/* Вкладка «Уроки и материалы»: список, PDF, интерактивные уроки */

(function () {
  const { $, refreshPortsInto, consoleAppend } = window.sbShared;

  let lessonEditor = null;
  let currentLesson = null;   // { meta, lesson }
  let lessonAutosaveTimer = null;

  function pick(obj, base) {
    // выбирает поле по языку: title_ru / title_kk и т.п.
    return currentLangIs('kk')
      ? (obj[base + '_kk'] || obj[base + '_ru'] || obj[base] || '')
      : (obj[base + '_ru'] || obj[base] || obj[base + '_kk'] || '');
  }
  function currentLangIs(l) { return typeof currentLang !== 'undefined' && currentLang === l; }

  /* ───────── Список материалов ───────── */
  async function loadMaterials() {
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
      const isLesson = m.type === 'interactive';
      card.innerHTML = `
        <span class="mat-type ${isLesson ? 'interactive' : 'pdf'}">${isLesson ? '▶ ' + t('mat.interactive') : '📘 ' + t('mat.pdf')}</span>
        <h3></h3>
        <p></p>
        <span class="mat-status ${m.downloaded ? 'cached' : 'cloud'}">${m.downloaded ? t('mat.cached') : t('mat.cloud')}</span>`;
      card.querySelector('h3').textContent = title || m.file;
      card.querySelector('p').textContent = desc;
      card.addEventListener('click', () => (isLesson ? openLesson(m, title) : openPdf(m, title)));
      list.appendChild(card);
    }
  }

  /* ───────── PDF ───────── */
  async function openPdf(m, title) {
    const r = await window.sb.openMaterial(m.file);
    if (!r.ok) { $('materials-info').textContent = t('mat.downloadErr'); return; }
    $('materials-list-view').classList.add('hidden');
    $('materials-pdf-view').classList.remove('hidden');
    $('pdf-title').textContent = title || m.file;
    $('pdf-frame').src = r.path;
    $('btn-pdf-external').onclick = () => window.sb.openMaterialExternal(m.file);
  }

  $('btn-pdf-back').addEventListener('click', () => {
    $('pdf-frame').src = 'about:blank';
    $('materials-pdf-view').classList.add('hidden');
    $('materials-list-view').classList.remove('hidden');
    loadMaterials();
  });

  /* ───────── Интерактивный урок ───────── */
  async function openLesson(meta, title) {
    const r = await window.sb.openLesson(meta.file);
    if (!r.ok) { $('materials-info').textContent = t('mat.downloadErr'); return; }
    currentLesson = { meta, lesson: r.lesson };

    $('materials-list-view').classList.add('hidden');
    $('lesson-view').classList.remove('hidden');
    $('lesson-title').textContent = title || meta.file;
    renderLessonContent(r.lesson);

    // Редактор урока со стартовым шаблоном урока
    const tpl = (r.lesson.template && Array.isArray(r.lesson.template.lines))
      ? r.lesson.template
      : await window.sb.getTemplate();
    const saved = await window.sb.autosaveGet('lesson-' + (meta.id || meta.file));
    $('lesson-editor').innerHTML = '';
    lessonEditor = createLockedEditor(
      $('lesson-editor'), tpl, window.sbShowLockedHint, saved.ok ? saved.code : undefined
    );
    lessonEditor.onChange(() => {
      clearTimeout(lessonAutosaveTimer);
      lessonAutosaveTimer = setTimeout(() => {
        window.sb.autosaveSet('lesson-' + (meta.id || meta.file), lessonEditor.getCode());
      }, 1500);
    });

    $('lesson-result').classList.add('hidden');
    $('lesson-console').textContent = '';
    window.sbActiveConsole = $('lesson-console');
    refreshPortsInto($('lesson-port-select'));
  }

  function renderLessonContent(lesson) {
    const box = $('lesson-content');
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = pick(lesson, 'title');
    box.appendChild(h);
    for (const step of lesson.steps || []) {
      if (step.type === 'text') {
        const p = document.createElement('div');
        p.className = 'lesson-text';
        renderRichText(p, pick(step, 'text') || step.ru || step.kk || '');
        box.appendChild(p);
      } else if (step.type === 'image' && step.url) {
        const img = document.createElement('img');
        img.src = step.url;
        box.appendChild(img);
      } else if (step.type === 'code') {
        const pre = document.createElement('pre');
        pre.textContent = step.text || '';
        box.appendChild(pre);
      } else if (step.type === 'task') {
        const d = document.createElement('div');
        d.className = 'lesson-task-block';
        const tt = document.createElement('div');
        tt.className = 'task-title';
        tt.textContent = '🎯 ' + t('lesson.task');
        const body = document.createElement('div');
        renderRichText(body, pick(step, 'text') || step.ru || step.kk || '');
        d.appendChild(tt);
        d.appendChild(body);
        box.appendChild(d);
      }
    }
  }

  /* Простая разметка: **жирный**, `код`, переносы строк */
  function renderRichText(el, text) {
    const lines = String(text).split('\n');
    lines.forEach((line, idx) => {
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      for (const part of parts) {
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          const b = document.createElement('b');
          b.textContent = part.slice(2, -2);
          el.appendChild(b);
        } else if (/^`[^`]+`$/.test(part)) {
          const c = document.createElement('code');
          c.textContent = part.slice(1, -1);
          el.appendChild(c);
        } else if (part) {
          el.appendChild(document.createTextNode(part));
        }
      }
      if (idx < lines.length - 1) el.appendChild(document.createElement('br'));
    });
  }

  /* ───────── Проверка задания ───────── */
  $('btn-lesson-check').addEventListener('click', async () => {
    if (!lessonEditor || !currentLesson || window.sbBusy) return;
    window.sbBusy = true;
    $('btn-lesson-check').disabled = true;
    const lesson = currentLesson.lesson;
    const code = lessonEditor.getCode();
    const box = $('lesson-result');
    box.classList.remove('hidden');
    box.innerHTML = `<div>${t('lesson.checking')}</div>`;
    $('lesson-console').textContent = '';
    window.sbActiveConsole = $('lesson-console');

    const results = runStaticChecks(code, lesson.check);
    let compileOk = true;
    const needCompile = !lesson.check || lesson.check.requireCompile !== false;
    if (needCompile) {
      const r = await window.sb.compile(code, $('board-select').value);
      compileOk = r.ok;
    }

    const allOk = compileOk && results.every((x) => x.ok);
    box.innerHTML = '';
    if (allOk) {
      const d = document.createElement('div');
      d.className = 'res-done';
      d.textContent = t('lesson.done');
      box.appendChild(d);
    } else {
      const head = document.createElement('div');
      head.textContent = t('lesson.notDone');
      box.appendChild(head);
    }
    if (needCompile) {
      const d = document.createElement('div');
      d.className = 'res-item ' + (compileOk ? 'ok' : 'fail');
      d.textContent = (compileOk ? '✓ ' : '✗ ') + t('lesson.compileOk');
      box.appendChild(d);
    }
    for (const res of results) {
      const d = document.createElement('div');
      d.className = 'res-item ' + (res.ok ? 'ok' : 'fail');
      d.textContent = (res.ok ? '✓ ' : '✗ ') + (currentLangIs('kk') ? res.msgKk : res.msgRu);
      box.appendChild(d);
    }
    window.sbBusy = false;
    $('btn-lesson-check').disabled = false;
  });

  /* ───────── Загрузка на плату из урока ───────── */
  $('btn-lesson-upload').addEventListener('click', async () => {
    if (!lessonEditor || window.sbBusy) return;
    const sel = $('lesson-port-select');
    if (!sel.value) {
      await refreshPortsInto(sel);
      if (!sel.value) {
        $('lesson-console').textContent = t('msg.noPort') + '\n';
        return;
      }
    }
    window.sbBusy = true;
    $('btn-lesson-upload').disabled = true;
    window.sbShared.stopMonitorUi();
    window.sbActiveConsole = $('lesson-console');
    $('lesson-console').textContent = '';
    const r = await window.sb.upload(lessonEditor.getCode(), $('board-select').value, sel.value);
    consoleAppend($('lesson-console'), '\n' + (r.ok ? t('msg.uploadOk') : t('msg.uploadErr')) + '\n');
    window.sbBusy = false;
    $('btn-lesson-upload').disabled = false;
  });

  $('btn-lesson-ports').addEventListener('click', () => refreshPortsInto($('lesson-port-select')));

  $('btn-lesson-reset').addEventListener('click', () => {
    if (!lessonEditor || !currentLesson) return;
    if (!confirm(t('msg.resetConfirm'))) return;
    const tpl = (currentLesson.lesson.template && currentLesson.lesson.template.lines)
      ? currentLesson.lesson.template : null;
    if (tpl) lessonEditor.reset(tpl);
    else window.sb.getTemplate().then((tp) => lessonEditor.reset(tp));
  });

  $('btn-lesson-back').addEventListener('click', () => {
    $('lesson-view').classList.add('hidden');
    $('materials-list-view').classList.remove('hidden');
    window.sbActiveConsole = $('console');
    currentLesson = null;
    loadMaterials();
  });

  $('btn-mat-refresh').addEventListener('click', loadMaterials);

  document.addEventListener('sb-lang-changed', () => {
    if (currentLesson) renderLessonContent(currentLesson.lesson);
  });

  window.sbLessons = { onShow: loadMaterials };
})();
