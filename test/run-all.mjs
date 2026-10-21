// Автопроверка программы перед сборкой (`npm test`, запускается и в GitHub Actions).
// Ничего не меняет в проекте — только читает файлы и гоняет код в памяти.
//   1. синтаксис всех .js;
//   2. словарь интерфейса: русский и казахский совпадают по ключам и {подстановкам};
//   3. у каждого текста {ru} в данных курсов, инструкции и сборки есть {kk};
//   4. эталонные решения всех заданий проходят свои же автопроверки (RU и KK) —
//      настоящим Python (Pyodide) и настоящими проверяющими из course.js;
//   5. защиты v1.17.1: большой файл не «удаляется», проверка не зависает.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = path.join(ROOT, 'renderer');
let failed = 0;
const pass = (name) => console.log('  ✓ ' + name);
const fail = (name, detail) => { failed++; console.log('  ✗ ' + name + (detail ? '\n      ' + String(detail).split('\n').join('\n      ') : '')); };
const section = (t) => console.log('\n' + t);

/* ── 1. синтаксис ── */
section('1. Синтаксис JavaScript');
const jsFiles = ['main.js', 'preload.js', ...fs.readdirSync(R).filter((f) => f.endsWith('.js')).map((f) => 'renderer/' + f), 'renderer/assembly/data.js'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const isModule = /^import\s/m.test(src) || /^export\s/m.test(src);
  const r = isModule
    ? spawnSync(process.execPath, ['--input-type=module', '--check'], { input: src, encoding: 'utf8' })
    : spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  if (r.status !== 0) fail(f, (r.stderr || '').split('\n').slice(0, 6).join('\n'));
}
if (!failed) pass(jsFiles.length + ' файлов без синтаксических ошибок');

/* общая «песочница» для файлов данных интерфейса */
function loadScripts(files, extra = {}) {
  const doc = { getElementById: () => null, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], dispatchEvent() {}, body: { dataset: {} } };
  const ctx = vm.createContext(Object.assign({ document: doc, window: {}, console, CustomEvent: function () {}, setTimeout, clearTimeout }, extra));
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(R, f), 'utf8') + '\n;globalThis.__I18N = typeof I18N !== "undefined" ? I18N : globalThis.__I18N;', ctx, { filename: f });
  return ctx;
}

/* ── 2. словарь интерфейса ── */
section('2. Словарь интерфейса RU/KK');
{
  const ctx = loadScripts(['i18n.js']);
  const D = ctx.__I18N;
  const ru = D.ru, kk = D.kk;
  const kr = Object.keys(ru), kz = Object.keys(kk);
  const miss = kr.filter((k) => !(k in kk)), extra = kz.filter((k) => !(k in ru));
  if (miss.length) fail('нет перевода на казахский: ' + miss.join(', '));
  if (extra.length) fail('ключи только в казахском: ' + extra.join(', '));
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const badVars = kr.filter((k) => k in kk && vars(ru[k]) !== vars(kk[k]));
  if (badVars.length) fail('разные {подстановки} в RU и KK: ' + badVars.join(', '));
  const empty = kr.filter((k) => !String(ru[k]).trim() || (k in kk && !String(kk[k]).trim()));
  if (empty.length) fail('пустые строки: ' + empty.join(', '));
  if (!miss.length && !extra.length && !badVars.length && !empty.length) pass(kr.length + ' ключей, переводы и подстановки совпадают');
}

/* ── 3. тексты данных: у каждого {ru} есть {kk} ── */
section('3. Тексты курсов, инструкции и сборки на двух языках');
const data = loadScripts(['course-data.js', 'car-course-data.js', 'manual-data.js', 'manual-build-data.js', 'assembly/data.js']);
{
  const W = data.window;
  const roots = Object.keys(W).filter((k) => W[k] && typeof W[k] === 'object');
  let pairs = 0; const bad = [];
  const walk = (o, where, seen) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (typeof o.ru === 'string') {
      pairs++;
      if (typeof o.kk !== 'string' || !o.kk.trim()) bad.push(where + ': «' + o.ru.slice(0, 50) + '»');
    }
    for (const k of Object.keys(o)) walk(o[k], where + '.' + k, seen);
  };
  for (const k of roots) walk(W[k], k, new Set());
  if (bad.length) fail('нет казахского текста (' + bad.length + ')', bad.slice(0, 10).join('\n'));
  else pass(pairs + ' пар RU/KK в ' + roots.join(', '));
}

/* ── 4–5. Python: эталоны проходят свои проверки ── */
section('4. Эталонные решения проходят автопроверку (настоящий Python)');
const { loadPyodide } = await import(pathToFileURL(path.join(ROOT, 'node_modules/pyodide/pyodide.mjs')).href);
const msgs = [];
const wctx = vm.createContext({ console, Date, TextDecoder, TextEncoder, JSON, SharedArrayBuffer, Int32Array, Uint8Array, Atomics, Math, Object, Array, String, Set, Promise,
  loadPyodide, postMessage: (m) => msgs.push(m), self: {} });
let wsrc = fs.readFileSync(path.join(R, 'py-worker.js'), 'utf8').replace(/^import .*$/m, '');
vm.runInContext(wsrc + '\n;globalThis.__h = self.onmessage;', wctx, { filename: 'py-worker.js' });
const H = wctx.__h;
const ctl = new SharedArrayBuffer(1), io = new SharedArrayBuffer(8 + 65536), ev = new SharedArrayBuffer(16);
await H({ data: { t: 'init', indexURL: path.join(ROOT, 'node_modules/pyodide') + path.sep, ctl, io, ev } });
if (!msgs.some((m) => m.t === 'ready')) { fail('Python не загрузился', JSON.stringify(msgs.slice(-2))); }

async function run(code, opts = {}) {
  msgs.length = 0;
  await H({ data: { t: 'run', code, stdin: opts.stdin || [], files: opts.files || {}, test: true, car: opts.car } });
  const d = msgs.find((m) => m.t === 'done') || {};
  return { ok: d.ok, error: d.error, output: msgs.filter((m) => m.t === 'out' || m.t === 'err').map((m) => m.s).join(''), files: d.files, segments: d.segments, carLog: d.carLog };
}
async function judge(src, log, spec) { msgs.length = 0; await H({ data: { t: 'judge', id: 1, src, log, spec } }); return msgs.find((m) => m.t === 'judged') || { fails: [], error: 'no answer' }; }

// проверяющие — из настоящего course.js
const cctx = loadScripts(['course-data.js', 'car-course-data.js', 'course.js'], { t: (k) => k, currentLang: 'ru' });
const judgeText = cctx.window.sbCourse._judge;
const T = (x, L) => (x == null ? '' : typeof x === 'string' ? x : (x[L] || x.ru));
const needsRef = (s) => s.numbers === true || s.values || s.text || s.turtle;
async function checkPy(tk, code, L, files) {
  const out = [];
  for (const t0 of tk.tests || []) {
    const spec = Object.assign({}, tk.check || {}, t0);
    const stdin = !spec.stdin ? [] : Array.isArray(spec.stdin) ? spec.stdin : (spec.stdin[L] || spec.stdin.ru);
    const ref = needsRef(spec) ? await run(T(tk.a, L), { stdin, files }) : {};
    const r = await run(code, { stdin, files });
    if (r.error) { out.push('ошибка ' + r.error.kind + ': ' + r.error.msg); continue; }
    const f = judgeText(spec, r, ref);
    out.push(f.length ? f.map((x) => x.why).join(' | ') : 'ok');
  }
  return out;
}
async function checkCar(tk, code) {
  const out = [];
  for (const t0 of tk.tests || [{}]) {
    const spec = Object.assign({}, tk.check || {}, t0);
    const r = await run(code, { car: { events: spec.events || [], inputs: spec.inputs || {}, limit: spec.limit || 12 } });
    if (r.error) { out.push('ошибка ' + r.error.kind + ': ' + r.error.msg); continue; }
    const j = await judge(tk.judge, Object.assign({}, r.carLog || {}, { output: r.output }), spec);
    out.push(j.error ? 'ошибка судьи: ' + j.error : (j.fails.length ? j.fails.map((f) => f[0]).join(' | ') : 'ok'));
  }
  return out;
}
{
  const PY = cctx.window.COURSE.flatMap((m) => m.tasks).filter((tk) => tk.tests && tk.tests.length);
  const CAR = cctx.window.CAR_COURSE.flatMap((m) => m.tasks).filter((tk) => tk.judge);
  let n = 0, bad = 0;
  for (const L of ['ru', 'kk']) {
    cctx.currentLang = L;
    for (const tk of PY) { n++; const r = await checkPy(tk, T(tk.a, L), L, {}); if (r.some((x) => x !== 'ok')) { bad++; fail('Python ' + tk.id + ' (' + L + ')', r.join('\n')); } }
    for (const tk of CAR) { n++; const r = await checkCar(tk, T(tk.a, L)); if (r.some((x) => x !== 'ok')) { bad++; fail('машинка ' + tk.id + ' (' + L + ')', r.join('\n')); } }
  }
  if (!bad) pass(n + ' эталонов (' + PY.length + ' Python + ' + CAR.length + ' машинка, на двух языках) проходят свои проверки');
  // пустая программа не должна проходить ни одно задание с автопроверкой
  cctx.currentLang = 'ru';
  const leaky = [];
  for (const tk of PY) { const r = await checkPy(tk, 'pass\n', 'ru', {}); if (r.every((x) => x === 'ok')) leaky.push(tk.id); }
  if (leaky.length) fail('пустая программа проходит проверку: ' + leaky.join(', '));
  else pass('пустая программа не проходит ни одно задание');
}

section('5. Защиты v1.17.1');
{
  const big = await run('f = open("log.txt", "a")\nf.write("x" * (1100 * 1024))\nf.close()\n', { files: { 'log.txt': 'hello\n' } });
  const del = (big.files && big.files.deletes) || [];
  if (del.includes('log.txt')) fail('файл больше 1 МБ попадает в «удалённые» (уйдёт в корзину)');
  else pass('файл больше 1 МБ не считается удалённым');
  if (!(big.files && big.files.skipped || []).includes('log.txt')) fail('большой файл не отмечен как несохранённый');
  else pass('большой файл отмечен как несохранённый — ученик увидит сообщение');
  const pyjs = fs.readFileSync(path.join(R, 'course.js'), 'utf8');
  if (!/PY_CHECK_MS/.test(pyjs) || !/timeout: PY_CHECK_MS/.test(pyjs)) fail('у проверки заданий Python нет ограничения по времени');
  else pass('проверка заданий Python ограничена по времени');
  const mainjs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const need = [['requestSingleInstanceLock', 'одна копия программы'], ['will-navigate', 'окно не уходит со своей страницы'],
    ['setWindowOpenHandler', 'новые окна не открываются'], ['writeAtomic(userDir(\'settings.json\')', 'настройки пишутся атомарно']];
  for (const [s, what] of need) { if (mainjs.includes(s)) pass(what); else fail(what); }
}

console.log(failed ? `\n✗ Не пройдено: ${failed}` : '\n✓ Все проверки пройдены');
process.exit(failed ? 1 : 0);
