/* Вкладка «Машинка»: слева — карточка связи, «Свободный режим» и список
 * PDF-уроков с галочками; справа — либо свободный режим (рабочая панель
 * машинки; пока связи нет — три шага подключения), либо урок: бесшовный
 * просмотр PDF и та же рабочая панель справа от него. */

(function () {
  const { $, dockCar } = window.sbShared;

  // pdf.js может не загрузиться — не роняем весь модуль уроков
  const pdfReady = (typeof pdfjsLib !== 'undefined');
  if (pdfReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  let pdfDoc = null;
  let zoom = 1;
  let renderSeq = 0;      // защита от параллельных перерисовок
  let lessonOpen = false;
  let openLessonId = null;
  let materials = [];           // из облачного manifest.json
  let noCarMode = false;        // ученик нажал «Писать код без машинки»
  let progress = { done: {} };  // пройденные уроки (settings.carProgress)
  let carState = { connected: false, connecting: false };
  let currentQuiz = null; // вопросы мини-теста открытого урока (из облачного quizzes.json)

  function pick(obj, base) {
    return (typeof currentLang !== 'undefined' && currentLang === 'kk')
      ? (obj[base + '_kk'] || obj[base + '_ru'] || obj[base] || '')
      : (obj[base + '_ru'] || obj[base] || obj[base + '_kk'] || '');
  }

  /* Файл урока по языку интерфейса: file_ru / file_kk, запасной — file */
  function lessonFile(m) {
    return (typeof currentLang !== 'undefined' && currentLang === 'kk')
      ? (m.file_kk || m.file || m.file_ru)
      : (m.file_ru || m.file || m.file_kk);
  }

  /* ───────── прогресс уроков ───────── */
  async function loadProgress() {
    try { const st = await window.sb.getSettings(); if (st && st.carProgress) progress = Object.assign({ done: {} }, st.carProgress); } catch (_) {}
  }
  function saveProgress() { try { window.sb.setSettings({ carProgress: progress }); } catch (_) {} }
  const isDone = (id) => !!progress.done[id];

  /* ───────── боковой список уроков ───────── */
  function renderNav() {
    const box = $('car-nav-lessons'); if (!box) return;
    box.innerHTML = '';
    let done = 0;
    materials.forEach((m, i) => {
      const id = m.id || lessonFile(m);
      const d = isDone(id); if (d) done++;
      const b = document.createElement('button');
      const cur = lessonOpen && openLessonId === id;
      b.className = 'py-nav-item' + (cur ? ' active' : '');
      b.innerHTML = '<span class="py-dot' + (d ? ' done' : (cur ? ' now' : '')) + '">' + (d ? '✓' : (cur ? '▶' : '')) + '</span>'
        + '<span class="py-nav-t"></span>' + (m.downloaded ? '' : '<span class="py-nav-n" title="' + t('mat.cloud') + '">☁</span>');
      b.querySelector('.py-nav-t').textContent = shortTitle(pick(m, 'title') || lessonFile(m) || '', i);
      b.title = pick(m, 'description') || '';
      b.addEventListener('click', () => openLesson(m));
      box.appendChild(b);
    });
    const free = document.querySelector('.py-nav-item[data-cview="free"]');
    if (free) free.classList.toggle('active', !lessonOpen);
    const pt = $('car-progress-text'), pb = $('car-progress-bar');
    if (pt) pt.textContent = materials.length ? t('py.progress').replace('{n}', done).replace('{m}', materials.length) : '';
    if (pb) pb.style.width = (materials.length ? Math.round(done / materials.length * 100) : 0) + '%';
  }
  /* «Урок 3 — Ловушки» → «3. Ловушки»; без номера в названии — «i. …» */
  function shortTitle(title, i) {
    const m = String(title).match(/^\s*(?:урок|сабақ|lesson)?\s*(\d+)\s*[-—–:.]?\s*(?:урок|сабақ)?\s*[-—–:.]?\s*(.+)$/i)
      || String(title).match(/^\s*(\d+)\s*[-—–]\s*(?:сабақ|урок)\s*[-—–]?\s*(.+)$/i);
    if (m) return m[1] + '. ' + m[2].trim();
    return (i + 1) + '. ' + title;
  }

  async function loadMaterials(force) {
    const info = $('materials-info');
    if (info) info.textContent = '…';
    let r;
    try {
      r = await window.sb.listMaterials();
    } catch (e) {
      if (info) info.textContent = t('mat.noUrl');
      materials = []; renderNav(); return;
    }
    if (!r.ok && r.error === 'no-url') { if (info) info.textContent = t('mat.noUrl'); materials = []; renderNav(); return; }
    if (!r.ok) { if (info) info.textContent = t('mat.offline'); materials = []; renderNav(); return; }
    if (info) info.textContent = r.fromCache ? t('mat.offline') : (r.materials.length ? '' : t('mat.empty'));
    materials = r.materials || [];
    renderNav();
  }

  /* ───────── свободный режим / пустое состояние ───────── */
  function showFree() {
    lessonOpen = false; openLessonId = null; window.sbLesson = null;
    currentQuiz = null; pdfDoc = null; renderSeq++;
    $('pdf-scroll').innerHTML = '';
    $('car-view-lesson').classList.add('hidden');
    $('car-view-free').classList.remove('hidden');
    dockCar($('car-free-slot'));
    applyCarState();
    renderNav();
  }
  /* Пока машинка не подключена и ученик не выбрал «без машинки» — вместо
   * панели три шага подключения; в уроке — жёлтая плашка над панелью. */
  function applyCarState() {
    const off = !carState.connected;
    const empty = $('car-empty'), slot = $('car-free-slot'), plaque = $('lesson-plaque');
    if (empty && slot) {
      const showEmpty = off && !noCarMode && !lessonOpen;
      const wasHidden = slot.classList.contains('hidden');
      empty.classList.toggle('hidden', !showEmpty);
      slot.classList.toggle('hidden', showEmpty);
      // панель только что показали — дать редактору перерисоваться и показать подсказки
      if (!showEmpty && wasHidden && window.sbCar) { window.sbCar.onShow(); if (!lessonOpen) maybeTips(); }
    }
    if (plaque) plaque.classList.toggle('hidden', !(off && lessonOpen));
    const err = $('car-empty-err'); if (err && carState.connected) err.textContent = '';
    // карточка состояния слева
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
    if (!window.sbTips || document.getElementById('tab-car').classList.contains('hidden')) return;
    window.sbTips.show('car', [
      { el: '#car-editor', key: 'tips.carEditor', at: 'inside' },
      { el: '#btn-car-upload', key: 'tips.carUpload', at: 'below' },
      { el: '#car-side', key: 'tips.carMap', at: 'left' },
      { el: '#car-console-wrap', key: 'tips.carConsole', at: 'above' }
    ]);
  }

  /* ───────── Открытие урока ───────── */
  async function openLesson(m) {
    const title = pick(m, 'title');
    const info = $('materials-info');
    if (info) info.textContent = t('mat.loading');
    const r = await window.sb.openMaterial(lessonFile(m));
    if (!r.ok) { if (info) info.textContent = t('mat.downloadErr'); return; }
    if (info) info.textContent = '';
    m.downloaded = true;

    $('car-view-free').classList.add('hidden');
    $('car-view-lesson').classList.remove('hidden');
    $('lesson-title').textContent = title || lessonFile(m) || '';
    lessonOpen = true;
    openLessonId = m.id || lessonFile(m);
    // Редактор подставит это в имя новой программы: «Урок 3. Ловушки — …».
    // Работа ученика остаётся в общей папке, но подписывается сама собой.
    window.sbLesson = { id: openLessonId, title: $('lesson-title').textContent || '' };
    dockCar($('lesson-work-slot')); // справа от урока — редактор машинки
    applyCarState();
    updateDoneBtn();
    renderNav();

    // Мини-тест урока из облачного quizzes.json (офлайн — из кеша).
    // Урок открывается и без теста: нет файла или записи — просто нет карточки.
    currentQuiz = null;
    try {
      const qr = await window.sb.getQuiz(openLessonId);
      if (qr && qr.ok && window.sbQuiz) {
        const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
        currentQuiz = window.sbQuiz.forLang(qr.quiz, lang);
      }
    } catch (_) { /* тест не обязателен */ }

    try {
      if (!pdfReady) throw new Error('pdf.js not loaded');
      pdfDoc = await pdfjsLib.getDocument(r.path).promise;
      zoom = 1;
      await renderPdf();
    } catch (e) {
      $('pdf-scroll').textContent = t('mat.downloadErr') + ' — ' + String(e).slice(0, 150);
    }
  }
  function updateDoneBtn() {
    const b = $('btn-lesson-done'); if (!b) return;
    const d = lessonOpen && isDone(openLessonId);
    b.classList.toggle('done', d);
    b.querySelector('span').textContent = d ? '✓ ' + t('lesson.done') : t('lesson.markDone');
  }

  /* Бесшовная отрисовка всех страниц PDF подряд (без интерфейса просмотрщика).
   * Поверх каждой страницы кладётся прозрачный текстовый слой,
   * поэтому текст можно выделять и копировать (Ctrl+C или правая кнопка). */
  async function renderPdf() {
    if (!pdfDoc) return;
    const seq = ++renderSeq;
    const box = $('pdf-scroll');
    const width = Math.max(box.clientWidth - 4, 200);
    const dpr = window.devicePixelRatio || 1;
    box.innerHTML = '';
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (seq !== renderSeq) return; // началась новая перерисовка
      const page = await pdfDoc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = (width / base.width) * zoom;
      const cssViewport = page.getViewport({ scale });          // размеры на экране
      const renderViewport = page.getViewport({ scale: scale * dpr }); // чёткость

      const wrap = document.createElement('div');
      wrap.className = 'pdf-page';
      wrap.style.width = Math.floor(cssViewport.width) + 'px';
      wrap.style.height = Math.floor(cssViewport.height) + 'px';

      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      // Размеры в px, а не в %: тогда обрезка страницы снизу (под мини-тест)
      // не сжимает картинку, а просто прячет пустую часть листа
      canvas.style.width = Math.floor(cssViewport.width) + 'px';
      canvas.style.height = Math.floor(cssViewport.height) + 'px';
      wrap.appendChild(canvas);

      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.setProperty('--scale-factor', String(scale));
      wrap.appendChild(textDiv);

      if (seq !== renderSeq) return;
      box.appendChild(wrap);
      const gap = document.createElement('div');
      gap.className = 'pdf-gap';
      box.appendChild(gap);

      await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;

      // Текстовый слой для выделения/копирования
      try {
        const textContent = await page.getTextContent();
        if (seq !== renderSeq) return;

        // Последняя страница перед мини-тестом: прячем пустой низ листа,
        // чтобы тест шёл сразу после последней строки текста, с небольшим отступом
        if (n === pdfDoc.numPages && currentQuiz && currentQuiz.length) {
          let maxBottom = 0;
          for (const item of textContent.items || []) {
            if (!item.str || !item.str.trim()) continue;
            const yBase = cssViewport.convertToViewportPoint(item.transform[4], item.transform[5])[1];
            const h = (item.height || 10) * scale;
            if (yBase + h * 0.35 > maxBottom) maxBottom = yBase + h * 0.35;
          }
          if (maxBottom > 40) {
            wrap.style.height = Math.ceil(Math.min(cssViewport.height, maxBottom + 14)) + 'px';
          }
        }
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          textContent: textContent,
          container: textDiv,
          viewport: cssViewport,
          textDivs: []
        }).promise;
        // Рамки с кнопкой «Копировать» вокруг блоков кода
        addCodeBlockOverlays(wrap, textContent, cssViewport);
      } catch (_) { /* нет текста (скан) — страница останется картинкой */ }
    }
    // Мини-тест — в самом конце урока, сразу после текста последней страницы
    if (seq === renderSeq && currentQuiz) appendQuizCard(box, Math.floor(width * zoom));
  }

  /*
   * Поиск блоков кода на странице PDF: всё, что набрано моноширинным
   * шрифтом (Consolas, Courier New и т.п.), группируется в блоки.
   * Вокруг блока рисуется рамка, справа сверху — кнопка «Копировать».
   */
  function addCodeBlockOverlays(wrap, textContent, viewport) {
    const styles = textContent.styles || {};
    const scale = viewport.scale;

    // 1) Собираем строки, набранные моноширинным шрифтом
    const lines = new Map(); // ключ — округлённая базовая линия
    for (const item of textContent.items || []) {
      if (!item.str || !item.str.trim()) continue;
      const st = styles[item.fontName];
      const family = (st && st.fontFamily) || '';
      if (!family.includes('monospace')) continue;
      const [x, yBase] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const h = (item.height || 10) * scale;
      const w = (item.width || 0) * scale;
      const key = Math.round(yBase / 4);
      if (!lines.has(key)) {
        lines.set(key, { top: yBase - h, bottom: yBase + h * 0.25, left: x, right: x + w, parts: [] });
      }
      const line = lines.get(key);
      line.top = Math.min(line.top, yBase - h);
      line.bottom = Math.max(line.bottom, yBase + h * 0.25);
      line.left = Math.min(line.left, x);
      line.right = Math.max(line.right, x + w);
      line.parts.push({ x, w, str: item.str });
    }
    if (!lines.size) return;

    // 2) Склеиваем соседние строки в блоки
    const sorted = [...lines.values()].sort((a, b) => a.top - b.top);
    const blocks = [];
    let cur = null;
    for (const line of sorted) {
      const lineH = line.bottom - line.top;
      if (cur && line.top - cur.bottom < Math.max(lineH * 1.6, 22)) {
        cur.bottom = Math.max(cur.bottom, line.bottom);
        cur.left = Math.min(cur.left, line.left);
        cur.right = Math.max(cur.right, line.right);
        cur.lines.push(line);
      } else {
        cur = { top: line.top, bottom: line.bottom, left: line.left, right: line.right, lines: [line] };
        blocks.push(cur);
      }
    }

    // 3) Рисуем рамку и кнопку для каждого блока
    for (const b of blocks) {
      // Восстанавливаем пробелы и отступы по расстояниям между фрагментами:
      // PDF хранит текст кусками, и пробелы часто «нарисованы» просто зазором.
      const text = b.lines
        .map((l) => {
          const parts = l.parts.sort((p, q) => p.x - q.x);
          const chars = parts.reduce((n, p) => n + p.str.length, 0) || 1;
          const width = parts.reduce((n, p) => n + p.w, 0);
          const charW = Math.max(width / chars, 1);
          let out = '';
          // отступ строки относительно левого края блока
          const indent = parts[0].x - b.left;
          if (indent > charW * 0.6) out += ' '.repeat(Math.round(indent / charW));
          let cursor = null;
          for (const p of parts) {
            if (cursor !== null) {
              const gap = p.x - cursor;
              if (gap > charW * 0.45) out += ' '.repeat(Math.max(1, Math.round(gap / charW)));
            }
            out += p.str;
            cursor = p.x + p.w;
          }
          return out;
        })
        .join('\n');
      if (b.lines.length < 2 && text.trim().length < 20) continue; // мелкие вкрапления пропускаем

      // Рамка на всю ширину текста страницы (симметричные поля),
      // кнопка «Копировать» — ВНУТРИ рамки, в правом верхнем углу
      const pageW = viewport.width;
      const frameLeft = Math.max(b.left - 10, 4);
      const frameRight = Math.min(Math.max(b.right + 10, pageW - frameLeft), pageW - 4);
      const frameTop = b.top - 8;

      const frame = document.createElement('div');
      frame.className = 'code-frame';
      frame.style.left = frameLeft + 'px';
      frame.style.top = frameTop + 'px';
      frame.style.width = (frameRight - frameLeft) + 'px';
      frame.style.height = (b.bottom - b.top + 16) + 'px';
      wrap.appendChild(frame);

      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = '⧉ ' + t('pdf.copy');
      btn.style.right = (pageW - frameRight + 5) + 'px';
      btn.style.top = (frameTop + 5) + 'px';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = '✓ ' + t('pdf.copied');
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '⧉ ' + t('pdf.copy');
            btn.classList.remove('copied');
          }, 1800);
        } catch (_) { /* буфер обмена недоступен */ }
      });
      wrap.appendChild(btn);
    }
  }

  /*
   * Интерактивный мини-тест в конце урока: карточка с вопросами
   * добавляется в ленту просмотра после последней страницы PDF,
   * с небольшим отступом от текста. Вопросы приходят из облачного
   * файла quizzes.json (по id открытого урока и языку интерфейса).
   * Ответ подсвечивается сразу, пробовать можно до верного,
   * в конце — счёт «верно с первой попытки: N из M».
   * Состояние переживает перерисовку (зум, изменение окна).
   */
  const quizStates = {}; // ключ — id урока

  function appendQuizCard(box, pageWidth) {
    const quiz = currentQuiz;
    if (!quiz || !quiz.length) return;

    const key = String(openLessonId);
    if (!quizStates[key] || quizStates[key].total !== quiz.length) {
      quizStates[key] = { idx: 0, firstTry: {}, wrong: {}, finished: false, total: quiz.length };
    }
    const st = quizStates[key];

    const card = document.createElement('div');
    card.className = 'quiz-card';
    if (pageWidth) card.style.width = pageWidth + 'px'; // по ширине страницы урока
    box.appendChild(card);

    function draw() {
      card.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'quiz-head';
      const title = document.createElement('span');
      title.textContent = '✎ ' + t('quiz.title');
      head.appendChild(title);
      card.appendChild(head);

      if (st.finished) { drawResult(); return; }

      const q = quiz[st.idx];
      const prog = document.createElement('span');
      prog.className = 'quiz-progress';
      prog.textContent = (st.idx + 1) + ' / ' + quiz.length;
      head.appendChild(prog);

      const qEl = document.createElement('div');
      qEl.className = 'quiz-question';
      qEl.textContent = q.q;
      card.appendChild(qEl);

      const list = document.createElement('div');
      list.className = 'quiz-answers';
      card.appendChild(list);

      let solved = false;
      const wrongSet = st.wrong[st.idx] || (st.wrong[st.idx] = {});
      q.answers.forEach((a, i) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-answer';
        btn.textContent = a;
        if (wrongSet[i]) { btn.classList.add('wrong'); btn.disabled = true; }
        btn.addEventListener('click', () => {
          if (solved) return;
          if (i === q.correct) {
            solved = true;
            if (st.firstTry[st.idx] === undefined) st.firstTry[st.idx] = true;
            btn.classList.add('right');
            [...list.children].forEach((el) => { el.disabled = true; });
            showAfter(q);
          } else {
            if (st.firstTry[st.idx] === undefined) st.firstTry[st.idx] = false;
            wrongSet[i] = true;
            btn.classList.add('wrong');
            btn.disabled = true;
          }
        });
        list.appendChild(btn);
      });
    }

    function showAfter(q) {
      if (q.expl) {
        const ex = document.createElement('div');
        ex.className = 'quiz-expl';
        ex.textContent = q.expl;
        card.appendChild(ex);
      }
      const next = document.createElement('button');
      next.className = 'quiz-next';
      next.textContent = (st.idx + 1 < quiz.length) ? t('quiz.next') : t('quiz.result');
      next.addEventListener('click', () => {
        if (st.idx + 1 < quiz.length) st.idx += 1;
        else st.finished = true;
        draw();
      });
      card.appendChild(next);
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function drawResult() {
      const score = Object.values(st.firstTry).filter(Boolean).length;
      const res = document.createElement('div');
      res.className = 'quiz-resultbox';
      const big = document.createElement('div');
      big.className = 'quiz-score';
      big.textContent = score + ' / ' + quiz.length;
      const msg = document.createElement('div');
      msg.className = 'quiz-scoremsg';
      msg.textContent = (score === quiz.length) ? t('quiz.perfect') : (t('quiz.score') + ' ' + score + ' ' + t('quiz.of') + ' ' + quiz.length);
      const stars = document.createElement('div');
      stars.className = 'quiz-stars';
      const frac = quiz.length ? score / quiz.length : 0;
      stars.textContent = '★'.repeat(Math.max(1, Math.round(frac * 5))).padEnd(5, '☆');
      res.appendChild(stars);
      res.appendChild(big);
      res.appendChild(msg);
      card.appendChild(res);

      const again = document.createElement('button');
      again.className = 'quiz-next quiz-again';
      again.textContent = '↻ ' + t('quiz.retry');
      again.addEventListener('click', () => {
        quizStates[key] = { idx: 0, firstTry: {}, wrong: {}, finished: false, total: quiz.length };
        Object.assign(st, quizStates[key]);
        quizStates[key] = st;
        draw();
      });
      card.appendChild(again);
    }

    draw();
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!lessonOpen || !pdfDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPdf, 300);
  });

  $('btn-zoom-in').addEventListener('click', () => {
    if (!pdfDoc) return;
    zoom = Math.min(zoom + 0.15, 2.5);
    renderPdf();
  });
  $('btn-zoom-out').addEventListener('click', () => {
    if (!pdfDoc) return;
    zoom = Math.max(zoom - 0.15, 0.5);
    renderPdf();
  });

  /* ───────── кнопки ───────── */
  $('btn-mat-refresh').addEventListener('click', () => loadMaterials(true));
  document.querySelector('.py-nav-item[data-cview="free"]').addEventListener('click', showFree);
  $('btn-lesson-done').addEventListener('click', () => {
    if (!lessonOpen) return;
    if (isDone(openLessonId)) delete progress.done[openLessonId]; else progress.done[openLessonId] = true;
    saveProgress(); updateDoneBtn(); renderNav();
    if (progress.done[openLessonId] && window.sbToast) window.sbToast('🏁 ' + t('lesson.doneToast'));
  });
  $('carstat-btn').addEventListener('click', () => {
    if (carState.connected) { if (window.sbCar) window.sbCar.disconnect(); }
    else connectFromUi($('car-empty-err'));
  });
  $('btn-car-empty-connect').addEventListener('click', () => connectFromUi($('car-empty-err')));
  $('btn-plaque-connect').addEventListener('click', () => connectFromUi(null));
  $('btn-car-nocar').addEventListener('click', () => { noCarMode = true; applyCarState(); });
  $('btn-car-help').addEventListener('click', () => { if (window.sbShared && window.sbShared.showPage) window.sbShared.showPage('manual'); });

  document.addEventListener('sb-car-state', (e) => {
    carState = e.detail || carState;
    applyCarState();
  });
  document.addEventListener('sb-lang-changed', () => { renderNav(); applyCarState(); updateDoneBtn(); });

  let inited = false;
  window.sbCarTab = {
    async ensure() { if (!inited) { inited = true; await loadProgress(); await loadMaterials(); } },
    async onShow() {
      await this.ensure();
      if (lessonOpen) { dockCar($('lesson-work-slot')); } else { dockCar($('car-free-slot')); }
      applyCarState();
      if (window.sbCar) carState = Object.assign(carState, window.sbCar.state());
      applyCarState();
    },
    async showFree() { await this.ensure(); showFree(); },
    /* открыть первый непройденный урок (для «Домой → Продолжить») */
    async continueLesson() {
      await this.ensure();
      const m = materials.find((x) => !isDone(x.id || lessonFile(x))) || materials[0];
      if (m) openLesson(m); else showFree();
    },
    materials: () => materials,
    progress: () => progress,
    isLessonOpen: () => lessonOpen
  };
})();
