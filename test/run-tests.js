/*
 * Автотесты (без запуска Electron): защита строк, восстановление кода,
 * проверка условий заданий.
 * Запуск: npm test
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM('<!DOCTYPE html><body><div id="ed"></div></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
dom.window.document.createRange = () => ({
  setEnd: () => {}, setStart: () => {},
  getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
  getClientRects: () => ({ length: 0 })
});

const CodeMirror = require('codemirror');
global.CodeMirror = CodeMirror;
require('codemirror/mode/clike/clike');

const { parseTemplate, matchLockedLines, createLockedEditor } =
  require(path.join(__dirname, '..', 'renderer', 'editor.js'));
const { runStaticChecks, stripCommentsAndStrings } =
  require(path.join(__dirname, '..', 'renderer', 'checker.js'));

const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'template.json'), 'utf8'));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

function freshEditor(initialCode) {
  document.getElementById('ed').innerHTML = '';
  return createLockedEditor(document.getElementById('ed'), template, () => {}, initialCode);
}

const parsed = parseTemplate(template);
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
  const line = parsed.lockedLines[1];
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
    if (line > 0) {
      ed.cm.replaceRange('', { line: line - 1, ch: ed.cm.getLine(line - 1).length }, { line, ch: 0 });
    }
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
  const editable = template.lines.findIndex((l, i) => !l.locked && i > 4);
  ed.cm.replaceRange('digitalWrite(13, HIGH);', { line: editable, ch: ed.cm.getLine(editable).length });
  check('код добавлен', ed.getCode().includes('digitalWrite(13, HIGH);'));
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

console.log('Тест 9: восстановление сохранённого кода с защитой строк');
{
  // Пользовательский код: добавлены строки внутри setup()
  const codeLines = parsed.text.split('\n');
  const insertAt = parsed.lockedLines[2]; // после Serial.begin
  codeLines.splice(insertAt + 1, 0, '  pinMode(13, OUTPUT);', '  digitalWrite(13, HIGH);');
  const savedCode = codeLines.join('\n');

  const matched = matchLockedLines(savedCode, template);
  check('строки шаблона найдены в сохранённом коде', Array.isArray(matched));

  const ed = freshEditor(savedCode);
  check('сохранённый код восстановлен', ed.getCode() === savedCode);
  // Защита работает на новых позициях
  const lockLine = matched[matched.length - 1];
  const before = ed.cm.getLine(lockLine);
  ed.cm.replaceRange('XXX', { line: lockLine, ch: 0 });
  check('защита действует после восстановления', ed.cm.getLine(lockLine) === before);
}

console.log('Тест 10: повреждённый сохранённый код → откат к шаблону');
{
  const ed = freshEditor('вообще не тот код');
  check('редактор вернулся к шаблону', ed.getCode() === parsed.text);
}

console.log('Тест 11: проверка условий задания (checker)');
{
  const code = `void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000); // пауза\n}`;
  const res = runStaticChecks(code, {
    contains: [{ text: 'digitalWrite' }, { text: 'analogRead' }],
    notContains: [{ text: 'while(1)' }],
    regex: [{ pattern: 'delay\\s*\\(\\s*\\d+\\s*\\)' }]
  });
  check('условий проверено: 4', res.length === 4);
  check('digitalWrite найден', res[0].ok === true);
  check('analogRead не найден', res[1].ok === false);
  check('запрещённого while(1) нет', res[2].ok === true);
  check('regex delay(...) выполняется', res[3].ok === true);
}

console.log('Тест 12: текст в комментариях не засчитывается');
{
  const code = `void loop() {\n  // тут digitalWrite только в комментарии\n}`;
  const res = runStaticChecks(code, { contains: [{ text: 'digitalWrite' }] });
  check('digitalWrite в комментарии не считается', res[0].ok === false);
  check('strip работает', !stripCommentsAndStrings(code).includes('digitalWrite'));
}

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
