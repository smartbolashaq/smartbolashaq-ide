/* Исполнитель Python для вкладки «Python»: настоящий CPython (Pyodide,
 * WebAssembly) в отдельном потоке. Окно IDE никогда не замирает, даже если
 * ученик написал `while True:` — главный поток просто ставит флаг в общей
 * памяти, и интерпретатор поднимает KeyboardInterrupt.
 *
 * Протокол (главный поток → сюда):
 *   {t:'init', indexURL, ctl, io}   ctl — SharedArrayBuffer(1): байт прерывания
 *                                   io  — SharedArrayBuffer для ввода input()
 *   {t:'run', code, stdin, files, test}
 *       stdin: null — спрашивать пользователя, массив строк — готовые ответы
 *       files: {имя: текст} — файлы ученика, попадают в рабочую папку программы
 *       test:  true — режим проверки: подсказки input() не печатаются,
 *              черепашка не анимируется, её линии собираются для сравнения
 * (отсюда → главный поток):
 *   {t:'ready', version} | {t:'fail', msg}
 *   {t:'out', s} | {t:'err', s}     текст stdout / stderr
 *   {t:'input'}                     программа ждёт строку от пользователя
 *   {t:'turtle', cmds:[...]}        команды рисования черепашки
 *   {t:'done', ok, stopped, error:{kind,msg,line,tb}, ms,
 *              files:{writes:{имя:текст}, deletes:[имя]}, segments:[...]}
 */
import { loadPyodide } from '../node_modules/pyodide/pyodide.mjs';

const PROG = 'программа.py';   // имя «файла» в трассировках — по нему ищем строку ученика
const WORK = '/home/student';  // рабочая папка программы (в памяти); синхронизируется с папкой ученика

let py = null;
let ctl = null;          // Uint8Array(1): 2 = «остановись»
let io = null;           // Int32Array поверх общего буфера ввода
let ioBytes = null;      // Uint8Array того же буфера
let stdinQueue = null;   // готовые ответы для автопроверки или null
let capture = false;     // собирать отрезки черепашки (режим проверки)
let segments = [];

/* ── вывод: копим короткие всплески, чтобы не заваливать окно сообщениями ── */
let outBuf = '', errBuf = '', tCmds = [], lastFlush = 0;
const dec = new TextDecoder();
function flush() {
  if (outBuf) { postMessage({ t: 'out', s: outBuf }); outBuf = ''; }
  if (errBuf) { postMessage({ t: 'err', s: errBuf }); errBuf = ''; }
  if (tCmds.length) { postMessage({ t: 'turtle', cmds: tCmds }); tCmds = []; }
  lastFlush = Date.now();
}
function onWrite(kind, buf) {
  const s = dec.decode(buf, { stream: true });
  if (kind === 'out') outBuf += s; else errBuf += s;
  const now = Date.now();
  if (now - lastFlush > 30 || outBuf.length + errBuf.length > 2048) flush();
  return buf.length;
}
/* команды черепашки приходят из Python строкой JSON */
function draw(json) {
  const c = JSON.parse(json);
  if (capture && c[0] === 'line') {
    // отрезок без учёта направления и цвета — только геометрия, округлённая до пикселя
    const a = [Math.round(c[1]), Math.round(c[2])], b = [Math.round(c[3]), Math.round(c[4])];
    const k = (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])) ? [a, b] : [b, a];
    segments.push(k[0][0] + ',' + k[0][1] + ',' + k[1][0] + ',' + k[1][1]);
  }
  if (!capture) {
    tCmds.push(c);
    if (tCmds.length > 300) flush();
  }
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

/* ── файлы ученика: до запуска кладём в рабочую папку, после — забираем изменения ── */
function resetWorkDir(files) {
  const FS = py.FS;
  try { FS.mkdir('/home'); } catch (_) {}
  try { FS.mkdir(WORK); } catch (_) {}
  for (const name of FS.readdir(WORK)) {
    if (name === '.' || name === '..') continue;
    const p = WORK + '/' + name;
    try { if (FS.isDir(FS.stat(p).mode)) continue; FS.unlink(p); } catch (_) {}
  }
  for (const name of Object.keys(files || {})) {
    try { FS.writeFile(WORK + '/' + name, files[name], { encoding: 'utf8' }); } catch (_) {}
  }
  FS.chdir(WORK);
}
function collectWorkDir(before) {
  const FS = py.FS;
  const writes = {}, deletes = [], all = {}, seen = new Set();
  for (const name of FS.readdir(WORK)) {
    if (name === '.' || name === '..') continue;
    const p = WORK + '/' + name;
    let text = null;
    try {
      const st = FS.stat(p);
      if (FS.isDir(st.mode) || st.size > 1024 * 1024) continue;
      text = new TextDecoder('utf-8', { fatal: true }).decode(FS.readFile(p));
    } catch (_) { continue; }   // двоичные и слишком большие файлы не трогаем
    seen.add(name); all[name] = text;
    if (!(name in before) || before[name] !== text) writes[name] = text;
  }
  for (const name of Object.keys(before)) if (!seen.has(name)) deletes.push(name);
  return { writes, deletes, all };
}

/* ── обёртка запуска и наш модуль turtle ── */
const RUNNER = `
import sys, traceback, builtins

_sb_real_input = builtins.input
_sb_quiet_prompt = False

def _sb_input(prompt=""):
    # в режиме проверки подсказка input() не печатается — в выводе остаются только print
    if _sb_quiet_prompt:
        return _sb_real_input()
    return _sb_real_input(prompt)
builtins.input = _sb_input

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

/* Черепашка: тот же API, что у стандартного модуля turtle, но рисует на
 * холсте в IDE. Геометрия круга повторяет CPython, чтобы образец и решение
 * ученика давали одинаковые отрезки. */
const TURTLE = `
import math as _m, json as _json, _sb_js

_anim = True
_colormode = 1.0
_turtles = []
_default = None
_SPEED = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
_DELAY = {0: 0, 1: 110, 2: 90, 3: 70, 4: 55, 5: 45, 6: 35, 7: 26, 8: 18, 9: 12, 10: 8}

def _emit(*cmd):
    _sb_js.draw(_json.dumps(cmd, ensure_ascii=False))

def _col(c):
    if isinstance(c, (tuple, list)):
        if len(c) < 3:
            raise ValueError("bad color: %r" % (c,))
        r, g, b = c[0], c[1], c[2]
        if _colormode == 1.0:
            r, g, b = [int(round(float(x) * 255)) for x in (r, g, b)]
        return "rgb(%d,%d,%d)" % (int(r), int(g), int(b))
    return str(c)

class Turtle:
    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        self._x = 0.0; self._y = 0.0; self._h = 0.0
        self._pen = True; self._pc = "black"; self._fc = "black"; self._w = 1
        self._speed = 3; self._vis = visible; self._fill = None; self._shape = shape
        _turtles.append(self)
        self._sync()

    # --- служебное ---
    def _sync(self):
        _emit("turtle", id(self), round(self._x, 2), round(self._y, 2), round(self._h, 2), self._vis, self._pc)
    def _delay(self, k=1.0):
        if not _anim: return
        d = _DELAY.get(self._speed, 35) * k
        if d >= 1: _sb_js.nap(d)
    def _moveto(self, x, y):
        x0, y0 = self._x, self._y
        self._x, self._y = float(x), float(y)
        if self._pen:
            _emit("line", round(x0, 2), round(y0, 2), round(self._x, 2), round(self._y, 2), self._pc, self._w)
        if self._fill is not None:
            self._fill.append((round(self._x, 2), round(self._y, 2)))
        self._sync(); self._delay()

    # --- движение ---
    def forward(self, distance):
        a = _m.radians(self._h)
        self._moveto(self._x + distance * _m.cos(a), self._y + distance * _m.sin(a))
    fd = forward
    def backward(self, distance): self.forward(-distance)
    bk = back = backward
    def left(self, angle):
        self._h = (self._h + angle) % 360.0
        self._sync(); self._delay(0.4)
    lt = left
    def right(self, angle): self.left(-angle)
    rt = right
    def goto(self, x, y=None):
        if y is None: x, y = x
        self._moveto(x, y)
    setpos = setposition = goto
    def setx(self, x): self._moveto(x, self._y)
    def sety(self, y): self._moveto(self._x, y)
    def setheading(self, angle):
        self._h = angle % 360.0; self._sync()
    seth = setheading
    def home(self):
        self.goto(0, 0); self.setheading(0)
    def circle(self, radius, extent=None, steps=None):
        if extent is None: extent = 360
        if steps is None:
            frac = abs(extent) / 360
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = 1.0 * extent / steps
        w2 = 0.5 * w
        l = 2.0 * radius * _m.sin(_m.radians(w2))
        if radius < 0:
            l, w, w2 = -l, -w, -w2
        global _anim
        was = _anim; _anim = False
        try:
            self._h = (self._h + w2) % 360.0
            for i in range(steps):
                self.forward(l)
                self._h = (self._h + w) % 360.0
            self._h = (self._h - w2) % 360.0
        finally:
            _anim = was
        self._sync(); self._delay(1.5)
    def dot(self, size=None, *color):
        if size is None: size = max(self._w + 4, 2 * self._w)
        c = _col(color[0]) if color else self._pc
        _emit("dot", round(self._x, 2), round(self._y, 2), size, c)
    def stamp(self):
        _emit("stamp", round(self._x, 2), round(self._y, 2), round(self._h, 2), self._pc)
        return 0
    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        _emit("write", round(self._x, 2), round(self._y, 2), str(arg), self._pc, align, list(font))
    def clear(self): _emit("clear")
    def reset(self):
        self.clear(); self._x = self._y = self._h = 0.0
        self._pen = True; self._pc = self._fc = "black"; self._w = 1; self._fill = None
        self._sync()

    # --- перо ---
    def penup(self): self._pen = False
    pu = up = penup
    def pendown(self): self._pen = True
    pd = down = pendown
    def isdown(self): return self._pen
    def pensize(self, width=None):
        if width is None: return self._w
        self._w = width
    width = pensize
    def pencolor(self, *args):
        if not args: return self._pc
        self._pc = _col(args[0] if len(args) == 1 else args); self._sync()
    def fillcolor(self, *args):
        if not args: return self._fc
        self._fc = _col(args[0] if len(args) == 1 else args)
    def color(self, *args):
        if not args: return (self._pc, self._fc)
        if len(args) == 1:
            self.pencolor(args[0]); self.fillcolor(args[0])
        elif len(args) == 2:
            self.pencolor(args[0]); self.fillcolor(args[1])
        else:
            self.pencolor(args); self.fillcolor(args)
    def begin_fill(self): self._fill = [(round(self._x, 2), round(self._y, 2))]
    def end_fill(self):
        if self._fill and len(self._fill) > 2:
            _emit("fill", self._fill, self._fc)
        self._fill = None
    def filling(self): return self._fill is not None
    def speed(self, speed=None):
        if speed is None: return self._speed
        if isinstance(speed, str): speed = _SPEED.get(speed, 3)
        speed = int(speed)
        if speed > 10 or speed < 0.5: speed = 0
        self._speed = speed
    def hideturtle(self): self._vis = False; self._sync()
    ht = hideturtle
    def showturtle(self): self._vis = True; self._sync()
    st = showturtle
    def isvisible(self): return self._vis
    def shape(self, name=None):
        if name is None: return self._shape
        self._shape = name
    def shapesize(self, *a, **k): pass
    turtlesize = shapesize
    def degrees(self, *a): pass
    def setundobuffer(self, *a): pass
    def undo(self): pass

    # --- состояние ---
    def position(self): return (self._x, self._y)
    pos = position
    def xcor(self): return self._x
    def ycor(self): return self._y
    def heading(self): return self._h
    def distance(self, x, y=None):
        if y is None:
            if isinstance(x, Turtle): x, y = x._x, x._y
            else: x, y = x
        return _m.hypot(self._x - x, self._y - y)
    def towards(self, x, y=None):
        if y is None:
            if isinstance(x, Turtle): x, y = x._x, x._y
            else: x, y = x
        return _m.degrees(_m.atan2(y - self._y, x - self._x)) % 360.0
    def getscreen(self): return Screen()

Pen = RawTurtle = RawPen = Turtle

class _ScreenT:
    def bgcolor(self, *args):
        if args: _emit("bg", _col(args[0] if len(args) == 1 else args))
    def title(self, *a): pass
    def setup(self, *a, **k): pass
    def screensize(self, *a, **k): pass
    def tracer(self, n=None, delay=None):
        global _anim
        if n is not None: _anim = bool(n)
    def update(self): pass
    def delay(self, *a): pass
    def colormode(self, mode=None):
        global _colormode
        if mode is None: return _colormode
        _colormode = float(mode)
    def clear(self): _emit("clear")
    reset = clearscreen = resetscreen = clear
    def exitonclick(self): pass
    def mainloop(self): pass
    done = mainloop
    def bye(self): pass
    def listen(self, *a, **k): pass
    def onkey(self, *a, **k): pass
    onkeypress = onkeyrelease = onclick = ontimer = onkey
    def window_width(self): return 640
    def window_height(self): return 500
    def turtles(self): return list(_turtles)

_screen = _ScreenT()
def Screen(): return _screen
def getscreen(): return _screen
TurtleScreen = _ScreenT

def _d():
    global _default
    if _default is None: _default = Turtle()
    return _default

def _sb_reset():
    global _default, _anim, _colormode
    _turtles.clear(); _default = None; _anim = True; _colormode = 1.0

for _name in ["forward","fd","backward","bk","back","left","lt","right","rt","goto","setpos",
              "setposition","setx","sety","setheading","seth","home","circle","dot","stamp","write",
              "clear","reset","penup","pu","up","pendown","pd","down","isdown","pensize","width",
              "pencolor","fillcolor","color","begin_fill","end_fill","filling","speed","hideturtle",
              "ht","showturtle","st","isvisible","shape","shapesize","turtlesize","degrees","position",
              "pos","xcor","ycor","heading","distance","towards","undo"]:
    def _mk(n):
        def f(*a, **k): return getattr(_d(), n)(*a, **k)
        f.__name__ = n
        return f
    globals()[_name] = _mk(_name)

def bgcolor(*a): return _screen.bgcolor(*a)
def tracer(*a, **k): return _screen.tracer(*a, **k)
def update(): pass
def colormode(*a): return _screen.colormode(*a)
def title(*a): pass
def setup(*a, **k): pass
def screensize(*a, **k): pass
def delay(*a): pass
def done(): pass
mainloop = exitonclick = done
def bye(): pass
def listen(*a, **k): pass
def onkey(*a, **k): pass
onkeypress = onkeyrelease = onclick = ontimer = onkey
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
  py.registerJsModule('_sb_js', { nap, draw });
  py.runPython(RUNNER);
  // time.sleep → настоящий сон потока с проверкой кнопки «Стоп»
  py.runPython(
    'import time, _sb_js\n' +
    'def _sb_sleep(s):\n' +
    '    _sb_js.nap(max(0.0, float(s)) * 1000)\n' +
    'time.sleep = _sb_sleep\n'
  );
  // наш модуль turtle вместо стандартного (тому нужен Tkinter)
  py.globals.set('_sb_turtle_src', TURTLE);
  py.runPython(
    'import types, sys\n' +
    '_m = types.ModuleType("turtle")\n' +
    'exec(_sb_turtle_src, _m.__dict__)\n' +
    'sys.modules["turtle"] = _m\n' +
    'del _sb_turtle_src\n'
  );
  resetWorkDir({});
  postMessage({ t: 'ready', version: py.version });
}

function run(msg) {
  const t0 = Date.now();
  const test = !!msg.test;
  stdinQueue = Array.isArray(msg.stdin) ? msg.stdin.slice() : null;
  capture = test; segments = []; tCmds = [];
  ctl[0] = 0;
  const before = msg.files || {};
  resetWorkDir(before);
  py.runPython(
    '_sb_quiet_prompt = ' + (test ? 'True' : 'False') + '\n' +
    'import sys\n' +
    'sys.modules["turtle"]._sb_reset()\n' +
    (test ? 'sys.modules["turtle"]._anim = False\n' : '')
  );
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
  let files = { writes: {}, deletes: [], all: {} };
  try { files = collectWorkDir(before); } catch (_) {}
  postMessage({ t: 'done', ok: !res && !stopped, stopped, error: res, ms: Date.now() - t0,
    files, segments: capture ? segments : null });
  capture = false; segments = [];
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
