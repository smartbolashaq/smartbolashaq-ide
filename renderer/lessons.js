/* Вкладка «Уроки»: список PDF-уроков и режим урока
 * (слева — бесшовный просмотр PDF без интерфейса просмотрщика,
 *  справа — рабочая панель с редактором и консолью). */

(function () {
  const { $, moveWorkPanel, enterLessonMode, exitLessonMode } = window.sbShared;

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

  /* ───────── Список уроков ───────── */
  async function loadMaterials() {
    if (lessonOpen) {
      moveWorkPanel($('lesson-work-slot'));
      enterLessonMode(openLessonId);
      return;
    }
    const info = $('materials-info');
    const list = $('materials-list');
    info.textContent = '…';
    let r;
    try {
      r = await window.sb.listMaterials();
    } catch (e) {
      info.textContent = t('mat.noUrl') + ' (' + String(e).slice(0, 120) + ')';
      return;
    }
    list.innerHTML = '';
    if (!r.ok && r.error === 'no-url') { info.textContent = t('mat.noUrl'); return; }
    if (!r.ok) { info.textContent = t('mat.offline'); return; }
    info.textContent = r.fromCache ? t('mat.offline') : '';
    if (!r.materials.length) { info.textContent = t('mat.empty'); return; }

    for (const m of r.materials) {
      const card = document.createElement('div');
      card.className = 'mat-card';
      const title = pick(m, 'title');
      const desc = pick(m, 'description');
      card.innerHTML = `
        <h3></h3>
        <p></p>
        <span class="mat-status ${m.downloaded ? 'cached' : 'cloud'}">${m.downloaded ? t('mat.cached') : t('mat.cloud')}</span>`;
      card.querySelector('h3').textContent = '📘 ' + (title || lessonFile(m) || '');
      card.querySelector('p').textContent = desc;
      card.addEventListener('click', () => openLesson(m, title));
      list.appendChild(card);
    }
  }

  /* ───────── Открытие урока ───────── */
  async function openLesson(m, title) {
    $('materials-info').textContent = t('mat.loading');
    const r = await window.sb.openMaterial(lessonFile(m));
    if (!r.ok) { $('materials-info').textContent = t('mat.downloadErr'); return; }
    $('materials-info').textContent = '';

    $('materials-list-view').classList.add('hidden');
    $('lesson-view').classList.remove('hidden');
    $('lesson-title').textContent = title || lessonFile(m) || '';
    lessonOpen = true;
    openLessonId = m.id || lessonFile(m);
    moveWorkPanel($('lesson-work-slot'));
    enterLessonMode(openLessonId); // чистый редактор без защищённых строк

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
      canvas.style.width = '100%';
      canvas.style.height = '100%';
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
    // Мини-тест — в самом конце урока, после последней страницы
    if (seq === renderSeq && currentQuiz) appendQuizCard(box);
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

  function appendQuizCard(box) {
    const quiz = currentQuiz;
    if (!quiz || !quiz.length) return;

    const key = String(openLessonId);
    if (!quizStates[key] || quizStates[key].total !== quiz.length) {
      quizStates[key] = { idx: 0, firstTry: {}, wrong: {}, finished: false, total: quiz.length };
    }
    const st = quizStates[key];

    const card = document.createElement('div');
    card.className = 'quiz-card';
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

  /* ───────── Назад к списку ───────── */
  $('btn-lesson-back').addEventListener('click', () => {
    lessonOpen = false;
    openLessonId = null;
    currentQuiz = null;
    pdfDoc = null;
    renderSeq++;
    $('pdf-scroll').innerHTML = '';
    $('lesson-view').classList.add('hidden');
    $('materials-list-view').classList.remove('hidden');
    moveWorkPanel($('tab-compiler'));
    exitLessonMode();
    loadMaterials();
  });

  $('btn-mat-refresh').addEventListener('click', () => {
    if (!lessonOpen) loadMaterials();
  });

  window.sbLessons = { onShow: loadMaterials };
})();
