/* Вкладка «Уроки»: список PDF-уроков и режим урока
 * (слева — бесшовный просмотр PDF без интерфейса просмотрщика,
 *  справа — рабочая панель с редактором и консолью). */

(function () {
  const { $, moveWorkPanel } = window.sbShared;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js';

  let pdfDoc = null;
  let zoom = 1;
  let renderSeq = 0;      // защита от параллельных перерисовок
  let lessonOpen = false;

  function pick(obj, base) {
    return (typeof currentLang !== 'undefined' && currentLang === 'kk')
      ? (obj[base + '_kk'] || obj[base + '_ru'] || obj[base] || '')
      : (obj[base + '_ru'] || obj[base] || obj[base + '_kk'] || '');
  }

  /* ───────── Список уроков ───────── */
  async function loadMaterials() {
    if (lessonOpen) { moveWorkPanel($('lesson-work-slot')); return; }
    const info = $('materials-info');
    const list = $('materials-list');
    info.textContent = '…';
    const r = await window.sb.listMaterials();
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
      card.querySelector('h3').textContent = '📘 ' + (title || m.file);
      card.querySelector('p').textContent = desc;
      card.addEventListener('click', () => openLesson(m, title));
      list.appendChild(card);
    }
  }

  /* ───────── Открытие урока ───────── */
  async function openLesson(m, title) {
    $('materials-info').textContent = t('mat.loading');
    const r = await window.sb.openMaterial(m.file);
    if (!r.ok) { $('materials-info').textContent = t('mat.downloadErr'); return; }
    $('materials-info').textContent = '';

    $('materials-list-view').classList.add('hidden');
    $('lesson-view').classList.remove('hidden');
    $('lesson-title').textContent = title || m.file;
    lessonOpen = true;
    moveWorkPanel($('lesson-work-slot'));

    try {
      pdfDoc = await pdfjsLib.getDocument(r.path).promise;
      zoom = 1;
      await renderPdf();
    } catch (e) {
      $('pdf-scroll').textContent = t('mat.downloadErr');
    }
  }

  /* Бесшовная отрисовка всех страниц PDF подряд (без интерфейса просмотрщика) */
  async function renderPdf() {
    if (!pdfDoc) return;
    const seq = ++renderSeq;
    const box = $('pdf-scroll');
    const width = Math.max(box.clientWidth - 4, 200);
    box.innerHTML = '';
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (seq !== renderSeq) return; // началась новая перерисовка
      const page = await pdfDoc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = (width / base.width) * zoom;
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = Math.floor(viewport.width / (window.devicePixelRatio || 1)) + 'px';
      canvas.style.height = Math.floor(viewport.height / (window.devicePixelRatio || 1)) + 'px';
      if (seq !== renderSeq) return;
      box.appendChild(canvas);
      const gap = document.createElement('div');
      gap.className = 'pdf-gap';
      box.appendChild(gap);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
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
    pdfDoc = null;
    renderSeq++;
    $('pdf-scroll').innerHTML = '';
    $('lesson-view').classList.add('hidden');
    $('materials-list-view').classList.remove('hidden');
    moveWorkPanel($('tab-compiler'));
    loadMaterials();
  });

  $('btn-mat-refresh').addEventListener('click', () => {
    if (!lessonOpen) loadMaterials();
  });

  window.sbLessons = { onShow: loadMaterials };
})();
