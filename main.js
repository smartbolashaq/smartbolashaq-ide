/*
 * Smart Bolashaq IDE — главный процесс Electron.
 * Отвечает за: окно, запуск arduino-cli, методички (PDF), настройки.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');
const { pathToFileURL } = require('url');

let win = null;

/* ─────────────────────────── Пути ─────────────────────────── */

function userDir(...p) {
  return path.join(app.getPath('userData'), ...p);
}

function resourcesDir(...p) {
  // В собранном приложении — process.resourcesPath, в разработке — папка проекта
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

/* Первый запуск: скопировать встроенное ядро AVR в папку пользователя,
 * чтобы arduino-cli мог писать в неё. Работает полностью офлайн. */
async function ensureSetup() {
  const dataDir = userDir('arduino-data');
  const marker = path.join(dataDir, '.sb-ready');
  if (fs.existsSync(marker)) return { ok: true, already: true };

  const bundled = resourcesDir('arduino-data');
  try {
    if (fs.existsSync(bundled)) {
      if (win) win.webContents.send('setup-progress', 'copy');
      fs.cpSync(bundled, dataDir, { recursive: true });
    } else {
      // Резервный вариант: ядро не встроено — скачиваем из интернета
      if (win) win.webContents.send('setup-progress', 'download');
      let r = await runCli(['core', 'update-index'], { stream: true });
      if (r.code !== 0) return { ok: false, error: r.err || r.out };
      r = await runCli(['core', 'install', 'arduino:avr'], { stream: true });
      if (r.code !== 0) return { ok: false, error: r.err || r.out };
    }
    fs.writeFileSync(marker, new Date().toISOString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/* ─────────────────── Компиляция и загрузка ─────────────────── */

function writeSketch(code) {
  const dir = userDir('sketches', 'sb_sketch');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sb_sketch.ino'), code, 'utf8');
  return dir;
}

ipcMain.handle('setup:ensure', () => ensureSetup());

ipcMain.handle('sketch:compile', async (_e, { code, fqbn }) => {
  const dir = writeSketch(code);
  const r = await runCli(['compile', '--fqbn', fqbn || 'arduino:avr:uno', dir], { stream: true });
  return { ok: r.code === 0, output: r.out, error: r.err };
});

ipcMain.handle('sketch:upload', async (_e, { code, fqbn, port }) => {
  const dir = writeSketch(code);
  const r = await runCli(
    ['compile', '--upload', '--fqbn', fqbn || 'arduino:avr:uno', '--port', port, dir],
    { stream: true }
  );
  return { ok: r.code === 0, output: r.out, error: r.err };
});

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
      const boards = (item.matching_boards || item.boards || [])
        .map((b) => b.name).filter(Boolean).join(', ');
      ports.push({ address: p.address, label: p.label || p.address, board: boards });
    }
  } catch (_) { /* нет плат или старый формат — вернём пустой список */ }
  return ports;
});

/* ─────────────────────── Настройки ─────────────────────── */

const DEFAULT_SETTINGS = {
  materialsUrl: '',   // например: https://raw.githubusercontent.com/USER/REPO/main/
  lang: 'ru',
  fqbn: 'arduino:avr:uno'
};

function loadSettings() {
  try {
    return Object.assign({}, DEFAULT_SETTINGS,
      JSON.parse(fs.readFileSync(userDir('settings.json'), 'utf8')));
  } catch (_) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const s = Object.assign(loadSettings(), patch);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userDir('settings.json'), JSON.stringify(s, null, 2));
  return s;
});

/* ─────────────────────── Шаблон кода ─────────────────────── */

function localTemplate() {
  const candidates = [
    resourcesDir('template.json'),                    // рядом с приложением (можно править)
    path.join(__dirname, 'resources', 'template.json') // внутри пакета
  ];
  for (const f of candidates) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* следующий */ }
  }
  return { lines: [{ text: 'void setup() {', locked: true }, { text: '  ', locked: false }, { text: '}', locked: true }, { text: 'void loop() {', locked: true }, { text: '  ', locked: false }, { text: '}', locked: true }] };
}

ipcMain.handle('template:get', async () => {
  // Если в облачном manifest.json есть шаблон — используем его (кэшируется)
  const cached = userDir('cache', 'manifest.json');
  try {
    const m = JSON.parse(fs.readFileSync(cached, 'utf8'));
    if (m.template && Array.isArray(m.template.lines)) return m.template;
  } catch (_) { /* нет кэша */ }
  return localTemplate();
});

/* ─────────────────── Методички (PDF из облака) ─────────────────── */

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

function normBase(u) {
  return u.endsWith('/') ? u : u + '/';
}

ipcMain.handle('materials:list', async () => {
  const s = loadSettings();
  const cacheDir = userDir('cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedManifest = path.join(cacheDir, 'manifest.json');

  let manifest = null, fromCache = false;
  if (s.materialsUrl) {
    try {
      const buf = await fetchUrl(normBase(s.materialsUrl) + 'manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
      fs.writeFileSync(cachedManifest, buf);
    } catch (_) { /* офлайн — попробуем кэш */ }
  }
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(cachedManifest, 'utf8'));
      fromCache = true;
    } catch (_) {
      return { ok: false, error: s.materialsUrl ? 'offline' : 'no-url', materials: [] };
    }
  }
  const materials = (manifest.materials || []).map((m) => ({
    ...m,
    downloaded: fs.existsSync(path.join(cacheDir, 'pdf', m.file || ''))
  }));
  return { ok: true, fromCache, materials };
});

ipcMain.handle('materials:open', async (_e, { file }) => {
  if (!file || file.includes('..') || path.isAbsolute(file)) {
    return { ok: false, error: 'bad-file' };
  }
  const s = loadSettings();
  const pdfDir = userDir('cache', 'pdf');
  fs.mkdirSync(pdfDir, { recursive: true });
  const local = path.join(pdfDir, file);

  if (!fs.existsSync(local)) {
    if (!s.materialsUrl) return { ok: false, error: 'no-url' };
    try {
      const buf = await fetchUrl(normBase(s.materialsUrl) + encodeURI(file));
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, buf);
    } catch (e) {
      return { ok: false, error: 'download-failed', detail: String(e) };
    }
  }
  return { ok: true, path: pathToFileURL(local).href };
});

ipcMain.handle('materials:openExternal', async (_e, { file }) => {
  if (!file || file.includes('..') || path.isAbsolute(file)) return { ok: false };
  const local = userDir('cache', 'pdf', file);
  if (fs.existsSync(local)) { shell.openPath(local); return { ok: true }; }
  return { ok: false };
});

/* ─────────────────────── Окно ─────────────────────── */

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Smart Bolashaq IDE',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true // встроенный просмотр PDF
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
