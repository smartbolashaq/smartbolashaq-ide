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

console.log('Тест 11: поиск недостающих библиотек в выводе компилятора');
{
  // Логика продублирована из main.js (missingHeaders) для проверки регулярного выражения
  const re = /(?:fatal error|error):\s*([A-Za-z0-9_\-. ]+\.h)[^\n]*No such file/g;
  const out = 'sb_sketch.ino:2:10: fatal error: FastLED.h: No such file or directory\n' +
              ' #include <FastLED.h>\ncompilation terminated.\n' +
              'sb_sketch.ino:3:10: fatal error: Adafruit_NeoPixel.h: No such file or directory';
  const found = [];
  let m;
  while ((m = re.exec(out)) !== null) found.push(m[1].trim());
  check('найдено 2 заголовка', found.length === 2);
  check('FastLED.h найден', found.includes('FastLED.h'));
  check('Adafruit_NeoPixel.h найден', found.includes('Adafruit_NeoPixel.h'));
}

/* ───── Тест 12: мини-тесты из облачного quizzes.json ───── */
{
  console.log('\nТест 12: проверка данных мини-тестов');
  const quiz = require(path.join(__dirname, '..', 'renderer', 'quiz.js'));

  // Нормализация: битые вопросы отбрасываются, урок не ломается
  const qs = quiz.normalize([
    { q: 'Что делает setup()?', answers: ['Повторяется', 'Один раз'], correct: 1, expl: 'Пояснение' },
    { q: 'Без ответов', answers: [], correct: 0 },              // выбрасывается
    { q: '', answers: ['а', 'б'], correct: 0 },                 // выбрасывается
    { q: 'Кривой индекс', answers: ['а', 'б'], correct: 99 }    // индекс чинится на 0
  ]);
  check('битые вопросы отброшены, осталось 2', qs && qs.length === 2);
  check('верный ответ сохранён', qs[0].correct === 1 && qs[0].expl === 'Пояснение');
  check('кривой индекс исправлен на 0', qs[1].correct === 0);
  check('пустой список — null', quiz.normalize([]) === null);
  check('мусор — null', quiz.normalize('не массив') === null);

  // Выбор языка
  const entry = { ru: [{ q: 'В?', answers: ['а', 'б'], correct: 0 }], kk: [{ q: 'С?', answers: ['а', 'б'], correct: 1 }] };
  check('язык kk выбирается', quiz.forLang(entry, 'kk')[0].q === 'С?');
  check('без kk — запасной ru', quiz.forLang({ ru: entry.ru }, 'kk')[0].q === 'В?');

  // Реальный облачный файл: все 14 уроков, оба языка, 5-7 вопросов
  const cloud = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloud-repo-example', 'quizzes.json'), 'utf8'));
  const ids = Object.keys(cloud.quizzes || {});
  check('в quizzes.json 14 уроков', ids.length === 14);
  let ok = true;
  for (const id of ids) {
    for (const lang of ['ru', 'kk']) {
      const list = quiz.forLang(cloud.quizzes[id], lang);
      if (!list || list.length < 5 || list.length > 7) { ok = false; console.log('    проблема:', id, lang); }
      else if (list.length !== (cloud.quizzes[id][lang] || []).length) { ok = false; console.log('    отброшен вопрос:', id, lang); }
    }
  }
  check('все уроки: 5-7 валидных вопросов на обоих языках', ok);
}

console.log('\nИтог: ' + passed + ' пройдено, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
