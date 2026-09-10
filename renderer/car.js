/* «Бортовой компьютер» — среда программирования машинки Phygital Machines.
 *
 * Код ученика выполняется НА машинке в песочнице (отдельный процесс без доступа
 * к железу). Здесь — редактор с подсказками, живым линтом, шпаргалкой команд,
 * мини-картой пинов, понятными ошибками (RU/KK) и живой консолью.
 *
 * Философия: подсказываем ЧТО есть и ПОЧЕМУ ошибка, но не пишем код за ученика.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  /* ── язык ── */
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  function tt(key) { try { return t(key); } catch (_) { return key; } }

  /* ── команды API (док на двух языках прямо здесь) ── */
  const API = [
    { name: 'pin',     grp: 'out', sig: 'pin(n, HIGH/LOW)', ru: 'подать/снять 3.3В на пине n (как digitalWrite)', kk: 'n пиніне 3.3В беру/алу (digitalWrite сияқты)' },
    { name: 'servo',   grp: 'out', sig: 'servo(n, deg)',    ru: 'серво на пине n → угол 0–180. Паузу ставь сам!', kk: 'n пиніндегі серво → 0–180 бұрыш. Кідірісті өзің қой!' },
    { name: 'strip',   grp: 'out', sig: 'strip(i, r, g, b)', ru: 'цвет i-го диода в буфере (0–8)', kk: 'i-диод түсі буферде (0–8)' },
    { name: 'show',    grp: 'out', sig: 'show()', noargs: true, ru: 'вывести буфер на ленту', kk: 'буферді таспаға шығару' },
    { name: 'fire',    grp: 'out', sig: 'fire()', noargs: true, ru: 'ИК-выстрел (не чаще раза в 0.5с)', kk: 'ИҚ-ату (0.5с сайын бір рет)' },
    { name: 'read',    grp: 'in',  sig: 'read(n)', ru: 'уровень на пине n: 1 или 0', kk: 'n пиніндегі деңгей: 1 не 0' },
    { name: 'wait',    grp: 'evt', sig: 'wait(sec)', ru: 'пауза, секунды (можно дробные)', kk: 'кідіріс, секунд (бөлшек болады)' },
    { name: 'on_hit',  grp: 'evt', sig: 'on_hit(func)', ru: 'вызвать func, когда в нас попали', kk: 'соғылғанда func шақыру' },
    { name: 'on_button', grp: 'evt', sig: 'on_button(n, func)', ru: 'вызвать func, когда пилот нажал кнопку n (1–3)', kk: 'пилот n батырмасын басқанда func шақыру' },
    { name: 'forever', grp: 'evt', sig: 'forever()', noargs: true, ru: 'держать программу живой, ждать события', kk: 'бағдарламаны тірі ұстау, оқиға күту' },
    { name: 'print',   grp: 'evt', sig: 'print(text)', ru: 'вывести текст в консоль', kk: 'консольге мәтін шығару' }
  ];
  const API_NAMES = API.map((d) => d.name);
  const PYKW = ['def', 'for', 'while', 'if', 'elif', 'else', 'return', 'import', 'in', 'and', 'or', 'not', 'range', 'break', 'continue', 'True', 'False', 'None'];

  /* ── пины ── */
  const ROLE = {
    motor: { ru: 'Мотор', kk: 'Мотор' }, steer: { ru: 'Руль', kk: 'Руль' },
    strip: { ru: 'Лента', kk: 'Таспа' }, ir_rx: { ru: 'ИК-приёмник', kk: 'ИҚ-қабылдағыш' },
    ir_tx: { ru: 'ИК-передатчик', kk: 'ИҚ-таратқыш' }
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
    d.className = cls || '';
    d.textContent = text;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }
  function logLine(text) {
    // раскраска по началу строки
    let cls = 'c-print';
    if (text.indexOf('[машинка]') === 0 || text.indexOf('[машинка]') === 1) cls = 'c-machine';
    else if (text.indexOf('⛔') >= 0) cls = 'c-err';
    else if (text.indexOf('⏳') >= 0) cls = 'c-warn';
    else if (text.indexOf('💥') >= 0 || text.indexOf('попал') >= 0) cls = 'c-hit';
    else if (text.indexOf('—') === 0) cls = 'c-sys';
    log(text, cls);
  }

  /* ── статус/кнопки ── */
  function setStatus(cls, text) {
    const el = $('car-status'); if (!el) return;
    el.className = 'car-status ' + cls; el.textContent = text;
  }
  function refreshUi() {
    const dis = (id, v) => { const b = $(id); if (b) b.disabled = v; };
    dis('btn-car-upload', !connected);
    dis('btn-car-stop', !connected || !running);
    dis('btn-car-clear', !connected || !hasSaved);
    dis('btn-car-hit', !connected || !running);
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
      mode: 'python', lineNumbers: true, indentUnit: 4, viewportMargin: Infinity,
      theme: document.body.dataset.theme === 'dark' ? 'material-darker' : 'default',
      extraKeys: {
        'Ctrl-Space': openAC,
        Tab: (c) => c.replaceSelection('    ', 'end')
      }
    });
    cm.on('change', () => {
      clearTimeout(saveTimer);
      const code = cm.getValue();
      saveTimer = setTimeout(() => { try { window.sb.autosaveSet('car', code); } catch (_) {} }, 1200);
      lint();
      if (acEl) drawAC();
    });
    cm.on('cursorActivity', closeAC);
    addPinOverlay();
    addPinHover();
    lint();
  }

  /* ── подсветка пинов ── */
  function addPinOverlay() {
    cm.addOverlay({
      token: function (stream) {
        const before = stream.string.slice(0, stream.pos);
        if (/(?:servo|pin|read)\s*\(\s*$/.test(before)) {
          const m = stream.match(/\d+/);
          if (m) {
            const z = zoneOf(parseInt(m[0], 10));
            return z ? 'pin' + z : 'pinnum';
          }
        }
        stream.next();
        return null;
      }
    });
  }

  /* ── ховер по пину ── */
  function addPinHover() {
    const wrap = cm.getWrapperElement();
    wrap.addEventListener('mousemove', (e) => {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      const tok = cm.getTokenAt(pos);
      if (tok && /^\d+$/.test(tok.string || '')) {
        const line = cm.getLine(pos.line) || '';
        const before = line.slice(0, tok.start);
        if (/(?:servo|pin|read)\s*\(\s*$/.test(before)) {
          const n = parseInt(tok.string, 10), z = zoneOf(n);
          let body;
          if (z === 'free') body = L() === 'ru' ? 'Свободный — можно использовать' : 'Бос — қолдануға болады';
          else if (z === 'bad') body = roleText(PINMAP[n].role) + (L() === 'ru' ? ' — трогать нельзя!' : ' — тиюге болмайды!');
          else if (z === 'sys') body = roleText(PINMAP[n].role) + (L() === 'ru' ? ' — через команды' : ' — командалар арқылы');
          else body = L() === 'ru' ? 'Свободный пин' : 'Бос пин';
          showTT(e, 'GPIO ' + n, body); return;
        }
      }
      hideTT();
    });
    wrap.addEventListener('mouseleave', hideTT);
  }

  /* ── тултип ── */
  function showTT(e, title, body) {
    if (!ttEl) { ttEl = document.createElement('div'); ttEl.id = 'car-tt'; document.body.appendChild(ttEl); }
    ttEl.innerHTML = '';
    const h = document.createElement('div'); h.className = 'tt-t'; h.textContent = title;
    const b = document.createElement('div'); b.textContent = body;
    ttEl.appendChild(h); ttEl.appendChild(b);
    ttEl.style.display = 'block';
    ttEl.style.left = (e.clientX + 14) + 'px';
    ttEl.style.top = (e.clientY + 16) + 'px';
  }
  function hideTT() { if (ttEl) ttEl.style.display = 'none'; }

  /* ── автодополнение (мягкое) ── */
  function currentWord() {
    const cur = cm.getCursor(), line = cm.getLine(cur.line);
    let s = cur.ch;
    while (s > 0 && /[A-Za-z_]/.test(line[s - 1])) s--;
    return { word: line.slice(s, cur.ch), from: { line: cur.line, ch: s }, to: cur };
  }
  function openAC() {
    const cw = currentWord();
    let list = API.filter((d) => d.name.indexOf(cw.word) === 0);
    if (cw.word === '') list = API.slice();
    if (!list.length) { closeAC(); return; }
    acItems = list; acSel = 0; acFrom = cw.from;
    if (!acEl) { acEl = document.createElement('div'); acEl.id = 'car-ac'; document.body.appendChild(acEl); }
    const co = cm.cursorCoords(true, 'window');
    acEl.style.left = co.left + 'px';
    acEl.style.top = (co.bottom + 4) + 'px';
    acEl.style.display = 'block';
    drawAC();
  }
  function drawAC() {
    if (!acEl) return;
    const cw = currentWord();
    acItems = (cw.word === '' ? API.slice() : API.filter((d) => d.name.indexOf(cw.word) === 0));
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
    const to = cm.getCursor();
    cm.replaceRange(ins, acFrom, to);
    if (!d.noargs) {
      const c = cm.getCursor(); // после "("
      cm.setCursor(c);
    }
    closeAC();
    cm.focus();
  }
  function closeAC() { if (acEl) { acEl.style.display = 'none'; } acItems = []; }
  // навигация клавишами, пока открыт список
  document.addEventListener('keydown', (e) => {
    if (!acEl || acEl.style.display !== 'block') return;
    if (e.key === 'ArrowDown') { acSel = (acSel + 1) % acItems.length; drawAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowUp') { acSel = (acSel - 1 + acItems.length) % acItems.length; drawAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { acceptAC(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Escape') { closeAC(); e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ── линт (живой, клиентский) ── */
  function lev(a, b) {
    const m = a.length, n = b.length; let d = []; for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function nearest(w) { let best = null, bd = 99; API_NAMES.forEach((n) => { const dd = lev(w, n); if (dd < bd) { bd = dd; best = n; } }); return bd <= 2 ? best : null; }
  function fmt(key, map) { let s = tt(key); Object.keys(map).forEach((k) => { s = s.split('{' + k + '}').join(map[k]); }); return s; }

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
        if (z === 'bad') {
          msgs.push({ t: 'err', line: i, text: fmt('car.errPinBad', { n: n, role: roleText(PINMAP[n].role) }) });
          mark(i, idx, idx + m[2].length, 'cm-lint-err');
        } else if (z === 'sys') {
          msgs.push({ t: 'warn', line: i, text: fmt('car.errPinSys', { n: n, role: roleText(PINMAP[n].role) }) });
          mark(i, idx, idx + m[2].length, 'cm-lint-warn');
        }
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
  function mark(line, a, b, cls) { try { lintMarks.push(cm.markText({ line: line, ch: a }, { line: line, ch: b }, { className: cls })); } catch (_) {} }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── шпаргалка ── */
  function buildCheat() {
    const body = $('car-cheat-body'); if (!body) return;
    const groups = [['out', tt('car.gOut')], ['in', tt('car.gIn')], ['evt', tt('car.gEvt')]];
    body.innerHTML = groups.map((g) => {
      const items = API.filter((d) => d.grp === g[0]).map((d) =>
        '<div class="car-cmd"><code>' + escapeHtml(d.sig) + '</code><div class="d">' + escapeHtml(d[L()] || d.ru) + '</div></div>').join('');
      return '<div class="car-grp"><div class="car-glabel">' + g[1] + '</div>' + items + '</div>';
    }).join('');
  }
  function buildMap() {
    const svg = $('car-map'); if (!svg) return;
    const col = { free: '#26a269', sys: '#e5a50a', bad: '#e01b24' };
    let s = '<rect x="40" y="24" width="180" height="142" rx="22" fill="rgba(120,140,180,.14)" stroke="rgba(120,140,180,.4)"/>'
      + '<rect x="24" y="40" width="16" height="30" rx="5" fill="rgba(120,140,180,.4)"/>'
      + '<rect x="220" y="40" width="16" height="30" rx="5" fill="rgba(120,140,180,.4)"/>'
      + '<rect x="24" y="120" width="16" height="30" rx="5" fill="rgba(120,140,180,.4)"/>'
      + '<rect x="220" y="120" width="16" height="30" rx="5" fill="rgba(120,140,180,.4)"/>'
      + '<rect x="98" y="10" width="64" height="12" rx="6" fill="#26a269" opacity=".85"/>'
      + '<text x="130" y="20" text-anchor="middle" font-size="8" fill="#04261a">CAM</text>';
    PINS.forEach((p, idx) => {
      const cx = 70 + (idx % 3) * 60, cy = 54 + Math.floor(idx / 3) * 38;
      s += '<g class="car-pinpad" data-n="' + p.n + '" style="cursor:default">'
        + '<circle cx="' + cx + '" cy="' + cy + '" r="14" fill="' + col[p.zone] + '"/>'
        + '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#0b1020">' + p.n + '</text></g>';
    });
    svg.innerHTML = s;
    svg.querySelectorAll('.car-pinpad').forEach((g) => {
      g.addEventListener('mousemove', (e) => {
        const n = parseInt(g.dataset.n, 10), p = PINMAP[n];
        const body = p.zone === 'free' ? (L() === 'ru' ? 'Свободный — можно использовать' : 'Бос — қолдануға болады')
          : roleText(p.role) + (p.zone === 'bad' ? (L() === 'ru' ? ' — трогать нельзя!' : ' — тиюге болмайды!') : (L() === 'ru' ? ' — через команды' : ' — командалар арқылы'));
        showTT(e, 'GPIO ' + n, body);
      });
      g.addEventListener('mouseleave', hideTT);
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
  wire('btn-car-stop', () => { try { window.sb.carStop(); } catch (_) {} });
  wire('btn-car-clear', async () => { if (!connected) return; if (!confirm(tt('car.clearConfirm'))) return; try { await window.sb.carClear(); } catch (_) {} });
  wire('btn-car-reset', () => { if (!cm) return; if (!confirm(tt('msg.resetConfirm'))) return; cm.setValue(STARTER); });
  wire('btn-car-hit', () => { try { window.sb.carHit && window.sb.carHit(); } catch (_) {} });
  wire('btn-car-hints', () => { if (cm) { cm.focus(); openAC(); } });
  wire('btn-car-cheat', () => { const a = $('car-cheat'); if (a) a.classList.toggle('hidden'); if (cm) setTimeout(() => cm.refresh(), 0); });

  /* ── события от машинки ── */
  if (window.sb && window.sb.onCarOutput) window.sb.onCarOutput((text) => String(text).split(/(?<=\n)/).forEach((p) => { if (p) logLine(p); }));
  if (window.sb && window.sb.onCarState) window.sb.onCarState((st) => {
    if (st.ev === 'hello') { carId = String(st.car || ''); hasSaved = !!st.saved; refreshUi(); return; }
    if (st.ev === 'saved') { if (st.ok) { hasSaved = true; logLine(tt('car.savedMsg') + '\n'); } else logLine('\n' + String(st.error || 'error') + '\n'); refreshUi(); return; }
    if (st.ev === 'cleared') { hasSaved = false; logLine(tt('car.clearedMsg') + '\n'); refreshUi(); return; }
    if (st.ev === 'lint') {
      if (st.ok) return; // всё чисто — сервер запустит
      const box = $('car-problems');
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

  /* ── язык поменялся ── */
  document.addEventListener('sb-lang-changed', () => { buildCheat(); buildMap(); lint(); refreshUi(); });

  /* ── интеграция с приложением ── */
  window.sbCar = {
    onShow() {
      if (!cm) initEditor().then(() => { cm.refresh(); buildCheat(); buildMap(); });
      else { setTimeout(() => cm.refresh(), 0); buildCheat(); buildMap(); }
      refreshUi();
      if (!connected && consoleEl() && !consoleEl().textContent) logLine(tt('car.hint') + '\n');
    },
    applyTheme(theme) { if (cm) cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default'); }
  };
})();
