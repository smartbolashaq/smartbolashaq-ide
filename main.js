/*
 * Phygital Machines — главный процесс Electron.
 * Отвечает за: окно, PDF-уроки из облака, настройки, автосохранение,
 * связь с машинкой («Бортовой компьютер», TCP), автообновление.
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
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

/* ─────────────────────── Настройки ─────────────────────── */

const DEFAULT_SETTINGS = {
  // Облако с уроками Smart Bolashaq (встроено, меняется в настройках)
  materialsUrl: 'https://raw.githubusercontent.com/smartbolashaq/smartbolashaq-materials/main/',
  lang: 'ru',
  autoUpdate: true,
  theme: 'light',
  consoleHeight: 230,
  carHost: '10.42.0.1'
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
      downloaded: [m.file, m.file_ru, m.file_kk].some(
        (f) => f && !badRel(f) && fs.existsSync(userDir('cache', 'files', f))
      )
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

/* ─────────────────── Мини-тесты (quizzes.json из облака) ───────────────────
 * Отдельный файл рядом с manifest.json:
 *   { "version": 1, "quizzes": { "lesson0": { "ru": [...], "kk": [...] }, ... } }
 * Каждый вопрос: { "q": "...", "answers": ["..."], "correct": 0, "expl": "..." }.
 * Свежая версия подтягивается при каждом открытии урока; офлайн — из кеша. */

async function getQuizzes() {
  const cacheDir = userDir('cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedFile = path.join(cacheDir, 'quizzes.json');
  const s = loadSettings();
  let data = null;
  if (s.materialsUrl) {
    try {
      const buf = await fetchUrl(normBase(s.materialsUrl) + 'quizzes.json');
      data = JSON.parse(buf.toString('utf8'));
      fs.writeFileSync(cachedFile, buf);
    } catch (_) { /* офлайн или файла ещё нет */ }
  }
  if (!data && fs.existsSync(cachedFile)) {
    try { data = JSON.parse(fs.readFileSync(cachedFile, 'utf8')); } catch (_) { /* битый кеш */ }
  }
  return data;
}

ipcMain.handle('quiz:get', async (_e, { lessonId }) => {
  try {
    const data = await getQuizzes();
    const entry = data && data.quizzes && data.quizzes[lessonId];
    return { ok: true, quiz: entry || null };
  } catch (_) {
    return { ok: false, quiz: null };
  }
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

const RELEASES_PAGE = 'https://github.com/smartbolashaq/smartbolashaq-ide/releases';
let updater = null;

function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/* Запасная проверка обновлений: напрямую читаем latest.yml из
 * последнего релиза GitHub. Работает даже если electron-updater сбоит. */
async function manualUpdateCheck() {
  const buf = await fetchUrl(RELEASES_PAGE + '/latest/download/latest.yml');
  const m = buf.toString('utf8').match(/version:\s*([0-9][0-9a-zA-Z.\-]*)/);
  if (!m) throw new Error('latest.yml: version not found');
  const remote = m[1];
  return { version: remote, updateAvailable: cmpVersions(remote, app.getVersion()) > 0 };
}

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
    updater.on('error', () => { /* тихо: обработка ниже, запасной механизм */ });
    if (loadSettings().autoUpdate) {
      setTimeout(async () => {
        try {
          await updater.checkForUpdates();
        } catch (_) {
          // основной механизм не сработал — запасной
          try {
            const r = await manualUpdateCheck();
            if (r.updateAvailable && win) {
              win.webContents.send('update-available-manual', { version: r.version });
            }
          } catch (_) { /* офлайн */ }
        }
      }, 5000);
    }
  } catch (_) { /* модуль недоступен */ }
}

ipcMain.handle('updater:check', async () => {
  // 1) основной механизм (electron-updater, умеет ставить обновление сам)
  let mainError = null;
  if (updater) {
    try {
      const res = await updater.checkForUpdates();
      const newer = res && res.updateInfo &&
        cmpVersions(res.updateInfo.version, app.getVersion()) > 0;
      return { ok: true, updateAvailable: !!newer };
    } catch (e) {
      mainError = String((e && e.message) || e);
    }
  } else {
    mainError = 'dev-mode';
  }
  // 2) запасной: прямое чтение latest.yml с GitHub
  try {
    const r = await manualUpdateCheck();
    return { ok: true, updateAvailable: r.updateAvailable, version: r.version, manual: true, mainError };
  } catch (e) {
    return { ok: false, error: mainError + ' | fallback: ' + String((e && e.message) || e) };
  }
});

ipcMain.handle('updater:openDownloadPage', () => {
  shell.openExternal(RELEASES_PAGE + '/latest');
  return { ok: true };
});
ipcMain.handle('updater:download', async () => {
  if (!updater) return { ok: false };
  try { await updater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('updater:install', () => {
  // quitAndInstall(true, true): тихая установка без экранов мастера
  // и автоматический запуск программы после обновления
  if (updater) updater.quitAndInstall(true, true);
  return { ok: true };
});
ipcMain.handle('app:version', () => app.getVersion());


/* ─────────── «Бортовой компьютер»: связь с машинкой ───────────
 * ПК подключён к Wi-Fi машинки; малинка слушает TCP-порт 5010 и
 * говорит JSON-строками (по одной на строку):
 *   → {"op":"run","code":"..."}   запустить код ученика
 *   → {"op":"stop"}               остановить
 *   ← {"ev":"hello","car":"12"}   номер машинки при подключении
 *   ← {"ev":"out","text":"..."}   вывод программы ученика (print/ошибки)
 *   ← {"ev":"state","running":true/false, "error":"..."} состояние
 */
const net = require('net');
const CAR_PORT = 5010;
let carSock = null;
let carBuf = '';

function carEmit(channel, data) { if (win) win.webContents.send(channel, data); }

function carDisconnect() {
  if (carSock) { try { carSock.destroy(); } catch (_) { /* уже закрыт */ } }
  carSock = null;
  carBuf = '';
}

ipcMain.handle('car:connect', async (_e, { host } = {}) => {
  // Порядок: явный адрес → кабель (USB-gadget) → Wi-Fi машинки → из настроек
  const hosts = [];
  const push = (h) => { h = String(h || '').trim(); if (h && !hosts.includes(h)) hosts.push(h); };
  push(host);
  push('10.55.0.1');                 // USB-кабель
  push('169.254.55.1');              // USB-кабель (служебный link-local адрес)
  push('10.42.0.1');                 // Wi-Fi машинки
  push(loadSettings().carHost);
  let lastErr = 'no-host';
  for (const h of hosts) {
    const r = await carTryConnect(h);
    if (r.ok) return r;
    lastErr = r.error;
  }
  return { ok: false, error: lastErr };
});

function carTryConnect(addr) {
  carDisconnect();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let sock;
    try {
      sock = net.createConnection({ host: addr, port: CAR_PORT });
    } catch (e) {
      return done({ ok: false, error: String(e) });
    }
    carSock = sock;
    sock.setTimeout(5000);
    sock.on('timeout', () => {
      if (!settled) { done({ ok: false, error: 'timeout' }); carDisconnect(); }
    });
    sock.on('connect', () => {
      sock.setTimeout(0);
      sock.setNoDelay(true);
      done({ ok: true });
      carEmit('car-state', { connected: true });
    });
    sock.on('data', (d) => {
      carBuf += d.toString('utf8');
      let i;
      while ((i = carBuf.indexOf('\n')) >= 0) {
        const line = carBuf.slice(0, i);
        carBuf = carBuf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.ev === 'out') carEmit('car-output', String(msg.text || ''));
        else carEmit('car-state', msg);
      }
    });
    sock.on('error', (e) => {
      done({ ok: false, error: String((e && e.message) || e) });
    });
    sock.on('close', () => {
      if (carSock === sock) {
        carSock = null;
        carEmit('car-state', { connected: false, running: false });
      }
      done({ ok: false, error: 'closed' });
    });
  });
}

function carSend(obj) {
  if (!carSock) return false;
  try { carSock.write(JSON.stringify(obj) + '\n'); return true; }
  catch (_) { return false; }
}

ipcMain.handle('car:run', (_e, { code }) => ({ ok: carSend({ op: 'run', code }) }));
ipcMain.handle('car:save', (_e, { code }) => ({ ok: carSend({ op: 'save', code }) }));
ipcMain.handle('car:clear', () => ({ ok: carSend({ op: 'clear' }) }));
ipcMain.handle('car:stop', () => ({ ok: carSend({ op: 'stop' }) }));
ipcMain.handle('car:hit', () => ({ ok: carSend({ op: 'hit' }) }));
ipcMain.handle('car:disconnect', () => {
  carDisconnect();
  carEmit('car-state', { connected: false, running: false });
  return { ok: true };
});

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
  // Контекстное меню «Копировать/Вставить» по правой кнопке мыши
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.selectionText) items.push({ role: 'copy', label: 'Копировать' });
    if (params.isEditable) {
      items.push({ role: 'paste', label: 'Вставить' });
      if (params.selectionText) items.push({ role: 'cut', label: 'Вырезать' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupUpdater();
});
app.on('before-quit', () => { carDisconnect(); });
app.on('window-all-closed', () => app.quit());
