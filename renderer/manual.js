/* Справка («?», раньше — «Как всё устроено») — страница из MANUAL (manual-data.js).
 *
 * Слева: поиск и оглавление. Справа: «Часто спрашивают» и разделы. Всё строится
 * через DOM-узлы, а не через innerHTML: содержимое своё, но случайная угловая
 * скобка в тексте не должна ломать вёрстку.
 *
 * Снаружи: window.sbManual.open(id) — открыть справку на разделе ('pilot') или
 * на вопросе ('faq:not-found'); так в справку ведут кнопки «Домой» и вкладки «Машинка».
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  function tt(key) { try { return t(key); } catch (_) { return key; } }

  /* Ссылка на приложение-пульт (APK). Отдельный публичный репозиторий только с этим файлом:
   * поменяли APK на GitHub — ссылка и QR-код остаются прежними. */
  const PILOT_APK_URL = 'https://github.com/smartbolashaq/phygital-pilot/raw/main/PhygitalPilot.apk';

  /** Текст блока на текущем языке; нет перевода — показываем русский. */
  const s = (o) => (o ? (o[L()] || o.ru || '') : '');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ═══════════ Переходы: кнопки в тексте справки ═══════════ */
  function go(to) {
    const sh = window.sbShared;
    if (!to || !sh) return;
    if (to.startsWith('man:')) return scrollToSection(to.slice(4));
    if (to.startsWith('faq:')) return openFaq(to.slice(4));
    if (to === 'assembly') { if (window.sbAsm) window.sbAsm.open('manual'); return; }
    if (to.startsWith('asm:')) { if (window.sbAsm) window.sbAsm.open('manual', to.slice(4), 0); return; }
    if (to === 'python') { if (window.sbHome) window.sbHome.goPy(); else sh.showPage('python'); return; }
    if (to === 'car') { if (window.sbHome) window.sbHome.goCar(); else sh.showPage('car'); return; }
    if (to === 'carFree') { sh.showPage('car'); if (window.sbCarTab) window.sbCarTab.showFree(); return; }
    if (to === 'settings') { const b = $('btn-settings'); if (b) b.click(); }
  }

  function goButton(it, cls) {
    const b = el('button', cls || 'btn btn-tinted btn-sm man-go-btn', s(it.label));
    b.type = 'button';
    b.addEventListener('click', () => go(it.to));
    return b;
  }

  /* ═══════════ QR-код приложения-пульта ═══════════
   * Рисуем сами по матрице qrcode-generator (renderer/vendor/qrcode.js, MIT): чёрное на белом
   * с полями в 4 модуля — так код читается любой камерой в обеих темах программы. */
  function qrSvg(text) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'man-qr-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR');
    if (typeof qrcode !== 'function') return svg;
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount(), m = 4, size = n + 2 * m;
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#000');
    svg.appendChild(p);
    return svg;
  }

  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try {
        const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (_) { /* не вышло — ссылка видна на экране, её можно переписать */ }
    }
    if (ok && btn) {
      const was = btn.textContent;
      btn.textContent = tt('man.qrCopied');
      setTimeout(() => { btn.textContent = was; }, 1800);
    }
  }

  function renderQr() {
    const card = el('div', 'man-qr');
    const fig = el('div', 'man-qr-fig');
    fig.appendChild(qrSvg(PILOT_APK_URL));
    card.appendChild(fig);
    const body = el('div', 'man-qr-body');
    body.appendChild(el('div', 'man-qr-kicker', 'Android · APK'));
    body.appendChild(el('h3', 'man-qr-t', tt('man.qrT')));
    body.appendChild(el('p', 'man-qr-p', tt('man.qrSub')));
    const a = el('a', 'man-qr-link', PILOT_APK_URL);
    a.href = PILOT_APK_URL; a.target = '_blank'; a.rel = 'noopener';
    body.appendChild(a);
    const row = el('div', 'man-qr-row');
    const copy = el('button', 'btn btn-ghost btn-sm', tt('man.qrCopy')); copy.type = 'button';
    copy.addEventListener('click', () => copyText(PILOT_APK_URL, copy));
    row.appendChild(copy);
    body.appendChild(row);
    card.appendChild(body);
    return card;
  }

  /* ═══════════ Блоки текста ═══════════ */
  function renderBlock(b) {
    switch (b.t) {
      case 'h':    return el('h3', 'man-h', s(b));
      case 'p':    return el('p', 'man-p', s(b));
      case 'warn': return el('div', 'man-box man-warn', s(b));
      case 'note': return el('div', 'man-box man-note', s(b));
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
      case 'ol':
      case 'check': {
        const list = el(b.t === 'ol' ? 'ol' : 'ul', 'man-list' + (b.t === 'check' ? ' man-check' : ''));
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
      case 'dl': {
        const dl = el('dl', 'man-dl');
        (b.items || []).forEach((it) => {
          const row = el('div', 'man-dl-row');
          row.appendChild(el('dt', '', s(it.k)));
          row.appendChild(el('dd', '', s(it.v)));
          dl.appendChild(row);
        });
        return dl;
      }
      case 'go': {
        const row = el('div', 'man-go');
        (b.items || []).forEach((it) => row.appendChild(goButton(it)));
        return row;
      }
      case 'faq': {
        // вопрос — раскрывающийся: в длинном разделе видны только заголовки
        const d = el('details', 'man-faq');
        d.id = 'faq-' + b.id;
        const sum = el('summary', 'man-faq-q');
        sum.appendChild(el('span', '', s(b.q)));
        d.appendChild(sum);
        const body = el('div', 'man-faq-a');
        (b.a || []).forEach((x) => body.appendChild(renderBlock(x)));
        d.appendChild(body);
        return d;
      }
      case 'qr': return renderQr();
      default: return el('p', 'man-p', s(b));
    }
  }

  /* ═══════════ 3D-сборка: карточка-вход в разделе «Сборка и ремонт» ═══════════
   * Сама сборка — отдельная страница (assembly.js); здесь обложка, прогресс по разделам и кнопки. */
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
    const goB = el('button', 'btn btn-primary man-a3-go'); goB.type = 'button';
    goB.addEventListener('click', () => {
      const p = a3Progress(); if (!window.sbAsm || !p) return;
      if (p.next) window.sbAsm.open('manual', window.sbAsm.sections[p.next[0]].id, p.next[1]);
      else window.sbAsm.open('manual');
    });
    row.appendChild(goB);
    const reset = el('button', 'btn btn-ghost btn-sm man-a3-reset', tt('man.asm.reset')); reset.type = 'button';
    let armed = null;
    reset.addEventListener('click', () => {
      // сброс в два нажатия: первое спрашивает, второе сбрасывает
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
    document.querySelectorAll('.man-a3').forEach((card) => {
      const secs = card.querySelector('.man-a3-secs');
      secs.textContent = '';
      p.bySec.forEach((sc) => {
        const b = el('button', 'man-a3-sec' + (sc.n === sc.m ? ' is-complete' : '')); b.type = 'button';
        b.appendChild(el('b', 'man-a3-sec-l', sc.letter));
        b.appendChild(el('span', 'man-a3-sec-t', s(sc.label)));
        b.appendChild(el('span', 'man-a3-sec-n', sc.n === sc.m ? '✓' : sc.n + '/' + sc.m));
        b.addEventListener('click', () => window.sbAsm.open('manual', sc.id, 0));
        secs.appendChild(b);
      });
      const goB = card.querySelector('.man-a3-go');
      if (!p.n) goB.textContent = tt('a3.start');
      else if (p.next) {
        const sc = window.sbAsm.sections[p.next[0]], st = sc.steps[p.next[1]];
        goB.textContent = tt('a3.continueAt').replace('{l}', sc.letter).replace('{n}', st.num + (st.sub ? '·' + st.sub : ''));
      } else goB.textContent = tt('a3.openAgain');
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

  /* ═══════════ Начало справки: «Часто спрашивают» ═══════════ */
  function renderHome() {
    const H = window.MANUAL_HOME;
    const wrap = el('section', 'man-hero');
    if (!H) return wrap;
    wrap.appendChild(el('h1', 'man-hero-t', s(H.title)));
    wrap.appendChild(el('p', 'man-hero-p', s(H.sub)));
    wrap.appendChild(el('div', 'man-hero-lbl', s(H.popularT)));
    const chips = el('div', 'man-chips');
    (H.popular || []).forEach((it) => chips.appendChild(goButton(it, 'man-chip')));
    wrap.appendChild(chips);
    return wrap;
  }

  /* ═══════════ Поиск ═══════════
   * Индекс — тексты отрисованных блоков на текущем языке. Находим блоки, где есть все
   * слова запроса; вопрос (faq) — одна запись целиком, его заголовок весит больше. */
  let index = [];
  /** Текст узла для поиска: блоки разделяются пробелом, схемы (SVG) и номера шагов не берём. */
  const BLOCK = new Set(['LI', 'P', 'DIV', 'TD', 'TH', 'TR', 'DT', 'DD', 'SUMMARY', 'H3', 'PRE', 'FIGCAPTION', 'A', 'BUTTON']);
  function textOf(n) {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1 || n.namespaceURI === 'http://www.w3.org/2000/svg' || n.classList.contains('man-step-n')) return '';
    let out = '';
    for (const c of n.childNodes) out += textOf(c) + (c.nodeType === 1 && BLOCK.has(c.tagName) ? ' ' : '');
    return out;
  }
  const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-яәіңғүұқөһ.]+/gi, ' ');

  function buildIndex() {
    index = [];
    (window.MANUAL || []).forEach((sec) => {
      const node = $('man-sec-' + sec.id);
      if (!node) return;
      let head = s(sec.title);
      index.push({ sec: sec.id, el: node, label: s(sec.title), where: '', text: s(sec.title), w: 3 });
      [...node.children].forEach((child) => {
        if (child.classList.contains('man-h2')) return;
        if (child.classList.contains('man-h')) {
          head = child.textContent;
          index.push({ sec: sec.id, el: child, label: head, where: s(sec.title), text: head, w: 2 });
          return;
        }
        if (child.classList.contains('man-faq')) {
          const q = child.querySelector('.man-faq-q').textContent;
          index.push({ sec: sec.id, el: child, label: q, where: s(sec.title) + ' · ' + head, text: q + ' ' + textOf(child.querySelector('.man-faq-a')), w: 2.5, q });
          return;
        }
        const txt = textOf(child);
        if (txt && txt.trim()) index.push({ sec: sec.id, el: child, label: head, where: s(sec.title), text: txt, w: 1 });
      });
    });
    index.forEach((e) => { e.n = norm(e.text); e.nl = norm(e.label); });
  }

  /** Кусок текста вокруг первого совпадения с подсветкой (узлы DOM, без innerHTML). */
  function snippet(text, words) {
    const out = el('span', 'man-res-snip');
    const flat = String(text).replace(/\s+/g, ' ').trim();
    const low = flat.toLowerCase().replace(/ё/g, 'е');
    let at = -1, wlen = 0;
    for (const w of words) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; wlen = w.length; } }
    if (at < 0) { out.textContent = flat.slice(0, 110) + (flat.length > 110 ? '…' : ''); return out; }
    const from = Math.max(0, at - 40), to = Math.min(flat.length, at + wlen + 80);
    out.appendChild(document.createTextNode((from ? '…' : '') + flat.slice(from, at)));
    out.appendChild(el('mark', '', flat.slice(at, at + wlen)));
    out.appendChild(document.createTextNode(flat.slice(at + wlen, to) + (to < flat.length ? '…' : '')));
    return out;
  }

  function runSearch(qRaw) {
    const box = $('man-results'), toc = $('man-toc');
    const words = norm(qRaw).split(' ').filter((w) => w.length >= 2);
    const active = words.length > 0;
    box.classList.toggle('hidden', !active);
    toc.classList.toggle('hidden', active);
    const head = document.querySelector('.man-side-h'); if (head) head.classList.toggle('hidden', active);
    box.textContent = '';
    if (!active) return;
    const hits = index
      .filter((e) => words.every((w) => e.n.includes(w)))
      .map((e) => ({ e, score: e.w + words.filter((w) => e.nl.includes(w)).length * 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    // под одним подзаголовком бывает несколько абзацев — показываем лучший, остальные лишь шумят
    const seen = new Set();
    const list = hits.filter((h) => { const k = h.e.label + '|' + h.e.where; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!list.length) {
      box.appendChild(el('div', 'man-res-none', tt('man.searchNone')));
      box.appendChild(goButton({ to: 'man:trouble', label: { ru: tt('man.troubleGo'), kk: tt('man.troubleGo') } }, 'btn btn-ghost btn-sm man-res-go'));
      return;
    }
    box.appendChild(el('div', 'man-res-count', tt('man.results').replace('{n}', list.length)));
    list.forEach(({ e }) => {
      const b = el('button', 'man-res');
      b.type = 'button';
      b.appendChild(el('span', 'man-res-t', e.label));
      if (e.where) b.appendChild(el('span', 'man-res-where', e.where));
      if (e.w !== 3) b.appendChild(snippet(e.q ? e.text.slice(e.q.length) : e.text, words));
      b.addEventListener('click', () => reveal(e.el));
      box.appendChild(b);
    });
  }

  /* ═══════════ Прокрутка к месту ═══════════ */
  function flash(node) {
    node.classList.remove('man-flash');
    void node.offsetWidth;                // перезапуск анимации
    node.classList.add('man-flash');
    setTimeout(() => node.classList.remove('man-flash'), 2200);
  }
  function reveal(node) {
    if (!node) return;
    const faq = node.closest('.man-faq');
    if (faq) faq.open = true;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flash(faq || node);
  }
  function scrollToSection(id) {
    const n = $('man-sec-' + id);
    if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openFaq(id) {
    const d = $('faq-' + id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flash(d);
  }

  /* ═══════════ Сборка страницы ═══════════ */
  let built = false;

  function build() {
    const toc = $('man-toc');
    const body = $('man-body');
    if (!toc || !body || !window.MANUAL) return;
    toc.textContent = '';
    body.textContent = '';
    body.appendChild(renderHome());

    window.MANUAL.forEach((sec, i) => {
      const hasAsm = (sec.blocks || []).some((x) => x.t === 'asm3d');
      // оглавление
      const b = el('button', 'man-toc-item');
      b.appendChild(el('span', 'man-toc-n', String(i + 1)));
      b.appendChild(el('span', 'man-toc-t', s(sec.title)));
      b.dataset.target = sec.id;
      if (hasAsm) b.appendChild(el('span', 'man-toc-badge'));
      b.addEventListener('click', () => scrollToSection(sec.id));
      toc.appendChild(b);
      // раздел
      const wrap = el('section', 'man-sec');
      wrap.id = 'man-sec-' + sec.id;
      wrap.appendChild(el('h2', 'man-h2', s(sec.title)));
      (sec.blocks || []).forEach((blk) => {
        if (blk.t === 'asm3d') wrap.appendChild(renderAsm3d());
        else wrap.appendChild(renderBlock(blk));
      });
      body.appendChild(wrap);
    });

    const q = $('man-search');
    if (q) q.placeholder = tt('man.search');
    built = true;
    buildIndex();
    if (q && q.value) runSearch(q.value);
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

  const searchEl = $('man-search');
  if (searchEl) {
    let deb = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => runSearch(searchEl.value), 120);
      const clr = $('man-search-clear'); if (clr) clr.classList.toggle('hidden', !searchEl.value);
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchEl.value = ''; runSearch(''); const clr = $('man-search-clear'); if (clr) clr.classList.add('hidden'); }
      if (e.key === 'Enter') { const first = document.querySelector('#man-results .man-res'); if (first) first.click(); }
    });
    const clr = $('man-search-clear');
    if (clr) clr.addEventListener('click', () => { searchEl.value = ''; runSearch(''); clr.classList.add('hidden'); searchEl.focus(); });
  }
  // Ctrl+F в справке — к поиску
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyF') return;
    const page = $('tab-manual');
    if (!page || page.classList.contains('hidden') || !searchEl) return;
    e.preventDefault();
    searchEl.focus(); searchEl.select();
  });

  // смена языка — пересобираем текст, оставаясь на месте
  document.addEventListener('sb-lang-changed', () => {
    if (!built) return;
    const keep = $('man-body') ? $('man-body').scrollTop : 0;
    build();
    if ($('man-body')) $('man-body').scrollTop = keep;
  });

  window.sbManual = {
    onShow() { if (!built) build(); else markActive(); },
    /** Открыть справку на разделе ('pilot') или вопросе ('faq:not-found'). */
    open(target) {
      if (window.sbShared) window.sbShared.showPage('manual');
      if (!built) build();
      if (!target) return;
      setTimeout(() => (String(target).startsWith('faq:') ? openFaq(target.slice(4)) : scrollToSection(target)), 60);
    },
    PILOT_APK_URL
  };
})();
