/* «Мои программы» — общая панель проектов для двух редакторов: «Машинка»
 * (свободный режим) и «Основы Python» (песочница). Программа — обычный файл
 * .py в видимой папке ученика. Сохранение классическое: «Сохранить» или
 * Ctrl+S; автосохранение — только страховка-черновик, файл оно не подменяет,
 * поэтому точка у имени честно показывает «в файле не то, что на экране».
 *
 * window.sbProjects.create({
 *   prefix:   'proj' | 'pyproj'     — префикс id элементов панели в index.html
 *   panelId:  id рабочей панели      — Ctrl+S работает, когда эта панель на экране
 *   lastKey:  'lastProject' | 'lastPyProject' — ключ в настройках
 *   getCode, setCode, focus, starter(), onOpened(code), suggestName()
 * }) → { init(draft), save, saveAs, newProject, open, markDirty, name(), isDirty(), refreshUi }
 */
(() => {
  function tt(key) { try { return t(key); } catch (_) { return key; } }
  function fmt(key, map) { let s = tt(key); Object.keys(map).forEach((k) => { s = s.split('{' + k + '}').join(map[k]); }); return s; }
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  const $ = (id) => document.getElementById(id);

  /* Electron не умеет window.prompt — спрашиваем имя своим окошком.
     cursorAtEnd: не выделять текст, а поставить курсор в конец — так ученик
     дописывает своё к подставленной заготовке, а не стирает её первой буквой. */
  function askName(titleKey, initial, cursorAtEnd) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'proj-modal-back';
      const box = document.createElement('div');
      box.className = 'proj-modal';
      const h = document.createElement('div');
      h.className = 'proj-modal-h';
      h.textContent = tt(titleKey);
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'proj-modal-inp'; inp.maxLength = 60;
      inp.value = initial || '';
      const err = document.createElement('div');
      err.className = 'proj-modal-err';
      const btns = document.createElement('div');
      btns.className = 'proj-modal-btns';
      const cancel = document.createElement('button');
      cancel.className = 'btn btn-ghost btn-sm';
      cancel.textContent = tt('proj.cancel');
      const ok = document.createElement('button');
      ok.className = 'btn btn-primary btn-sm';
      ok.textContent = tt('proj.ok');
      btns.appendChild(cancel); btns.appendChild(ok);
      box.appendChild(h); box.appendChild(inp); box.appendChild(err); box.appendChild(btns);
      back.appendChild(box);
      document.body.appendChild(back);
      setTimeout(() => {
        inp.focus();
        if (cursorAtEnd) inp.setSelectionRange(inp.value.length, inp.value.length);
        else inp.select();
      }, 0);
      const close = (val) => { back.remove(); resolve(val); };
      const submit = () => {
        // «Урок 3 — » без дописанного: тире в конце убираем, имя урока годится
        const v = inp.value.replace(/\s*[—–]\s*$/, '').trim();
        if (!v) { err.textContent = tt('proj.badName'); return; }
        if (/[\\/:*?"<>|]/.test(v)) { err.textContent = tt('proj.badName'); return; }
        close(v);
      };
      ok.addEventListener('click', submit);
      cancel.addEventListener('click', () => close(null));
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
    });
  }

  function shortDate(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      return sameDay
        ? d.toLocaleTimeString(L() === 'kk' ? 'kk-KZ' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString(L() === 'kk' ? 'kk-KZ' : 'ru-RU', { day: '2-digit', month: '2-digit' });
    } catch (_) { return ''; }
  }

  const bars = [];   // все панели — чтобы закрывать меню по клику мимо

  function create(opts) {
    const P = opts.prefix;
    const ids = {
      pick: P + '-pick', name: P + '-name-text', dirty: P + '-dirty', menu: P + '-menu',
      save: 'btn-' + P + '-save', nw: 'btn-' + P + '-new', more: 'btn-' + P + '-more', moreMenu: P + '-more-menu'
    };
    let projName = null;    // имя открытой программы (null — ещё не сохранялась)
    let baseline = '';      // содержимое файла на момент последнего сохранения
    let dirty = false;
    let enabled = true;     // false — панель скрыта (например, в задании урока), Ctrl+S не работает

    function markDirty() {
      const d = enabled ? (opts.getCode() !== baseline) : false;
      if (d === dirty) return;
      dirty = d;
      updateUi();
    }
    function updateUi() {
      const nm = $(ids.name);
      if (nm) nm.textContent = projName || tt('proj.untitled');
      const dot = $(ids.dirty);
      if (dot) { dot.textContent = dirty ? '•' : ''; dot.title = dirty ? tt('proj.dirtyHint') : ''; }
      const sv = $(ids.save);
      if (sv) sv.classList.toggle('attention', dirty);
    }
    function okToDiscard() { return !dirty || confirm(tt('proj.dropChanges')); }
    async function remember(name) { try { await window.sb.setSettings({ [opts.lastKey]: name || '' }); } catch (_) {} }

    async function writeProject(name) {
      const r = await window.sb.saveProject(name, opts.getCode());
      if (!r || !r.ok) { alert(tt('proj.saveErr')); return false; }
      projName = r.name;
      baseline = opts.getCode();
      dirty = false;
      updateUi();
      await remember(projName);
      if (window.sbToast) window.sbToast('💾 ' + fmt('proj.savedToast', { name: projName }), { action: () => window.sb.revealProject(projName), label: tt('proj.show') });
      return true;
    }
    async function save() { if (!enabled) return; if (!projName) return saveAs(); await writeProject(projName); }
    async function saveAs() {
      if (!enabled) return;
      const sug = projName ? { value: projName, atEnd: false } : (opts.suggestName ? opts.suggestName() : { value: '', atEnd: false });
      const name = await askName('proj.askName', sug.value, sug.atEnd);
      if (!name) return;
      try {
        const ex = await window.sb.projectExists(name);
        if (ex && ex.exists && name !== projName && !confirm(tt('proj.overwrite'))) return;
      } catch (_) {}
      await writeProject(name);
    }
    async function newProject() {
      if (!okToDiscard()) return;
      projName = null;
      baseline = opts.starter();
      opts.setCode(baseline);
      dirty = false;
      updateUi();
      await remember('');
      if (opts.focus) opts.focus();
    }
    async function open(name) {
      if (!okToDiscard()) return;
      const r = await window.sb.loadProject(name);
      if (!r || !r.ok) return;
      projName = name;
      baseline = r.code;
      opts.setCode(r.code);
      dirty = false;
      updateUi();
      if (opts.onOpened) opts.onOpened(r.code);
      await remember(name);
      if (opts.focus) opts.focus();
    }
    async function rename() {
      if (!projName) return saveAs();
      const name = await askName('proj.askNewName', projName, false);
      if (!name || name === projName) return;
      const r = await window.sb.renameProject(projName, name);
      if (!r || !r.ok) { alert(tt(r && r.error === 'exists' ? 'proj.exists' : 'proj.saveErr')); return; }
      projName = r.name;
      updateUi();
      await remember(projName);
    }
    async function del() {
      if (!projName) return;
      if (!confirm(fmt('proj.delConfirm', { name: projName }))) return;
      await window.sb.deleteProject(projName);
      projName = null;
      baseline = opts.getCode();
      dirty = false;
      updateUi();
      await remember('');
    }

    /* ── меню ── */
    function closeMenus() { [ids.menu, ids.moreMenu].forEach((id) => { const m = $(id); if (m) m.classList.add('hidden'); }); }
    async function openListMenu() {
      const menu = $(ids.menu);
      if (!menu) return;
      if (!menu.classList.contains('hidden')) { closeMenus(); return; }
      bars.forEach((b) => b.closeMenus());
      menu.textContent = '';
      let list = [];
      try { list = await window.sb.listProjects(); } catch (_) {}
      if (!list.length) {
        const em = document.createElement('div');
        em.className = 'proj-menu-empty';
        em.textContent = tt('proj.empty');
        menu.appendChild(em);
      } else {
        list.forEach((p) => {
          const it = document.createElement('button');
          it.className = 'proj-menu-item' + (p.name === projName ? ' cur' : '');
          const n = document.createElement('span'); n.className = 'proj-menu-name'; n.textContent = p.name;
          const d = document.createElement('span'); d.className = 'proj-menu-date'; d.textContent = shortDate(p.updatedAt);
          it.appendChild(n); it.appendChild(d);
          it.addEventListener('click', () => { closeMenus(); open(p.name); });
          menu.appendChild(it);
        });
      }
      menu.classList.remove('hidden');
    }
    function openMoreMenu() {
      const menu = $(ids.moreMenu);
      if (!menu) return;
      if (!menu.classList.contains('hidden')) { closeMenus(); return; }
      bars.forEach((b) => b.closeMenus());
      menu.textContent = '';
      const items = [
        ['proj.saveAs', saveAs, false],
        ['proj.rename', rename, !projName],
        ['proj.delete', del, !projName],
        ['proj.openFolder', () => window.sb.revealProject(projName || ''), false],
        ['proj.changeFolder', async () => { await window.sb.chooseProjectsDir(); }, false]
      ];
      items.forEach(([key, fn, off]) => {
        const it = document.createElement('button');
        it.className = 'proj-menu-item';
        it.textContent = tt(key);
        if (off) it.disabled = true;
        else it.addEventListener('click', () => { closeMenus(); fn(); });
        menu.appendChild(it);
      });
      menu.classList.remove('hidden');
    }

    /* Стартовое состояние: файл последней открытой программы — «сохранённая
     * правда», черновик — то, что ученик успел натыкать. Возвращает код,
     * который надо показать в редакторе. */
    async function init(draft) {
      let fileCode = null;
      try {
        const st = await window.sb.getSettings();
        const last = st && st[opts.lastKey];
        if (last) {
          const r = await window.sb.loadProject(last);
          if (r && r.ok) { projName = last; fileCode = r.code; }
        }
      } catch (_) {}
      baseline = (fileCode !== null) ? fileCode : opts.starter();
      const value = (draft === null || draft === undefined || draft === '') ? baseline : draft;
      dirty = value !== baseline;
      updateUi();
      return value;
    }

    const wire = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    wire(ids.pick, openListMenu);
    wire(ids.more, openMoreMenu);
    wire(ids.save, () => save());
    wire(ids.nw, () => newProject());

    const bar = {
      init, save, saveAs, newProject, open, rename, del, markDirty, closeMenus, refreshUi: updateUi,
      name: () => projName, isDirty: () => dirty,
      setEnabled(v) { enabled = !!v; if (!v) { dirty = false; } updateUi(); },
      isOnScreen() { const p = $(opts.panelId); return !!(p && p.isConnected && !p.closest('.hidden') && enabled); }
    };
    bars.push(bar);
    return bar;
  }

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest || !e.target.closest('.proj-pick-wrap')) bars.forEach((b) => b.closeMenus());
  });
  // Ctrl+S работает и когда курсор не в редакторе (щёлкнул в консоль — и забыл).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      const b = bars.find((x) => x.isOnScreen());
      if (b) { e.preventDefault(); b.save(); }
    }
  });
  document.addEventListener('sb-lang-changed', () => bars.forEach((b) => b.refreshUi()));

  window.sbProjects = { create, askName };
})();
