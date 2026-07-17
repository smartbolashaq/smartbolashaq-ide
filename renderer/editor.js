/*
 * Редактор кода с защищёнными (неудаляемыми) строками.
 *
 * Принцип: каждая защищённая строка накрывается readOnly-меткой CodeMirror,
 * захватывающей и соседние переводы строк. Благодаря этому:
 *   — текст строки нельзя изменить;
 *   — строку нельзя удалить (в том числе через Backspace/Delete на границах,
 *     выделение с удалением, Ctrl+A, вставку поверх);
 *   — между защищёнными строками всегда остаётся редактируемая область,
 *     куда ученик дописывает свой код.
 */

/* Преобразует шаблон {lines:[{text,locked}]} в текст + номера защищённых строк */
function parseTemplate(template) {
  const lines = (template && template.lines) || [];
  return {
    text: lines.map((l) => l.text).join('\n'),
    lockedLines: lines.map((l, i) => (l.locked ? i : -1)).filter((i) => i >= 0)
  };
}

function createLockedEditor(container, template, onBlockedEdit) {
  const { text, lockedLines } = parseTemplate(template);

  const cm = CodeMirror(container, {
    value: text,
    mode: 'text/x-c++src',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    gutters: ['CodeMirror-linenumbers', 'locked-gutter'],
    autofocus: true
  });

  let marks = [];

  function applyLocks(lockedIdx) {
    marks.forEach((m) => m.clear());
    marks = [];
    const lastLine = cm.lastLine();
    for (const i of lockedIdx) {
      if (i > lastLine) continue;
      // Метка захватывает перевод строки ДО и ПОСЛЕ защищённой строки,
      // чтобы строку нельзя было "склеить" с соседями и тем самым удалить.
      const from = i === 0
        ? { line: 0, ch: 0 }
        : { line: i - 1, ch: cm.getLine(i - 1).length };
      const to = i === lastLine
        ? { line: i, ch: cm.getLine(i).length }
        : { line: i + 1, ch: 0 };
      marks.push(cm.markText(from, to, {
        readOnly: true,
        className: 'cm-locked-text',
        inclusiveLeft: i === 0,      // нельзя печатать перед самой первой строкой
        inclusiveRight: i === lastLine, // и после самой последней
        atomic: false
      }));
    }
    updateDecorations();
  }

  /* Текущие номера защищённых строк (метки двигаются вместе с текстом) */
  function currentLockedLines() {
    const set = new Set();
    for (const m of marks) {
      const pos = m.find();
      if (!pos) continue;
      const first = pos.from.ch === 0 && pos.from.line === 0 ? 0 : pos.from.line + 1;
      const last = pos.to.ch === 0 ? pos.to.line - 1 : pos.to.line;
      for (let l = first; l <= last; l++) set.add(l);
    }
    return set;
  }

  /* Значок 🔒 в отступе + фон для защищённых строк */
  function updateDecorations() {
    const locked = currentLockedLines();
    cm.operation(() => {
      cm.clearGutter('locked-gutter');
      cm.eachLine((h) => cm.removeLineClass(h, 'background', 'locked-line-bg'));
      locked.forEach((l) => {
        if (l > cm.lastLine()) return;
        const el = document.createElement('div');
        el.className = 'locked-marker';
        el.textContent = '🔒';
        cm.setGutterMarker(l, 'locked-gutter', el);
        cm.addLineClass(l, 'background', 'locked-line-bg');
      });
    });
  }

  /* Подсказка, когда правка заблокирована */
  cm.on('beforeChange', (_cm, change) => {
    if (change.origin === 'setValue') return;
    const hit = cm.findMarks(change.from, change.to).some((m) => m.readOnly);
    if (hit && typeof onBlockedEdit === 'function') onBlockedEdit();
  });

  cm.on('changes', () => updateDecorations());

  applyLocks(lockedLines);

  return {
    cm,
    getCode: () => cm.getValue(),
    reset: (tpl) => {
      const parsed = parseTemplate(tpl || template);
      marks.forEach((m) => m.clear());
      marks = [];
      cm.setValue(parsed.text);
      cm.clearHistory();
      applyLocks(parsed.lockedLines);
    }
  };
}
