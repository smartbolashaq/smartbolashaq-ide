/* Вкладка «Инструкция» — сборка страницы из MANUAL (manual-data.js).
 *
 * Слева оглавление, справа текст. Всё строится через DOM-узлы, а не через
 * innerHTML: содержимое своё, но привычка полезная — случайная угловая скобка
 * в тексте инструкции не должна ломать вёрстку.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  function tt(key) { try { return t(key); } catch (_) { return key; } }

  /** Текст блока на текущем языке; нет перевода — показываем русский. */
  const s = (o) => (o ? (o[L()] || o.ru || '') : '');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function renderBlock(b) {
    switch (b.t) {
      case 'h':    return el('h3', 'man-h', s(b));
      case 'p':    return el('p', 'man-p', s(b));
      case 'warn': return el('div', 'man-box man-warn', s(b));
      case 'note': return el('div', 'man-box man-note', s(b));
      case 'todo': {
        const d = el('div', 'man-box man-todo');
        d.appendChild(el('span', 'man-todo-tag', tt('man.todo')));
        d.appendChild(el('span', '', s(b)));
        return d;
      }
      case 'code': {
        const pre = el('pre', 'man-code');
        pre.appendChild(el('code', '', b.code));
        return pre;
      }
      case 'fig': {
        // схема рисуется кодом (manual-figures.js) на текущем языке
        const f = el('figure', 'man-fig');
        const draw = window.MANUAL_FIGS && window.MANUAL_FIGS[b.name];
        if (draw) f.appendChild(draw(L()));
        if (b.cap) f.appendChild(el('figcaption', 'man-fig-cap', s(b.cap)));
        return f;
      }
      case 'steps': {
        // пронумерованные карточки — читаются как «делай раз, делай два»
        const wrap = el('div', 'man-steps');
        (b.items || []).forEach((it, i) => {
          const st = el('div', 'man-step');
          st.appendChild(el('div', 'man-step-n', String(i + 1)));
          const body = el('div', 'man-step-body');
          body.appendChild(el('div', 'man-step-t', s(it)));
          if (it.sub) body.appendChild(el('div', 'man-step-sub', s(it.sub)));
          st.appendChild(body);
          wrap.appendChild(st);
        });
        return wrap;
      }
      case 'ul':
      case 'ol': {
        const list = el(b.t === 'ul' ? 'ul' : 'ol', 'man-list');
        (b.items || []).forEach((it) => list.appendChild(el('li', '', s(it))));
        return list;
      }
      case 'table': {
        const wrap = el('div', 'man-table-wrap');
        const tb = el('table', 'man-table');
        if (b.head) {
          const tr = el('tr');
          b.head.forEach((c) => tr.appendChild(el('th', '', s(c))));
          tb.appendChild(el('thead')).appendChild(tr);
        }
        const body = el('tbody');
        (b.rows || []).forEach((row) => {
          const tr = el('tr');
          row.forEach((c) => tr.appendChild(el('td', '', s(c))));
          body.appendChild(tr);
        });
        tb.appendChild(body);
        wrap.appendChild(tb);
        return wrap;
      }
      default: return el('p', 'man-p', s(b));
    }
  }

  /* ═══════════ Пошаговая сборка: карточки шагов с отметкой «готово» ═══════════
   *
   * Блок { t:'asm' } — один шаг сборки (формат описан в manual-build-data.js).
   * Блок { t:'asm-progress' } — полоска «Собрано N из M» для своего раздела.
   *
   * Отметки хранятся в настройках программы (asmProgress.done[id] = true),
   * рядом с прогрессом курсов, — переживают перезапуск и обновление.
   * Собранный шаг сворачивается до заголовка, чтобы длинная сборка не
   * превращалась в бесконечную ленту; клик по заголовку разворачивает его.
   */
  let asmDone = {};
  const asmOpen = {};                  // какие собранные шаги развёрнуты вручную

  function saveAsm() {
    try { window.sb.setSettings({ asmProgress: { done: asmDone } }); } catch (_) {}
  }
  (async () => {
    try {
      const st = await window.sb.getSettings();
      if (st && st.asmProgress && st.asmProgress.done) asmDone = Object.assign({}, st.asmProgress.done);
    } catch (_) {}
    refreshAsm();
  })();

  /** Шаги сборки раздела по порядку. */
  const asmSteps = (sec) => (sec.blocks || []).filter((b) => b.t === 'asm');

  function asmList(cls, label, items) {
    const box = el('div', 'man-asm-col');
    box.appendChild(el('div', 'man-asm-lbl', label));
    const ul = el('ul', 'man-asm-ul ' + cls);
    items.forEach((it) => ul.appendChild(el('li', '', s(it))));
    box.appendChild(ul);
    return box;
  }

  function renderAsm(b, n) {
    const card = el('article', 'man-asm');
    card.id = 'asm-' + b.id;
    card.dataset.id = b.id;

    const head = el('div', 'man-asm-head');
    const num = el('div', 'man-asm-n', String(n));
    num.dataset.n = String(n);
    head.appendChild(num);
    head.appendChild(el('h3', 'man-asm-t', s(b.title)));
    const btn = el('button', 'man-asm-done');
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (asmDone[b.id]) delete asmDone[b.id]; else asmDone[b.id] = true;
      delete asmOpen[b.id];
      saveAsm();
      refreshAsm();
      // отметил — сразу показываем следующий несобранный шаг
      if (asmDone[b.id]) {
        const next = card.parentElement && [...card.parentElement.querySelectorAll('.man-asm')]
          .find((c) => !asmDone[c.dataset.id] && c.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING);
        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    head.appendChild(btn);
    // клик по заголовку собранного шага — развернуть/свернуть
    head.addEventListener('click', () => {
      if (!asmDone[b.id]) return;
      asmOpen[b.id] = !asmOpen[b.id];
      refreshAsm();
    });
    card.appendChild(head);

    const body = el('div', 'man-asm-body');
    if (b.fig) body.appendChild(renderBlock({ t: 'fig', name: b.fig, cap: b.cap }));
    if ((b.parts && b.parts.length) || (b.tools && b.tools.length)) {
      const need = el('div', 'man-asm-need');
      if (b.parts && b.parts.length) need.appendChild(asmList('man-asm-parts', tt('man.asm.parts'), b.parts));
      if (b.tools && b.tools.length) need.appendChild(asmList('man-asm-tools', tt('man.asm.tools'), b.tools));
      body.appendChild(need);
    }
    if (b.do && b.do.length) {
      body.appendChild(el('div', 'man-asm-lbl', tt('man.asm.do')));
      const ol = el('ol', 'man-asm-do');
      b.do.forEach((it) => ol.appendChild(el('li', '', s(it))));
      body.appendChild(ol);
    }
    if (b.check) {
      const c = el('div', 'man-box man-asm-check');
      c.appendChild(el('b', '', tt('man.asm.check') + ' '));
      c.appendChild(document.createTextNode(s(b.check)));
      body.appendChild(c);
    }
    if (b.tip) body.appendChild(el('div', 'man-box man-note', s(b.tip)));
    if (b.warn) body.appendChild(el('div', 'man-box man-warn', s(b.warn)));
    card.appendChild(body);
    return card;
  }

  function renderAsmProgress(sec) {
    const w = el('div', 'man-asm-prog');
    w.dataset.sec = sec.id;
    const row = el('div', 'man-asm-prog-row');
    row.appendChild(el('span', 'man-asm-prog-t'));
    const go = el('button', 'btn btn-primary btn-sm man-asm-go');
    go.type = 'button';
    go.addEventListener('click', () => {
      const first = asmSteps(sec).find((st) => !asmDone[st.id]);
      const n = first && $('asm-' + first.id);
      if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    row.appendChild(go);
    const reset = el('button', 'btn btn-ghost btn-sm man-asm-reset', tt('man.asm.reset'));
    reset.type = 'button';
    let armed = null;
    reset.addEventListener('click', () => {
      // сброс в два нажатия: первое спрашивает, второе сбрасывает
      if (!armed) {
        reset.textContent = tt('man.asm.resetSure');
        armed = setTimeout(() => { armed = null; reset.textContent = tt('man.asm.reset'); }, 3000);
        return;
      }
      clearTimeout(armed); armed = null;
      reset.textContent = tt('man.asm.reset');
      asmSteps(sec).forEach((st) => { delete asmDone[st.id]; delete asmOpen[st.id]; });
      saveAsm();
      refreshAsm();
    });
    row.appendChild(reset);
    w.appendChild(row);
    const bar = el('div', 'man-asm-bar');
    bar.appendChild(el('div', 'man-asm-bar-fill'));
    w.appendChild(bar);
    return w;
  }

  /** Привести экран в соответствие с отметками: карточки, полоски, оглавление. */
  function refreshAsm() {
    document.querySelectorAll('.man-asm').forEach((card) => {
      const id = card.dataset.id, done = !!asmDone[id];
      card.classList.toggle('is-done', done);
      card.classList.toggle('is-open', done && !!asmOpen[id]);
      const num = card.querySelector('.man-asm-n');
      if (num) num.textContent = done ? '✓' : num.dataset.n;
      const btn = card.querySelector('.man-asm-done');
      if (btn) {
        btn.textContent = done ? tt('man.asm.undone') : tt('man.asm.mark');
        btn.setAttribute('aria-pressed', done ? 'true' : 'false');
      }
    });
    (window.MANUAL || []).forEach((sec) => {
      const steps = asmSteps(sec);
      if (!steps.length) return;
      const n = steps.filter((st) => asmDone[st.id]).length, m = steps.length;
      const pr = document.querySelector(`.man-asm-prog[data-sec="${sec.id}"]`);
      if (pr) {
        pr.querySelector('.man-asm-prog-t').textContent =
          (n === m ? tt('man.asm.allDone') : tt('man.asm.progress')).replace('{n}', n).replace('{m}', m);
        pr.querySelector('.man-asm-bar-fill').style.width = Math.round((100 * n) / m) + '%';
        pr.classList.toggle('is-complete', n === m);
        const go = pr.querySelector('.man-asm-go');
        if (go) {
          const first = steps.findIndex((st) => !asmDone[st.id]);
          go.textContent = n === 0 ? tt('man.asm.start')
            : tt('man.asm.continue').replace('{i}', first + 1);
          go.classList.toggle('hidden', n === m);
        }
      }
      const toc = document.querySelector(`.man-toc-item[data-target="${sec.id}"] .man-toc-badge`);
      if (toc) {
        toc.textContent = n + '/' + m;
        toc.classList.toggle('is-complete', n === m);
      }
    });
  }

  /* ═══════════ 3D-сборка шасси: карточка-вход в разделе «Сборка шасси» (v1.17) ═══════════
   * Сама сборка — отдельная страница (assembly.js); здесь обложка, прогресс по разделам А–Д и кнопки. */
  function a3Progress() { return window.sbAsm ? window.sbAsm.progress() : null; }

  function renderAsm3d() {
    const card = el('div', 'man-a3');
    const fig = el('button', 'man-a3-fig');
    fig.type = 'button';
    const img = el('img'); img.src = 'assembly/cover.webp'; img.alt = '';
    fig.appendChild(img);
    fig.appendChild(el('span', 'man-a3-badge', '3D'));
    fig.addEventListener('click', () => window.sbAsm && window.sbAsm.open('manual'));
    card.appendChild(fig);
    const body = el('div', 'man-a3-body');
    body.appendChild(el('div', 'man-a3-kicker', tt('a3.kicker')));
    body.appendChild(el('h3', 'man-a3-t', tt('a3.cardTitle')));
    body.appendChild(el('p', 'man-a3-p', tt('a3.cardDesc')));
    body.appendChild(el('div', 'man-a3-secs'));
    const row = el('div', 'man-a3-row');
    const go = el('button', 'btn btn-primary man-a3-go'); go.type = 'button';
    go.addEventListener('click', () => {
      const p = a3Progress(); if (!window.sbAsm || !p) return;
      if (p.next) window.sbAsm.open('manual', window.sbAsm.sections[p.next[0]].id, p.next[1]);
      else window.sbAsm.open('manual');
    });
    row.appendChild(go);
    const reset = el('button', 'btn btn-ghost btn-sm man-a3-reset', tt('man.asm.reset')); reset.type = 'button';
    let armed = null;
    reset.addEventListener('click', () => {
      if (!armed) {
        reset.textContent = tt('man.asm.resetSure');
        armed = setTimeout(() => { armed = null; reset.textContent = tt('man.asm.reset'); }, 3000);
        return;
      }
      clearTimeout(armed); armed = null; reset.textContent = tt('man.asm.reset');
      if (window.sbAsm) window.sbAsm.reset();
    });
    row.appendChild(reset);
    body.appendChild(row);
    const bar = el('div', 'man-asm-bar'); bar.appendChild(el('div', 'man-asm-bar-fill'));
    body.appendChild(bar);
    card.appendChild(body);
    return card;
  }

  /** Прогресс 3D-сборки: строки разделов, кнопка «Продолжить», полоска и значок в оглавлении. */
  function refreshAsm3d() {
    const p = a3Progress();
    if (!p) return;
    const L_ = (o) => s(o);
    document.querySelectorAll('.man-a3').forEach((card) => {
      const secs = card.querySelector('.man-a3-secs');
      secs.textContent = '';
      p.bySec.forEach((sc, i) => {
        const b = el('button', 'man-a3-sec' + (sc.n === sc.m ? ' is-complete' : '')); b.type = 'button';
        b.appendChild(el('b', 'man-a3-sec-l', sc.letter));
        b.appendChild(el('span', 'man-a3-sec-t', L_(sc.label)));
        b.appendChild(el('span', 'man-a3-sec-n', sc.n === sc.m ? '✓' : sc.n + '/' + sc.m));
        b.addEventListener('click', () => window.sbAsm.open('manual', sc.id, 0));
        secs.appendChild(b);
      });
      const go = card.querySelector('.man-a3-go');
      if (!p.n) go.textContent = tt('a3.start');
      else if (p.next) {
        const sc = window.sbAsm.sections[p.next[0]], st = sc.steps[p.next[1]];
        go.textContent = tt('a3.continueAt').replace('{l}', sc.letter).replace('{n}', st.num + (st.sub ? '·' + st.sub : ''));
      } else go.textContent = tt('a3.openAgain');
      card.querySelector('.man-a3-reset').classList.toggle('hidden', !p.n);
      card.querySelector('.man-asm-bar-fill').style.width = Math.round(100 * p.n / p.m) + '%';
      card.classList.toggle('is-complete', p.n === p.m);
    });
    (window.MANUAL || []).forEach((sec) => {
      if (!(sec.blocks || []).some((b) => b.t === 'asm3d')) return;
      const toc = document.querySelector(`.man-toc-item[data-target="${sec.id}"] .man-toc-badge`);
      if (toc) { toc.textContent = p.n + '/' + p.m; toc.classList.toggle('is-complete', p.n === p.m); }
    });
  }
  document.addEventListener('sb-asm3d-progress', refreshAsm3d);

  let built = false;

  function build() {
    const toc = $('man-toc');
    const body = $('man-body');
    if (!toc || !body || !window.MANUAL) return;
    toc.textContent = '';
    body.textContent = '';

    window.MANUAL.forEach((sec, i) => {
      const hasAsm = asmSteps(sec).length > 0 || (sec.blocks || []).some((x) => x.t === 'asm3d');

      // оглавление
      const b = el('button', 'man-toc-item', (i + 1) + '. ' + s(sec.title));
      b.dataset.target = sec.id;
      if (hasAsm) b.appendChild(el('span', 'man-toc-badge'));
      b.addEventListener('click', () => {
        const target = $('man-sec-' + sec.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(b);

      // раздел; шаги сборки нумеруются внутри своего раздела
      const wrap = el('section', 'man-sec');
      wrap.id = 'man-sec-' + sec.id;
      wrap.appendChild(el('h2', 'man-h2', s(sec.title)));
      let n = 0;
      (sec.blocks || []).forEach((blk) => {
        if (blk.t === 'asm') wrap.appendChild(renderAsm(blk, ++n));
        else if (blk.t === 'asm-progress') wrap.appendChild(renderAsmProgress(sec));
        else if (blk.t === 'asm3d') wrap.appendChild(renderAsm3d());
        else wrap.appendChild(renderBlock(blk));
      });
      body.appendChild(wrap);
    });

    built = true;
    refreshAsm();
    refreshAsm3d();
    markActive();
  }

  /** Подсветка раздела, который сейчас на экране. */
  function markActive() {
    const body = $('man-body');
    if (!body) return;
    const top = body.scrollTop;
    let cur = null;
    (window.MANUAL || []).forEach((sec) => {
      const n = $('man-sec-' + sec.id);
      if (n && n.offsetTop - 80 <= top) cur = sec.id;
    });
    if (!cur && window.MANUAL && window.MANUAL.length) cur = window.MANUAL[0].id;
    document.querySelectorAll('.man-toc-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.target === cur));
  }

  const bodyEl = $('man-body');
  if (bodyEl) {
    let tick = null;
    bodyEl.addEventListener('scroll', () => {
      if (tick) return;
      tick = setTimeout(() => { tick = null; markActive(); }, 120);
    });
  }

  // смена языка — пересобираем текст, оставаясь на месте
  document.addEventListener('sb-lang-changed', () => {
    if (!built) return;
    const keep = $('man-body') ? $('man-body').scrollTop : 0;
    build();
    if ($('man-body')) $('man-body').scrollTop = keep;
  });

  window.sbManual = {
    onShow() { if (!built) build(); else markActive(); }
  };
})();
