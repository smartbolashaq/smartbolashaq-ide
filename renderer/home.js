/* Стартовый экран «Домой»: две дороги — курс Python и машинка — с прогрессом,
 * состоянием связи и кнопками «Продолжить». */
(() => {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  const T = (x) => (x == null ? '' : (typeof x === 'string' ? x : (x[L()] || x.ru || '')));
  const tt = (k, vars) => {
    let s; try { s = t(k); } catch (_) { s = k; }
    if (vars) Object.keys(vars).forEach((v) => { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  };
  let carState = { connected: false };

  async function fill() {
    let st = {};
    try { st = await window.sb.getSettings(); } catch (_) {}

    /* ── курс Python ── */
    const course = window.COURSE || [];
    const solved = (st.pyProgress && st.pyProgress.solved) || {};
    const total = course.reduce((n, m) => n + m.tasks.length, 0);
    const done = course.reduce((n, m) => n + m.tasks.filter((tk) => solved[tk.id]).length, 0);
    const curIdx = course.findIndex((m) => m.tasks.some((tk) => !solved[tk.id]));
    const cur = curIdx >= 0 ? course[curIdx] : null;
    $('home-py-where').textContent = cur ? tt('home.moduleAt', { i: curIdx + 1, t: T(cur.short) }) : tt('home.allDone');
    $('home-py-count').textContent = tt('home.tasksOf', { n: done, m: total });
    $('home-py-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    $('home-py-go').querySelector('span').textContent = tt(done ? 'home.continue' : 'home.start');

    /* ── машинка ── */
    let mats = [], cdone = {};
    try { cdone = (st.carProgress && st.carProgress.done) || {}; } catch (_) {}
    if (window.sbCarTab) { try { await window.sbCarTab.ensure(); mats = window.sbCarTab.materials() || []; } catch (_) {} }
    const ndone = mats.filter((m) => cdone[m.id || m.file_ru || m.file]).length;
    const next = mats.find((m) => !cdone[m.id || m.file_ru || m.file]);
    const pickT = (m) => (L() === 'kk' ? (m.title_kk || m.title_ru || m.title) : (m.title_ru || m.title || m.title_kk)) || '';
    $('home-car-where').textContent = mats.length
      ? (next ? pickT(next) : tt('home.allDone')) + ' · ' + tt('home.lessonsOf', { n: ndone, m: mats.length })
      : tt('home.noLessons');
    $('home-car-bar').style.width = (mats.length ? Math.round(ndone / mats.length * 100) : 0) + '%';
    $('home-car-go').querySelector('span').textContent = tt(ndone ? 'home.continue' : 'home.start');
    renderCarStat();
  }
  function renderCarStat() {
    const el = $('home-car-stat'); if (!el) return;
    el.className = 'status-pill' + (carState.connected ? ' on' : '');
    el.textContent = '● ' + (carState.connected ? tt('car.on') + (carState.carId ? ' · №' + carState.carId : '') : tt('car.off'));
  }

  $('home-py-go').addEventListener('click', () => {
    window.sbShared.showPage('python');
    // открыть модуль, на котором остановились
    setTimeout(() => {
      if (!window.sbCourse) return;
      const solved = window.sbCourse.progress().solved || {};
      const m = (window.COURSE || []).find((x) => x.tasks.some((tk) => !solved[tk.id]));
      window.sbCourse.show(m ? m.id : 'intro');
    }, 150);
  });
  $('home-car-go').addEventListener('click', async () => {
    window.sbShared.showPage('car');
    if (window.sbCarTab) window.sbCarTab.continueLesson();
  });
  $('home-car-free').addEventListener('click', () => {
    window.sbShared.showPage('car');
    if (window.sbCarTab) window.sbCarTab.showFree();
  });
  $('home-manual-go').addEventListener('click', () => window.sbShared.showPage('manual'));
  $('home-card-manual').addEventListener('dblclick', () => window.sbShared.showPage('manual'));

  document.addEventListener('sb-car-state', (e) => { carState = e.detail || carState; renderCarStat(); });
  document.addEventListener('sb-lang-changed', () => { if (!$('tab-home').classList.contains('hidden')) fill(); });

  window.sbHome = { onShow: fill };
})();
