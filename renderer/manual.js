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

  let built = false;

  function build() {
    const toc = $('man-toc');
    const body = $('man-body');
    if (!toc || !body || !window.MANUAL) return;
    toc.textContent = '';
    body.textContent = '';

    window.MANUAL.forEach((sec, i) => {
      // оглавление
      const b = el('button', 'man-toc-item', (i + 1) + '. ' + s(sec.title));
      b.dataset.target = sec.id;
      b.addEventListener('click', () => {
        const target = $('man-sec-' + sec.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(b);

      // раздел
      const wrap = el('section', 'man-sec');
      wrap.id = 'man-sec-' + sec.id;
      wrap.appendChild(el('h2', 'man-h2', s(sec.title)));
      (sec.blocks || []).forEach((blk) => wrap.appendChild(renderBlock(blk)));
      body.appendChild(wrap);
    });

    built = true;
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
