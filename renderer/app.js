/* Главная логика Phygital Machines: вкладки, язык, тема, настройки, обновления,
 * стыковка Python-редактора «Бортовой компьютер» (своя вкладка ↔ урок). */

let settings = {};
let prevPage = 'manual';   // стартовая вкладка — «Инструкция»

const $ = (id) => document.getElementById(id);

/* ───────────── Страницы ───────────── */
function showPage(name) {
  ['manual', 'python', 'materials', 'settings', 'car'].forEach((n) => {
    const el = $('tab-' + n);
    if (el) el.classList.toggle('hidden', n !== name);
  });
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name !== 'settings') prevPage = name;
  if (name === 'manual' && window.sbManual) window.sbManual.onShow();
  if (name === 'materials' && window.sbLessons) window.sbLessons.onShow();
  if (name === 'car') dockCar($('tab-car'));
  if (name === 'python' && window.sbPy) window.sbPy.onShow();
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.tab));
});

$('btn-settings').addEventListener('click', async () => {
  await fillSettingsPage();
  showPage('settings');
});
$('btn-settings-close').addEventListener('click', () => showPage(prevPage));

/* Перемещение Python-панели «Бортовой компьютер» (редактор машинки) между
 * своей вкладкой и уроком: справа от PDF урока — тот же редактор машинки. */
function dockCar(container) {
  const p = $('car-work-panel');
  if (p && container && p.parentElement !== container) container.appendChild(p);
  if (window.sbCar) window.sbCar.onShow();
}

/* ───────────── Язык ───────────── */
$('lang-ru').addEventListener('click', () => setLang('ru'));
$('lang-kk').addEventListener('click', () => setLang('kk'));

function setLang(lang) {
  applyLang(lang);
  settings.lang = lang;
  window.sb.setSettings({ lang });
}

/* ───────────── Тема ───────────── */
function applyTheme(theme) {
  document.body.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  if (window.sbCar) window.sbCar.applyTheme(theme);
  if (window.sbPy) window.sbPy.applyTheme(theme);
}

/* ───────────── Настройки (страница ⚙) ───────────── */
async function fillSettingsPage() {
  settings = await window.sb.getSettings();
  $('set-autoupdate').checked = !!settings.autoUpdate;
  $('set-carhost').value = settings.carHost || '10.42.0.1';
  ($('theme-' + (settings.theme === 'dark' ? 'dark' : 'light'))).checked = true;
  $('app-version').textContent = await window.sb.appVersion();
}

['theme-light', 'theme-dark'].forEach((id) => {
  $(id).addEventListener('change', () => {
    const theme = $('theme-dark').checked ? 'dark' : 'light';
    settings.theme = theme;
    applyTheme(theme);
    window.sb.setSettings({ theme });
  });
});

$('set-autoupdate').addEventListener('change', () => {
  window.sb.setSettings({ autoUpdate: $('set-autoupdate').checked });
});
$('set-carhost').addEventListener('change', () => {
  window.sb.setSettings({ carHost: $('set-carhost').value.trim() || '10.42.0.1' });
});

$('btn-check-update').addEventListener('click', async () => {
  const note = $('update-note');
  note.className = 'saved-note';
  note.textContent = '…';
  const r = await window.sb.updaterCheck();
  if (r.ok && r.updateAvailable) {
    note.textContent = t('upd.available') + (r.version ? ' ' + r.version : '');
    if (r.manual) {
      showUpdateToast(t('upd.available') + ': ' + r.version, t('upd.download'),
        () => window.sb.updaterOpenDownloadPage());
    }
  } else if (r.ok) {
    note.textContent = t('adm.noUpdate');
  } else {
    note.className = 'err-note';
    note.textContent = t('status.error') + ': ' + String(r.error || '').slice(0, 160);
  }
  setTimeout(() => { note.textContent = ''; note.className = 'saved-note'; }, 12000);
});

/* ───────────── Обновления ───────────── */
let updState = 'none';

function showUpdateToast(msg, btnLabel, action) {
  $('update-msg').textContent = msg;
  const b = $('btn-upd-action');
  b.textContent = btnLabel || '';
  b.classList.toggle('hidden', !btnLabel);
  b.onclick = action || null;
  $('update-toast').classList.remove('hidden');
}

$('btn-upd-later').addEventListener('click', () => $('update-toast').classList.add('hidden'));

window.sb.onUpdateAvailable((info) => {
  updState = 'available';
  showUpdateToast(t('upd.available') + ': ' + info.version, t('upd.download'), async () => {
    updState = 'downloading';
    showUpdateToast(t('upd.downloading'), null, null);
    await window.sb.updaterDownload();
  });
});
window.sb.onUpdateProgress((p) => {
  if (updState === 'downloading') $('update-msg').textContent = t('upd.downloading') + ' ' + p.percent + '%';
});
window.sb.onUpdateDownloaded(() => {
  updState = 'ready';
  showUpdateToast(t('upd.ready'), t('upd.install'), () => window.sb.updaterInstall());
});
window.sb.onUpdateAvailableManual((info) => {
  showUpdateToast(t('upd.available') + ': ' + info.version, t('upd.download'),
    () => window.sb.updaterOpenDownloadPage());
});

/* ───────────── Инициализация ───────────── */
async function init() {
  settings = await window.sb.getSettings();
  applyLang(settings.lang || 'ru');
  applyTheme(settings.theme);
  showPage('manual'); // при запуске открыта вкладка «Инструкция»
}

/* Общие функции для lessons.js */
window.sbShared = { $, dockCar };

init();
