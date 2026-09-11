/* «Бортовой компьютер» — среда программирования машинки Phygital Machines.
 *
 * Код ученика выполняется НА машинке в песочнице (отдельный процесс без доступа
 * к железу). Здесь — редактор с подсказками (по наведению и при наборе), живым
 * линтом, картой пинов реальной малинки, понятными ошибками (RU/KK) и живой
 * консолью. Философия: подсказываем ЧТО есть и ПОЧЕМУ ошибка, но не пишем код
 * за ученика.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  function tt(key) { try { return t(key); } catch (_) { return key; } }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── команды API (док на двух языках) ── */
  const API = [
    { name: 'pin',     grp: 'out', sig: 'pin(n, HIGH/LOW)', ru: 'подать/снять 3.3В на пине n (как digitalWrite)', kk: 'n пиніне 3.3В беру/алу (digitalWrite сияқты)' },
    { name: 'servo',   grp: 'out', sig: 'servo(n, deg)',    ru: 'серво на пине n → угол 0–180. Паузу ставь сам!', kk: 'n пиніндегі серво → 0–180 бұрыш. Кідірісті өзің қой!' },
    { name: 'strip',   grp: 'out', sig: 'strip(i, r, g, b)', ru: 'цвет i-го диода встроенной ленты в буфере (0–8)', kk: 'кіріктірілген таспаның i-диод түсі буферде (0–8)' },
    { name: 'show',    grp: 'out', sig: 'show()', noargs: true, ru: 'вывести буфер на ленту', kk: 'буферді таспаға шығару' },
    { name: 'fire',    grp: 'out', sig: 'fire()', noargs: true, ru: 'ИК-выстрел встроенной пушкой (не чаще раза в 0.5с)', kk: 'ИҚ-ату (0.5с сайын бір рет)' },
    { name: 'read',    grp: 'in',  sig: 'read(n)', ru: 'уровень на пине n: 1 или 0', kk: 'n пиніндегі деңгей: 1 не 0' },
    { name: 'wait',    grp: 'evt', sig: 'wait(sec)', ru: 'пауза, секунды (можно дробные)', kk: 'кідіріс, секунд (бөлшек болады)' },
    { name: 'on_hit',  grp: 'evt', sig: 'on_hit(func)', ru: 'вызвать func, когда в нас попали', kk: 'соғылғанда func шақыру' },
    { name: 'on_button', grp: 'evt', sig: 'on_button(n, func)', ru: 'вызвать func, когда пилот нажал кнопку n (1–3)', kk: 'пилот n батырмасын басқанда func шақыру' },
    { name: 'forever', grp: 'evt', sig: 'forever()', noargs: true, ru: 'держать программу живой, ждать события', kk: 'бағдарламаны тірі ұстау, оқиға күту' },
    { name: 'print',   grp: 'evt', sig: 'print(text)', ru: 'вывести текст в консоль', kk: 'консольге мәтін шығару' }
  ];
  const API_NAMES = API.map((d) => d.name);
  const API_BY = {}; API.forEach((d) => { API_BY[d.name] = d; });
  const PYKW = ['def', 'for', 'while', 'if', 'elif', 'else', 'return', 'import', 'in', 'and', 'or', 'not', 'range', 'break', 'continue', 'True', 'False', 'None'];

  /* ── пины ── */
  const ROLE = {
    motor: { ru: 'мотор', kk: 'мотор' }, steer: { ru: 'руль', kk: 'руль' },
    strip: { ru: 'лента', kk: 'таспа' }, ir_rx: { ru: 'ИК-приём', kk: 'ИҚ-қабылдау' },
    ir_tx: { ru: 'ИК-выстрел', kk: 'ИҚ-ату' }
  };
  const PINS = [
    { n: 13, zone: 'bad', role: 'motor' }, { n: 18, zone: 'bad', role: 'steer' },
    { n: 10, zone: 'sys', role: 'strip' }, { n: 25, zone: 'sys', role: 'ir_rx' },
    { n: 12, zone: 'sys', role: 'ir_tx' },
    { n: 17, zone: 'free' }, { n: 22, zone: 'free' }, { n: 23, zone: 'free' },
    { n: 24, zone: 'free' }, { n: 27, zone: 'free' }
  ];
  const PINMAP = {}; PINS.forEach((p) => { PINMAP[p.n] = p; });
  const zoneOf = (n) => (PINMAP[n] ? PINMAP[n].zone : null);
  const roleText = (r) => (ROLE[r] ? ROLE[r][L()] || ROLE[r].ru : r);

  // Раскладка 40-пинового разъёма малинки (как на реальной плате):
  // физический пин → тип. k: 'p' питание, 'n' земля, 'g' GPIO (b = номер BCM).
  const HEADER = [
    null,
    { k: 'p', l: '3V3' }, { k: 'p', l: '5V' },
    { k: 'g', b: 2 },     { k: 'p', l: '5V' },
    { k: 'g', b: 3 },     { k: 'n', l: 'GND' },
    { k: 'g', b: 4 },     { k: 'g', b: 14 },
    { k: 'n', l: 'GND' }, { k: 'g', b: 15 },
    { k: 'g', b: 17 },    { k: 'g', b: 18 },
    { k: 'g', b: 27 },    { k: 'n', l: 'GND' },
    { k: 'g', b: 22 },    { k: 'g', b: 23 },
    { k: 'p', l: '3V3' }, { k: 'g', b: 24 },
    { k: 'g', b: 10 },    { k: 'n', l: 'GND' },
    { k: 'g', b: 9 },     { k: 'g', b: 25 },
    { k: 'g', b: 11 },    { k: 'g', b: 8 },
    { k: 'n', l: 'GND' }, { k: 'g', b: 7 },
    { k: 'g', b: 0 },     { k: 'g', b: 1 },
    { k: 'g', b: 5 },     { k: 'n', l: 'GND' },
    { k: 'g', b: 6 },     { k: 'g', b: 12 },
    { k: 'g', b: 13 },    { k: 'n', l: 'GND' },
    { k: 'g', b: 19 },    { k: 'g', b: 16 },
    { k: 'g', b: 26 },    { k: 'g', b: 20 },
    { k: 'n', l: 'GND' }, { k: 'g', b: 21 }
  ];

  /* ── стартовая заготовка ── */
  const STARTER = [
    '# Бортовой компьютер машинки Phygital Machines',
    '# Пиши код — он работает прямо на машинке!',
    '#',
    '# У пилота 3 кнопки ловушек. Что делает каждая — решаешь ТЫ здесь.',
    '',
    'CLAW = 23                 # своё серво на свободном пине 23',
    '',
    'def flashbang():          # ловушка «маячок»: мигаем маджента/зелёным',
    '    for k in range(10):',
    '        for i in range(9): strip(i, 255, 0, 255)   # маджента',
    '        show(); wait(0.16)',
    '        for i in range(9): strip(i, 0, 255, 0)      # зелёный',
    '        show(); wait(0.16)',
    '    for i in range(9): strip(i, 0, 0, 0)            # погасить',
    '    show()',
    '',
    'def claw():               # ловушка «клешня»',
    '    servo(CLAW, 120); wait(0.4); servo(CLAW, 0)',
    '',
    'def hurt():               # когда в нас попали',
    '    print("В нас попали!")',
    '',
    'on_button(1, flashbang)   # кнопка 1 → маячок',
    'on_button(2, claw)        # кнопка 2 → клешня',
    'on_button(3, fire)        # кнопка 3 → выстрел',
    'on_hit(hurt)',
    '',
    'forever()                 # ждём кнопки и попадания',
    ''
  ].join('\n');

  let cm = null;
  let connected = false, running = false, hasSaved = false, carId = '';
  let saveTimer = null, lintMarks = [], acEl = null, ttEl = null, acItems = [], acSel = 0, acFrom = null;

  const consoleEl = () => $('car-console');
  function log(text, cls) {
    const el = consoleEl(); if (!el) return;
    const d = document.createElement('span');
    d.className = cls || ''; d.textContent = text;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
  }
  function logLine(text) {
    let cls = 'c-print';
    if (text.indexOf('[машинка]') >= 0 && text.indexOf('[машинка]') <= 1) cls = 'c-machine';
    else if (text.indexOf('⛔') >= 0) cls = 'c-err';
    else if (text.indexOf('⏳') >= 0) cls = 'c-warn';
    else if (text.indexOf('💥') >= 0 || text.indexOf('попал') >= 0) cls = 'c-hit';
    else if (text.indexOf('—') === 0) cls = 'c-sys';
    log(text, cls);
  }

  /* ── статус/кнопки ── */
  function setStatus(cls, text) { const el = $('car-status'); if (!el) return; el.className = 'car-status ' + cls; el.textContent = text; }
  function refreshUi() {
    const dis = (id, v) => { const b = $(id); if (b) b.disabled = v; };
    dis('btn-car-upload', !connected);
    dis('btn-car-clear', !connected || !hasSaved);
    const bc = $('btn-car-connect');
    if (bc) bc.querySelector('[data-i18n]').textContent = connected ? tt('car.disconnect') : tt('car.connect');
    if (!connected) setStatus('off', tt('car.off'));
    else if (running) setStatus('busy', (carId ? '№' + carId + ' · ' : '') + tt('car.running'));
    else setStatus('on', tt('car.on') + (carId ? ' · №' + carId : '') + (hasSaved ? ' · ' + tt('car.savedBadge') : ''));
    const badge = $('car-badge');
    if (badge) { badge.className = 'badge ' + (running ? 'busy' : connected ? 'ok' : ''); badge.textContent = running ? '▶' : ''; }
  }

  /* ── редактор ── */
  async function initEditor() {
    let saved = null;
    try { saved = await window.sb.autosaveGet('car'); } catch (_) {}
    cm = CodeMirror($('car-editor'), {
      value: (saved && saved.ok && saved.code) ? saved.code : STARTER,
      mode: 'python', lineNumbers: true, indentUnit: 4,
      theme: document.body.dataset.theme === 'dark' ? 'material-darker' : 'default',
      extraKeys: { 'Ctrl-Space': openAC, Tab: (c) => c.replaceSelection('    ', 'end') }
    });
    cm.on('change', () => {
      clearTimeout(saveTimer);
      const code = cm.getValue();
      saveTimer = setTimeout(() => { try { window.sb.autosaveSet('car', code); } catch (_) {} }, 1200);
      lint();
      autoAC();
    });
    cm.on('cursorActivity', () => { /* не закрываем сразу — даём набирать */ });
    cm.on('blur', closeAC);
    addPinOverlay();
    addHover();
    lint();
  }

  /* ── подсветка пинов ── */
  function addPinOverlay() {
    cm.addOverlay({
      token: function (stream) {
        const before = stream.string.slice(0, stream.pos);
        if (/(?:servo|pin|read)\s*\(\s*$/.test(before)) {
          const m = stream.match(/\d+/);
          if (m) { const z = zoneOf(parseInt(m[0], 10)); return z ? 'pin' + z : 'pinnum'; }
        }
        const w = stream.match(/[A-Za-z_]\w*/);
        if (w) { return API_BY[w[0]] ? 'apicmd' : null; }
        stream.next(); return null;
      }
    });
  }

  /* ── подсказка по наведению: пин ИЛИ команда ── */
  function addHover() {
    const wrap = cm.getWrapperElement();
    let hoverTimer = null, lastKey = '';
    wrap.addEventListener('mousemove', (e) => {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      const tok = cm.getTokenAt(pos);
      if (!tok || !tok.string || !tok.string.trim()) { lastKey = ''; hideTT(); return; }
      const key = tok.string + '@' + pos.line + ':' + tok.start;
      if (key === lastKey) { moveTT(e); return; }   // тот же токен — просто двигаем
      lastKey = key;
      clearTimeout(hoverTimer);
      const ev = { clientX: e.clientX, clientY: e.clientY };
      // пин?
      if (/^\d+$/.test(tok.string)) {
        const line = cm.getLine(pos.line) || '';
        if (/(?:servo|pin|read)\s*\(\s*$/.test(line.slice(0, tok.start))) {
          const n = parseInt(tok.string, 10), z = zoneOf(n);
          let body;
          if (z === 'free') body = L() === 'ru' ? 'Свободный — можно использовать' : 'Бос — қолдануға болады';
          else if (z === 'bad') body = roleText(PINMAP[n].role) + (L() === 'ru' ? ' — трогать нельзя!' : ' — тиюге болмайды!');
          else if (z === 'sys') body = roleText(PINMAP[n].role) + (L() === 'ru' ? ' — через команду' : ' — команда арқылы');
          else body = L() === 'ru' ? 'Свободный пин' : 'Бос пин';
          hoverTimer = setTimeout(() => showTT(ev, 'GPIO ' + n, body), 350);
          return;
        }
      }
      // команда?
      const d = API_BY[tok.string];
      if (d) { hoverTimer = setTimeout(() => showTT(ev, d.sig, d[L()] || d.ru), 350); return; }
      hideTT();
    });
    wrap.addEventListener('mouseleave', () => { lastKey = ''; hideTT(); });
  }

  /* ── тултип ── */
  function showTT(e, title, body) {
    if (!ttEl) { ttEl = document.createElement('div'); ttEl.id = 'car-tt'; document.body.appendChild(ttEl); }
    ttEl.innerHTML = '';
    const h = document.createElement('div'); h.className = 'tt-t'; h.textContent = title;
    const b = document.createElement('div'); b.textContent = body;
    ttEl.appendChild(h); ttEl.appendChild(b);
    ttEl.style.display = 'block'; moveTT(e);
  }
  function moveTT(e) { if (ttEl) { ttEl.style.left = (e.clientX + 14) + 'px'; ttEl.style.top = (e.clientY + 16) + 'px'; } }
  function hideTT() { if (ttEl) ttEl.style.display = 'none'; }

  /* ── автодополнение: само при 3+ буквах и по Ctrl+Space ── */
  function currentWord() {
    const cur = cm.getCursor(), line = cm.getLine(cur.line);
    let s = cur.ch;
    while (s > 0 && /[A-Za-z_]/.test(line[s - 1])) s--;
    return { word: line.slice(s, cur.ch), from: { line: cur.line, ch: s }, to: cur };
  }
  function matches(word) {
    if (word === '') return API.slice();
    return API.filter((d) => d.name.indexOf(word) === 0);
  }
  function autoAC() {
    const cw = currentWord();
    const list = matches(cw.word).filter((d) => d.name !== cw.word);
    if (cw.word.length >= 3 && list.length) openAC();
    else closeAC();
  }
  function openAC() {
    const cw = currentWord();
    const list = matches(cw.word);
    if (!list.length) { closeAC(); return; }
    acItems = list; acSel = 0; acFrom = cw.from;
    if (!acEl) { acEl = document.createElement('div'); acEl.id = 'car-ac'; document.body.appendChild(acEl); }
    const co = cm.cursorCoords(true, 'window');
    acEl.style.left = co.left + 'px'; acEl.style.top = (co.bottom + 4) + 'px';
    acEl.style.display = 'block'; drawAC();
  }
  function drawAC() {
    if (!acEl) return;
    const cw = currentWord();
    acItems = matches(cw.word);
    if (!acItems.length) { closeAC(); return; }
    if (acSel >= acItems.length) acSel = acItems.length - 1;
    acFrom = cw.from;
    acEl.innerHTML = '';
    acItems.forEach((d, i) => {
      const it = document.createElement('div');
      it.className = 'ac-i' + (i === acSel ? ' sel' : '');
      const c = document.createElement('code'); c.innerHTML = '<b>' + d.name + '</b>' + escapeHtml(d.sig.slice(d.name.length));
      const dd = document.createElement('span'); dd.className = 'd'; dd.textContent = d[L()] || d.ru;
      it.appendChild(c); it.appendChild(dd);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); acSel = i; acceptAC(); });
      acEl.appendChild(it);
    });
    const hint = document.createElement('div'); hint.className = 'ac-hint'; hint.textContent = tt('car.acHint');
    acEl.appendChild(hint);
  }
  function acceptAC() {
    if (!acEl || !acItems.length) return;
    const d = acItems[acSel];
    const ins = d.noargs ? d.name + '()' : d.name + '(';
    cm.replaceRange(ins, acFrom, cm.getCursor());
    closeAC(); cm.focus();
  }
  function closeAC() { if (acEl) acEl.style.display = 'none'; acItems = []; }
  document.addEventListener('keydown', (e) => {
    if (!acEl || acEl.style.display !== 'block') return;
    if (e.key === 'ArrowDown') { acSel = (acSel + 1) % acItems.length; drawAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowUp') { acSel = (acSel - 1 + acItems.length) % acItems.length; drawAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { acceptAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Escape') { closeAC(); e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ── линт ── */
  function lev(a, b) {
    const m = a.length, n = b.length; const d = []; for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function nearest(w) { let best = null, bd = 99; API_NAMES.forEach((n) => { const dd = lev(w, n); if (dd < bd) { bd = dd; best = n; } }); return bd <= 2 ? best : null; }
  function fmt(key, map) { let s = tt(key); Object.keys(map).forEach((k) => { s = s.split('{' + k + '}').join(map[k]); }); return s; }
  function mark(line, a, b, cls) { try { lintMarks.push(cm.markText({ line: line, ch: a }, { line: line, ch: b }, { className: cls })); } catch (_) {} }

  function lint() {
    if (!cm) return [];
    lintMarks.forEach((m) => m.clear()); lintMarks = [];
    const box = $('car-problems'); if (box) box.innerHTML = '';
    const msgs = [];
    const lines = cm.getValue().split('\n');
    lines.forEach((ln, i) => {
      const noStr = ln.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (s) => ' '.repeat(s.length)).replace(/#.*$/, (s) => ' '.repeat(s.length));
      let m;
      const rp = /(servo|pin|read)\s*\(\s*(\d+)/g;
      while ((m = rp.exec(noStr))) {
        const n = parseInt(m[2], 10), z = zoneOf(n);
        const idx = m.index + m[0].length - m[2].length;
        if (z === 'bad') { msgs.push({ t: 'err', line: i, text: fmt('car.errPinBad', { n: n, role: roleText(PINMAP[n].role) }) }); mark(i, idx, idx + m[2].length, 'cm-lint-err'); }
        else if (z === 'sys') { msgs.push({ t: 'warn', line: i, text: fmt('car.errPinSys', { n: n, role: roleText(PINMAP[n].role) }) }); mark(i, idx, idx + m[2].length, 'cm-lint-warn'); }
      }
      const rc = /([A-Za-z_]\w*)\s*\(/g;
      while ((m = rc.exec(noStr))) {
        const w = m[1];
        if (API_NAMES.indexOf(w) < 0 && PYKW.indexOf(w) < 0) {
          const sug = nearest(w);
          if (sug) { msgs.push({ t: 'err', line: i, text: fmt('car.errTypo', { w: w, sug: sug }) }); mark(i, m.index, m.index + w.length, 'cm-lint-err'); }
        }
      }
      const s = ln.replace(/#.*$/, '').trim();
      if (/^(def|if|elif|else|for|while)\b/.test(s) && s !== '' && !/:\s*$/.test(s) && !/:\s*\S/.test(s))
        msgs.push({ t: 'err', line: i, text: tt('car.errColon') });
    });
    if (box) box.innerHTML = msgs.map((x) =>
      '<div class="car-prob ' + x.t + '"><span class="pln">' + (L() === 'ru' ? 'стр. ' : 'жол ') + (x.line + 1) + '</span><span>' + escapeHtml(x.text) + '</span></div>').join('');
    return msgs;
  }

  /* ── карта пинов (реальный 40-пиновый разъём) ── */
  function pinCell(phys, side) {
    const h = HEADER[phys];
    let zone = 'none', role = null, label;
    if (h.k === 'p') { zone = 'pwr'; label = h.l; }
    else if (h.k === 'n') { zone = 'gnd'; label = h.l; }
    else {
      const z = zoneOf(h.b);
      if (z) { zone = z; role = PINMAP[h.b].role; }
      label = 'GPIO' + h.b + (role ? ' · ' + roleText(role) : '');
    }
    const num = '<span class="pp-num">' + phys + '</span>';
    const dot = '<span class="pp-dot z-' + zone + '"></span>';
    const lab = '<span class="pp-lab z-' + zone + '">' + escapeHtml(label) + '</span>';
    const inner = side === 'l' ? (lab + dot + num) : (num + dot + lab);
    const b = (h.k === 'g' ? h.b : -1);
    return '<div class="pp-cell ' + side + '" data-b="' + b + '" data-z="' + zone + '">' + inner + '</div>';
  }
  function buildMap() {
    const box = $('car-map'); if (!box) return;
    let rows = '';
    for (let r = 1; r <= 20; r++) rows += '<div class="pp-row">' + pinCell(2 * r - 1, 'l') + pinCell(2 * r, 'r') + '</div>';
    box.innerHTML = rows;
    box.querySelectorAll('.pp-cell').forEach((c) => {
      const b = parseInt(c.dataset.b, 10), z = c.dataset.z;
      if (z === 'none' || z === 'pwr' || z === 'gnd') return;
      c.classList.add('hoverable');
      c.addEventListener('mousemove', (e) => {
        const p = PINMAP[b];
        const body = z === 'free' ? (L() === 'ru' ? 'Свободный — вешай своё: servo / pin / read' : 'Бос — өзіңдікін іл: servo / pin / read')
          : z === 'bad' ? (roleText(p.role) + (L() === 'ru' ? ' — трогать нельзя (машина пилота)' : ' — тиюге болмайды (пилот көлігі)'))
            : (roleText(p.role) + (L() === 'ru' ? ' — встроено, зови командой' : ' — кіріктірілген, командамен шақыр'));
        showTT(e, 'GPIO ' + b, body);
      });
      c.addEventListener('mouseleave', hideTT);
    });
  }

  /* ── ползунок высоты консоли ── */
  function initResizer() {
    const rez = $('car-console-resizer'), wrap = $('car-console-wrap');
    if (!rez || !wrap || rez._wired) return; rez._wired = true;
    rez.addEventListener('mousedown', (e) => {
      const startY = e.clientY, startH = wrap.getBoundingClientRect().height;
      const move = (ev) => { let h = startH + (startY - ev.clientY); h = Math.max(90, Math.min(h, window.innerHeight * 0.7)); wrap.style.height = h + 'px'; if (cm) cm.refresh(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); e.preventDefault();
    });
  }

  /* ── кнопки ── */
  function wire(id, fn) { const b = $(id); if (b) b.addEventListener('click', fn); }
  wire('btn-car-connect', async () => {
    if (connected) { try { await window.sb.carDisconnect(); } catch (_) {} return; }
    setStatus('busy', tt('car.connecting'));
    let host = '';
    try { const st = await window.sb.getSettings(); host = (st && st.carHost) || ''; } catch (_) {}
    const r = await window.sb.carConnect(host);
    if (!r || !r.ok) { connected = false; refreshUi(); logLine('\n' + tt('car.errConn') + '\n'); }
  });
  wire('btn-car-upload', async () => { if (!connected || !cm) return; consoleEl().textContent = ''; try { await window.sb.carSave(cm.getValue()); } catch (_) {} });
  wire('btn-car-clear', async () => { if (!connected) return; if (!confirm(tt('car.clearConfirm'))) return; try { await window.sb.carClear(); } catch (_) {} });

  /* ── события от машинки ── */
  if (window.sb && window.sb.onCarOutput) window.sb.onCarOutput((text) => String(text).split(/(?<=\n)/).forEach((p) => { if (p) logLine(p); }));
  if (window.sb && window.sb.onCarState) window.sb.onCarState((st) => {
    if (st.ev === 'hello') { carId = String(st.car || ''); hasSaved = !!st.saved; refreshUi(); return; }
    if (st.ev === 'saved') { if (st.ok) { hasSaved = true; logLine(tt('car.savedMsg') + '\n'); } else logLine('\n' + String(st.error || 'error') + '\n'); refreshUi(); return; }
    if (st.ev === 'cleared') { hasSaved = false; logLine(tt('car.clearedMsg') + '\n'); refreshUi(); return; }
    if (st.ev === 'lint') {
      if (st.ok) return;
      (st.errors || []).forEach((er) => {
        let text;
        if (er.code === 'pin') text = fmt('car.errPinBad', { n: er.pin, role: roleText(er.role) });
        else if (er.code === 'syntax') text = (L() === 'ru' ? 'Строка ' : 'Жол ') + (er.line || '?') + ': ' + tt('car.errSyntax');
        else text = er.msg || 'error';
        logLine('⛔ ' + text + '\n');
      });
      return;
    }
    if ('connected' in st) {
      const was = connected; connected = !!st.connected;
      if (!connected) { running = false; carId = ''; if (was) logLine('\n' + tt('car.lost') + '\n'); }
    }
    if ('running' in st) {
      const was = running; running = !!st.running;
      if (was && !running) {
        if (st.error) logLine('\n' + String(st.error) + '\n');
        logLine((st.stopped ? tt('car.stoppedMsg') : tt('car.doneMsg')) + '\n');
      }
    }
    refreshUi();
  });

  document.addEventListener('sb-lang-changed', () => { buildMap(); lint(); refreshUi(); });

  /* ── интеграция с приложением ── */
  window.sbCar = {
    onShow() {
      if (!cm) initEditor().then(() => { cm.refresh(); buildMap(); initResizer(); });
      else { setTimeout(() => cm.refresh(), 0); buildMap(); initResizer(); }
      refreshUi();
      if (!connected && consoleEl() && !consoleEl().textContent) logLine(tt('car.hint') + '\n');
    },
    applyTheme(theme) { if (cm) cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default'); }
  };
})();
