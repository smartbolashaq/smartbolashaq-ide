/* Стартовый экран «Домой»: большая карточка «Продолжить» (то, чем занимались
 * в последний раз: курс Python, уроки с машинкой или 3D-сборка), три карточки
 * разделов с прогрессом и список «Как всё устроено» / «Подключить машинку». */
(() => {
  const $ = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  const T = (x) => (x == null ? '' : (typeof x === 'string' ? x : (x[L()] || x.ru || '')));
  const tt = (k, vars) => {
    let s; try { s = t(k); } catch (_) { s = k; }
    if (vars) Object.keys(vars).forEach((v) => { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  };
  const RING = 113.1;   // длина окружности r=18 у кольца прогресса
  let carState = { connected: false };
  let heroGo = null, heroAlt = null;

  /* прогресс курса: модули, решённые задания, модуль «где остановились» */
  function courseInfo(course, solved) {
    const total = course.reduce((n, m) => n + m.tasks.length, 0);
    const done = course.reduce((n, m) => n + m.tasks.filter((tk) => solved[tk.id]).length, 0);
    const idx = course.findIndex((m) => m.tasks.some((tk) => !solved[tk.id]));
    const cur = idx >= 0 ? course[idx] : null;
    const curDone = cur ? cur.tasks.filter((tk) => solved[tk.id]).length : 0;
    return { total, done, idx, cur, curDone };
  }

  function showCode(code, file, out) {
    $('home-hero-codewin').classList.remove('hidden');
    $('home-hero-imgwrap').classList.add('hidden');
    $('home-hero-file').textContent = file || '';
    const pre = $('home-hero-code');
    pre.textContent = '';
    const lines = String(code || '').split('\n').slice(0, 8).join('\n');
    try { CodeMirror.runMode(lines, 'python', pre); } catch (_) { pre.textContent = lines; }
    const o = String(out || '').split('\n').filter(Boolean).slice(0, 3).join(' · ');
    $('home-hero-out').textContent = o;
    $('home-hero-out').hidden = !o;
  }
  function showImage() {
    $('home-hero-codewin').classList.add('hidden');
    $('home-hero-imgwrap').classList.remove('hidden');
  }

  async function fill() {
    let st = {};
    try { st = await window.sb.getSettings(); } catch (_) {}

    /* ── курс Python ── */
    const py = courseInfo(window.COURSE || [], (st.pyProgress && st.pyProgress.solved) || {});
    $('home-py-count').textContent = tt('home.tasksOf', { n: py.done, m: py.total });
    const ring = $('home-py-ring');
    ring.setAttribute('stroke-dasharray', (py.total ? RING * py.done / py.total : 0).toFixed(1) + ' ' + RING);
    ring.style.opacity = py.done ? '1' : '0';

    /* ── машинка ── */
    const ccourse = window.CAR_COURSE || [];
    const car = courseInfo(ccourse, (st.carProgress && st.carProgress.solved) || {});
    $('home-car-where').textContent = ccourse.length
      ? (car.cur ? tt('home.lessonAt', { i: car.idx + 1, t: T(car.cur.short) }) : tt('home.allDone')) + ' · ' + tt('home.tasksOf', { n: car.done, m: car.total })
      : tt('home.noLessons');
    $('home-car-go').textContent = tt(car.done ? 'home.continue' : 'home.start');
    renderCarStat();

    /* ── 3D-сборка шасси ── */
    let asm = null;
    if (window.sbAsm) {
      await window.sbAsm.whenReady();
      asm = window.sbAsm.progress();
      const nx = asm.next ? { l: window.sbAsm.sections[asm.next[0]].letter, n: window.sbAsm.sections[asm.next[0]].steps[asm.next[1]].num } : null;
      asm.where = nx ? tt('home.asmAt', nx) : tt('home.allDone');
      $('home-asm-where').textContent = asm.where;
      $('home-asm-count').textContent = asm.n + ' / ' + asm.m;
      $('home-asm-bar').style.width = Math.round(100 * asm.n / asm.m) + '%';
      $('home-asm-go').textContent = tt(asm.n ? 'home.asmContinue' : 'home.start');
    }

    /* ── «Продолжить»: последний раздел, где работали ── */
    let work = st.lastWork || 'python';
    if (work === 'assembly' && !asm) work = 'python';
    const hTitle = $('home-hero-title'), hSub = $('home-hero-sub'), hBar = $('home-hero-bar');
    const alt = $('home-hero-alt');
    if (work === 'car' && ccourse.length) {
      const m = car.cur || ccourse[0];
      const i = car.cur ? car.idx : 0;
      hTitle.textContent = tt('home.lessonAt', { i: i + 1, t: T(m.title || m.short) });
      hSub.textContent = (car.cur ? tt('home.taskN', { k: Math.min(car.curDone + 1, m.tasks.length), n: m.tasks.length }) + ' · ' : '')
        + tt('home.tasksOf', { n: car.done, m: car.total });
      hBar.style.width = (car.total ? Math.round(car.done / car.total * 100) : 0) + '%';
      const ex = (m.ex || [])[0];
      if (ex) showCode(T(ex.c), ex.f, T(ex.o)); else showImage();
      alt.textContent = tt('car.free');
      heroGo = goCar; heroAlt = goCarFree;
    } else if (work === 'assembly') {
      hTitle.textContent = tt('home.asmTitle') + ' · HSP 94123';
      hSub.textContent = asm.where + ' · ' + tt('a3.progress', { n: asm.n, m: asm.m });
      hBar.style.width = Math.round(100 * asm.n / asm.m) + '%';
      showImage();
      alt.textContent = tt('tab.manual');
      heroGo = goAsm; heroAlt = goManual;
    } else {
      const course = window.COURSE || [];
      const m = py.cur || course[0];
      const i = py.cur ? py.idx : 0;
      if (m) {
        hTitle.textContent = tt('home.moduleAt', { i: i + 1, t: T(m.title || m.short) });
        hSub.textContent = (py.cur ? tt('home.taskN', { k: Math.min(py.curDone + 1, m.tasks.length), n: m.tasks.length }) + ' · ' : '')
          + tt('home.tasksOf', { n: py.done, m: py.total });
        const ex = (m.ex || [])[0];
        if (ex) showCode(T(ex.c), ex.f, T(ex.o)); else showImage();
      }
      hBar.style.width = (py.total ? Math.round(py.done / py.total * 100) : 0) + '%';
      alt.textContent = tt('home.allModules');
      heroGo = goPy; heroAlt = goPyAll;
    }
    $('home-hero-go').querySelector('span').textContent = tt('home.continue');
  }

  function renderCarStat() {
    const el = $('home-car-stat'); if (!el) return;
    el.className = 'status-pill' + (carState.connected ? ' on' : '');
    el.textContent = carState.connected ? tt('car.on') + (carState.carId ? ' · №' + carState.carId : '') : tt('car.off');
    const t1 = $('home-connect-t'), s1 = $('home-connect-sub');
    if (t1 && s1) {
      t1.textContent = carState.connected ? tt('top.carOn') + (carState.carId ? ' · №' + carState.carId : '') : tt('car.connect');
      s1.textContent = carState.connected ? tt('car.free') : tt('home.connectSub');
    }
  }

  /* ── переходы ── */
  function goPy() {
    window.sbShared.showPage('python');
    // открыть модуль, на котором остановились
    setTimeout(() => {
      if (!window.sbCourse) return;
      const solved = window.sbCourse.progress().solved || {};
      const m = (window.COURSE || []).find((x) => x.tasks.some((tk) => !solved[tk.id]));
      window.sbCourse.show(m ? m.id : 'intro');
    }, 150);
  }
  function goPyAll() {
    window.sbShared.showPage('python');
    setTimeout(() => { if (window.sbCourse) window.sbCourse.show('intro'); }, 150);
  }
  function goCar() { window.sbShared.showPage('car'); if (window.sbCarTab) window.sbCarTab.continueLesson(); }
  function goCarFree() { window.sbShared.showPage('car'); if (window.sbCarTab) window.sbCarTab.showFree(); }
  function goAsm() { if (window.sbAsm) window.sbAsm.open('home'); }
  function goManual() { window.sbShared.showPage('manual'); }

  $('home-hero-go').addEventListener('click', () => (heroGo || goPy)());
  $('home-hero-alt').addEventListener('click', () => (heroAlt || goPyAll)());
  $('home-py-go').addEventListener('click', goPy);
  $('home-car-go').addEventListener('click', goCar);
  $('home-car-free').addEventListener('click', goCarFree);
  $('home-asm-go').addEventListener('click', goAsm);
  $('home-asm-fig').addEventListener('click', goAsm);
  $('home-manual-go').addEventListener('click', goManual);
  $('home-connect-go').addEventListener('click', goCarFree);

  document.addEventListener('sb-car-state', (e) => { carState = e.detail || carState; renderCarStat(); });
  document.addEventListener('sb-lang-changed', () => { if (!$('tab-home').classList.contains('hidden')) fill(); else renderCarStat(); });

  window.sbHome = { onShow: fill };
})();
