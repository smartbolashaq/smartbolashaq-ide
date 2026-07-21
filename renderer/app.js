/* Главная логика Smart Bolashaq IDE: компилятор, монитор, проекты, настройки, обновления */

let editor = null;
let settings = {};
let busy = false;
let hintTimer = null;
let monitorOn = false;
let prevPage = 'compiler';

const $ = (id) => document.getElementById(id);

/* ───────────── Страницы ───────────── */
function showPage(name) {
  ['compiler', 'materials', 'settings'].forEach((n) => {
    $('tab-' + n).classList.toggle('hidden', n !== name);
  });
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name !== 'settings') prevPage = name;
  // рабочая панель следует за пользователем
  if (name === 'compiler') moveWorkPanel($('tab-compiler'));
  if (name === 'materials' && window.sbLessons) window.sbLessons.onShow();
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.tab));
});

$('btn-settings').addEventListener('click', async () => {
  await fillSettingsPage();
  showPage('settings');
});
$('btn-settings-close').addEventListener('click', () => showPage(prevPage));

/* Перемещение рабочей панели (редактор+консоль) между вкладкой и уроком */
function moveWorkPanel(container) {
  const panel = $('work-panel');
  if (panel.parentElement !== container) {
    container.appendChild(panel);
    if (editor) setTimeout(() => editor.cm.refresh(), 0);
  }
}

/* ───────────── Язык ───────────── */
$('lang-ru').addEventListener('click', () => setLang('ru'));
$('lang-kk').addEventListener('click', () => setLang('kk'));

function setLang(lang) {
  applyLang(lang);
  settings.lang = lang;
  window.sb.setSettings({ lang });
  renderPortsPlaceholder($('port-select'));
}

/* ───────────── Тема ───────────── */
function applyTheme(theme) {
  document.body.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  if (editor) editor.cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default');
}

/* ───────────── Статус и консоль ───────────── */
function setStatus(kind, key) {
  const b = $('status-badge');
  b.className = 'badge ' + kind;
  b.textContent = key ? t(key) : '';
}

function consoleAppend(el, text) {
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

window.sb.onCliOutput((text) => consoleAppend($('console'), text));

/* ───────────── Изменяемая высота консоли ───────────── */
(function initResizer() {
  const resizer = $('console-resizer');
  const wrap = $('console-wrap');
  let dragging = false;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const panelRect = $('work-panel').getBoundingClientRect();
    let h = panelRect.bottom - e.clientY;
    const max = panelRect.height - 160;
    h = Math.max(90, Math.min(h, max));
    wrap.style.height = h + 'px';
    if (editor) editor.cm.refresh();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.sb.setSettings({ consoleHeight: parseInt(wrap.style.height, 10) || 230 });
  });
})();

/* ───────────── Порты ───────────── */
function renderPortsPlaceholder(sel) {
  if (!sel.options.length || sel.options[0].value === '') {
    sel.innerHTML = `<option value="">${t('msg.portsNone')}</option>`;
  }
}

async function refreshPorts() {
  const sel = $('port-select');
  const prev = sel.value;
  const ports = await window.sb.listPorts();
  sel.innerHTML = '';
  if (!ports.length) {
    sel.innerHTML = `<option value="">${t('msg.portsNone')}</option>`;
    return false;
  }
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.address;
    opt.textContent = p.board ? `${p.address} — ${p.board}` : p.address;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  return true;
}

$('btn-ports').addEventListener('click', refreshPorts);

/* ───────────── Компиляция / загрузка ───────────── */
function setBusy(on) {
  busy = on;
  $('btn-verify').disabled = on;
  $('btn-upload').disabled = on;
}

$('btn-verify').addEventListener('click', async () => {
  if (busy || !editor) return;
  setBusy(true);
  switchConsoleTab('output');
  $('console').textContent = '';
  setStatus('busy', 'status.compiling');
  const r = await window.sb.compile(editor.getCode(), $('board-select').value);
  consoleAppend($('console'), '\n' + (r.ok ? t('msg.compileOk') : t('msg.compileErr')) + '\n');
  setStatus(r.ok ? 'ok' : 'err', r.ok ? 'status.ok' : 'status.error');
  setBusy(false);
});

$('btn-upload').addEventListener('click', async () => {
  if (busy || !editor) return;
  if (!$('port-select').value) {
    await refreshPorts();
    if (!$('port-select').value) {
      switchConsoleTab('output');
      $('console').textContent = t('msg.noPort') + '\n';
      setStatus('err', 'status.error');
      return;
    }
  }
  setBusy(true);
  stopMonitorUi();
  switchConsoleTab('output');
  $('console').textContent = '';
  setStatus('busy', 'status.uploading');
  const r = await window.sb.upload(editor.getCode(), $('board-select').value, $('port-select').value);
  consoleAppend($('console'), '\n' + (r.ok ? t('msg.uploadOk') : t('msg.uploadErr')) + '\n');
  setStatus(r.ok ? 'ok' : 'err', r.ok ? 'status.ok' : 'status.error');
  setBusy(false);
});

$('btn-reset').addEventListener('click', async () => {
  if (!editor) return;
  if (!confirm(t('msg.resetConfirm'))) return;
  const tpl = await window.sb.getTemplate();
  editor.reset(tpl);
});

$('board-select').addEventListener('change', () => {
  window.sb.setSettings({ fqbn: $('board-select').value });
});

/* ───────────── Монитор порта ───────────── */
function switchConsoleTab(name) {
  document.querySelectorAll('.con-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.con === name));
  $('console').classList.toggle('hidden', name !== 'output');
  $('monitor-pane').classList.toggle('hidden', name !== 'monitor');
}

document.querySelectorAll('.con-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchConsoleTab(btn.dataset.con));
});

function stopMonitorUi() {
  if (!monitorOn) return;
  monitorOn = false;
  window.sb.monitorStop();
  $('btn-mon-toggle').textContent = t('mon.start');
  $('btn-mon-toggle').classList.remove('btn-ghost');
  $('btn-mon-toggle').classList.add('btn-primary');
}

$('btn-mon-toggle').addEventListener('click', async () => {
  if (monitorOn) { stopMonitorUi(); return; }
  if (!$('port-select').value) {
    const found = await refreshPorts();
    if (!found) { $('mon-status').textContent = t('msg.noPort'); return; }
  }
  $('monitor-out').textContent = '';
  const r = await window.sb.monitorStart($('port-select').value, $('baud-select').value);
  if (r.ok) {
    monitorOn = true;
    $('mon-status').textContent = $('port-select').value + ' @ ' + $('baud-select').value;
    $('btn-mon-toggle').textContent = t('mon.stop');
    $('btn-mon-toggle').classList.remove('btn-primary');
    $('btn-mon-toggle').classList.add('btn-ghost');
  } else {
    $('mon-status').textContent = t('status.error');
  }
});

window.sb.onMonitorData((text) => consoleAppend($('monitor-out'), text));
window.sb.onMonitorClosed(() => {
  monitorOn = false;
  consoleAppend($('monitor-out'), '\n' + t('mon.closed') + '\n');
  $('btn-mon-toggle').textContent = t('mon.start');
  $('btn-mon-toggle').classList.remove('btn-ghost');
  $('btn-mon-toggle').classList.add('btn-primary');
});

function monitorSend() {
  const v = $('mon-input').value;
  if (!v || !monitorOn) return;
  window.sb.monitorSend(v);
  consoleAppend($('monitor-out'), '⟶ ' + v + '\n');
  $('mon-input').value = '';
}
$('btn-mon-send').addEventListener('click', monitorSend);
$('mon-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') monitorSend(); });

/* ───────────── Проекты ───────────── */
$('btn-projects').addEventListener('click', async () => {
  $('proj-note').textContent = '';
  await renderProjects();
  $('projects-modal').classList.remove('hidden');
});
$('btn-proj-close').addEventListener('click', () => $('projects-modal').classList.add('hidden'));

async function renderProjects() {
  const list = $('projects-list');
  const items = await window.sb.listProjects();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<p class="set-hint">${t('proj.empty')}</p>`;
    return;
  }
  for (const p of items) {
    const row = document.createElement('div');
    row.className = 'proj-row';
    const date = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '';
    row.innerHTML = `<span class="p-name"></span><span class="p-date">${date}</span>`;
    row.querySelector('.p-name').textContent = '🗂 ' + p.name;
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary btn-sm';
    openBtn.textContent = t('proj.open');
    openBtn.addEventListener('click', async () => {
      if (!confirm(t('proj.openConfirm'))) return;
      const r = await window.sb.loadProject(p.name);
      if (r.ok && editor) {
        await loadCodeIntoEditor(r.code);
        $('projects-modal').classList.add('hidden');
      }
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-sm';
    delBtn.textContent = t('proj.delete');
    delBtn.addEventListener('click', async () => {
      if (!confirm(t('proj.deleteConfirm') + ' «' + p.name + '»?')) return;
      await window.sb.deleteProject(p.name);
      renderProjects();
    });
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    list.appendChild(row);
  }
}

$('btn-proj-save').addEventListener('click', async () => {
  const name = $('proj-name').value.trim();
  if (!name || !editor) return;
  const r = await window.sb.saveProject(name, editor.getCode());
  if (r.ok) {
    $('proj-note').textContent = t('proj.saved');
    $('proj-name').value = '';
    renderProjects();
  }
});

async function loadCodeIntoEditor(code) {
  const tpl = await window.sb.getTemplate();
  const holder = $('editor');
  holder.innerHTML = '';
  editor = createLockedEditor(holder, tpl, showLockedHint, code);
  applyTheme(settings.theme);
  attachAutosave();
}

/* ───────────── Автосохранение ───────────── */
let autosaveTimer = null;
function attachAutosave() {
  editor.onChange(() => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      window.sb.autosaveSet('compiler', editor.getCode());
    }, 1500);
  });
}

/* ───────────── Настройки (страница ⚙) ───────────── */
async function fillSettingsPage() {
  settings = await window.sb.getSettings();
  $('set-autoupdate').checked = !!settings.autoUpdate;
  $('set-autolibs').checked = !!settings.autoLibs;
  ($('theme-' + (settings.theme === 'dark' ? 'dark' : 'light'))).checked = true;
  $('app-version').textContent = await window.sb.appVersion();
  renderLibs();
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
$('set-autolibs').addEventListener('change', () => {
  window.sb.setSettings({ autoLibs: $('set-autolibs').checked });
});

$('btn-check-update').addEventListener('click', async () => {
  const note = $('update-note');
  note.textContent = '…';
  const r = await window.sb.updaterCheck();
  if (r.ok) note.textContent = r.updateAvailable ? t('upd.available') : t('adm.noUpdate');
  else note.textContent = r.error === 'dev-mode' ? 'dev' : t('status.error');
  setTimeout(() => { note.textContent = ''; }, 5000);
});

async function renderLibs() {
  const libs = await window.sb.listLibs();
  $('libs-list').textContent = libs.length
    ? libs.map((l) => l.name + (l.version ? ' (' + l.version + ')' : '')).join(' · ')
    : '—';
}

$('btn-lib-install').addEventListener('click', async () => {
  const name = $('lib-name-input').value.trim();
  if (!name) return;
  const note = $('libs-note');
  note.textContent = '…';
  const r = await window.sb.installLibByName(name);
  note.textContent = r.ok ? t('adm.libs.done') : t('status.error');
  if (r.ok) $('lib-name-input').value = '';
  renderLibs();
});

$('btn-libs-sync').addEventListener('click', async () => {
  const note = $('libs-note');
  note.textContent = '…';
  const r = await window.sb.syncLibs(false);
  note.textContent = r.ok ? t('adm.libs.done') : t('status.error');
  renderLibs();
});

$('btn-libs-zip').addEventListener('click', async () => {
  const r = await window.sb.installLibZip();
  if (!r.canceled) {
    $('libs-note').textContent = r.ok ? t('adm.libs.done') : t('status.error');
    renderLibs();
  }
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

/* ───────────── Первый запуск и инициализация ───────────── */
window.sb.onSetupProgress((stage) => {
  $('setup-log').textContent += t('setup.' + stage) + '\n';
});

function showLockedHint() {
  clearTimeout(hintTimer);
  setStatus('err', 'msg.lockedHint');
  hintTimer = setTimeout(() => setStatus('', ''), 2500);
}

async function init() {
  settings = await window.sb.getSettings();
  applyLang(settings.lang || 'ru');
  document.body.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light';
  $('board-select').value = settings.fqbn || 'arduino:avr:uno';
  $('console-wrap').style.height = (settings.consoleHeight || 230) + 'px';
  renderPortsPlaceholder($('port-select'));

  const tpl = await window.sb.getTemplate();
  const saved = await window.sb.autosaveGet('compiler');
  editor = createLockedEditor($('editor'), tpl, showLockedHint, saved.ok ? saved.code : undefined);
  applyTheme(settings.theme);
  attachAutosave();

  const overlay = $('setup-overlay');
  overlay.classList.remove('hidden');
  const r = await window.sb.ensureSetup();
  if (!r.ok) {
    $('setup-log').textContent += '\n' + t('setup.error') + '\n\n' + (r.error || '');
    setTimeout(() => overlay.classList.add('hidden'), 6000);
  } else {
    overlay.classList.add('hidden');
  }
  refreshPorts();
}

/* Общие функции для lessons.js */
window.sbShared = {
  $, refreshPorts, consoleAppend, moveWorkPanel,
  getEditor: () => editor
};

init();
