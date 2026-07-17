/*
 * Автотест логики защищённых строк (без запуска Electron).
 * Запуск: npm test
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM('<!DOCTYPE html><body><div id="ed"></div></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
dom.window.document.createRange = () => {
  const r = {
    setEnd: () => {}, setStart: () => {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => ({ length: 0 })
  };
  return r;
};

const CodeMirror = require('codemirror');
global.CodeMirror = CodeMirror;
require('codemirror/mode/clike/clike');

// Загружаем editor.js как обычный скрипт
const editorSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'editor.js'), 'utf8');
eval(editorSrc + '\nglobal.createLockedEditor = createLockedEditor; global.parseTemplate = parseTemplate;');

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'template.json'), 'utf8'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

function freshEditor() {
  document.getElementById('ed').innerHTML = '';
  return createLockedEditor(document.getElementById('ed'), template, () => {});
}

const parsed = parseTemplate(template);
const LOCKED = new Set(parsed.lockedLines);
const N = template.lines.length;

console.log('Тест 1: шаблон загружается полностью');
{
  const ed = freshEditor();
  check('текст совпадает с шаблоном', ed.getCode() === parsed.text);
  check('количество строк = ' + N, ed.cm.lineCount() === N);
}

console.log('Тест 2: защищённую строку нельзя изменить');
{
  const ed = freshEditor();
  const line = parsed.lockedLines[1]; // #include <Arduino.h>
  const before = ed.cm.getLine(line);
  ed.cm.replaceRange('XXX', { line, ch: 3 });
  check('текст внутри строки не изменился', ed.cm.getLine(line) === before);
  ed.cm.replaceRange('', { line, ch: 0 }, { line, ch: ed.cm.getLine(line).length });
  check('содержимое строки нельзя стереть', ed.cm.getLine(line) === before);
}

console.log('Тест 3: защищённую строку нельзя удалить склейкой (Backspace/Delete на границах)');
{
  const ed = freshEditor();
  const before = ed.getCode();
  for (const line of parsed.lockedLines) {
    // Backspace в начале защищённой строки (удаление перевода строки перед ней)
    if (line > 0) {
      ed.cm.replaceRange('', { line: line - 1, ch: ed.cm.getLine(line - 1).length }, { line, ch: 0 });
    }
    // Delete в конце защищённой строки (удаление перевода строки после неё)
    if (line < ed.cm.lastLine()) {
      ed.cm.replaceRange('', { line, ch: ed.cm.getLine(line).length }, { line: line + 1, ch: 0 });
    }
  }
  check('структура не изменилась', ed.getCode() === before);
}

console.log('Тест 4: Ctrl+A + Delete не уничтожает защищённые строки');
{
  const ed = freshEditor();
  ed.cm.execCommand('selectAll');
  ed.cm.replaceSelection('');
  const after = ed.getCode().split('\n');
  let allKept = true;
  for (const i of parsed.lockedLines) {
    if (!after.includes(template.lines[i].text)) allKept = false;
  }
  check('все защищённые строки на месте', allKept);
}

console.log('Тест 5: в редактируемую область можно дописывать код');
{
  const ed = freshEditor();
  // Строка-подсказка внутри setup() — редактируемая (после Serial.begin)
  const editable = template.lines.findIndex((l, i) => !l.locked && i > 4);
  ed.cm.replaceRange('digitalWrite(13, HIGH);', { line: editable, ch: ed.cm.getLine(editable).length });
  check('код добавлен', ed.getCode().includes('digitalWrite(13, HIGH);'));
  // Enter в конце редактируемой строки — новая строка
  const cnt = ed.cm.lineCount();
  ed.cm.replaceRange('\n  delay(500);', { line: editable, ch: ed.cm.getLine(editable).length });
  check('новая строка добавлена', ed.cm.lineCount() === cnt + 1 && ed.getCode().includes('delay(500);'));
}

console.log('Тест 6: редактируемый текст можно удалять');
{
  const ed = freshEditor();
  const editable = template.lines.findIndex((l) => !l.locked && l.text.trim().length > 0);
  ed.cm.replaceRange('', { line: editable, ch: 0 }, { line: editable, ch: ed.cm.getLine(editable).length });
  check('редактируемая строка очищена', ed.cm.getLine(editable) === '');
}

console.log('Тест 7: вставка поверх всего документа не трогает защищённые строки');
{
  const ed = freshEditor();
  ed.cm.execCommand('selectAll');
  ed.cm.replaceSelection('int x = 1;');
  const after = ed.getCode().split('\n');
  let allKept = true;
  for (const i of parsed.lockedLines) {
    if (!after.includes(template.lines[i].text)) allKept = false;
  }
  check('все защищённые строки на месте', allKept);
}

console.log('Тест 8: сброс кода восстанавливает шаблон и защиту');
{
  const ed = freshEditor();
  const editable = template.lines.findIndex((l) => !l.locked);
  ed.cm.replaceRange('мусор', { line: editable, ch: 0 });
  ed.reset(template);
  check('текст восстановлен', ed.getCode() === parsed.text);
  const line = parsed.lockedLines[0];
  const before = ed.cm.getLine(line);
  ed.cm.replaceRange('XXX', { line, ch: 1 });
  check('защита снова работает', ed.cm.getLine(line) === before);
}

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
