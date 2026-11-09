/* Справка («?») — v1.18: понятная детям.
 *
 * Четыре вида страницы (data-view на #tab-manual):
 *   home  — «Что хочешь сделать?»: большой поиск, плитки-задачи, три главных правила;
 *   topic — тема по шагам (MANUAL_GUIDE.topics): короткий шаг, подробности под «+»;
 *   fix   — «Что-то не работает?»: выбираешь, что случилось, и проверяешь по порядку;
 *   all   — полный текст (MANUAL, manual-data.js) с оглавлением слева — «Все разделы списком».
 * Плюс окно «Пульт на телефон» с QR-кодом (его же открывает карточка на «Домой»).
 *
 * Всё строится через DOM-узлы, а не через innerHTML: содержимое своё, но случайная
 * угловая скобка в тексте не должна ломать вёрстку.
 *
 * Снаружи: window.sbManual.open(target):
 *   ''/'home', 'topic:<id>', 'fix', 'fix:<id>', 'pilot' (окно с QR), 'faq:<id>' (вопрос;
 *   если для него есть «Что-то не работает» — откроется там), '<раздел MANUAL>' (полный текст).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  function tt(key) { try { return t(key); } catch (_) { return key; } }
  const G = () => window.MANUAL_GUIDE || { tiles: [], rules: [], links: [], topics: {}, symptoms: [], popular: [], pilotFaq: [] };

  /* Ссылка на приложение-пульт (APK). Отдельный публичный репозиторий только с этим файлом:
   * поменяли APK на GitHub — ссылка и QR-код остаются прежними. */
  const PILOT_APK_URL = 'https://github.com/smartbolashaq/phygital-pilot/raw/main/PhygitalPilot.apk';

  /** Текст на текущем языке; нет перевода — показываем русский. */
  const s = (o) => (o ? (o[L()] || o.ru || '') : '');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };

  /* ═══════════ Значки (контур, 24×24) ═══════════ */
  const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const CAR = ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', C(7, 17, 2), 'M9 17h6', C(17, 17, 2)];
  const IC = {
    car: CAR,
    floor: CAR.concat(['M1 21.5h22']),
    phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
    battery: ['M4 7h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M22 11v2', 'M6 10v4', 'M10 10v4'],
    wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
    laptop: ['M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16'],
    code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
    target: [C(12, 12, 10), C(12, 12, 6), C(12, 12, 2)],
    alert: ['M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'],
    box: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.3 7L12 12l8.7-5', 'M12 22V12'],
    wifi: ['M12 20h.01', 'M2 8.82a15 15 0 0 1 20 0', 'M5 12.86a10 10 0 0 1 14 0', 'M8.5 16.43a5 5 0 0 1 7 0'],
    play: ['M7 4l13 8-13 8z'],
    flag: ['M4 22V3', 'M4 4h14l-3 4.5 3 4.5H4'],
    tile: ['M3 3h18v18H3z', 'M3 12h18', 'M12 3v18'],
    sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
    clock: [C(12, 12, 10), 'M12 6v6l4 2'],
    thermo: ['M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z'],
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', C(8.5, 8.5, 1.5), 'M21 15l-5-5L5 21'],
    rotate: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
    search: [C(11, 11, 8), 'M21 21l-4.3-4.3'],
    undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
    unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.6-1.7'],
    usb: ['M9 2h6v6H9z', 'M7 8h10v5a5 5 0 0 1-10 0z', 'M12 18v4'],
    monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
    save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
    button: [C(12, 12, 10), C(12, 12, 3)],
    repeat: ['M17 2l4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'M7 22l-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
    bolt: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
    bt: ['M7 7l10 10-5 5V2l5 5L7 17'],
    videoOff: ['M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.06A.5.5 0 0 1 22 7.87v8.26', 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2', 'M2 2l20 20'],
    bulb: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
    terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
    flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
    book: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', C(9, 7, 4), 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    info: [C(12, 12, 10), 'M12 16v-4', 'M12 8h.01'],
    back: ['M12 19l-7-7 7-7', 'M19 12H5'],
    chev: ['M9 18l6-6-6-6'],
    check: ['M20 6L9 17l-5-5'],
    x: ['M18 6L6 18', 'M6 6l12 12'],
    copy: ['M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
    people: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', C(9, 7, 4)]
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'mg-ic' + (cls ? ' ' + cls : ''));
    (IC[name] || IC.info).forEach((d) => {
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p);
    });
    return svg;
  }
  /** Кнопка «+ Подробнее»: плюс превращается в минус, тело показывается и прячется. */
  function plusToggle(label, body, open) {
    const b = btn('mg-plus');
    const ic = el('span', 'mg-plus-ic');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const h = document.createElementNS(NS, 'path'); h.setAttribute('d', 'M5 12h14');
    const v = document.createElementNS(NS, 'path'); v.setAttribute('d', 'M12 5v14'); v.setAttribute('class', 'mg-plus-v');
    svg.appendChild(h); svg.appendChild(v); ic.appendChild(svg);
    b.appendChild(ic);
    b.appendChild(el('span', 'mg-plus-t', label));
    const set = (on) => { b.setAttribute('aria-expanded', on ? 'true' : 'false'); body.hidden = !on; };
    set(!!open);
    b.addEventListener('click', () => set(body.hidden));
    b.sbOpen = () => set(true);
    return b;
  }
  function codeBlock(code, cls) {
    const pre = el('pre', 'man-code' + (cls ? ' ' + cls : ''));
    pre.appendChild(el('code', '', code));
    return pre;
  }

  /* ═══════════ Переходы ═══════════ */
  function go(to) {
    const sh = window.sbShared;
    if (to === undefined || to === null || !sh) return;
    to = String(to);
    if (to === '' || to === 'home') return show({ v: 'home' });
    if (to === 'pilot') return openPilot();
    if (to === 'fix') return show({ v: 'fix' });
    if (to.startsWith('fix:')) return show({ v: 'fix', sym: to.slice(4) }, { toPanel: true });
    if (to.startsWith('topic:')) return show({ v: 'topic', id: to.slice(6) });
    if (to.startsWith('man:')) return show({ v: 'all', sec: to.slice(4) });
    if (to.startsWith('faq:')) {
      const id = to.slice(4);
      if (G().symptoms.some((x) => x.id === id)) return show({ v: 'fix', sym: id }, { toPanel: true });
      return show({ v: 'all', faq: id });
    }
    if (to === 'assembly') { if (window.sbAsm) window.sbAsm.open('manual'); return; }
    if (to.startsWith('asm:')) { if (window.sbAsm) window.sbAsm.open('manual', to.slice(4), 0); return; }
    if (to === 'python') { if (window.sbHome) window.sbHome.goPy(); else sh.showPage('python'); return; }
    if (to === 'car') { if (window.sbHome) window.sbHome.goCar(); else sh.showPage('car'); return; }
    if (to === 'carFree') { sh.showPage('car'); if (window.sbCarTab) window.sbCarTab.showFree(); return; }
    if (to === 'settings') { const b = $('btn-settings'); if (b) b.click(); return; }
    if (window.MANUAL && window.MANUAL.some((x) => x.id === to)) show({ v: 'all', sec: to });
  }

  function goButton(it, cls) {
    const b = btn(cls || 'btn btn-tinted btn-sm man-go-btn', s(it.label));
    b.addEventListener('click', () => go(it.to));
    return b;
  }

  /* ═══════════ QR-код приложения-пульта ═══════════
   * Рисуем сами по матрице qrcode-generator (renderer/vendor/qrcode.js, MIT): чёрное на белом
   * с полями в 4 модуля — так код читается любой камерой в обеих темах программы. */
  function qrSvg(text) {
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

  async function copyText(text, b) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try {
        const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (_) { /* не вышло — ссылка видна на экране, её можно переписать */ }
    }
    if (ok && b) {
      const lab = b.querySelector('.mg-copy-t') || b;
      const was = lab.textContent;
      lab.textContent = tt('man.qrCopied');
      setTimeout(() => { lab.textContent = was; }, 1800);
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
    const copy = btn('btn btn-ghost btn-sm', tt('man.qrCopy'));
    copy.addEventListener('click', () => copyText(PILOT_APK_URL, copy));
    row.appendChild(copy);
    body.appendChild(row);
    card.appendChild(body);
    return card;
  }

  /* ═══════════ Окно «Пульт на телефон» ═══════════ */
  let pilotBack = null, pilotPrevFocus = null;
  function closePilot() {
    if (!pilotBack) return;
    pilotBack.remove(); pilotBack = null;
    document.removeEventListener('keydown', pilotKey, true);
    if (pilotPrevFocus && pilotPrevFocus.focus) try { pilotPrevFocus.focus(); } catch (_) { /* узел мог исчезнуть */ }
  }
  function pilotKey(e) { if (e.key === 'Escape') { e.preventDefault(); closePilot(); } }

  function openPilot() {
    closePilot();
    pilotPrevFocus = document.activeElement;
    const back = el('div', 'pd-back');
    back.id = 'pilot-dlg';
    const dlg = el('div', 'pd');
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'pd-title');

    const head = el('div', 'pd-head');
    const ht = el('div', 'pd-head-t');
    const h = el('h2', 'pd-title', tt('home.pilotT')); h.id = 'pd-title';
    ht.appendChild(h);
    ht.appendChild(el('p', 'pd-sub', tt('man.p.sub')));
    head.appendChild(ht);
    const x = btn('pd-close'); x.setAttribute('aria-label', tt('man.p.close')); x.appendChild(icon('x'));
    x.addEventListener('click', closePilot);
    head.appendChild(x);
    dlg.appendChild(head);

    const body = el('div', 'pd-body');
    const qcol = el('div', 'pd-qcol');
    const q = el('div', 'pd-qr'); q.appendChild(qrSvg(PILOT_APK_URL));
    qcol.appendChild(q);
    qcol.appendChild(el('span', 'pd-only', tt('man.p.only')));
    const copy = btn('pd-copy'); copy.appendChild(icon('copy')); copy.appendChild(el('span', 'mg-copy-t', tt('man.qrCopy')));
    copy.addEventListener('click', () => copyText(PILOT_APK_URL, copy));
    qcol.appendChild(copy);
    body.appendChild(qcol);

    const ol = el('ol', 'pd-steps');
    [['man.p.s1t', 'man.p.s1'], ['man.p.s2t', 'man.p.s2'], ['man.p.s3t', 'man.p.s3']].forEach(([a, b], i) => {
      const li = el('li', 'pd-step');
      li.appendChild(el('span', 'pd-step-n', String(i + 1)));
      const tx = el('div', 'pd-step-tx');
      tx.appendChild(el('b', 'pd-step-t', tt(a)));
      tx.appendChild(el('span', 'pd-step-s', tt(b)));
      li.appendChild(tx);
      ol.appendChild(li);
    });
    const net = el('li', 'pd-net'); net.appendChild(icon('wifi')); net.appendChild(el('span', '', tt('man.p.net')));
    ol.appendChild(net);
    body.appendChild(ol);
    dlg.appendChild(body);

    const faq = el('section', 'pd-faq');
    faq.appendChild(el('h3', 'pd-faq-h', tt('man.p.failT')));
    (G().pilotFaq || []).forEach((it) => faq.appendChild(accRow(s(it.q), el('p', 'mg-acc-a', s(it.a)))));
    dlg.appendChild(faq);

    back.appendChild(dlg);
    back.addEventListener('mousedown', (e) => { if (e.target === back) closePilot(); });
    document.body.appendChild(back);
    document.addEventListener('keydown', pilotKey, true);
    pilotBack = back;
    setTimeout(() => x.focus(), 0);
  }

  /** Строка-вопрос во всю ширину с «+» справа (окно пульта). */
  function accRow(q, answer, open) {
    const wrap = el('div', 'mg-acc');
    const b = btn('mg-acc-q');
    b.appendChild(el('span', 'mg-acc-qt', q));
    const ic = el('span', 'mg-plus-ic');
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const p1 = document.createElementNS(NS, 'path'); p1.setAttribute('d', 'M5 12h14');
    const p2 = document.createElementNS(NS, 'path'); p2.setAttribute('d', 'M12 5v14'); p2.setAttribute('class', 'mg-plus-v');
    svg.appendChild(p1); svg.appendChild(p2); ic.appendChild(svg);
    b.appendChild(ic);
    const body = el('div', 'mg-acc-b'); body.appendChild(answer);
    const set = (on) => { b.setAttribute('aria-expanded', on ? 'true' : 'false'); body.hidden = !on; };
    set(!!open);
    b.addEventListener('click', () => set(body.hidden));
    wrap.appendChild(b); wrap.appendChild(body);
    return wrap;
  }

  /* ═══════════ Полный текст: блоки MANUAL ═══════════ */
  function renderBlock(b) {
    switch (b.t) {
      case 'h':    return el('h3', 'man-h', s(b));
      case 'p':    return el('p', 'man-p', s(b));
      case 'warn': return el('div', 'man-box man-warn', s(b));
      case 'note': return el('div', 'man-box man-note', s(b));
      case 'code': return codeBlock(b.code);
      case 'fig':  return renderFig(b.name, b.cap);
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
  function renderFig(name, cap) {
    // схема рисуется кодом (manual-figures.js) на текущем языке
    const f = el('figure', 'man-fig');
    const draw = window.MANUAL_FIGS && window.MANUAL_FIGS[name];
    if (draw) f.appendChild(draw(L()));
    if (cap) f.appendChild(el('figcaption', 'man-fig-cap', s(cap)));
    return f;
  }

  /* ═══════════ 3D-сборка: карточка-вход («Собрать и починить», «Сборка и ремонт») ═══════════ */
  function a3Progress() { return window.sbAsm ? window.sbAsm.progress() : null; }

  function renderAsm3d() {
    const card = el('div', 'man-a3');
    const fig = btn('man-a3-fig');
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
    const goB = btn('btn btn-primary man-a3-go');
    goB.addEventListener('click', () => {
      const p = a3Progress(); if (!window.sbAsm || !p) return;
      if (p.next) window.sbAsm.open('manual', window.sbAsm.sections[p.next[0]].id, p.next[1]);
      else window.sbAsm.open('manual');
    });
    row.appendChild(goB);
    const reset = btn('btn btn-ghost btn-sm man-a3-reset', tt('man.asm.reset'));
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
        const b = btn('man-a3-sec' + (sc.n === sc.m ? ' is-complete' : ''));
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

  /* ═══════════ Полный текст («Все разделы списком»): строится один раз на язык ═══════════ */
  let ref = null;          // { lang, root }
  function refRoot() {
    if (ref && ref.lang === L()) return ref.root;
    const root = el('div', 'man-ref');
    (window.MANUAL || []).forEach((sec) => {
      const wrap = el('section', 'man-sec');
      wrap.id = 'man-sec-' + sec.id;
      wrap.appendChild(el('h2', 'man-h2', s(sec.title)));
      (sec.blocks || []).forEach((blk) => wrap.appendChild(blk.t === 'asm3d' ? renderAsm3d() : renderBlock(blk)));
      root.appendChild(wrap);
    });
    ref = { lang: L(), root };
    index = null;
    return root;
  }
  function buildToc() {
    const toc = $('man-toc');
    if (!toc || toc.dataset.lang === L()) return;
    toc.textContent = '';
    toc.dataset.lang = L();
    (window.MANUAL || []).forEach((sec, i) => {
      const hasAsm = (sec.blocks || []).some((x) => x.t === 'asm3d');
      const b = btn('man-toc-item');
      b.appendChild(el('span', 'man-toc-n', String(i + 1)));
      b.appendChild(el('span', 'man-toc-t', s(sec.title)));
      b.dataset.target = sec.id;
      if (hasAsm) b.appendChild(el('span', 'man-toc-badge'));
      b.addEventListener('click', () => scrollToSection(sec.id));
      toc.appendChild(b);
    });
  }

  /* ═══════════ Вид «Справка» (главная) ═══════════ */
  function back(label) {
    const b = btn('mg-back');
    b.appendChild(icon('back'));
    b.appendChild(el('span', '', label || tt('man.g.back')));
    b.addEventListener('click', () => show({ v: 'home' }));
    return b;
  }

  function renderHomeView(root) {
    const g = G();
    const hero = el('section', 'mg-hero');
    hero.appendChild(el('h1', 'mg-h1', tt('tab.manual')));
    const lab = el('label', 'mg-ask', tt('man.g.ask')); lab.htmlFor = 'man-q';
    hero.appendChild(lab);
    const box = el('div', 'mg-search');
    box.appendChild(icon('search', 'mg-search-ic'));
    const q = el('input'); q.id = 'man-q'; q.type = 'search'; q.autocomplete = 'off'; q.spellcheck = false;
    q.placeholder = tt('man.g.ph');
    box.appendChild(q);
    const clr = btn('mg-search-clear hidden', '×'); clr.setAttribute('aria-label', '×');
    box.appendChild(clr);
    hero.appendChild(box);
    const res = el('div', 'mg-res hidden'); res.id = 'man-q-res';
    hero.appendChild(res);
    const pop = el('div', 'mg-pop');
    pop.appendChild(el('span', 'mg-pop-l', tt('man.g.popular')));
    (g.popular || []).forEach((it) => pop.appendChild(goButton(it, 'mg-chip')));
    hero.appendChild(pop);
    root.appendChild(hero);
    bindSearch(q, res, clr);

    const sec1 = el('section', 'mg-sec');
    sec1.appendChild(el('h2', 'mg-h2', tt('man.g.todo')));
    const tiles = el('div', 'mg-tiles');
    (g.tiles || []).forEach((tl) => {
      const b = btn('mg-tile' + (tl.danger ? ' is-danger' : ''));
      const ic = el('span', 'mg-tile-ic'); ic.style.background = tl.col; ic.appendChild(icon(tl.ic));
      b.appendChild(ic);
      b.appendChild(el('span', 'mg-tile-t', s(tl.t)));
      b.appendChild(el('span', 'mg-tile-s', s(tl.sub)));
      b.addEventListener('click', () => go(tl.to));
      tiles.appendChild(b);
    });
    sec1.appendChild(tiles);
    root.appendChild(sec1);

    const sec2 = el('section', 'mg-sec');
    sec2.appendChild(el('h2', 'mg-h2', tt('man.g.rules')));
    const rules = el('div', 'mg-rules');
    (g.rules || []).forEach((r, i) => {
      const c = el('div', 'mg-rule'); c.id = 'mg-rule-' + i;
      const top = el('div', 'mg-rule-top');
      const ic = el('span', 'mg-rule-ic tone-' + r.tone); ic.appendChild(icon(r.ic));
      top.appendChild(ic);
      top.appendChild(el('span', 'mg-rule-t', s(r.t)));
      c.appendChild(top);
      const why = el('p', 'mg-rule-why', s(r.why));
      c.appendChild(plusToggle(tt('man.g.why'), why));
      c.appendChild(why);
      rules.appendChild(c);
    });
    sec2.appendChild(rules);
    root.appendChild(sec2);

    const links = el('nav', 'mg-links');
    (g.links || []).forEach((lk) => {
      const b = btn('mg-link');
      b.appendChild(icon(lk.ic));
      b.appendChild(el('span', '', s(lk.label)));
      b.addEventListener('click', () => go(lk.to));
      links.appendChild(b);
    });
    root.appendChild(links);
  }

  /* ═══════════ Вид «Тема» ═══════════ */
  function renderTopicView(root, id) {
    const tp = G().topics[id];
    if (!tp) return renderHomeView(root);
    root.appendChild(back());

    const head = el('div', 'mg-thead');
    const ic = el('span', 'mg-thead-ic'); ic.style.background = tp.col; ic.appendChild(icon(tp.ic));
    head.appendChild(ic);
    const ht = el('div', 'mg-thead-t');
    ht.appendChild(el('h1', 'mg-h1', s(tp.title)));
    if (tp.meta) ht.appendChild(el('span', 'mg-meta', s(tp.meta)));
    head.appendChild(ht);
    root.appendChild(head);

    if (tp.warn && !tp.warnAfter) root.appendChild(el('div', 'mg-box mg-warn', s(tp.warn)));
    if (tp.intro) root.appendChild(el('p', 'mg-intro', s(tp.intro)));

    if (tp.need && tp.need.length) {
      const need = el('div', 'mg-need');
      need.appendChild(el('span', 'mg-need-h', tt('man.g.need')));
      tp.need.forEach((n) => {
        const chip = n.to ? btn('mg-need-chip is-link') : el('span', 'mg-need-chip');
        chip.appendChild(icon(n.to ? (n.to === 'pilot' ? 'phone' : 'chev') : 'check'));
        chip.appendChild(el('span', '', s(n.t)));
        if (n.to) chip.addEventListener('click', () => go(n.to));
        need.appendChild(chip);
      });
      root.appendChild(need);
    }

    if (tp.asm3d) root.appendChild(renderAsm3d());

    (tp.groups || []).forEach((gr, gi) => {
      if (gr.h) root.appendChild(el('h2', 'mg-h2 mg-gh', s(gr.h)));
      const ol = el('ol', 'mg-steps');
      gr.steps.forEach((st, si) => {
        const li = el('li', 'mg-step' + (st.final ? ' is-final' : ''));
        li.id = `mg-step-${gi}-${si}`;
        const row = el('div', 'mg-step-row');
        const n = el('span', 'mg-step-n');
        if (st.final) n.appendChild(icon('check')); else n.textContent = String(si + 1);
        row.appendChild(n);
        const tx = el('div', 'mg-step-tx');
        tx.appendChild(el('b', 'mg-step-t', s(st.t)));
        if (st.sub) tx.appendChild(el('span', 'mg-step-s', s(st.sub)));
        row.appendChild(tx);
        const pic = el('span', 'mg-step-pic'); pic.style.color = tp.col; pic.appendChild(icon(st.ic));
        row.appendChild(pic);
        li.appendChild(row);
        if (st.code) li.appendChild(codeBlock(st.code, 'mg-step-code'));
        let more = null;
        if (st.more) more = el('p', 'mg-more-p', s(st.more));
        else if (st.moreList) { more = el('ul', 'mg-more-ul'); st.moreList.forEach((x) => more.appendChild(el('li', '', s(x)))); }
        else if (st.moreCode) more = codeBlock(st.moreCode);
        if (more) {
          const box = el('div', 'mg-more'); box.appendChild(more);
          li.appendChild(plusToggle(st.moreT ? s(st.moreT) : tt('man.g.more'), box));
          li.appendChild(box);
        }
        ol.appendChild(li);
      });
      root.appendChild(ol);
    });

    if (tp.warn && tp.warnAfter) root.appendChild(el('div', 'mg-box mg-warn', s(tp.warn)));
    if (tp.fig) root.appendChild(renderFig(tp.fig.name, tp.fig.cap));
    if (tp.facts) {
      root.appendChild(el('h2', 'mg-h2 mg-gh', s(tp.facts.h)));
      const ul = el('ul', 'mg-facts');
      tp.facts.items.forEach((x) => ul.appendChild(el('li', '', s(x))));
      root.appendChild(ul);
    }
    if (tp.note) {
      const nb = el('div', 'mg-box mg-note');
      nb.appendChild(icon('info'));
      nb.appendChild(el('span', '', s(tp.note)));
      root.appendChild(nb);
    }
    if (tp.done) {
      const db = el('div', 'mg-box mg-done');
      db.appendChild(icon('check'));
      db.appendChild(el('span', '', s(tp.done)));
      root.appendChild(db);
    }
    if (tp.go && tp.go.length) {
      const row = el('div', 'mg-go');
      tp.go.forEach((it) => row.appendChild(goButton(it, 'btn btn-tinted btn-sm')));
      root.appendChild(row);
    }
    if (tp.fail && tp.fail.length) {
      const f = el('section', 'mg-fail');
      f.appendChild(el('h2', 'mg-h2', tt('man.g.fail')));
      const row = el('div', 'mg-fail-row');
      tp.fail.forEach((it) => row.appendChild(goButton(it, 'mg-fail-chip')));
      f.appendChild(row);
      root.appendChild(f);
    }
  }

  /* ═══════════ Вид «Что-то не работает?» ═══════════ */
  const checked = {};      // { symId: { index: true } } — живёт, пока открыта программа

  function renderFixView(root, symId) {
    const g = G();
    root.appendChild(back());
    root.appendChild(el('h1', 'mg-h1', tt('man.g.fixT')));
    root.appendChild(el('p', 'mg-intro', tt('man.g.fixSub')));

    const grid = el('div', 'mg-syms');
    g.symptoms.forEach((sy) => {
      const b = btn('mg-sym' + (sy.id === symId ? ' is-on' : ''));
      b.setAttribute('aria-pressed', sy.id === symId ? 'true' : 'false');
      const ic = el('span', 'mg-sym-ic'); ic.style.background = sy.col; ic.appendChild(icon(sy.ic));
      b.appendChild(ic);
      b.appendChild(el('span', 'mg-sym-t', s(sy.t)));
      b.addEventListener('click', () => show({ v: 'fix', sym: sy.id }, { keepScroll: true, toPanel: true }));
      grid.appendChild(b);
    });
    const other = btn('mg-sym mg-sym-other');
    const oic = el('span', 'mg-sym-ic'); oic.appendChild(icon('list'));
    other.appendChild(oic);
    const ot = el('span', 'mg-sym-t2');
    ot.appendChild(el('span', 'mg-sym-t', tt('man.g.other')));
    ot.appendChild(el('span', 'mg-sym-s', tt('man.g.otherSub')));
    other.appendChild(ot);
    other.addEventListener('click', () => go('man:trouble'));
    grid.appendChild(other);
    root.appendChild(grid);

    const sy = g.symptoms.find((x) => x.id === symId);
    if (!sy) return;
    const st = checked[sy.id] || (checked[sy.id] = {});
    const panel = el('section', 'mg-fixp'); panel.id = 'mg-fixp';
    const ph = el('div', 'mg-fixp-head');
    const pt = el('div', 'mg-fixp-t');
    pt.appendChild(el('h2', 'mg-h2', s(sy.t)));
    pt.appendChild(el('span', 'mg-meta', tt('man.g.checkSub')));
    ph.appendChild(pt);
    const cnt = el('span', 'mg-count');
    ph.appendChild(cnt);
    panel.appendChild(ph);
    const upd = () => {
      const n = sy.checks.filter((_, i) => st[i]).length;
      cnt.textContent = tt('man.g.checked').replace('{n}', n).replace('{m}', sy.checks.length);
      cnt.classList.toggle('is-all', n === sy.checks.length);
      helpBox.classList.toggle('is-on', n === sy.checks.length);
    };
    if (sy.urgent) {
      const u = el('div', 'mg-box mg-urgent'); u.setAttribute('role', 'alert');
      u.appendChild(icon('alert'));
      u.appendChild(el('span', '', s(sy.urgent)));
      panel.appendChild(u);
    }
    const ol = el('ol', 'mg-checks');
    sy.checks.forEach((c, i) => {
      const li = el('li', 'mg-check' + (st[i] ? ' is-done' : '')); li.id = `mg-check-${sy.id}-${i}`;
      const row = el('div', 'mg-check-row');
      row.appendChild(el('span', 'mg-check-n', String(i + 1)));
      const cb = el('input'); cb.type = 'checkbox'; cb.id = `mg-cb-${sy.id}-${i}`; cb.checked = !!st[i];
      row.appendChild(cb);
      const lab = el('label', 'mg-check-t', s(c.t)); lab.htmlFor = cb.id;
      row.appendChild(lab);
      const tag = el('span', 'mg-check-tag', tt('man.g.done'));
      row.appendChild(tag);
      const how = el('div', 'mg-check-how'); how.appendChild(el('p', '', s(c.h)));
      row.appendChild(plusToggle(tt('man.g.how'), how));
      cb.addEventListener('change', () => { st[i] = cb.checked; li.classList.toggle('is-done', cb.checked); upd(); });
      li.appendChild(row);
      li.appendChild(how);
      ol.appendChild(li);
    });
    panel.appendChild(ol);
    if (sy.go && sy.go.length) {
      const row = el('div', 'mg-go');
      sy.go.forEach((it) => row.appendChild(goButton(it, 'btn btn-tinted btn-sm')));
      panel.appendChild(row);
    }
    const helpBox = el('div', 'mg-help');
    helpBox.appendChild(icon('people'));
    const hx = el('div', 'mg-help-tx');
    hx.appendChild(el('b', '', tt('man.g.notHelpT')));
    hx.appendChild(el('span', '', tt('man.g.notHelpSub')));
    helpBox.appendChild(hx);
    panel.appendChild(helpBox);
    root.appendChild(panel);
    upd();
  }

  /* ═══════════ Вид «Все разделы списком» ═══════════ */
  function renderAllView(root) {
    root.appendChild(refRoot());
    buildToc();
    refreshAsm3d();
  }

  /* ═══════════ Переключение видов ═══════════ */
  let cur = { v: 'home' };
  let shownLang = null;

  function show(v, opts) {
    opts = opts || {};
    const page = $('tab-manual'), body = $('man-body');
    if (!page || !body) return;
    if (window.sbShared && page.classList.contains('hidden')) { opening = true; window.sbShared.showPage('manual'); opening = false; }
    const keep = opts.keepScroll ? body.scrollTop : 0;
    cur = v;
    shownLang = L();
    page.dataset.view = v.v;
    // полный текст не пересоздаём — только отцепляем, чтобы не потерять открытые вопросы
    const r = ref && ref.root;
    if (r && r.parentNode === body) body.removeChild(r);
    body.textContent = '';
    const root = v.v === 'all' ? body : el('div', 'mg');
    if (v.v === 'home') renderHomeView(root);
    else if (v.v === 'topic') renderTopicView(root, v.id);
    else if (v.v === 'fix') renderFixView(root, v.sym);
    else renderAllView(root);
    if (root !== body) body.appendChild(root);
    body.scrollTop = keep;
    refreshAsm3d();          // карточка 3D-сборки заполняется, когда она уже в документе

    if (v.v === 'all') {
      const sch = $('man-search'); if (sch && sch.value) runSearch(sch.value, $('man-results'), true);
      // вид только что открылся — сразу на место, без долгой плавной прокрутки
      if (v.faq) setTimeout(() => openFaq(v.faq, true), 30);
      else if (v.sec) setTimeout(() => scrollToSection(v.sec, true), 30);
      else if (v.node) setTimeout(() => reveal(v.node, true), 30);
      markActive();
    }
    if (opts.toPanel) setTimeout(() => { const p = $('mg-fixp'); if (p) p.scrollIntoView({ behavior: opts.keepScroll ? 'smooth' : 'auto', block: 'start' }); }, 30);
    if (opts.focus) setTimeout(() => { const n = $(opts.focus); if (n) reveal(n, true); }, 30);
  }

  /* ═══════════ Поиск ═══════════
   * Ищем по темам, проверкам «Что-то не работает» и полному тексту. Находим записи, где есть
   * все слова запроса; заголовки и простые темы весят больше. */
  let index = null;
  /** Текст узла для поиска: блоки разделяются пробелом, схемы (SVG) и номера шагов не берём. */
  const BLOCK = new Set(['LI', 'P', 'DIV', 'TD', 'TH', 'TR', 'DT', 'DD', 'SUMMARY', 'H3', 'PRE', 'FIGCAPTION', 'A', 'BUTTON']);
  function textOf(n) {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1 || n.namespaceURI === NS || n.classList.contains('man-step-n')) return '';
    let out = '';
    for (const c of n.childNodes) out += textOf(c) + (c.nodeType === 1 && BLOCK.has(c.tagName) ? ' ' : '');
    return out;
  }
  const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-яәіңғүұқөһ.]+/gi, ' ');

  function buildIndex() {
    const g = G();
    const out = [];
    const add = (e) => out.push(e);
    // темы и их шаги
    Object.keys(g.topics).forEach((id) => {
      const tp = g.topics[id];
      add({ label: s(tp.title), where: tt('tab.manual'), text: [s(tp.title), s(tp.meta), s(tp.intro)].join(' '), w: 3.6, noSnip: true,
        act: () => show({ v: 'topic', id }) });
      (tp.groups || []).forEach((gr, gi) => gr.steps.forEach((st, si) => {
        const txt = [s(st.t), s(st.sub), s(st.more), (st.moreList || []).map(s).join(' '), st.code || '', st.moreCode || ''].join(' ');
        add({ label: s(st.t), where: s(tp.title), text: txt, w: 2.6,
          act: () => show({ v: 'topic', id }, { focus: `mg-step-${gi}-${si}`, open: true }) });
      }));
      if (tp.facts) tp.facts.items.forEach((x) => add({ label: s(tp.facts.h), where: s(tp.title), text: s(x), w: 1.8, act: () => show({ v: 'topic', id }) }));
    });
    // «Что-то не работает?»
    g.symptoms.forEach((sy) => {
      add({ label: s(sy.t), where: tt('man.g.fixT'), text: s(sy.t) + ' ' + sy.checks.map((c) => s(c.t)).join(' '), w: 3.4, noSnip: true,
        act: () => show({ v: 'fix', sym: sy.id }, { toPanel: true }) });
      sy.checks.forEach((c, i) => add({ label: s(c.t), where: s(sy.t), text: s(c.t) + ' ' + s(c.h), w: 2.4,
        act: () => show({ v: 'fix', sym: sy.id }, { focus: `mg-check-${sy.id}-${i}`, open: true }) }));
    });
    // окно пульта и правила
    add({ label: tt('home.pilotT'), where: 'QR · Android', w: 3.4, noSnip: true,
      text: [tt('home.pilotT'), 'QR APK Android', tt('man.p.sub'), (g.pilotFaq || []).map((x) => s(x.q) + ' ' + s(x.a)).join(' ')].join(' '),
      act: openPilot });
    (g.rules || []).forEach((r, i) => add({ label: s(r.t), where: tt('man.g.rules'), text: s(r.t) + ' ' + s(r.why), w: 2.2,
      act: () => show({ v: 'home' }, { focus: 'mg-rule-' + i, open: true }) }));
    // полный текст
    const root = refRoot();
    (window.MANUAL || []).forEach((sec) => {
      const node = root.querySelector('#man-sec-' + sec.id);
      if (!node) return;
      let head = s(sec.title);
      add({ label: s(sec.title), where: tt('man.g.allSecs'), text: s(sec.title), w: 2, noSnip: true, act: () => show({ v: 'all', sec: sec.id }) });
      [...node.children].forEach((child) => {
        if (child.classList.contains('man-h2')) return;
        if (child.classList.contains('man-h')) {
          head = child.textContent;
          add({ label: head, where: s(sec.title), text: head, w: 1.6, act: () => show({ v: 'all', node: child }) });
          return;
        }
        if (child.classList.contains('man-faq')) {
          const q = child.querySelector('.man-faq-q').textContent;
          add({ label: q, where: s(sec.title) + ' · ' + head, text: q + ' ' + textOf(child.querySelector('.man-faq-a')), w: 2.2, q,
            act: () => show({ v: 'all', node: child }) });
          return;
        }
        const txt = textOf(child);
        if (txt && txt.trim()) add({ label: head, where: s(sec.title), text: txt, w: 1, act: () => show({ v: 'all', node: child }) });
      });
    });
    out.forEach((e) => { e.n = norm(e.text + ' ' + e.label); e.nl = norm(e.label); });
    index = out;
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

  /** side — поиск в «Все разделы» (слева, вместо оглавления); иначе — под большим полем на главной. */
  function runSearch(qRaw, box, side) {
    if (!box) return;
    const words = norm(qRaw).split(' ').filter((w) => w.length >= 2);
    const active = words.length > 0;
    box.classList.toggle('hidden', !active);
    if (side) {
      const toc = $('man-toc'); if (toc) toc.classList.toggle('hidden', active);
      const head = document.querySelector('.man-side-h'); if (head) head.classList.toggle('hidden', active);
    }
    box.textContent = '';
    if (!active) return;
    if (!index || (ref && ref.lang !== L())) buildIndex();
    const hits = index
      .filter((e) => words.every((w) => e.n.includes(w)))
      .map((e) => ({ e, score: e.w + words.filter((w) => e.nl.includes(w)).length * 2 }))
      .sort((a, b) => b.score - a.score);
    // под одним подзаголовком бывает несколько абзацев — показываем лучший, остальные лишь шумят
    const seen = new Set();
    const list = hits.filter((h) => { const k = h.e.label + '|' + h.e.where; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, side ? 40 : 10);
    if (!list.length) {
      box.appendChild(el('div', 'man-res-none', tt('man.searchNone')));
      box.appendChild(goButton({ to: 'fix', label: { ru: tt('man.troubleGo'), kk: tt('man.troubleGo') } }, 'btn btn-ghost btn-sm man-res-go'));
      return;
    }
    box.appendChild(el('div', 'man-res-count', tt('man.results').replace('{n}', list.length)));
    list.forEach(({ e }) => {
      const b = btn('man-res');
      b.appendChild(el('span', 'man-res-t', e.label));
      if (e.where) b.appendChild(el('span', 'man-res-where', e.where));
      if (!e.noSnip) b.appendChild(snippet(e.q ? e.text.slice(e.q.length) : e.text, words));
      b.addEventListener('click', () => e.act());
      box.appendChild(b);
    });
  }

  function bindSearch(input, box, clr, side) {
    let deb = null;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => runSearch(input.value, box, side), 120);
      if (clr) clr.classList.toggle('hidden', !input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; runSearch('', box, side); if (clr) clr.classList.add('hidden'); }
      if (e.key === 'Enter') { const first = box.querySelector('.man-res'); if (first) first.click(); }
    });
    if (clr) clr.addEventListener('click', () => { input.value = ''; runSearch('', box, side); clr.classList.add('hidden'); input.focus(); });
  }

  /* ═══════════ Прокрутка к месту ═══════════ */
  function flash(node) {
    node.classList.remove('man-flash');
    void node.offsetWidth;                // перезапуск анимации
    node.classList.add('man-flash');
    setTimeout(() => node.classList.remove('man-flash'), 2200);
  }
  function reveal(node, instant) {
    if (!node) return;
    const faq = node.closest && node.closest('.man-faq');
    if (faq) faq.open = true;
    // шаг темы или проверка — раскрыть «+ Подробнее»
    const plus = node.querySelector && node.querySelector('.mg-plus');
    if (plus && plus.sbOpen && (node.classList.contains('mg-step') || node.classList.contains('mg-check') || node.classList.contains('mg-rule'))) plus.sbOpen();
    node.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    flash(faq || node);
  }
  function scrollToSection(id, instant) {
    const n = $('man-sec-' + id);
    if (n) n.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    else if (!id) { const b = $('man-body'); if (b) b.scrollTop = 0; }
  }
  function openFaq(id, instant) {
    const d = $('faq-' + id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    flash(d);
  }

  /** Подсветка раздела, который сейчас на экране (только «Все разделы»). */
  function markActive() {
    const body = $('man-body');
    if (!body || cur.v !== 'all') return;
    const top = body.scrollTop;
    let at = null;
    (window.MANUAL || []).forEach((sec) => {
      const n = $('man-sec-' + sec.id);
      if (n && n.offsetTop - 80 <= top) at = sec.id;
    });
    document.querySelectorAll('.man-toc-item').forEach((b) => b.classList.toggle('active', b.dataset.target === at));
  }

  const bodyEl = $('man-body');
  if (bodyEl) {
    let tick = null;
    bodyEl.addEventListener('scroll', () => {
      if (tick) return;
      tick = setTimeout(() => { tick = null; markActive(); }, 120);
    });
  }
  const sideSearch = $('man-search');
  if (sideSearch) bindSearch(sideSearch, $('man-results'), $('man-search-clear'), true);

  // Ctrl+F в справке — к видимому полю поиска
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyF') return;
    const page = $('tab-manual');
    if (!page || page.classList.contains('hidden')) return;
    const f = cur.v === 'all' ? sideSearch : $('man-q');
    if (!f) { if (cur.v !== 'all') { e.preventDefault(); show({ v: 'home' }); setTimeout(() => { const q = $('man-q'); if (q) q.focus(); }, 0); } return; }
    e.preventDefault();
    f.focus(); f.select();
  });

  // смена языка — пересобираем текущий вид, оставаясь на месте
  document.addEventListener('sb-lang-changed', () => {
    ref = null; index = null;
    if (pilotBack) openPilot();
    paintHomeQr();
    const page = $('tab-manual');
    if (!shownLang || !page || page.classList.contains('hidden')) { shownLang = null; return; }
    show(cur, { keepScroll: true });
  });

  /* QR на «Домой»: рисуем один раз, он не зависит от языка */
  function paintHomeQr() {
    const hq = $('home-pilot-qr');
    if (hq && !hq.firstChild) hq.appendChild(qrSvg(PILOT_APK_URL));
  }
  paintHomeQr();

  let opening = false;
  window.sbManual = {
    /** Открыли «?» — главная справки (если не открываем конкретное место). */
    onShow() { if (!opening) show({ v: 'home' }); },
    /** Открыть справку на нужном месте (см. шапку файла). */
    open(target) {
      if (target === 'pilot') { openPilot(); return; }
      if (window.sbShared) { opening = true; window.sbShared.showPage('manual'); opening = false; }
      go(target === undefined || target === null ? '' : target);
    },
    openPilot,
    closePilot,
    PILOT_APK_URL
  };
})();
