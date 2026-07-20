/* Режим администратора: вход, настройки, библиотеки, конструктор уроков */

(function () {
  const { $ } = window.sbShared;
  let isAdmin = false;

  /* ───────── Вход ───────── */
  $('btn-admin').addEventListener('click', () => {
    if (isAdmin) { openAdmin(); return; }
    $('admin-pass-input').value = '';
    $('admin-error').classList.add('hidden');
    $('admin-modal').classList.remove('hidden');
    $('admin-pass-input').focus();
  });

  $('btn-admin-cancel').addEventListener('click', () => $('admin-modal').classList.add('hidden'));

  async function tryLogin() {
    const r = await window.sb.adminLogin($('admin-pass-input').value);
    if (r.ok) {
      isAdmin = true;
      $('admin-modal').classList.add('hidden');
      openAdmin();
    } else {
      $('admin-error').classList.remove('hidden');
    }
  }
  $('btn-admin-login').addEventListener('click', tryLogin);
  $('admin-pass-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });

  async function openAdmin() {
    const s = await window.sb.getSettings();
    $('set-materials-url').value = s.materialsUrl || '';
    $('set-autoupdate').checked = !!s.autoUpdate;
    $('app-version').textContent = await window.sb.appVersion();
    renderLibs();
    // показать страницу админа
    ['tab-compiler', 'tab-materials'].forEach((id) => $(id).classList.add('hidden'));
    $('tab-admin').classList.remove('hidden');
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  }

  $('btn-admin-exit').addEventListener('click', () => {
    isAdmin = false;
    $('tab-admin').classList.add('hidden');
    $('tab-compiler').classList.remove('hidden');
    document.querySelectorAll('.tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === 'compiler'));
  });

  /* ───────── Настройки ───────── */
  $('btn-save-settings').addEventListener('click', async () => {
    await window.sb.setSettings({
      materialsUrl: $('set-materials-url').value.trim(),
      autoUpdate: $('set-autoupdate').checked
    });
    const note = $('settings-saved');
    note.textContent = '✓';
    note.classList.remove('hidden');
    setTimeout(() => note.classList.add('hidden'), 2000);
  });

  $('btn-check-update').addEventListener('click', async () => {
    const note = $('settings-saved');
    note.textContent = '…';
    note.classList.remove('hidden');
    const r = await window.sb.updaterCheck();
    note.textContent = r.ok ? t('adm.noUpdate') : (r.error === 'dev-mode' ? 'dev' : t('status.error'));
    setTimeout(() => note.classList.add('hidden'), 4000);
  });

  /* ───────── Пароль ───────── */
  $('btn-pass-change').addEventListener('click', async () => {
    const r = await window.sb.adminSetPassword($('pass-old').value, $('pass-new').value);
    const note = $('pass-note');
    if (r.ok) {
      note.textContent = t('adm.pass.ok');
      note.className = 'set-hint saved-note';
      $('pass-old').value = ''; $('pass-new').value = '';
    } else {
      note.textContent = r.error === 'too-short' ? t('adm.pass.tooShort') : t('adm.pass.wrongOld');
      note.className = 'set-hint err-note';
    }
  });

  /* ───────── Библиотеки ───────── */
  async function renderLibs() {
    const libs = await window.sb.listLibs();
    $('libs-list').textContent = libs.length
      ? libs.map((l) => l.name + (l.version ? ' (' + l.version + ')' : '')).join(' · ')
      : '—';
  }

  async function doSync(force) {
    const note = $('libs-note');
    note.textContent = '…';
    const r = await window.sb.syncLibs(force);
    note.textContent = r.ok ? t('adm.libs.done')
      : t('adm.libs.err') + ' ' + (r.errors || []).join('; ');
    renderLibs();
  }
  $('btn-libs-sync').addEventListener('click', () => doSync(false));
  $('btn-libs-force').addEventListener('click', () => doSync(true));
  $('btn-libs-zip').addEventListener('click', async () => {
    const r = await window.sb.installLibZip();
    if (!r.canceled) {
      $('libs-note').textContent = r.ok ? t('adm.libs.done') : t('status.error');
      renderLibs();
    }
  });

  /* ───────── Конструктор уроков ───────── */
  const steps = [];   // { kind, ru, kk, file, code }
  const checks = [];  // { text, ru, kk }

  document.querySelectorAll('.ctor-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      steps.push({ kind: btn.dataset.kind, ru: '', kk: '', file: '', code: '' });
      renderSteps();
    });
  });

  function renderSteps() {
    const box = $('ctor-steps');
    box.innerHTML = '';
    steps.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'ctor-step';
      const kindNames = { text: t('ctor.addText'), image: t('ctor.addImage'), code: t('ctor.addCode'), task: t('ctor.addTask') };
      const head = document.createElement('div');
      head.className = 'step-head';
      head.innerHTML = `<span class="step-kind">${(kindNames[s.kind] || s.kind).replace('+ ', '')} #${i + 1}</span>`;
      const del = document.createElement('button');
      del.className = 'step-del';
      del.textContent = '✕ ' + t('ctor.remove');
      del.addEventListener('click', () => { steps.splice(i, 1); renderSteps(); });
      head.appendChild(del);
      d.appendChild(head);

      if (s.kind === 'text' || s.kind === 'task') {
        const ru = document.createElement('textarea');
        ru.rows = 3; ru.placeholder = t('ctor.text.ru'); ru.value = s.ru;
        ru.addEventListener('input', () => { s.ru = ru.value; regenManifest(); });
        const kk = document.createElement('textarea');
        kk.rows = 3; kk.placeholder = t('ctor.text.kk'); kk.value = s.kk;
        kk.addEventListener('input', () => { s.kk = kk.value; regenManifest(); });
        d.appendChild(ru); d.appendChild(kk);
      } else if (s.kind === 'image') {
        const f = document.createElement('input');
        f.type = 'text'; f.placeholder = t('ctor.image.file'); f.value = s.file;
        f.addEventListener('input', () => { s.file = f.value; regenManifest(); });
        d.appendChild(f);
      } else if (s.kind === 'code') {
        const c = document.createElement('textarea');
        c.rows = 4; c.placeholder = t('ctor.code.text'); c.value = s.code;
        c.style.fontFamily = 'Consolas, monospace';
        c.addEventListener('input', () => { s.code = c.value; regenManifest(); });
        d.appendChild(c);
      }
      box.appendChild(d);
    });
  }

  /* Галочки защищённых строк для стартового кода */
  const lockedSet = new Set();
  $('ctor-template').addEventListener('input', renderLocks);

  function renderLocks() {
    const box = $('ctor-locks');
    box.innerHTML = '';
    const lines = $('ctor-template').value.split('\n');
    lines.forEach((line, i) => {
      const row = document.createElement('label');
      row.className = 'lock-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = lockedSet.has(i);
      cb.addEventListener('change', () => {
        if (cb.checked) lockedSet.add(i); else lockedSet.delete(i);
        regenManifest();
        renderLocks();
      });
      const span = document.createElement('span');
      span.textContent = (lockedSet.has(i) ? '🔒 ' : '   ') + (line || ' ');
      row.appendChild(cb);
      row.appendChild(span);
      box.appendChild(row);
    });
  }

  $('ctor-check-add').addEventListener('click', () => {
    checks.push({ text: '', ru: '', kk: '' });
    renderChecks();
  });

  function renderChecks() {
    const box = $('ctor-checks');
    box.innerHTML = '';
    checks.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'ctor-step';
      const head = document.createElement('div');
      head.className = 'step-head';
      head.innerHTML = `<span class="step-kind">#${i + 1}</span>`;
      const del = document.createElement('button');
      del.className = 'step-del';
      del.textContent = '✕ ' + t('ctor.remove');
      del.addEventListener('click', () => { checks.splice(i, 1); renderChecks(); });
      head.appendChild(del);
      d.appendChild(head);
      const mk = (ph, key) => {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = ph; inp.value = c[key];
        inp.addEventListener('input', () => { c[key] = inp.value; regenManifest(); });
        return inp;
      };
      d.appendChild(mk(t('ctor.check.text'), 'text'));
      d.appendChild(mk(t('ctor.check.msgRu'), 'ru'));
      d.appendChild(mk(t('ctor.check.msgKk'), 'kk'));
      box.appendChild(d);
    });
  }

  function buildLesson() {
    const id = ($('ctor-id').value.trim() || 'lesson').replace(/[^a-z0-9_-]/gi, '');
    const tplLines = $('ctor-template').value.split('\n');
    const lesson = {
      title_ru: $('ctor-title-ru').value.trim(),
      title_kk: $('ctor-title-kk').value.trim(),
      steps: steps.map((s) => {
        if (s.kind === 'image') return { type: 'image', file: s.file.trim() };
        if (s.kind === 'code') return { type: 'code', text: s.code };
        return { type: s.kind, ru: s.ru, kk: s.kk };
      }),
      template: {
        lines: tplLines.map((text, i) => ({ text, locked: lockedSet.has(i) }))
      },
      check: {
        requireCompile: $('ctor-check-compile').checked,
        contains: checks.filter((c) => c.text.trim()).map((c) => ({
          text: c.text.trim(), ru: c.ru, kk: c.kk
        }))
      }
    };
    return { id, lesson };
  }

  function regenManifest() {
    const { id, lesson } = buildLesson();
    const entry = {
      id,
      type: 'interactive',
      title_ru: lesson.title_ru,
      title_kk: lesson.title_kk,
      file: 'lessons/' + id + '.json'
    };
    $('ctor-manifest').value = JSON.stringify(entry, null, 2) + ',';
  }
  ['ctor-id', 'ctor-title-ru', 'ctor-title-kk'].forEach((id) =>
    $(id).addEventListener('input', regenManifest));
  $('ctor-check-compile').addEventListener('change', regenManifest);

  $('ctor-export').addEventListener('click', async () => {
    const { id, lesson } = buildLesson();
    await window.sb.exportLesson(id + '.json', JSON.stringify(lesson, null, 2));
    regenManifest();
  });

  document.addEventListener('sb-lang-changed', () => { renderSteps(); renderChecks(); });
})();
