/* Вкладка «Машинка»: слева — карточка связи, «Свободный режим» и список
 * уроков с галочками; справа — либо свободный режим (рабочая панель
 * машинки car.js; пока связи нет — три шага подключения), либо урок курса
 * «Уроки с машинкой» (car-course-data.js): теория, примеры, задания с
 * проверкой на виртуальной машинке и кнопкой «На машинку» для настоящей. */
(function () {
  const { $, dockCar } = window.sbShared;

  let lessonOpen = false;       // открыт урок (иначе — свободный режим)
  let noCarMode = false;        // ученик нажал «Писать код без машинки»
  let carState = { connected: false, connecting: false };
  let firstShown = false;       // первый показ вкладки — открыть курс

  /* курс уроков с машинкой */
  const course = window.sbMakeCourse({
    key: 'car', data: window.CAR_COURSE || [], intro: window.CAR_COURSE_INTRO || {}, progressKey: 'carProgress',
    initialView: 'intro',
    ids: { root: 'tab-car', nav: 'car-nav-lessons', page: 'car-page', viewPage: 'car-view-lesson', park: 'car-park',
      progressText: 'car-progress-text', progressBar: 'car-progress-bar' },
    onOpenPage() { lessonOpen = true; $('car-view-free').classList.add('hidden'); applyCarState(); },
    onNav(view) {
      const free = document.querySelector('.py-nav-item[data-cview="free"]');
      if (free) free.classList.toggle('active', !lessonOpen);
      if (!lessonOpen) $('tab-car').querySelectorAll('#car-nav-lessons .py-nav-item, .py-nav-item[data-view="intro"]').forEach((b) => b.classList.remove('active'));
    },
    onTaskOpened() { if (window.sbPy) window.sbPy.setMode('car'); }
  });
  window.sbCarCourse = course;

  /* ───────── свободный режим / пустое состояние ───────── */
  function showFree() {
    lessonOpen = false;
    course.closeTask();
    $('car-view-lesson').classList.add('hidden');
    $('car-view-free').classList.remove('hidden');
    dockCar($('car-free-slot'));
    applyCarState();
    course.renderNav();
  }
  /* Пока машинка не подключена и ученик не выбрал «без машинки» — вместо
   * панели три шага подключения; в уроке — плашка над страницей. */
  function applyCarState() {
    const off = !carState.connected;
    const empty = $('car-empty'), slot = $('car-free-slot'), plaque = $('lesson-plaque');
    if (empty && slot) {
      const showEmpty = off && !noCarMode && !lessonOpen;
      const wasHidden = slot.classList.contains('hidden');
      empty.classList.toggle('hidden', !showEmpty);
      slot.classList.toggle('hidden', showEmpty);
      if (!showEmpty && wasHidden && window.sbCar) { window.sbCar.onShow(); if (!lessonOpen) maybeTips(); }
    }
    if (plaque) plaque.classList.toggle('hidden', !(off && lessonOpen));
    const err = $('car-empty-err'); if (err && carState.connected) err.textContent = '';
    const card = $('car-statcard'), sub = $('carstat-sub'), name = $('carstat-name'), btn = $('carstat-btn');
    if (card) {
      card.classList.toggle('on', !!carState.connected);
      card.classList.toggle('busy', !!carState.connecting);
      if (name) name.textContent = t('tab.car') + (carState.connected && carState.carId ? ' №' + carState.carId : '');
      if (sub) sub.textContent = carState.connecting ? t('car.connecting') : (carState.connected ? t('car.on') : t('car.off'));
      if (btn) {
        btn.textContent = carState.connected ? t('car.disconnect') : t('car.connectShort');
        btn.className = 'btn btn-sm ' + (carState.connected ? 'btn-ghost' : 'btn-primary');
        btn.disabled = !!carState.connecting;
      }
    }
  }
  async function connectFromUi(errEl) {
    if (!window.sbCar) return;
    if (errEl) errEl.textContent = '';
    const r = await window.sbCar.connect();
    if ((!r || !r.ok) && errEl) errEl.textContent = t('car.errConn');
  }
  function maybeTips() {
    if (!window.sbTips || $('tab-car').classList.contains('hidden')) return;
    window.sbTips.show('car', [
      { el: '#car-editor', key: 'tips.carEditor', at: 'inside' },
      { el: '#btn-car-upload', key: 'tips.carUpload', at: 'below' },
      { el: '#car-side', key: 'tips.carMap', at: 'left' },
      { el: '#car-console-wrap', key: 'tips.carConsole', at: 'above' }
    ]);
  }

  /* ───────── кнопки ───────── */
  document.querySelector('.py-nav-item[data-cview="free"]').addEventListener('click', showFree);
  $('carstat-btn').addEventListener('click', () => {
    if (carState.connected) { if (window.sbCar) window.sbCar.disconnect(); }
    else connectFromUi($('car-empty-err'));
  });
  $('btn-car-empty-connect').addEventListener('click', () => connectFromUi($('car-empty-err')));
  $('btn-plaque-connect').addEventListener('click', () => connectFromUi(null));
  $('btn-car-nocar').addEventListener('click', () => { noCarMode = true; applyCarState(); });
  $('btn-car-help').addEventListener('click', () => { if (window.sbShared && window.sbShared.showPage) window.sbShared.showPage('manual'); });

  document.addEventListener('sb-car-state', (e) => { carState = e.detail || carState; applyCarState(); });
  document.addEventListener('sb-lang-changed', () => { applyCarState(); });

  let inited = false;
  window.sbCarTab = {
    async ensure() { if (!inited) { inited = true; await course.ensure(); } },
    async onShow() {
      await this.ensure();
      if (window.sbCar) carState = Object.assign(carState, window.sbCar.state());
      /* первый заход — на курс (вводная или урок, где остановились); машинка
       * для уроков не нужна, а свободный режим — рядом в списке слева */
      if (!firstShown) {
        firstShown = true;
        if (!carState.connected) {
          const started = Object.keys(course.progress().solved || {}).length > 0;
          const m = course.nextModule();
          course.show(started && m ? m.id : 'intro');
          applyCarState();
          return;
        }
      }
      if (lessonOpen) { await course.onShow(); }
      else dockCar($('car-free-slot'));
      applyCarState();
      course.renderNav();
    },
    async showFree() { await this.ensure(); showFree(); },
    /* открыть урок, на котором остановились (для «Домой → Продолжить») */
    async continueLesson() {
      await this.ensure();
      const m = course.nextModule() || (course.data[0] || null);
      course.show(m ? m.id : 'intro');
    },
    openLesson(id) { course.show(id); },
    isLessonOpen: () => lessonOpen
  };
})();
