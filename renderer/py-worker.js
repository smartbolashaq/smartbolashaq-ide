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
let ev = null;           // Int32Array: [0] — нажатия кнопок пилота/попадание (биты), [1] — уровни входных пинов
let cCmds = [];          // команды виртуальной машинки для отрисовки

/* ── вывод: копим короткие всплески, чтобы не заваливать окно сообщениями ── */
let outBuf = '', errBuf = '', tCmds = [], lastFlush = 0;
const dec = new TextDecoder();
function flush() {
  if (outBuf) { postMessage({ t: 'out', s: outBuf }); outBuf = ''; }
  if (errBuf) { postMessage({ t: 'err', s: errBuf }); errBuf = ''; }
  if (tCmds.length) { postMessage({ t: 'turtle', cmds: tCmds }); tCmds = []; }
  if (cCmds.length) { postMessage({ t: 'car', cmds: cCmds }); cCmds = []; }
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

/* команды виртуальной машинки (лента, серво, выстрел) — на отрисовку */
function car(json) { cCmds.push(JSON.parse(json)); if (cCmds.length > 200) flush(); }
/* события от панели виртуальной машинки: кнопки пилота (биты 1,2,4), попадание (8) */
function carPoll() { return ev ? Atomics.exchange(ev, 0, 0) : 0; }
function carInputs() { return ev ? Atomics.load(ev, 1) : 0; }

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

class _SbSimEnd(Exception):
    """виртуальная машинка: время сценария вышло — программа считается завершённой"""

_sb_car_mode = False

def _sb_run(code):
    try:
        g = {"__name__": "__main__"}
        if _sb_car_mode:
            import _sbcar
            g.update(_sbcar.api())
        exec(compile(code, ${JSON.stringify(PROG)}, "exec"), g)
        return None
    except _SbSimEnd:
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


/* Виртуальная машинка: тот же API, что на настоящей (strip/show/wait/servo/pin/
 * read/fire/on_button/on_hit/forever), но всё пишется в журнал и рисуется на
 * панели. В режиме проверки время виртуальное: wait() не ждёт, а «перематывает»,
 * события сценария (кнопки, попадание) срабатывают в назначенный момент. */
const CAR = `
import time as _time, json as _json, _sb_js, builtins as _bi

FREE_PINS = (17, 22, 23, 24, 27)
HIGH, LOW = 1, 0

class _Sim:
    def __init__(self):
        self.reset(False, {})
    def reset(self, test, cfg):
        self.test = bool(test); self.cfg = cfg or {}
        self.t = 0.0; self.t0 = _time.time()
        self.leds = [[0, 0, 0] for _ in range(9)]
        self.log = {"frames": [], "servo": [], "pins": [], "fire": [], "events": [], "end": 0.0}
        self.buttons = {}; self.hit = None
        self.events = sorted([list(e) for e in self.cfg.get("events", [])], key=lambda e: e[0])
        self.inputs = {int(k): int(v) for k, v in (self.cfg.get("inputs") or {}).items()}
        self.limit = float(self.cfg.get("limit", 12))
        self.in_handler = 0
    def now(self):
        return self.t if self.test else (_time.time() - self.t0)
    def emit(self, *cmd):
        if not self.test: _sb_js.car(_json.dumps(cmd))
    # --- события ---
    def dispatch(self, e):
        self.log["events"].append([round(self.now(), 3), e[1], e[2] if len(e) > 2 else None])
        self.in_handler += 1
        try:
            if e[1] == "btn":
                f = self.buttons.get(int(e[2]))
                if f: f()
            elif e[1] == "hit":
                if self.hit: self.hit()
        finally:
            self.in_handler -= 1
    def poll_live(self):
        mask = _sb_js.carPoll()
        if not mask: return
        for bit, ev in ((1, ("live", "btn", 1)), (2, ("live", "btn", 2)), (4, ("live", "btn", 3)), (8, ("live", "hit"))):
            if mask & bit: self.dispatch(ev)
    # --- время ---
    def advance(self, s):
        if self.test:
            target = self.t + s
            while self.events and self.events[0][0] <= target:
                e = self.events.pop(0)
                self.t = max(self.t, float(e[0]))
                self.dispatch(e)
            self.t = max(self.t, target)
            self.log["end"] = self.t
            if self.t > self.limit:
                raise _bi._SbSimEnd()
        else:
            end = _time.time() + s
            while True:
                left = end - _time.time()
                if left <= 0: break
                _sb_js.nap(min(left, 0.05) * 1000)
                self.poll_live()
    def forever(self):
        if self.test:
            while self.events:
                e = self.events.pop(0)
                self.t = max(self.t, float(e[0]))
                self.dispatch(e)
                self.log["end"] = self.t
            self.t = max(self.t, min(self.limit, self.t + 0.5))
            self.log["end"] = self.t
            return
        while True:
            _sb_js.nap(50)
            self.poll_live()

_sim = _Sim()

def _check_pin(n, what):
    n = int(n)
    if n not in FREE_PINS:
        if n in (13, 18): raise ValueError("%s: пин %d занят пилотом (мотор/руль) — возьми свободный: 17, 22, 23, 24, 27" % (what, n))
        if n in (10, 25, 12): raise ValueError("%s: пин %d встроенный (лента/ИК) — пользуйся командами strip/fire, свободные пины: 17, 22, 23, 24, 27" % (what, n))
        raise ValueError("%s: такого свободного пина нет, есть 17, 22, 23, 24, 27" % what)
    return n

def strip(i, r, g, b):
    i = int(i)
    if not 0 <= i <= 8: raise IndexError("strip: номер диода 0–8, а получил %d" % i)
    c = [max(0, min(255, int(v))) for v in (r, g, b)]
    _sim.leds[i] = c
def show():
    frame = [list(c) for c in _sim.leds]
    _sim.log["frames"].append([round(_sim.now(), 3), frame])
    _sim.emit("leds", frame)
def wait(sec):
    sec = float(sec)
    if sec < 0: sec = 0
    _sim.advance(sec)
def servo(n, deg):
    n = _check_pin(n, "servo")
    deg = max(0, min(180, float(deg)))
    _sim.log["servo"].append([round(_sim.now(), 3), n, round(deg, 1)])
    _sim.emit("servo", n, deg)
def pin(n, level):
    n = _check_pin(n, "pin")
    v = 1 if level else 0
    _sim.log["pins"].append([round(_sim.now(), 3), n, v])
    _sim.emit("pin", n, v)
def read(n):
    n = _check_pin(n, "read")
    if _sim.test: return int(_sim.inputs.get(n, 0))
    idx = FREE_PINS.index(n)
    return 1 if (_sb_js.carInputs() >> idx) & 1 else 0
def fire():
    _sim.log["fire"].append(round(_sim.now(), 3))
    _sim.emit("fire")
def on_button(n, func):
    n = int(n)
    if n not in (1, 2, 3): raise ValueError("on_button: кнопки пилота — 1, 2 или 3")
    if not callable(func): raise TypeError("on_button: вторым аргументом нужна функция — без скобок: on_button(1, vystrel)")
    _sim.buttons[n] = func
def on_hit(func):
    if not callable(func): raise TypeError("on_hit: нужна функция — без скобок: on_hit(popali)")
    _sim.hit = func
def forever():
    _sim.forever()

def api():
    return {"strip": strip, "show": show, "wait": wait, "servo": servo, "pin": pin, "read": read,
            "fire": fire, "on_button": on_button, "on_hit": on_hit, "forever": forever, "HIGH": HIGH, "LOW": LOW}

def _sb_reset(test, cfg):
    _sim.reset(test, cfg)
def _sb_log():
    _sim.log["end"] = max(_sim.log["end"], _sim.now())
    return _json.dumps(_sim.log)
`;

/* Судья: помощники для разбора журнала + функция check(log, spec) из данных урока */
const JUDGE = `
import json as _json

def classify(rgb):
    r, g, b = rgb
    m = max(r, g, b)
    if m < 20: return "off"
    hi = tuple(int(c / m > 0.55) for c in (r, g, b))
    return {(1,0,0):"red",(0,1,0):"green",(0,0,1):"blue",(1,1,0):"yellow",(1,0,1):"magenta",(0,1,1):"cyan",(1,1,1):"white"}.get(hi, "other")
def all_leds(frame, color): return all(classify(c) == color for c in frame)
def count_leds(frame, color): return sum(1 for c in frame if classify(c) == color)
def lit(frame): return [i for i, c in enumerate(frame) if classify(c) != "off"]
def brightness(frame): return max(max(c) for c in frame) if frame else 0
def frames(log): return log.get("frames", [])
def find(log, pred, after=0.0):
    for t, f in frames(log):
        if t >= after and pred(f): return t
    return None
def held(log, pred, min_s, after=0.0):
    """кадр, удовлетворяющий pred, который держится не меньше min_s (до следующего кадра или до конца)"""
    fr = frames(log)
    for i, (t, f) in enumerate(fr):
        if t < after or not pred(f): continue
        end = fr[i + 1][0] if i + 1 < len(fr) else log.get("end", t)
        # серия одинаковых по pred кадров считается одним состоянием
        j = i + 1
        while j < len(fr) and pred(fr[j][1]):
            end = fr[j + 1][0] if j + 1 < len(fr) else log.get("end", fr[j][0]); j += 1
        if end - t >= min_s - 0.03: return t
    return None
def seq(log, preds, after=0.0):
    """каждый pred встречается после предыдущего; возвращает список времён или None"""
    ts = []; t0 = after
    for p in preds:
        t = find(log, p, t0)
        if t is None: return None
        ts.append(t); t0 = t + 0.001
    return ts
def count(log, pred, after=0.0):
    """сколько раз состояние pred включалось (переходы из не-pred в pred)"""
    n = 0; prev = False
    for t, f in frames(log):
        if t < after: continue
        cur = pred(f)
        if cur and not prev: n += 1
        prev = cur
    return n
def off_all(f): return all_leds(f, "off")
def after_event(log, kind, n=None, idx=0):
    """время события сценария (btn n / hit) по счёту idx"""
    k = 0
    for t, e, arg in log.get("events", []):
        if e == kind and (n is None or arg == n):
            if k == idx: return t
            k += 1
    return None

def _sb_judge(src, log_json, spec_json):
    log = _json.loads(log_json); spec = _json.loads(spec_json or "{}")
    errs = []
    ns = dict(globals()); ns["errs"] = errs
    ns["fail"] = lambda ru, kk=None: errs.append((ru, kk or ru))
    exec(src, ns)
    ns["check"](log, spec)
    return _json.dumps(errs, ensure_ascii=False)
`;

async function init(msg) {
  ctl = new Uint8Array(msg.ctl);
  io = new Int32Array(msg.io);
  ioBytes = new Uint8Array(msg.io);
  if (msg.ev) ev = new Int32Array(msg.ev);
  py = await loadPyodide({ indexURL: msg.indexURL });
  py.setInterruptBuffer(ctl);
  py.setStdout({ write: (b) => onWrite('out', b), isatty: true });
  py.setStderr({ write: (b) => onWrite('err', b), isatty: true });
  // stdin — не «терминал»: тогда подсказка input() идёт в stdout, а не в stderr
  py.setStdin({ stdin: readLine, isatty: false });
  py.registerJsModule('_sb_js', { nap, draw, car, carPoll, carInputs });
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
  // виртуальная машинка и судья уроков
  py.globals.set('_sb_car_src', CAR); py.globals.set('_sb_judge_src', JUDGE);
  py.runPython(
    'import types, sys, builtins\n' +
    'builtins._SbSimEnd = _SbSimEnd\n' +
    '_c = types.ModuleType("_sbcar"); exec(_sb_car_src, _c.__dict__); sys.modules["_sbcar"] = _c\n' +
    '_j = types.ModuleType("_sbjudge"); exec(_sb_judge_src, _j.__dict__); sys.modules["_sbjudge"] = _j\n' +
    'del _sb_car_src, _sb_judge_src\n'
  );
  resetWorkDir({});
  postMessage({ t: 'ready', version: py.version });
}

function run(msg) {
  const t0 = Date.now();
  const test = !!msg.test;
  stdinQueue = Array.isArray(msg.stdin) ? msg.stdin.slice() : null;
  capture = test; segments = []; tCmds = []; cCmds = [];
  ctl[0] = 0;
  if (ev) { Atomics.store(ev, 0, 0); }
  const before = msg.files || {};
  resetWorkDir(before);
  const carMode = !!msg.car;
  py.globals.set('_sb_car_cfg', JSON.stringify(carMode ? (msg.car === true ? {} : msg.car) : {}));
  py.runPython(
    '_sb_quiet_prompt = ' + (test ? 'True' : 'False') + '\n' +
    '_sb_car_mode = ' + (carMode ? 'True' : 'False') + '\n' +
    'import sys, json\n' +
    'sys.modules["turtle"]._sb_reset()\n' +
    'sys.modules["_sbcar"]._sb_reset(' + (test ? 'True' : 'False') + ', json.loads(_sb_car_cfg))\n' +
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
  let carLog = null;
  if (carMode) { try { carLog = JSON.parse(py.runPython('sys.modules["_sbcar"]._sb_log()')); } catch (_) {} }
  postMessage({ t: 'done', ok: !res && !stopped, stopped, error: res, ms: Date.now() - t0,
    files, segments: capture ? segments : null, carLog });
  capture = false; segments = [];
}

/* судья урока с машинкой: check(log, spec) из данных урока над журналом прогона */
function judge(msg) {
  let fails = [], error = null;
  try {
    py.globals.set('_sb_j_src', String(msg.src || ''));
    py.globals.set('_sb_j_log', JSON.stringify(msg.log || {}));
    py.globals.set('_sb_j_spec', JSON.stringify(msg.spec || {}));
    const r = py.runPython('sys.modules["_sbjudge"]._sb_judge(_sb_j_src, _sb_j_log, _sb_j_spec)');
    fails = JSON.parse(r);
  } catch (e) { error = String(e && e.message || e).split('\n').slice(-2).join(' ').slice(0, 300); }
  postMessage({ t: 'judged', id: msg.id, fails, error });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.t === 'init') await init(msg);
    else if (msg.t === 'run') run(msg);
    else if (msg.t === 'judge') judge(msg);
  } catch (err) {
    postMessage({ t: 'fail', msg: String(err && err.message || err) });
  }
};
