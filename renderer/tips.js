/* Подсказки первого запуска: «облачка» у элементов интерфейса, по одному,
 * с кнопкой «Понятно · 1 из 3». Показываются один раз на вкладку, отметка
 * хранится в настройках (tipsSeen). Сбросить можно в настройках.
 *   window.sbTips.show('python', [{ el: '#btn-py-run', key: 'tips.pyRun', at: 'below' }, …])
 */
(() => {
  const tt = (k) => { try { return t(k); } catch (_) { return k; } };
  let seen = null;      // {python: true, car: true}
  let active = null;    // {steps, i, box}

  async function loadSeen() {
    if (seen) return seen;
    try { const s = await window.sb.getSettings(); seen = Object.assign({}, (s && s.tipsSeen) || {}); } catch (_) { seen = {}; }
    return seen;
  }
  async function markSeen(key) {
    seen = seen || {}; seen[key] = true;
    try { await window.sb.setSettings({ tipsSeen: seen }); } catch (_) {}
  }

  function place(box, target, at) {
    const r = target.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight, m = 12;
    let top, left;
    box.classList.remove('at-below', 'at-above', 'at-right', 'at-left');
    if (at === 'inside') { left = r.left + 48; top = r.top + 44; box.classList.add('at-below'); }
    else if (at === 'right') { left = r.right + m; top = r.top + Math.min(r.height / 2 - 20, 40); box.classList.add('at-right'); }
    else if (at === 'left') { left = r.left - bw - m; top = r.top + Math.min(r.height / 2 - 20, 40); box.classList.add('at-left'); }
    else if (at === 'above') { left = r.left; top = r.top - bh - m; box.classList.add('at-above'); }
    else { left = r.left; top = r.bottom + m; box.classList.add('at-below'); }
    // не вылезать за окно
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    box.style.left = left + 'px'; box.style.top = top + 'px';
  }

  function draw() {
    if (!active) return;
    const { steps, i, box } = active;
    const st = steps[i];
    const target = document.querySelector(st.el);
    if (!target || !target.isConnected || target.closest('.hidden')) {
      // первый же шаг не виден — вкладку успели переключить; тихо отменяем,
      // «видел» не отмечаем, покажем в следующий раз
      if (!active.shown) { cancel(); return; }
      next(); return;
    }
    active.shown = (active.shown || 0) + 1;
    box.innerHTML = '';
    const n = document.createElement('span'); n.className = 'tip-n'; n.textContent = String(i + 1);
    const txt = document.createElement('span'); txt.textContent = tt(st.key);
    const row = document.createElement('div'); row.className = 'tip-row';
    const ok = document.createElement('button'); ok.className = 'tip-ok';
    ok.textContent = (i + 1 < steps.length ? tt('tips.next') : tt('tips.done')) + ' · ' + (i + 1) + ' ' + tt('tips.of') + ' ' + steps.length;
    ok.addEventListener('click', next);
    const skip = document.createElement('button'); skip.className = 'tip-skip'; skip.textContent = tt('tips.skip');
    skip.addEventListener('click', finish);
    row.appendChild(ok); row.appendChild(skip);
    box.appendChild(n); box.appendChild(txt); box.appendChild(row);
    target.classList.add('tip-target');
    active.target = target;
    place(box, target, st.at || 'below');
  }
  function next() {
    if (!active) return;
    if (active.target) active.target.classList.remove('tip-target');
    active.i++;
    if (active.i >= active.steps.length) finish(); else draw();
  }
  function cancel() {
    if (!active) return;
    if (active.target) active.target.classList.remove('tip-target');
    active.box.remove(); active = null;
    window.removeEventListener('resize', onResize);
  }
  function finish() {
    if (!active) return;
    if (active.target) active.target.classList.remove('tip-target');
    active.box.remove();
    const key = active.key; active = null;
    markSeen(key);
    window.removeEventListener('resize', onResize);
  }
  function onResize() { if (active) draw(); }

  async function show(key, steps, force) {
    const s = await loadSeen();
    if (!force && s[key]) return false;
    if (active) cancel();
    const box = document.createElement('div');
    box.className = 'tip-box';
    document.body.appendChild(box);
    active = { key, steps, i: 0, box, target: null };
    window.addEventListener('resize', onResize);
    // дать вкладке отрисоваться
    setTimeout(draw, 250);
    return true;
  }
  async function reset() { seen = {}; try { await window.sb.setSettings({ tipsSeen: {} }); } catch (_) {} }

  window.sbTips = { show, reset, isActive: () => !!active, dismiss: cancel };
})();
