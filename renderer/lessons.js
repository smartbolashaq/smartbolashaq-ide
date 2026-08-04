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
