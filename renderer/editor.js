/*
 * Редактор кода с защищёнными (неудаляемыми) строками.
 *
 * Принцип: каждая защищённая строка накрывается readOnly-меткой CodeMirror,
 * захватывающей и соседние переводы строк. Благодаря этому:
 *   — текст строки нельзя изменить;
 *   — строку нельзя удалить (Backspace/Delete на границах, выделение
 *     с удалением, Ctrl+A, вставка поверх);
 *   — между защищёнными строками всегда остаётся редактируемая область.
 */

/* Шаблон {lines:[{text,locked}]} → текст + номера защищённых строк */
function parseTemplate(template) {
  const lines = (template && template.lines) || [];
  return {
    text: lines.map((l) => l.text).join('\n'),
    lockedLines: lines.map((l, i) => (l.locked ? i : -1)).filter((i) => i >= 0)
  };
}

/*
 * Сопоставляет сохранённый код с шаблоном: находит каждую защищённую
 * строку шаблона в коде (по порядку). Возвращает номера строк в коде
 * или null, если структура нарушена (тогда код считается несовместимым).
 */
function matchLockedLines(codeText, template) {
  const codeLines = String(codeText).split('\n');
  const result = [];
  let cursor = 0;
  for (const l of (template && template.lines) || []) {
    if (!l.locked) continue;
    let found = -1;
    for (let i = cursor; i < codeLines.length; i++) {
      if (codeLines[i] === l.text) { found = i; break; }
    }
    if (found === -1) return null;
    result.push(found);
    cursor = found + 1;
  }
  return result;
}

function createLockedEditor(container, template, onBlockedEdit, initialCode) {
  const parsed = parseTemplate(template);
  let text = parsed.text;
  let lockedIdx = parsed.lockedLines;

  // Восстановление сохранённого кода — только если защищённые строки целы
  if (typeof initialCode === 'string' && initialCode !== '') {
    const matched = matchLockedLines(initialCode, template);
    if (matched) { text = initialCode; lockedIdx = matched; }
  }

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

  function applyLocks(idx) {
    marks.forEach((m) => m.clear());
    marks = [];
    const lastLine = cm.lastLine();
    for (const i of idx) {
      if (i > lastLine) continue;
      // Метка захватывает перевод строки ДО и ПОСЛЕ защищённой строки,
      // чтобы строку нельзя было «склеить» с соседями и удалить.
      const from = i === 0
        ? { line: 0, ch: 0 }
        : { line: i - 1, ch: cm.getLine(i - 1).length };
      const to = i === lastLine
        ? { line: i, ch: cm.getLine(i).length }
        : { line: i + 1, ch: 0 };
      marks.push(cm.markText(from, to, {
        readOnly: true,
        className: 'cm-locked-text',
        inclusiveLeft: i === 0,
        inclusiveRight: i === lastLine,
        atomic: false
      }));
    }
    updateDecorations();
  }

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

  cm.on('beforeChange', (_cm, change) => {
    if (change.origin === 'setValue') return;
    const hit = cm.findMarks(change.from, change.to).some((m) => m.readOnly);
    if (hit && typeof onBlockedEdit === 'function') onBlockedEdit();
  });

  cm.on('changes', () => updateDecorations());

  applyLocks(lockedIdx);

  return {
    cm,
    getCode: () => cm.getValue(),
    onChange: (cb) => cm.on('changes', () => cb(cm.getValue())),
    reset: (tpl) => {
      const p = parseTemplate(tpl || template);
      marks.forEach((m) => m.clear());
      marks = [];
      cm.setValue(p.text);
      cm.clearHistory();
      applyLocks(p.lockedLines);
    }
  };
}

/* Для автотестов в Node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTemplate, matchLockedLines, createLockedEditor };
}
