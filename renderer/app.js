/* Главная логика Phygital Machines: вкладки, язык, тема, настройки,
 * обновления, масштаб, короткие уведомления (тосты). Три вкладки:
 * «Домой», «Основы Python», «Машинка»; инструкция и настройки — страницы
 * поверх них с кнопкой «Назад». */

let settings = {};
let prevPage = 'home';   // куда возвращаться из настроек / инструкции

const $ = (id) => document.getElementById(id);
const PAGES = ['home', 'python', 'car', 'manual', 'settings'];
const TABS = ['home', 'python', 'car'];

/* ───────────── Страницы ───────────── */
function showPage(name) {
  if (!PAGES.includes(name)) name = 'home';
  PAGES.forEach((n) => { const el = $('tab-' + n); if (el) el.classList.toggle('hidden', n !== name); });
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (TABS.includes(name)) prevPage = name;
  if (window.sbTips && window.sbTips.isActive()) window.sbTips.dismiss();
  if (name === 'home' && window.sbHome) window.sbHome.onShow();
  if (name === 'manual' && window.sbManual) window.sbManual.onShow();
  if (name === 'car' && window.sbCarTab) window.sbCarTab.onShow();
  if (name === 'python') { if (window.sbPy) window.sbPy.onShow(); if (window.sbCourse) window.sbCourse.onShow(); }
  try { window.sb.setSettings({ lastPage: TABS.includes(name) ? name : prevPage }); } catch (_) {}
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.tab));
});

$('btn-settings').addEventListener('click', async () => {
  await fillSettingsPage();
  showPage('settings');
});
$('btn-settings-close').addEventListener('click', () => showPage(prevPage));
$('btn-help').addEventListener('click', () => showPage('manual'));
$('btn-manual-close').addEventListener('click', () => showPage(prevPage));

/* Перемещение рабочей панели машинки между свободным режимом и уроком. */
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

/* ───────────── Масштаб (Ctrl + / − / 0) ───────────── */
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
let zoomFactor = 1;
function applyZoom(f) {
  zoomFactor = ZOOM_STEPS.reduce((best, z) => (Math.abs(z - f) < Math.abs(best - f) ? z : best), 1);
  try { window.sb.setZoom(zoomFactor); } catch (_) {}
  const v = $('zoom-value'); if (v) v.textContent = Math.round(zoomFactor * 100) + '%';
  settings.zoom = zoomFactor;
  window.sb.setSettings({ zoom: zoomFactor });
  if (window.sbToast) window.sbToast('🔍 ' + Math.round(zoomFactor * 100) + '%', { short: true });
}
function zoomStep(dir) {
  const i = ZOOM_STEPS.indexOf(zoomFactor);
  const j = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 2 : i) + dir));
  applyZoom(ZOOM_STEPS[j]);
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomStep(1); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(-1); }
  else if (e.key === '0') { e.preventDefault(); applyZoom(1); }
});
$('btn-zoom-plus').addEventListener('click', () => zoomStep(1));
$('btn-zoom-minus').addEventListener('click', () => zoomStep(-1));

/* ───────────── Тосты: короткие уведомления в углу ───────────── */
window.sbToast = function (text, opts) {
  opts = opts || {};
  const box = $('toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span'); span.textContent = text; el.appendChild(span);
  if (opts.action && opts.label) {
    const a = document.createElement('button'); a.className = 'toast-act'; a.textContent = opts.label;
    a.addEventListener('click', () => { try { opts.action(); } catch (_) {} el.remove(); });
    el.appendChild(a);
  }
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, opts.short ? 1200 : 4500);
};

/* ───────────── Настройки (страница ⚙) ───────────── */
async function fillSettingsPage() {
  settings = await window.sb.getSettings();
  $('set-autoupdate').checked = !!settings.autoUpdate;
  $('set-carhost').value = settings.carHost || '10.42.0.1';
  ($('theme-' + (settings.theme === 'dark' ? 'dark' : 'light'))).checked = true;
  $('app-version').textContent = await window.sb.appVersion();
  $('zoom-value').textContent = Math.round((settings.zoom || 1) * 100) + '%';
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
$('btn-tips-reset').addEventListener('click', async () => {
  if (window.sbTips) await window.sbTips.reset();
  if (window.sbToast) window.sbToast('✓ ' + t('set.tipsResetDone'));
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

/* ───────────── Точка связи во вкладке «Машинка» ───────────── */
document.addEventListener('sb-car-state', (e) => {
  const st = e.detail || {};
  const dot = $('car-tab-dot');
  if (!dot) return;
  dot.className = 'tab-dot' + (st.connected ? ' on' : st.connecting ? ' busy' : '');
  dot.title = st.connected ? t('car.on') + (st.carId ? ' · №' + st.carId : '') : t('car.off');
});

/* ───────────── Инициализация ───────────── */
async function init() {
  settings = await window.sb.getSettings();
  // остальные скрипты (home.js, lessons.js, …) могли ещё не загрузиться, пока ждали настройки
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  applyLang(settings.lang || 'ru');
  applyTheme(settings.theme);
  zoomFactor = settings.zoom || 1;
  if (zoomFactor !== 1) { try { window.sb.setZoom(zoomFactor); } catch (_) {} }
  try { $('top-version').textContent = 'v' + await window.sb.appVersion(); } catch (_) {}
  showPage('home'); // при запуске — стартовый экран
}

/* Общие функции для других модулей */
window.sbShared = { $, dockCar, showPage };

init();
