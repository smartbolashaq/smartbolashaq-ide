/*
 * Smart Bolashaq IDE — главный процесс Electron (v1.2).
 * Отвечает за: окно, arduino-cli (компиляция/прошивка/монитор порта),
 * PDF-уроки из облака, проекты учеников, библиотеки (включая
 * автоустановку из официального каталога Arduino), автообновление.
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const { pathToFileURL } = require('url');

let win = null;

/* ─────────────────────────── Пути ─────────────────────────── */

function userDir(...p) {
  return path.join(app.getPath('userData'), ...p);
}

function resourcesDir(...p) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build-resources');
  return path.join(base, ...p);
}

function cliPath() {
  const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(resourcesDir('arduino-cli'), exe);
}

function cliEnv() {
  const dataDir = userDir('arduino-data');
  return Object.assign({}, process.env, {
    ARDUINO_DIRECTORIES_DATA: dataDir,
    ARDUINO_DIRECTORIES_DOWNLOADS: path.join(dataDir, 'staging'),
    ARDUINO_DIRECTORIES_USER: userDir('sketchbook'),
    ARDUINO_LIBRARY_ENABLE_UNSAFE_INSTALL: 'true', // установка библиотек из zip
    ARDUINO_UPDATER_ENABLE_NOTIFICATION: 'false'
  });
}

/* ─────────────────────── Запуск arduino-cli ─────────────────────── */

function runCli(args, { stream = false } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try {
      child = spawn(cliPath(), args, { env: cliEnv(), windowsHide: true });
    } catch (e) {
      resolve({ code: -1, out: '', err: String(e) });
      return;
    }
    child.on('error', (e) => resolve({ code: -1, out, err: err + '\n' + String(e) }));
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (stream && win) win.webContents.send('cli-output', d.toString());
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (stream && win) win.webContents.send('cli-output', d.toString());
    });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function notifyCli(text) {
  if (win) win.webContents.send('cli-output', text);
}

/* Первый запуск: копируем встроенные ядро AVR и библиотеки. Офлайн. */
async function ensureSetup() {
  const dataDir = userDir('arduino-data');
  const marker = path.join(dataDir, '.sb-ready');
  try {
    if (!fs.existsSync(marker)) {
      const bundled = resourcesDir('arduino-data');
      if (fs.existsSync(bundled)) {
        if (win) win.webContents.send('setup-progress', 'copy');
        fs.cpSync(bundled, dataDir, { recursive: true });
      } else {
        if (win) win.webContents.send('setup-progress', 'download');
        let r = await runCli(['core', 'update-index'], { stream: true });
        if (r.code !== 0) return { ok: false, error: r.err || r.out };
        r = await runCli(['core', 'install', 'arduino:avr'], { stream: true });
        if (r.code !== 0) return { ok: false, error: r.err || r.out };
      }
      fs.writeFileSync(marker, new Date().toISOString());
    }
    const libMarker = userDir('sketchbook', '.sb-libs-ready');
    const bundledUser = resourcesDir('arduino-user');
    if (!fs.existsSync(libMarker) && fs.existsSync(bundledUser)) {
      if (win) win.webContents.send('setup-progress', 'libs');
      fs.cpSync(bundledUser, userDir('sketchbook'), { recursive: true, force: false });
      fs.writeFileSync(libMarker, new Date().toISOString());
    }
    syncCloudLibraries(false).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ─────── Автоустановка библиотек из официального каталога ─────── */

let libIndexUpdated = false;

/* Ищет в выводе компилятора отсутствующие заголовки: "FastLED.h: No such file..." */
function missingHeaders(text) {
  const re = /(?:fatal error|error):\s*([A-Za-z0-9_\-. ]+\.h)[^\n]*No such file/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) found.add(m[1].trim());
  return [...found];
}

/* Подбирает библиотеку в официальном каталоге по имени заголовка */
async function findLibraryForHeader(header) {
  const base = header.replace(/\.h$/i, '');
  const queries = [base, base.replace(/_/g, ' ')];
  for (const q of queries) {
    const r = await runCli(['lib', 'search', q, '--format', 'json']);
    let list = [];
    try {
      const parsed = JSON.parse(r.out);
      list = parsed.libraries || parsed || [];
    } catch (_) { continue; }
    if (!Array.isArray(list) || !list.length) continue;
    // 1) библиотека, которая официально предоставляет этот заголовок
    const byInclude = list.find((l) => {
      const inc = (l.latest && l.latest.provides_includes) || l.provides_includes || [];
      return inc.some((h) => h.toLowerCase() === header.toLowerCase());
    });
    if (byInclude) return byInclude.name;
    // 2) точное совпадение имени
    const byName = list.find((l) => l.name && l.name.toLowerCase() === base.toLowerCase());
    if (byName) return byName.name;
    // 3) первый результат поиска
    if (list[0] && list[0].name) return list[0].name;
  }
  return null;
}

/* Пытается доустановить недостающие библиотеки. Возвращает true, если что-то установилось. */
async function tryAutoInstallLibs(compileOutput) {
  const headers = missingHeaders(compileOutput);
  if (!headers.length) return false;
  if (!libIndexUpdated) {
    notifyCli('\n⏬ Обновление каталога библиотек Arduino…\n');
    const r = await runCli(['lib', 'update-index']);
    if (r.code !== 0) {
      notifyCli('⚠ Нет доступа к каталогу библиотек (нет интернета?)\n');
      return false;
    }
    libIndexUpdated = true;
  }
  let installedAny = false;
  for (const h of headers) {
    notifyCli('\n🔎 Не хватает библиотеки для ' + h + ' — ищу в каталоге Arduino…\n');
    const name = await findLibraryForHeader(h);
    if (!name) {
      notifyCli('⚠ Библиотека для ' + h + ' не найдена в каталоге.\n');
      continue;
    }
    notifyCli('⏬ Устанавливаю библиотеку «' + name + '»…\n');
    const r = await runCli(['lib', 'install', name], { stream: true });
    if (r.code === 0) installedAny = true;
    else notifyCli('⚠ Не удалось установить «' + name + '».\n');
  }
  if (installedAny && win) win.webContents.send('libs-updated', headers);
  return installedAny;
}

/* ─────────────────── Компиляция и загрузка ─────────────────── */

function writeSketch(code) {
  const dir = userDir('sketches', 'sb_sketch');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sb_sketch.ino'), code, 'utf8');
  return dir;
}

async function runBuild(args) {
  let r = await runCli(args, { stream: true });
  if (r.code !== 0 && loadSettings().autoLibs) {
    const fixed = await tryAutoInstallLibs(r.out + '\n' + r.err);
    if (fixed) {
      notifyCli('\n🔁 Повторная компиляция…\n\n');
      r = await runCli(args, { stream: true });
    }
  }
  return r;
}

ipcMain.handle('setup:ensure', () => ensureSetup());

ipcMain.handle('sketch:compile', async (_e, { code, fqbn }) => {
  const dir = writeSketch(code);
  const r = await runBuild(['compile', '--fqbn', fqbn || 'arduino:avr:uno', dir]);
  return { ok: r.code === 0, output: r.out, error: r.err };
});

ipcMain.handle('sketch:upload', async (_e, { code, fqbn, port }) => {
  await stopMonitor();
  const dir = writeSketch(code);
  const r = await runBuild(
    ['compile', '--upload', '--fqbn', fqbn || 'arduino:avr:uno', '--port', port, dir]
  );
  return { ok: r.code === 0, output: r.out, error: r.err };
});

/* Определение китайских клонов Arduino: они используют USB-чипы
 * CH340/CH341 (VID 1A86) или CP2102 (VID 10C4) и не опознаются
 * как «настоящие» Arduino. Показываем их с подсказкой. */
function detectClone(p) {
  const props = p.properties || p.hardware_id || {};
  const vid = String(props.vid || props.VID || '').toUpperCase().replace('0X', '');
  const pid = String(props.pid || props.PID || '').toUpperCase().replace('0X', '');
  if (vid.includes('1A86')) return 'CH340';                    // WCH CH340/CH341
  if (vid.includes('10C4') && pid.includes('EA60')) return 'CP2102'; // Silicon Labs
  return null;
}

ipcMain.handle('ports:list', async () => {
  const r = await runCli(['board', 'list', '--format', 'json']);
  const ports = [];
  try {
    const parsed = JSON.parse(r.out);
    const list = parsed.detected_ports || parsed.ports || parsed || [];
    for (const item of list) {
      const p = item.port || item;
      if (!p || !p.address) continue;
      if (p.protocol && p.protocol !== 'serial') continue;
      let board = (item.matching_boards || item.boards || [])
        .map((b) => b.name).filter(Boolean).join(', ');
      const clone = detectClone(p);
      if (!board && clone) board = 'Arduino Nano';
      ports.push({ address: p.address, label: p.label || p.address, board, clone: !!clone });
    }
  } catch (_) { /* нет плат */ }
  return ports;
});

/* ─────────────────── Монитор порта ─────────────────── */

let monitorChild = null;

function stopMonitor() {
  return new Promise((resolve) => {
    if (!monitorChild) return resolve();
    const child = monitorChild;
    monitorChild = null;
    child.once('close', () => resolve());
    try { child.kill(); } catch (_) { resolve(); }
    setTimeout(resolve, 1500);
  });
}

ipcMain.handle('monitor:start', async (_e, { port, baud }) => {
  await stopMonitor();
  try {
    monitorChild = spawn(
      cliPath(),
      ['monitor', '-p', port, '--config', 'baudrate=' + (baud || 9600)],
      { env: cliEnv(), windowsHide: true }
    );
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  const child = monitorChild;
  child.stdout.on('data', (d) => { if (win) win.webContents.send('monitor-data', d.toString()); });
  child.stderr.on('data', (d) => { if (win) win.webContents.send('monitor-data', d.toString()); });
  child.on('close', () => {
    if (monitorChild === child) monitorChild = null;
    if (win) win.webContents.send('monitor-closed');
  });
  child.on('error', () => {
    if (monitorChild === child) monitorChild = null;
    if (win) win.webContents.send('monitor-closed');
  });
  return { ok: true };
});

ipcMain.handle('monitor:send', (_e, { text }) => {
  if (!monitorChild || !monitorChild.stdin.writable) return { ok: false };
  try { monitorChild.stdin.write(text + '\n'); return { ok: true }; }
  catch (_) { return { ok: false }; }
});

ipcMain.handle('monitor:stop', async () => { await stopMonitor(); return { ok: true }; });

/* ─────────────────────── Настройки ─────────────────────── */

const DEFAULT_SETTINGS = {
  // Облако с уроками Smart Bolashaq (встроено, меняется в настройках)
  materialsUrl: 'https://raw.githubusercontent.com/smartbolashaq/smartbolashaq-materials/main/',
  lang: 'ru',
  fqbn: 'arduino:avr:uno',
  autoUpdate: true,
  autoLibs: true,
  theme: 'light',
  consoleHeight: 230
};

function loadSettings() {
  try {
    return Object.assign({}, DEFAULT_SETTINGS,
      JSON.parse(fs.readFileSync(userDir('settings.json'), 'utf8')));
  } catch (_) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(patch) {
  const s = Object.assign(loadSettings(), patch);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userDir('settings.json'), JSON.stringify(s, null, 2));
  return s;
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch));

/* ─────────────────────── Шаблон кода ─────────────────────── */

function localTemplate() {
  const candidates = [
    resourcesDir('template.json'),
    path.join(__dirname, 'resources', 'template.json')
  ];
  for (const f of candidates) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* далее */ }
  }
  return { lines: [{ text: 'void setup() {', locked: true }, { text: '  ', locked: false }, { text: '}', locked: true }, { text: 'void loop() {', locked: true }, { text: '  ', locked: false }, { text: '}', locked: true }] };
}

ipcMain.handle('template:get', async () => {
  const cached = userDir('cache', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(cached, 'utf8'));
    if (m.template && Array.isArray(m.template.lines)) return m.template;
  } catch (_) { /* нет кэша */ }
  return localTemplate();
});

/* ─────────────────── Загрузка из облака ─────────────────── */

function fetchUrl(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const normBase = (u) => (u.endsWith('/') ? u : u + '/');
const badRel = (f) => !f || f.includes('..') || path.isAbsolute(f);

async function cachedFetch(file, { forceFresh = false } = {}) {
  if (badRel(file)) throw new Error('bad-file');
  const local = userDir('cache', 'files', file);
  if (!forceFresh && fs.existsSync(local)) return local;
  const s = loadSettings();
  if (!s.materialsUrl) {
    if (fs.existsSync(local)) return local;
    throw new Error('no-url');
  }
  try {
    const buf = await fetchUrl(normBase(s.materialsUrl) + encodeURI(file));
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, buf);
    return local;
  } catch (e) {
    if (fs.existsSync(local)) return local;
    throw e;
  }
}

/* ─────────────────── Материалы (PDF-уроки) ─────────────────── */

async function getManifest() {
  const cacheDir = userDir('cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedManifest = path.join(cacheDir, 'manifest.json');
  const s = loadSettings();
  let manifest = null, fromCache = false;
  if (s.materialsUrl) {
    try {
      const buf = await fetchUrl(normBase(s.materialsUrl) + 'manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
      fs.writeFileSync(cachedManifest, buf);
    } catch (_) { /* офлайн */ }
  }
  if (!manifest) {
    manifest = JSON.parse(fs.readFileSync(cachedManifest, 'utf8'));
    fromCache = true;
  }
  return { manifest, fromCache };
}

ipcMain.handle('materials:list', async () => {
  try {
    const { manifest, fromCache } = await getManifest();
    const materials = (manifest.materials || []).map((m) => ({
      ...m,
      downloaded: fs.existsSync(userDir('cache', 'files', m.file || ''))
    }));
    return { ok: true, fromCache, materials };
  } catch (_) {
    const s = loadSettings();
    return { ok: false, error: s.materialsUrl ? 'offline' : 'no-url', materials: [] };
  }
});

ipcMain.handle('materials:open', async (_e, { file }) => {
  try {
    const local = await cachedFetch(file);
    return { ok: true, path: pathToFileURL(local).href };
  } catch (e) {
    return { ok: false, error: 'download-failed', detail: String(e) };
  }
});

/* ─────────────────── Библиотеки: список и установка ─────────────────── */

ipcMain.handle('libs:list', async () => {
  const r = await runCli(['lib', 'list', '--format', 'json']);
  const libs = [];
  try {
    const parsed = JSON.parse(r.out);
    const arr = parsed.installed_libraries || parsed || [];
    for (const item of arr) {
      const l = item.library || item;
      if (l && l.name) libs.push({ name: l.name, version: l.version || '' });
    }
  } catch (_) { /* пусто */ }
  return libs;
});

/* Установка библиотек из manifest.json облака (поле libraries) */
async function syncCloudLibraries(force) {
  let manifest;
  try { ({ manifest } = await getManifest()); } catch (_) { return { ok: false, error: 'offline', installed: [] }; }
  const wanted = manifest.libraries || [];
  const installed = [];
  const errors = [];
  for (const lib of wanted) {
    if (!lib || !lib.zip || badRel(lib.zip) || !lib.name) continue;
    const libDir = userDir('sketchbook', 'libraries', lib.name);
    if (fs.existsSync(libDir) && !force) continue;
    try {
      const zipLocal = await cachedFetch(lib.zip, { forceFresh: force });
      if (fs.existsSync(libDir)) fs.rmSync(libDir, { recursive: true, force: true });
      const r = await runCli(['lib', 'install', '--zip-path', zipLocal]);
      if (r.code === 0) installed.push(lib.name);
      else errors.push(lib.name + ': ' + (r.err || r.out));
    } catch (e) {
      errors.push(lib.name + ': ' + String(e));
    }
  }
  if (installed.length && win) win.webContents.send('libs-updated', installed);
  return { ok: errors.length === 0, installed, errors };
}

ipcMain.handle('libs:sync', (_e, { force } = {}) => syncCloudLibraries(!!force));

ipcMain.handle('libs:installZip', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите zip-файл библиотеки',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const r = await runCli(['lib', 'install', '--zip-path', res.filePaths[0]]);
  return { ok: r.code === 0, error: r.err || r.out };
});

/* Установка по имени из официального каталога (поле в настройках) */
ipcMain.handle('libs:installByName', async (_e, { name }) => {
  if (!name || !String(name).trim()) return { ok: false };
  if (!libIndexUpdated) {
    const u = await runCli(['lib', 'update-index']);
    if (u.code === 0) libIndexUpdated = true;
  }
  const r = await runCli(['lib', 'install', String(name).trim()]);
  return { ok: r.code === 0, error: r.err || r.out };
});

/* ─────────────────── Проекты учеников ─────────────────── */

const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);

function projectsDir() {
  const d = userDir('projects');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

ipcMain.handle('projects:list', () => {
  const out = [];
  for (const f of fs.readdirSync(projectsDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(projectsDir(), f), 'utf8'));
      out.push({ name: j.name, updatedAt: j.updatedAt });
    } catch (_) { /* пропускаем */ }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
});

ipcMain.handle('projects:save', (_e, { name, code }) => {
  const n = safeName(name);
  if (!n) return { ok: false, error: 'bad-name' };
  fs.writeFileSync(path.join(projectsDir(), n + '.json'),
    JSON.stringify({ name: n, code, updatedAt: new Date().toISOString() }, null, 2));
  return { ok: true, name: n };
});

ipcMain.handle('projects:load', (_e, { name }) => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(projectsDir(), safeName(name) + '.json'), 'utf8'));
    return { ok: true, code: j.code };
  } catch (_) { return { ok: false }; }
});

ipcMain.handle('projects:delete', (_e, { name }) => {
  try { fs.rmSync(path.join(projectsDir(), safeName(name) + '.json')); return { ok: true }; }
  catch (_) { return { ok: false }; }
});

const autosaveFile = (key) => userDir('autosave-' + String(key).replace(/[^a-z0-9_-]/gi, '_') + '.json');

ipcMain.handle('autosave:set', (_e, { key, code }) => {
  try { fs.writeFileSync(autosaveFile(key), JSON.stringify({ code })); return { ok: true }; }
  catch (_) { return { ok: false }; }
});
ipcMain.handle('autosave:get', (_e, { key }) => {
  try { return { ok: true, code: JSON.parse(fs.readFileSync(autosaveFile(key), 'utf8')).code }; }
  catch (_) { return { ok: false }; }
});

/* ─────────────────── Автообновление ─────────────────── */

let updater = null;

function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-available', (info) => {
      if (win) win.webContents.send('update-available', { version: info.version });
    });
    updater.on('download-progress', (p) => {
      if (win) win.webContents.send('update-progress', { percent: Math.round(p.percent) });
    });
    updater.on('update-downloaded', () => {
      if (win) win.webContents.send('update-downloaded');
    });
    updater.on('error', () => { /* тихо: нет интернета и т.п. */ });
    if (loadSettings().autoUpdate) {
      setTimeout(() => updater.checkForUpdates().catch(() => {}), 5000);
    }
  } catch (_) { /* модуль недоступен */ }
}

ipcMain.handle('updater:check', async () => {
  if (!updater) return { ok: false, error: 'dev-mode' };
  try {
    const res = await updater.checkForUpdates();
    const newer = res && res.updateInfo && res.updateInfo.version !== app.getVersion();
    return { ok: true, updateAvailable: !!newer };
  } catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('updater:download', async () => {
  if (!updater) return { ok: false };
  try { await updater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('updater:install', () => {
  if (updater) updater.quitAndInstall();
  return { ok: true };
});
ipcMain.handle('app:version', () => app.getVersion());

/* ─────────────────────── Окно ─────────────────────── */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Smart Bolashaq IDE',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
});
app.on('before-quit', () => { stopMonitor(); });
app.on('window-all-closed', () => app.quit());
