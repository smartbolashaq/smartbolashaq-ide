/* Курс: список модулей слева, урок справа, автопроверка заданий. Одна и та же
 * машинерия для двух курсов — «Основы Python» (песочница + модули, код
 * исполняется на ПК) и «Уроки с машинкой» (модули; код исполняется на
 * виртуальной машинке, а по кнопке — на настоящей). Рабочая панель одна
 * (py.js, window.sbPy): она переезжает под открытое задание.
 *
 *   window.sbMakeCourse({
 *     key: 'py' | 'car',           mode панели py.js: обычный Python или машинка
 *     data, intro,                 модули и введение (course-data.js / car-course-data.js)
 *     progressKey: 'pyProgress',   где хранить прогресс в настройках
 *     ids: { root, nav, page, viewPage, park, progressText, progressBar, navTitle, navSub,
 *            viewSandbox, sandboxSlot }   (последние два — только у курса с песочницей)
 *   })
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  const T = (x) => (x == null ? '' : (typeof x === 'string' ? x : (x[L()] || x.ru || '')));
  const tt = (key, vars) => {
    let s; try { s = t(key); } catch (_) { s = key; }
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const LV = { g: 'py.lvG', y: 'py.lvY', r: 'py.lvR' };

  /* ───────── подсветка кода в уроке (CodeMirror runMode) ───────── */
  function codeBlock(code, file, out) {
    const wrap = document.createElement('div'); wrap.className = 'py-term';
    const bar = document.createElement('div'); bar.className = 'py-term-bar';
    bar.innerHTML = '<b class="r"></b><b class="y"></b><b class="g"></b><span>' + esc(file || '') + '</span>';
    wrap.appendChild(bar);
    const pre = document.createElement('pre'); pre.className = 'py-term-code cm-s-material-darker';
    if (window.CodeMirror && CodeMirror.runMode) CodeMirror.runMode(code, 'python', pre); else pre.textContent = code;
    wrap.appendChild(pre);
    if (out) {
      const o = document.createElement('div'); o.className = 'py-term-out';
      o.innerHTML = '<em>&gt;&gt;&gt; ' + esc(tt('py.output')) + '</em>\n' + esc(out);
      wrap.appendChild(o);
    }
    return wrap;
  }

  /* ───────── сравнение вывода (курс Python) ───────── */
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();
  const numsOf = (s) => (String(s || '').match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(',', '.')));
  const valuesOf = (s) => String(s || '').split('\n').map((l) => norm(l)).filter(Boolean).map((l) => l.split(' ').pop());
  const TOL = 0.011;
  const near = (a, b) => Math.abs(a - b) <= TOL;
  function seqEqual(a, b) { return a.length === b.length && a.every((x, i) => near(x, b[i])); }
  function subseq(need, have) { let j = 0; for (const x of have) { if (j < need.length && near(need[j], x)) j++; } return j === need.length; }
  const fmtNum = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
  function needsRef(spec) { return spec.numbers === true || spec.values || spec.text || spec.turtle; }
  function shapeOf(segments) {
    const lens = [], xs = [], ys = [];
    (segments || []).forEach((k) => {
      const [x1, y1, x2, y2] = k.split(',').map(Number);
      lens.push(Math.round(Math.hypot(x2 - x1, y2 - y1)));
      xs.push(x1, x2); ys.push(y1, y2);
    });
    lens.sort((a, b) => a - b);
    const ext = (arr) => (arr.length ? [Math.abs(Math.min(...arr)), Math.abs(Math.max(...arr))].sort((p, q) => p - q) : [0, 0]);
    return { lens, ex: ext(xs), ey: ext(ys), n: lens.length };
  }
  function shapesEqual(a, b) {
    if (a.n !== b.n) return false;
    for (let i = 0; i < 2; i++) if (Math.abs(a.ex[i] - b.ex[i]) > 2 || Math.abs(a.ey[i] - b.ey[i]) > 2) return false;
    return a.lens.every((x, i) => Math.abs(x - b.lens[i]) <= 1);
  }
  function judgeText(spec, res, ref) {
    const out = res.output || '';
    const fails = [];
    if (spec.text && norm(out) !== norm(ref.output)) fails.push({ why: tt('py.whyText'), expected: ref.output });
    if (spec.values) {
      const a = valuesOf(out), b = valuesOf(ref.output);
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) fails.push({ why: tt('py.whyValues'), expected: ref.output });
    }
    if (spec.numbers) {
      const need = spec.numbers === true ? numsOf(ref.output) : spec.numbers;
      const have = numsOf(out);
      if (!(spec.exact ? seqEqual(need, have) : subseq(need, have))) fails.push({ why: tt(spec.exact ? 'py.whyNumbersExact' : 'py.whyNumbers', { v: need.map(fmtNum).join(', ') }) });
    }
    if (spec.expect) { const n = norm(out); spec.expect.forEach((g) => { if (!g.some((alt) => n.includes(norm(alt)))) fails.push({ why: tt('py.whyExpect', { v: g.map((x) => '«' + x + '»').join(' / ') }) }); }); }
    if (spec.forbid) { const n = norm(out); spec.forbid.forEach((g) => { const hit = g.find((alt) => n.includes(norm(alt))); if (hit) fails.push({ why: tt('py.whyForbid', { v: '«' + hit + '»' }) }); }); }
    if (spec.regex) spec.regex.forEach((r) => {
      const re = new RegExp(r.re, (r.flags || '') + (String(r.flags || '').includes('g') ? '' : 'g'));
      const cnt = (out.match(re) || []).length;
      if (cnt < (r.min || 1)) fails.push({ why: tt('py.whyLines', { n: r.min || 1, k: cnt }) });
    });
    if (spec.file) {
      const all = (res.files && res.files.all) || {}, f = spec.file, content = all[f.name];
      if (content == null) fails.push({ why: tt('py.whyFileMissing', { f: f.name }) });
      else {
        const lines = content.split('\n').filter((l) => l.trim());
        if (f.minLines && lines.length < f.minLines) fails.push({ why: tt('py.whyFileLines', { f: f.name, n: f.minLines, k: lines.length }) });
        if (f.contains && !norm(content).includes(norm(f.contains))) fails.push({ why: tt('py.whyFileContains', { f: f.name, v: f.contains }) });
      }
    }
    if (spec.turtle) {
      const a = shapeOf(res.segments), b = shapeOf(ref.segments);
      if (a.n === 0) fails.push({ why: tt('py.whyTurtleEmpty') });
      else if (!shapesEqual(a, b)) fails.push({ why: tt('py.whyTurtle', { n: b.n, k: a.n }) });
    }
    return fails;
  }

  /* описание сценария виртуальной машинки для отчёта: «кнопка 1 в 0.5 с, попадание в 2 с» */
  function describeCarTest(spec) {
    const parts = [];
    (spec.events || []).forEach((e) => {
      if (e[1] === 'btn') parts.push(tt('car.evBtn', { n: e[2], t: e[0] }));
      else if (e[1] === 'hit') parts.push(tt('car.evHit', { t: e[0] }));
    });
    if (spec.inputs) Object.keys(spec.inputs).forEach((p) => parts.push(tt('car.evPin', { p, v: spec.inputs[p] })));
    return parts.length ? parts.join(', ') : tt('car.evNone');
  }

  function makeCourse(cfg) {
    const COURSE = cfg.data || [], INTRO = cfg.intro || {}, ids = cfg.ids, hasSandbox = !!ids.sandboxSlot;
    const ROOT = () => $(ids.root);
    let view = hasSandbox ? 'sandbox' : 'intro';
    let openTaskId = null;
    let progress = { solved: {}, done: {} };
    let checking = false;
    let curTask = null;

    async function loadProgress() {
      try { const s = await window.sb.getSettings(); if (s && s[cfg.progressKey]) progress = Object.assign({ solved: {}, done: {} }, s[cfg.progressKey]); } catch (_) {}
    }
    function saveProgress() { try { window.sb.setSettings({ [cfg.progressKey]: progress }); } catch (_) {} }
    const isSolved = (id) => !!progress.solved[id];
    function moduleDone(m) { return m.tasks.every((tk) => isSolved(tk.id)); }
    function setSolved(id, v) { if (v) progress.solved[id] = true; else delete progress.solved[id]; saveProgress(); renderNav(); }

    /* ───────── боковая панель ───────── */
    function renderNav() {
      const box = $(ids.nav); if (!box) return;
      box.innerHTML = '';
      let done = 0;
      COURSE.forEach((m, i) => {
        const d = moduleDone(m); if (d) done++;
        const b = document.createElement('button');
        b.className = 'py-nav-item' + (view === m.id ? ' active' : '');
        b.dataset.view = m.id;
        const solved = m.tasks.filter((tk) => isSolved(tk.id)).length;
        b.innerHTML = '<span class="py-dot' + (d ? ' done' : (view === m.id ? ' now' : '')) + '">' + (d ? '✓' : (view === m.id ? '▶' : '')) + '</span>'
          + '<span class="py-nav-t">' + (i + 1) + '. ' + esc(T(m.short)) + '</span>'
          + (solved && !d ? '<span class="py-nav-n">' + solved + '/' + m.tasks.length + '</span>' : '');
        b.addEventListener('click', () => show(m.id));
        box.appendChild(b);
      });
      const root = ROOT();
      if (root) root.querySelectorAll('.py-nav-item[data-view="sandbox"], .py-nav-item[data-view="intro"]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      const pt = $(ids.progressText), pb = $(ids.progressBar);
      if (pt) pt.textContent = tt('py.progress', { n: done, m: COURSE.length });
      if (pb) pb.style.width = (COURSE.length ? Math.round(done / COURSE.length * 100) : 0) + '%';
      const lt = $(ids.navTitle), ls = $(ids.navSub);
      if (lt && INTRO.title) lt.textContent = T(INTRO.title);
      if (ls && INTRO.sub) ls.textContent = T(INTRO.sub);
      if (cfg.onNav) cfg.onNav(view);
    }

    /* ───────── переключение вида ───────── */
    function show(name) {
      view = name;
      const sb = hasSandbox ? $(ids.viewSandbox) : null, pg = $(ids.viewPage);
      if (name === 'sandbox' && hasSandbox) {
        sb.classList.remove('hidden'); pg.classList.add('hidden');
        dockToSandbox();
        if (cfg.sandboxTips && window.sbTips) window.sbTips.show(cfg.sandboxTips.key, cfg.sandboxTips.steps);
      } else {
        if (sb) sb.classList.add('hidden');
        pg.classList.remove('hidden');
        if (cfg.onOpenPage) cfg.onOpenPage();
        park();   // страница сейчас перерисуется — панель не должна погибнуть вместе с ней
        if (name === 'intro') renderIntro(); else renderModule(name);
        pg.scrollTop = 0;
      }
      renderNav();
    }
    /* убрать рабочую панель из страницы урока в «карман», пока страница перерисовывается */
    function park() {
      const p = $('py-work-panel'), park = $(ids.park);
      if (p && park && p.closest('#' + ids.page)) park.appendChild(p);
    }
    function dockToSandbox() {
      const slot = $(ids.sandboxSlot);
      if (!slot || !window.sbPy) return;
      window.sbPy.setMode('py');
      if (openTaskId !== null || window.sbPy.ctxKey() !== 'python' || !window.sbPy.ctxLoaded()) {
        openTaskId = null; curTask = null;
        window.sbPy.dock(slot, 'sandbox');
        window.sbPy.setContext('python', null);
        setCheckBtn(null);
      } else window.sbPy.dock(slot, 'sandbox');
    }
    /* открыть пример: в песочнице (курс Python) или в редакторе первого задания (машинка) */
    function tryExample(code) {
      if (hasSandbox) { show('sandbox'); setTimeout(() => window.sbPy.setCode(code), 30); return; }
      const m = COURSE.find((x) => x.id === view); if (!m) return;
      const tk = m.tasks[0], el = $(ids.page).querySelector('.py-task[data-task="' + tk.id + '"]');
      if (el) openTask(m, tk, el).then(() => window.sbPy.setCode(code));
    }

    /* ───────── введение ───────── */
    function renderIntro() {
      const page = $(ids.page);
      let h = '<div class="py-hero"><div class="py-crumb">' + esc(tt('py.course')) + ' «' + esc(T(INTRO.title)) + '»</div>'
        + '<h1>' + esc(T(INTRO.h1) || tt('py.introTitle')) + '</h1><p class="py-sub">' + esc(T(INTRO.hero)) + '</p></div>';
      h += '<div class="py-stats">'
        + '<div class="py-stat"><b>' + COURSE.length + '</b><span>' + esc(tt(hasSandbox ? 'py.statModules' : 'car.statLessons')) + '</span></div>'
        + '<div class="py-stat"><b>' + COURSE.reduce((n, m) => n + m.ex.length, 0) + '</b><span>' + esc(tt('py.statExamples')) + '</span></div>'
        + '<div class="py-stat"><b>' + COURSE.reduce((n, m) => n + m.tasks.length, 0) + '</b><span>' + esc(tt('py.statTasks')) + '</span></div>'
        + '<div class="py-stat"><b>3</b><span>' + esc(tt('py.statLevels')) + '</span></div></div>';
      h += '<h2>' + esc(tt(hasSandbox ? 'py.howTitle' : 'car.howTitle')) + '</h2><ol class="py-struct">' + (INTRO.how ? INTRO.how[L()] || INTRO.how.ru : []).map((x) => '<li>' + x + '</li>').join('') + '</ol>';
      h += '<h2>' + esc(tt('py.tipsTitle')) + '</h2><ol class="py-struct">' + (INTRO.tips ? INTRO.tips[L()] || INTRO.tips.ru : []).map((x) => '<li>' + x + '</li>').join('') + '</ol>';
      h += '<div class="py-foot"><button class="btn btn-primary" data-act="start">' + esc(tt(hasSandbox ? 'py.startModule' : 'car.startLesson')) + '</button></div>';
      page.innerHTML = h;
      page.querySelector('[data-act="start"]').addEventListener('click', () => show(COURSE[0].id));
      if (openTaskId) { openTaskId = null; curTask = null; if (hasSandbox) dockToSandbox(); else if (cfg.onTaskClosed) cfg.onTaskClosed(); }
    }

    /* ───────── страница модуля ───────── */
    function renderModule(id) {
      const i = COURSE.findIndex((m) => m.id === id); if (i < 0) return;
      const m = COURSE[i];
      const page = $(ids.page);
      page.innerHTML = '';
      const head = document.createElement('div');
      head.innerHTML = '<div class="py-crumb">' + esc(tt(hasSandbox ? 'py.module' : 'car.lessonN', { i: i + 1, n: COURSE.length })) + '</div><h1>' + esc(T(m.title)) + '</h1>'
        + '<div class="py-libline">' + esc(tt('py.use')) + ' <code>' + esc(T(m.lib)) + '</code></div>'
        + '<div class="py-goal"><div class="py-goal-tag">◎ ' + esc(tt('py.goal')) + '</div><p>' + esc(T(m.goal)) + '</p></div>'
        + '<h2><span class="ico">§</span> ' + esc(tt('py.theory')) + '</h2><div class="py-theory">' + T(m.theory) + '</div>'
        + (m.fact ? '<div class="py-fact"><span class="fi">✦</span><div><b>' + esc(tt('py.fact')) + '</b>' + esc(T(m.fact)) + '</div></div>' : '')
        + '<h2><span class="ico">›_</span> ' + esc(tt('py.examples')) + '</h2>';
      page.appendChild(head);

      m.ex.forEach((e) => {
        const block = codeBlock(T(e.c), e.f, T(e.o));
        const btn = document.createElement('button'); btn.className = 'py-term-btn'; btn.textContent = '🧪 ' + tt(hasSandbox ? 'py.toSandbox' : 'car.tryIt');
        btn.addEventListener('click', () => tryExample(T(e.c)));
        block.querySelector('.py-term-bar').appendChild(btn);
        page.appendChild(block);
      });

      if (m.mist && m.mist.length) {
        const mist = document.createElement('div'); mist.className = 'py-mistakes';
        mist.innerHTML = '<b>' + esc(tt('py.mistakes')) + '</b><ol>' + m.mist.map((x) => '<li>' + T(x) + '</li>').join('') + '</ol>';
        page.appendChild(mist);
      }

      const th = document.createElement('div');
      th.innerHTML = '<h2><span class="ico">✎</span> ' + esc(tt('py.tasks')) + '</h2><p class="py-tasks-note">' + esc(tt(hasSandbox ? 'py.tasksNote' : 'car.tasksNote')) + '</p>';
      page.appendChild(th);
      m.tasks.forEach((tk, n) => page.appendChild(renderTask(m, tk, n)));

      const foot = document.createElement('div'); foot.className = 'py-foot';
      const next = COURSE[i + 1];
      foot.innerHTML = (next
        ? '<button class="btn btn-primary" data-next="' + next.id + '">' + esc(tt(hasSandbox ? 'py.next' : 'car.nextLesson')) + '</button><span class="py-next-hint">' + esc(tt('py.nextHint', { t: T(next.short) })) + '</span>'
        : '<button class="btn btn-primary" data-next="intro">' + esc(tt('py.toStart')) + '</button><span class="py-next-hint">' + esc(tt(hasSandbox ? 'py.final' : 'car.final')) + '</span>');
      foot.querySelector('button').addEventListener('click', (e) => show(e.currentTarget.dataset.next));
      page.appendChild(foot);

      // если задание этого модуля было открыто — вернуть панель на место
      if (openTaskId && m.tasks.some((tk) => tk.id === openTaskId)) {
        const slot = page.querySelector('.py-task[data-task="' + openTaskId + '"] .py-task-work');
        if (slot) {
          slot.classList.remove('hidden'); window.sbPy.dock(slot, 'task'); window.sbPy.setMode(cfg.key); markOpen(openTaskId);
          const tk = m.tasks.find((x) => x.id === openTaskId); curTask = { m, tk, el: slot.closest('.py-task') };
          // пока нас не было, редактор мог занять другой курс — вернуть код этого задания
          if (window.sbPy.ctxKey() !== cfg.key + '-' + openTaskId) { window.sbPy.setContext(cfg.key + '-' + openTaskId, taskTemplate(m, tk)); setCheckBtn(tk); clearCheckOut(); }
        }
      } else if (openTaskId) { openTaskId = null; curTask = null; if (hasSandbox) dockToSandbox(); else if (cfg.onTaskClosed) cfg.onTaskClosed(); }
    }

    function renderTask(m, tk, n) {
      const el = document.createElement('div');
      el.className = 'py-task' + (isSolved(tk.id) ? ' solved' : '');
      el.dataset.task = tk.id;
      const auto = !!((tk.tests && tk.tests.length) || tk.judge);
      let h = '<div class="py-task-top"><span class="py-lvl ' + tk.lv + '">' + esc(tt(LV[tk.lv])) + '</span>'
        + '<span class="py-task-num">' + esc(tt('py.taskN', { n: n + 1 })) + '</span>'
        + '<span class="py-task-ok">✓ ' + esc(tt('py.solved')) + '</span></div>'
        + '<div class="py-task-q">' + T(tk.q) + '</div>';
      if (tk.sample) {
        const sin = tk.sample.in;
        const ins = Array.isArray(sin) ? sin : (sin ? (sin[L()] || sin.ru || []) : []);
        h += '<div class="py-sample"><span class="py-sample-l">' + esc(tt('py.sample')) + (ins.length ? ' (' + esc(tt('py.sampleIn')) + ' ' + esc(ins.join(', ')) + ')' : '') + ':</span><pre>' + esc(T(tk.sample.out)) + '</pre></div>';
      }
      h += '<div class="py-task-btns">'
        + '<button class="btn btn-primary btn-sm act-solve">▸ ' + esc(tt('py.solve')) + '</button>'
        + '<button class="btn-ans hintbtn act-hint">' + esc(tt('py.hint')) + '</button>'
        + '<button class="btn-ans act-ans">' + esc(tt('py.answer')) + '</button>'
        + (auto ? '' : '<button class="btn-ans act-self">' + esc(tt(isSolved(tk.id) ? 'py.selfUndo' : 'py.selfDone')) + '</button>')
        + '</div>'
        + '<div class="py-ans hintbox">' + T(tk.h) + '</div>'
        + '<div class="py-ans ansbox"></div>'
        + '<div class="py-task-work hidden"></div>';
      el.innerHTML = h;
      const ansbox = el.querySelector('.ansbox');
      ansbox.appendChild(codeBlock(T(tk.a), 'otvet.py', null));
      const ins = document.createElement('button'); ins.className = 'py-term-btn'; ins.textContent = '⤵ ' + tt('py.insertAnswer');
      ins.addEventListener('click', () => { openTask(m, tk, el).then(() => window.sbPy.setCode(T(tk.a))); });
      ansbox.querySelector('.py-term-bar').appendChild(ins);

      el.querySelector('.act-solve').addEventListener('click', () => openTask(m, tk, el));
      el.querySelector('.act-hint').addEventListener('click', (e) => toggleBox(e.currentTarget, el.querySelector('.hintbox'), 'py.hint', 'py.hideHint'));
      el.querySelector('.act-ans').addEventListener('click', (e) => toggleBox(e.currentTarget, ansbox, 'py.answer', 'py.hideAnswer'));
      const self = el.querySelector('.act-self');
      if (self) self.addEventListener('click', () => {
        const v = !isSolved(tk.id); setSolved(tk.id, v);
        el.classList.toggle('solved', v); self.textContent = tt(v ? 'py.selfUndo' : 'py.selfDone');
      });
      return el;
    }
    function toggleBox(btn, box, kOpen, kClose) {
      const open = box.classList.toggle('open');
      btn.textContent = tt(open ? kClose : kOpen);
    }

    /* ───────── решение задания: панель под условием ───────── */
    function markOpen(id) {
      const page = $(ids.page); if (!page) return;
      page.querySelectorAll('.py-task').forEach((x) => x.classList.toggle('open', x.dataset.task === id));
    }
    async function openTask(m, tk, el) {
      const slot = el.querySelector('.py-task-work');
      $(ids.page).querySelectorAll('.py-task-work').forEach((s) => { if (s !== slot) s.classList.add('hidden'); });
      slot.classList.remove('hidden');
      window.sbPy.setMode(cfg.key);
      if (openTaskId !== tk.id) {
        openTaskId = tk.id; curTask = { m, tk, el };
        window.sbPy.dock(slot, 'task');
        await window.sbPy.setContext(cfg.key + '-' + tk.id, taskTemplate(m, tk));
        setCheckBtn(tk);
        clearCheckOut();
      } else window.sbPy.dock(slot, 'task');
      curTask = { m, tk, el };
      markOpen(tk.id);
      if (cfg.onTaskOpened) cfg.onTaskOpened(tk);
      setTimeout(() => slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
    }
    function taskTemplate(m, tk) {
      const q = T(tk.q).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return '# ' + tt('py.taskN', { n: m.tasks.indexOf(tk) + 1 }) + ' — ' + tt(hasSandbox ? 'py.module' : 'car.lessonN', { i: COURSE.indexOf(m) + 1, n: COURSE.length }) + '\n# ' + q + '\n\n' + (tk.start ? T(tk.start) : '');
    }
    function setCheckBtn(tk) {
      const b = $('btn-py-check'); if (!b) return;
      const auto = !!(tk && ((tk.tests && tk.tests.length) || tk.judge));
      b.classList.toggle('hidden', !auto);
    }
    function clearCheckOut() { const o = $('py-check-out'); if (o) { o.innerHTML = ''; o.classList.add('hidden'); } }

    /* ───────── проверка ───────── */
    function stdinFor(test) { const s = test.stdin; if (!s) return []; if (Array.isArray(s)) return s; return s[L()] || s.ru || []; }

    async function runCheck() {
      if (!curTask || checking || !window.sbPy || window.sbPy.busy()) return;
      const { tk, el } = curTask;
      const tests = (tk.tests && tk.tests.length) ? tk.tests : (tk.judge ? [{}] : []);
      if (!tests.length) return;
      checking = true;
      const btn = $('btn-py-check'); if (btn) btn.disabled = true;
      const out = $('py-check-out'); out.classList.remove('hidden');
      out.innerHTML = '<div class="py-chk-head">' + esc(tt('py.checking')) + '</div>';
      const code = window.sbPy.getCode();
      const results = [];
      let passed = 0;
      for (let i = 0; i < tests.length; i++) {
        const spec = Object.assign({}, tk.check || {}, tests[i]);
        let item;
        if (cfg.key === 'car') {
          /* виртуальная машинка: сценарий событий → журнал → судья на Python */
          const res = await window.sbPy.run(code, { test: true, car: { events: spec.events || [], inputs: spec.inputs || {}, limit: spec.limit || 12 }, timeout: 8000 });
          if (res.stopped) item = { ok: false, stopped: true, timeout: res.timeout };
          else if (res.error) item = { ok: false, error: res.error, output: res.output };
          else {
            const log = Object.assign({}, res.carLog || {}, { output: res.output || '' });
            const jr = await window.sbPy.judge(tk.judge, log, spec);
            const fails = (jr.fails || []).map((f) => ({ why: (L() === 'kk' ? f[1] : f[0]) || f[0] }));
            if (jr.error) fails.push({ why: tt('car.judgeErr') + ': ' + jr.error });
            item = { ok: fails.length === 0, fails, output: res.output };
          }
          item.label = describeCarTest(spec);
        } else {
          const stdin = stdinFor(spec);
          let ref = null;
          if (needsRef(spec)) ref = await window.sbPy.run(T(tk.a), { stdin, test: true });
          const res = await window.sbPy.run(code, { stdin, test: true });
          if (res.stopped) item = { ok: false, stopped: true };
          else if (res.error) item = { ok: false, error: res.error, output: res.output };
          else { const fails = judgeText(spec, res, ref || {}); item = { ok: fails.length === 0, fails, output: res.output }; }
          item.label = stdin.length ? tt('py.testIn', { v: stdin.join(', ') }) : tt('py.testNoIn');
        }
        results.push(item);
        if (item.ok) passed++;
        renderCheck(out, results, tests.length, false);
        if (item.stopped && !item.timeout) break;
      }
      const allOk = passed === tests.length;
      renderCheck(out, results, tests.length, true);
      if (allOk) { setSolved(tk.id, true); el.classList.add('solved'); if (window.sbToast) window.sbToast('🎉 ' + tt('py.checkPass')); }
      checking = false;
      if (btn) btn.disabled = false;
    }

    function renderCheck(out, results, total, finished) {
      const passed = results.filter((r) => r.ok).length;
      let h = '<div class="py-chk-head ' + (finished ? (passed === total ? 'ok' : 'bad') : '') + '">'
        + esc(finished ? (passed === total ? tt('py.checkPass') : tt('py.checkFail', { k: total - passed, n: total })) : tt('py.checking')) + '</div>';
      results.forEach((r, i) => {
        h += '<div class="py-chk ' + (r.ok ? 'ok' : 'bad') + '"><div class="py-chk-t">' + (r.ok ? '✓' : '✗') + ' ' + esc(tt('py.testN', { n: i + 1 })) + ' — ' + esc(r.label || '') + '</div>';
        if (r.timeout) h += '<div class="py-chk-why">' + esc(tt('car.timeout')) + '</div>';
        else if (r.stopped) h += '<div class="py-chk-why">' + esc(tt('py.stopped')) + '</div>';
        else if (r.error) {
          const e = r.error;
          h += '<div class="py-chk-why">⛔ ' + esc(tt('py.testErr')) + ': ' + (e.line ? esc(tt('py.errAt', { n: e.line })) + ': ' : '') + esc(e.kind + (e.msg ? ': ' + e.msg : '')) + '</div>';
          const hint = window.sbPy.hintFor(e); if (hint) h += '<div class="py-chk-hint">💡 ' + esc(hint) + '</div>';
        } else if (!r.ok) {
          r.fails.forEach((f) => {
            h += '<div class="py-chk-why">' + esc(f.why) + '</div>';
            if (f.expected != null) h += '<div class="py-chk-lbl">' + esc(tt('py.expected')) + ':</div><pre class="py-chk-pre">' + esc(String(f.expected).trim().slice(0, 600)) + '</pre>';
          });
          if (cfg.key !== 'car') h += '<div class="py-chk-lbl">' + esc(tt('py.got')) + ':</div><pre class="py-chk-pre">' + esc((r.output || '').trim().slice(0, 600) || '∅') + '</pre>';
        }
        h += '</div>';
      });
      out.innerHTML = h;
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /* ───────── события ───────── */
    const root = ROOT();
    if (root) root.querySelectorAll('.py-nav-item[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
    document.addEventListener('sb-lang-changed', () => {
      if (!root || root.classList.contains('hidden')) { renderNav(); return; }
      if (view !== 'sandbox') show(view); else renderNav();
    });

    let inited = false;
    const api = {
      async ensure() { if (!inited) { inited = true; await loadProgress(); renderNav(); } },
      async onShow() {
        const first = !inited;
        await api.ensure();
        if (first) show(hasSandbox ? 'sandbox' : (cfg.initialView || 'intro'));
        else if (hasSandbox && view === 'sandbox') show('sandbox');   // панель могла уехать в другой курс
        else if (openTaskId) show(view);   // вернуть панель под задание после другой вкладки
      },
      show, renderNav, progress: () => progress, view: () => view, openTaskId: () => openTaskId,
      isSolved, moduleDone, data: COURSE,
      /* первый модуль с нерешённым заданием */
      nextModule() { return COURSE.find((m) => m.tasks.some((tk) => !isSolved(tk.id))) || null; },
      closeTask() { if (openTaskId) { openTaskId = null; curTask = null; setCheckBtn(null); } },
      _judge: judgeText, _shapeOf: shapeOf, _check: runCheck
    };
    // кнопка «Проверить» одна на панель — работает для того курса, чьё задание открыто
    const chk = $('btn-py-check');
    if (chk) chk.addEventListener('click', () => { if (curTask) runCheck(); });
    return api;
  }

  window.sbMakeCourse = makeCourse;

  /* курс «Основы Python» */
  window.sbCourse = makeCourse({
    key: 'py', data: window.COURSE || [], intro: window.COURSE_INTRO || {}, progressKey: 'pyProgress',
    ids: { root: 'tab-python', nav: 'py-nav-modules', page: 'py-page', viewPage: 'py-view-page', park: 'py-park',
      progressText: 'py-progress-text', progressBar: 'py-progress-bar', navTitle: 'py-nav-title', navSub: 'py-nav-sub',
      viewSandbox: 'py-view-sandbox', sandboxSlot: 'py-sandbox-slot' },
    sandboxTips: { key: 'python', steps: [
      { el: '#py-editor', key: 'tips.pyEditor', at: 'inside' },
      { el: '#btn-py-run', key: 'tips.pyRun', at: 'below' },
      { el: '#py-console-wrap', key: 'tips.pyConsole', at: 'above' },
      { el: '#pyproj-pick', key: 'tips.pyProj', at: 'below' }
    ] }
  });
})();
