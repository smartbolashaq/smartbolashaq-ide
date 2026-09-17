/* Исполнитель Python для вкладки «Python»: настоящий CPython (Pyodide,
 * WebAssembly) в отдельном потоке. Окно IDE никогда не замирает, даже если
 * ученик написал `while True:` — главный поток просто ставит флаг в общей
 * памяти, и интерпретатор поднимает KeyboardInterrupt.
 *
 * Протокол (главный поток → сюда):
 *   {t:'init', indexURL, ctl, io}   ctl — SharedArrayBuffer(1): байт прерывания
 *                                   io  — SharedArrayBuffer для ввода input()
 *   {t:'run', code, stdin}          stdin: null — спрашивать пользователя,
 *                                   массив строк — готовые ответы (автопроверка)
 * (отсюда → главный поток):
 *   {t:'ready', version} | {t:'fail', msg}
 *   {t:'out', s} | {t:'err', s}     текст stdout / stderr
 *   {t:'input'}                     программа ждёт строку от пользователя
 *   {t:'done', ok, stopped, error:{kind,msg,line,tb}, ms}
 */
import { loadPyodide } from '../node_modules/pyodide/pyodide.mjs';

const PROG = 'программа.py';   // имя «файла» в трассировках — по нему ищем строку ученика

let py = null;
let ctl = null;          // Uint8Array(1): 2 = «остановись»
let io = null;           // Int32Array поверх общего буфера ввода
let ioBytes = null;      // Uint8Array того же буфера
let stdinQueue = null;   // готовые ответы для автопроверки или null

/* ── вывод: копим короткие всплески, чтобы не заваливать окно сообщениями ── */
let outBuf = '', errBuf = '', lastFlush = 0;
const dec = new TextDecoder();
function flush() {
  if (outBuf) { postMessage({ t: 'out', s: outBuf }); outBuf = ''; }
  if (errBuf) { postMessage({ t: 'err', s: errBuf }); errBuf = ''; }
  lastFlush = Date.now();
}
function onWrite(kind, buf) {
  const s = dec.decode(buf, { stream: true });
  if (kind === 'out') outBuf += s; else errBuf += s;
  const now = Date.now();
  if (now - lastFlush > 30 || outBuf.length + errBuf.length > 2048) flush();
  return buf.length;
}

/* ── пауза: настоящий сон потока, а не выжигание процессора ── */
const napBuf = new Int32Array(new SharedArrayBuffer(4));
function nap(ms) {
  // спим кусками по 50 мс и смотрим, не нажали ли «Стоп»
  flush();
  const end = Date.now() + ms;
  while (true) {
    if (ctl && ctl[0] === 2) { py.checkInterrupt(); return; }
    const left = end - Date.now();
    if (left <= 0) return;
    Atomics.wait(napBuf, 0, 0, Math.min(left, 50));
  }
}

/* ── ввод: ждём строку из главного потока ── */
function readLine() {
  if (stdinQueue) return stdinQueue.length ? stdinQueue.shift() + '\n' : null;   // null = конец ввода
  flush();
  Atomics.store(io, 0, 0);
  postMessage({ t: 'input' });
  while (true) {
    if (ctl && ctl[0] === 2) { py.checkInterrupt(); return null; }
    Atomics.wait(io, 0, 0, 50);
    const st = Atomics.load(io, 0);
    if (st === 1) {
      const n = Atomics.load(io, 1);
      const s = new TextDecoder().decode(ioBytes.slice(8, 8 + n));
      Atomics.store(io, 0, 0);
      return s + '\n';
    }
    if (st === 2) { Atomics.store(io, 0, 0); return null; }   // EOF — ввод отменён
  }
}

const RUNNER = `
import sys, traceback, time

def _sb_run(code):
    try:
        exec(compile(code, ${JSON.stringify(PROG)}, "exec"), {"__name__": "__main__"})
        return None
    except KeyboardInterrupt:
        return {"kind": "KeyboardInterrupt", "msg": "", "line": None, "tb": ""}
    except SystemExit:
        return None
    except BaseException as e:
        line = None
        for fr in traceback.extract_tb(e.__traceback__):
            if fr.filename == ${JSON.stringify(PROG)}:
                line = fr.lineno
        if isinstance(e, SyntaxError) and e.filename == ${JSON.stringify(PROG)}:
            line = e.lineno
        return {"kind": type(e).__name__, "msg": str(e), "line": line,
                "tb": traceback.format_exc()}
    finally:
        try:
            sys.stdout.flush(); sys.stderr.flush()
        except Exception:
            pass
`;

async function init(msg) {
  ctl = new Uint8Array(msg.ctl);
  io = new Int32Array(msg.io);
  ioBytes = new Uint8Array(msg.io);
  py = await loadPyodide({ indexURL: msg.indexURL });
  py.setInterruptBuffer(ctl);
  py.setStdout({ write: (b) => onWrite('out', b), isatty: true });
  py.setStderr({ write: (b) => onWrite('err', b), isatty: true });
  // stdin — не «терминал»: тогда подсказка input() идёт в stdout, а не в stderr
  py.setStdin({ stdin: readLine, isatty: false });
  py.registerJsModule('_sb_js', { nap });
  py.runPython(RUNNER);
  // time.sleep → настоящий сон потока с проверкой кнопки «Стоп»
  py.runPython(
    'import time, _sb_js\n' +
    'def _sb_sleep(s):\n' +
    '    _sb_js.nap(max(0.0, float(s)) * 1000)\n' +
    'time.sleep = _sb_sleep\n'
  );
  postMessage({ t: 'ready', version: py.version });
}

function run(msg) {
  const t0 = Date.now();
  stdinQueue = Array.isArray(msg.stdin) ? msg.stdin.slice() : null;
  ctl[0] = 0;
  let res = null, stopped = false;
  try {
    const r = py.globals.get('_sb_run')(msg.code);
    if (r) { res = r.toJs({ dict_converter: Object.fromEntries }); r.destroy(); }
  } catch (e) {
    // сюда попадаем, если прерывание пришло раньше, чем стартовал exec
    res = { kind: 'KeyboardInterrupt', msg: String(e), line: null, tb: '' };
  }
  flush();
  if (res && res.kind === 'KeyboardInterrupt') { stopped = true; res = null; }
  postMessage({ t: 'done', ok: !res && !stopped, stopped, error: res, ms: Date.now() - t0 });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.t === 'init') await init(msg);
    else if (msg.t === 'run') run(msg);
  } catch (err) {
    postMessage({ t: 'fail', msg: String(err && err.message || err) });
  }
};
