/* Знакомство при первом запуске: три коротких экрана поверх программы.
 *   1. Что это за машинка и что она умеет.
 *   2. Как это работает: телефон — пульт, компьютер — для программ, машинка выполняет.
 *   3. С чего начать: Сборка → Основы Python → Машинка.
 * Показывается один раз (welcomeSeen в настройках) и только новому ученику: если в
 * программе уже есть прогресс, знакомство молча отмечается как просмотренное.
 * Снова открывается строкой «Знакомство с машинкой» на «Домой».
 * Клавиши: → / ← — листать, Esc — закрыть. */
(() => {
  const $ = (id) => document.getElementById(id);
  const root = $('welcome');
  if (!root) return;
  const slides = Array.from(root.querySelectorAll('.wel-slide'));
  const dots = Array.from(root.querySelectorAll('.wel-dots i'));
  const N = slides.length;
  let cur = 1;
  const tt = (k) => { try { return t(k); } catch (_) { return k; } };
  const isOpen = () => !root.classList.contains('hidden');

  function render() {
    slides.forEach((s) => s.classList.toggle('hidden', +s.dataset.n !== cur));
    dots.forEach((d, i) => d.classList.toggle('on', i + 1 === cur));
    $('wel-count').textContent = tt('wel.count').split('{n}').join(String(cur));
    $('wel-back').classList.toggle('invisible', cur === 1);
    $('wel-next').classList.toggle('hidden', cur === N);
    $('wel-done').classList.toggle('hidden', cur !== N);
    const kk = typeof currentLang !== 'undefined' && currentLang === 'kk';
    root.querySelectorAll('[data-wel-lang]').forEach((b) => b.classList.toggle('active', (b.dataset.welLang === 'kk') === kk));
  }
  function go(n) {
    cur = Math.max(1, Math.min(N, n));
    render();
    const s = slides[cur - 1];
    s.classList.remove('wel-in'); void s.offsetWidth; s.classList.add('wel-in');
    // фокус — на главную кнопку экрана: Enter сразу листает дальше
    const f = cur === N ? $('wel-go-asm') : $('wel-next');
    try { f.focus({ preventScroll: true }); } catch (_) {}
  }

  /* на третьем экране: «Начать» или «Продолжить», если ученик уже начинал */
  async function fillPath() {
    let st = {};
    try { st = await window.sb.getSettings(); } catch (_) {}
    let asmN = 0;
    try { if (window.sbAsm) { await window.sbAsm.whenReady(); asmN = window.sbAsm.progress().n; } } catch (_) {}
    const pyN = Object.keys((st.pyProgress && st.pyProgress.solved) || {}).length;
    const carN = Object.keys((st.carProgress && st.carProgress.solved) || {}).length;
    $('wel-go-asm-t').textContent = tt(asmN ? 'home.asmContinue' : 'wel.p1b');
    $('wel-go-py').textContent = tt(pyN ? 'home.continue' : 'home.openCourse');
    $('wel-go-car').textContent = tt(carN ? 'home.continue' : 'wel.p3b');
  }

  function open(n) {
    if (window.sbTips && window.sbTips.isActive()) window.sbTips.dismiss();
    root.classList.remove('hidden');
    document.body.classList.add('wel-open');
    go(n || 1);
    fillPath();
  }
  function close(then) {
    if (!isOpen()) return;
    root.classList.add('hidden');
    document.body.classList.remove('wel-open');
    try { window.sb.setSettings({ welcomeSeen: true }); } catch (_) {}
    if (typeof then === 'function') then();
    else if (window.sbHome && !$('tab-home').classList.contains('hidden')) window.sbHome.onShow();
  }

  /* при запуске: новичку — показать, у кого уже есть прогресс — просто отметить */
  function maybeShow(st) {
    st = st || {};
    if (st.welcomeSeen) return;
    const has = (o) => o && Object.keys(o).length > 0;
    const used = st.lastWork || has(st.pyProgress && st.pyProgress.solved) || has(st.carProgress && st.carProgress.solved)
      || has(st.asm3d && st.asm3d.done) || has(st.asmProgress && st.asmProgress.done);
    if (used) { try { window.sb.setSettings({ welcomeSeen: true }); } catch (_) {} return; }
    open(1);
  }

  const nav = (name) => () => close(() => { if (window.sbHome && window.sbHome[name]) window.sbHome[name](); });
  $('wel-next').addEventListener('click', () => go(cur + 1));
  $('wel-back').addEventListener('click', () => go(cur - 1));
  $('wel-skip').addEventListener('click', () => close());
  $('wel-done').addEventListener('click', () => close());
  $('wel-go-asm').addEventListener('click', nav('goAsm'));
  $('wel-go-py').addEventListener('click', nav('goPy'));
  $('wel-go-car').addEventListener('click', nav('goCar'));
  root.querySelectorAll('[data-wel-lang]').forEach((b) => b.addEventListener('click', () => {
    if (typeof setLang === 'function') setLang(b.dataset.welLang);
  }));
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (cur < N) go(cur + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (cur > 1) go(cur - 1); }
  }, true);
  document.addEventListener('sb-lang-changed', () => { if (isOpen()) { render(); fillPath(); } });
  const homeBtn = $('home-welcome-go');
  if (homeBtn) homeBtn.addEventListener('click', () => open(1));

  window.sbWelcome = { open, close, maybeShow, isOpen };
})();
