/* Главная логика интерфейса Smart Bolashaq IDE */

let editor = null;
let settings = { lang: 'ru', fqbn: 'arduino:avr:uno', materialsUrl: '' };
let busy = false;
let hintTimer = null;

const $ = (id) => document.getElementById(id);

/* ───────────── Вкладки ───────────── */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ['compiler', 'materials', 'settings'].forEach((name) => {
      $('tab-' + name).classList.toggle('hidden', name !== btn.dataset.tab);
    });
    if (btn.dataset.tab === 'materials') loadMaterials();
  });
});

/* ───────────── Язык ───────────── */
$('lang-ru').addEventListener('click', () => setLang('ru'));
$('lang-kk').addEventListener('click', () => setLang('kk'));

function setLang(lang) {
  applyLang(lang);
  settings.lang = lang;
  window.sb.setSettings({ lang });
  renderPortsPlaceholder();
}

/* ───────────── Статус и консоль ───────────── */
function setStatus(kind, key) {
  const b = $('status-badge');
  b.className = 'badge ' + kind;
  b.textContent = key ? t(key) : '';
}

function consoleAppend(text) {
  const c = $('console');
  c.textContent += text;
  c.scrollTop = c.scrollHeight;
}

function consoleClear() { $('console').textContent = ''; }

window.sb.onCliOutput((text) => consoleAppend(text));

/* ───────────── Порты ───────────── */
function renderPortsPlaceholder() {
  const sel = $('port-select');
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
    return;
  }
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.address;
    opt.textContent = p.board ? `${p.address} — ${p.board}` : p.address;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
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
  consoleClear();
  setStatus('busy', 'status.compiling');
  const r = await window.sb.compile(editor.getCode(), $('board-select').value);
  consoleAppend('\n' + (r.ok ? t('msg.compileOk') : t('msg.compileErr')) + '\n');
  setStatus(r.ok ? 'ok' : 'err', r.ok ? 'status.ok' : 'status.error');
  setBusy(false);
});

$('btn-upload').addEventListener('click', async () => {
  if (busy || !editor) return;
  const port = $('port-select').value;
  if (!port) {
    await refreshPorts();
    if (!$('port-select').value) {
      consoleClear();
      consoleAppend(t('msg.noPort') + '\n');
      setStatus('err', 'status.error');
      return;
    }
  }
  setBusy(true);
  consoleClear();
  setStatus('busy', 'status.uploading');
  const r = await window.sb.upload(editor.getCode(), $('board-select').value, $('port-select').value);
  consoleAppend('\n' + (r.ok ? t('msg.uploadOk') : t('msg.uploadErr')) + '\n');
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

/* ───────────── Материалы ───────────── */
async function loadMaterials() {
  const info = $('materials-info');
  const list = $('materials-list');
  info.textContent = '…';
  const r = await window.sb.listMaterials();
  list.innerHTML = '';
  if (!r.ok && r.error === 'no-url') { info.textContent = t('mat.noUrl'); return; }
  if (!r.ok) { info.textContent = t('mat.offline'); return; }
  info.textContent = r.fromCache ? t('mat.offline') : '';
  if (!r.materials.length) { info.textContent = t('mat.empty'); return; }

  for (const m of r.materials) {
    const card = document.createElement('div');
    card.className = 'mat-card';
    const title = currentLang === 'kk' ? (m.title_kk || m.title_ru || m.title) : (m.title_ru || m.title || m.title_kk);
    const desc = currentLang === 'kk' ? (m.description_kk || m.description_ru || '') : (m.description_ru || m.description || '');
    card.innerHTML = `
      <h3></h3>
      <p></p>
      <span class="mat-status ${m.downloaded ? 'cached' : 'cloud'}">${m.downloaded ? t('mat.cached') : t('mat.cloud')}</span>`;
    card.querySelector('h3').textContent = '📘 ' + (title || m.file);
    card.querySelector('p').textContent = desc;
    card.addEventListener('click', () => openMaterial(m, title));
    list.appendChild(card);
  }
}

async function openMaterial(m, title) {
  const r = await window.sb.openMaterial(m.file);
  if (!r.ok) {
    $('materials-info').textContent = t('mat.downloadErr');
    return;
  }
  $('materials-list-view').classList.add('hidden');
  $('materials-pdf-view').classList.remove('hidden');
  $('pdf-title').textContent = title || m.file;
  $('pdf-frame').src = r.path;
  $('btn-pdf-external').onclick = () => window.sb.openMaterialExternal(m.file);
}

$('btn-pdf-back').addEventListener('click', () => {
  $('pdf-frame').src = 'about:blank';
  $('materials-pdf-view').classList.add('hidden');
  $('materials-list-view').classList.remove('hidden');
  loadMaterials();
});

$('btn-mat-refresh').addEventListener('click', loadMaterials);

/* ───────────── Настройки ───────────── */
$('btn-save-settings').addEventListener('click', async () => {
  const url = $('set-materials-url').value.trim();
  settings = await window.sb.setSettings({ materialsUrl: url });
  const note = $('settings-saved');
  note.classList.remove('hidden');
  setTimeout(() => note.classList.add('hidden'), 2000);
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
  $('board-select').value = settings.fqbn || 'arduino:avr:uno';
  $('set-materials-url').value = settings.materialsUrl || '';
  renderPortsPlaceholder();

  const tpl = await window.sb.getTemplate();
  editor = createLockedEditor($('editor'), tpl, showLockedHint);

  // Подготовка arduino-cli (один раз при первом запуске)
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

init();
