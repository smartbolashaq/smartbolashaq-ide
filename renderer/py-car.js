/* Панель «Виртуальная машинка» рядом с редактором: лента из 9 диодов,
 * ИК-пушка, сервоприводы и пины, кнопки пилота и «попадание». Команды
 * приходят из py-worker.js (модуль _sbcar) пачками; нажатия уходят обратно
 * через общий буфер событий (SharedArrayBuffer). */
(() => {
  const FREE_PINS = [17, 22, 23, 24, 27];
  let ev = null;            // Int32Array: [0] события (биты), [1] уровни входных пинов (биты по FREE_PINS)
  let used = false;
  let fireTimer = null;
  const servos = {};        // pin → угол
  const outs = {};          // pin → уровень (pin())
  let inputs = 0;           // биты входов, включённых на панели

  const $ = (id) => document.getElementById(id);
  const tt = (k) => { try { return t(k); } catch (_) { return k; } };
  const pane = () => $('py-car-pane');
  const panel = () => $('py-work-panel');

  function build() {
    const p = pane(); if (!p || p.dataset.built) return;
    p.dataset.built = '1';
    p.innerHTML = ''
      + '<div class="vc-title"><span data-i18n="car.vTitle">' + tt('car.vTitle') + '</span><span class="vc-clock" id="vc-clock"></span></div>'
      + '<div class="vc-strip" id="vc-strip">' + Array.from({ length: 9 }, (_, i) => '<i class="vc-led" data-i="' + i + '" title="strip(' + i + ', …)"></i>').join('') + '</div>'
      + '<div class="vc-row"><span class="vc-fire" id="vc-fire">◉</span><span class="vc-lbl" data-i18n="car.vFire">' + tt('car.vFire') + '</span><span class="vc-count" id="vc-fire-n"></span></div>'
      + '<div class="vc-pins" id="vc-pins"></div>'
      + '<div class="vc-btns"><span class="vc-lbl" data-i18n="car.vButtons">' + tt('car.vButtons') + '</span>'
      + [1, 2, 3].map((n) => '<button class="vc-btn" data-btn="' + n + '">' + n + '</button>').join('')
      + '<button class="vc-btn vc-hit" data-hit="1">💥 <span data-i18n="car.vHit">' + tt('car.vHit') + '</span></button></div>'
      + '<div class="vc-hint" data-i18n="car.vHint">' + tt('car.vHint') + '</div>';
    p.querySelectorAll('.vc-btn').forEach((b) => b.addEventListener('click', () => {
      if (!ev) return;
      const bit = b.dataset.hit ? 8 : (1 << (Number(b.dataset.btn) - 1));
      Atomics.or(ev, 0, bit); Atomics.notify(ev, 0);
      b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 180);
    }));
    renderPins();
  }
  function renderPins() {
    const box = $('vc-pins'); if (!box) return;
    box.innerHTML = '';
    FREE_PINS.forEach((pin, idx) => {
      const row = document.createElement('div'); row.className = 'vc-pin';
      const lbl = document.createElement('span'); lbl.className = 'vc-pin-n'; lbl.textContent = 'GPIO' + pin;
      row.appendChild(lbl);
      if (servos[pin] !== undefined) {
        const g = document.createElement('span'); g.className = 'vc-servo';
        g.innerHTML = '<i style="transform:rotate(' + (servos[pin] - 90) + 'deg)"></i>';
        g.title = 'servo(' + pin + ', ' + Math.round(servos[pin]) + ')';
        row.appendChild(g);
        const v = document.createElement('span'); v.className = 'vc-pin-v'; v.textContent = Math.round(servos[pin]) + '°';
        row.appendChild(v);
      } else if (outs[pin] !== undefined) {
        const v = document.createElement('span'); v.className = 'vc-pin-v ' + (outs[pin] ? 'hi' : 'lo'); v.textContent = outs[pin] ? 'HIGH' : 'LOW';
        row.appendChild(v);
      } else {
        // свободный вход: переключатель уровня для read()
        const sw = document.createElement('button'); sw.className = 'vc-sw' + ((inputs >> idx) & 1 ? ' on' : '');
        sw.textContent = (inputs >> idx) & 1 ? '1' : '0'; sw.title = 'read(' + pin + ')';
        sw.addEventListener('click', () => { inputs ^= (1 << idx); if (ev) Atomics.store(ev, 1, inputs); renderPins(); });
        row.appendChild(sw);
      }
      box.appendChild(row);
    });
  }

  function apply(cmds) {
    build();
    for (const c of cmds) {
      if (c[0] === 'leds') {
        used = true;
        const leds = pane().querySelectorAll('.vc-led');
        c[1].forEach((rgb, i) => {
          const el = leds[i]; if (!el) return;
          const [r, g, b] = rgb; const on = Math.max(r, g, b) > 8;
          el.style.background = on ? 'rgb(' + r + ',' + g + ',' + b + ')' : '';
          el.style.boxShadow = on ? '0 0 10px 2px rgba(' + r + ',' + g + ',' + b + ',.7)' : '';
          el.classList.toggle('on', on);
        });
      } else if (c[0] === 'servo') { used = true; servos[c[1]] = c[2]; delete outs[c[1]]; renderPins(); }
      else if (c[0] === 'pin') { used = true; outs[c[1]] = c[2]; delete servos[c[1]]; renderPins(); }
      else if (c[0] === 'fire') {
        used = true;
        const f = $('vc-fire'); if (f) { f.classList.add('shot'); clearTimeout(fireTimer); fireTimer = setTimeout(() => f.classList.remove('shot'), 350); }
        const n = $('vc-fire-n'); if (n) n.textContent = '×' + (Number((n.textContent || '×0').slice(1)) + 1);
      }
    }
    if (used) show();
  }

  function show() { const p = pane(); if (p) p.classList.remove('hidden'); const w = panel(); if (w) w.classList.add('has-turtle'); }
  function hide() { const p = pane(); if (p) p.classList.add('hidden'); const w = panel(); const tp = $('py-turtle-pane'); if (w && (!tp || tp.classList.contains('hidden'))) w.classList.remove('has-turtle'); }

  window.sbVCar = {
    setEvents(sab) { ev = new Int32Array(sab); Atomics.store(ev, 1, inputs); },
    /* новый запуск: погасить всё; в режиме машинки панель видна сразу */
    reset(visible) {
      build();
      used = false;
      Object.keys(servos).forEach((k) => delete servos[k]); Object.keys(outs).forEach((k) => delete outs[k]);
      const p = pane();
      if (p) { p.querySelectorAll('.vc-led').forEach((el) => { el.style.background = ''; el.style.boxShadow = ''; el.classList.remove('on'); }); const n = $('vc-fire-n'); if (n) n.textContent = ''; }
      renderPins();
      if (visible) show(); else hide();
    },
    apply, show, hide
  };
  document.addEventListener('sb-lang-changed', () => { const p = pane(); if (p && p.dataset.built) { delete p.dataset.built; build(); } });
})();
