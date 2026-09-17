/* Вкладка «Python»: редактор + консоль, код исполняется настоящим CPython
 * (Pyodide) в фоновом потоке — см. py-worker.js. Отсюда наружу:
 *   window.sbPy = { onShow, applyTheme, run(code, opts), stop, getCode, setCode }
 * run() с opts.stdin = ['5', '7'] исполняет код с готовыми ответами на input()
 * и возвращает {ok, output, error} — это основа для автопроверки уроков. */
(() => {
  const $ = (id) => document.getElementById(id);
  const tt = (key, vars) => {
    let s; try { s = t(key); } catch (_) { s = key; }
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  };
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');

  const STARTER = [
    '# Привет! Это настоящий Python прямо в IDE.',
    '# Нажми ▶ Запустить (или Ctrl+Enter) и смотри в консоль внизу.',
    '',
    'name = input("Как тебя зовут? ")',
    'print("Привет,", name + "!")',
    '',
    'for i in range(1, 6):',
    '    print(i, "x", i, "=", i * i)',
    ''
  ].join('\n');

  const MAX_CONSOLE_CHARS = 400000;   // консоль не растёт бесконечно

  let cm = null;
  let worker = null, ctl = null, io = null, ioBytes = null;
  let state = 'off';        // off | loading | ready | running | input | failed
  let stopping = false, stopTimer = null;
  let current = null;       // { resolve, quiet, out: [], stdinMode }
  let errLine = null, saveTimer = null;
  let pendingRun = null;    // запуск, нажатый до окончания загрузки

  /* ───────── консоль ───────── */
  const con = () => $('py-console');
  function put(text, cls) {
    const el = con(); if (!el) return;
    const s = document.createElement('span');
    s.className = cls || 'c-print'; s.textContent = text;
    el.appendChild(s);
    // подрезаем самое старое, если консоль разрослась
    while (el.textContent.length > MAX_CONSOLE_CHARS && el.firstChild) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  const sys = (text) => put('\n' + text + '\n', 'c-sys');
  function clearConsole() { const el = con(); if (el) el.textContent = ''; hideInput(); }

  /* ───────── статус и кнопки ───────── */
  function setStatus(cls, text) { const el = $('py-status'); if (!el) return; el.className = 'car-status ' + cls; el.textContent = text; }
  function refreshUi() {
    const run = $('btn-py-run'), stop = $('btn-py-stop');
    if (run) run.disabled = (state === 'running' || state === 'input' || state === 'failed');
    if (stop) stop.disabled = !(state === 'running' || state === 'input');
    if (state === 'loading') setStatus('busy', tt('py.loading'));
    else if (state === 'ready') setStatus('on', tt('py.ready'));
    else if (state === 'running') setStatus('busy', tt('py.running'));
    else if (state === 'input') setStatus('busy', tt('py.waitInput'));
    else if (state === 'failed') setStatus('off', tt('py.failed'));
    else setStatus('off', '');
    const badge = $('py-badge');
    if (badge) { badge.className = 'badge ' + (state === 'running' || state === 'input' ? 'busy' : ''); badge.textContent = (state === 'running' || state === 'input') ? '▶' : ''; }
  }

  /* ───────── поток с Python ───────── */
  function boot() {
    if (worker || state === 'loading') return;
    state = 'loading'; refreshUi();
    try {
      ctl = new SharedArrayBuffer(1);
      io = new SharedArrayBuffer(8 + 65536);
      ioBytes = new Uint8Array(io);
    } catch (e) {
      state = 'failed'; refreshUi();
      sys(tt('py.errLoad', { e: 'SharedArrayBuffer: ' + e.message }));
      return;
    }
    worker = new Worker('py-worker.js', { type: 'module' });
    worker.onmessage = onMessage;
    worker.onerror = (e) => {
      state = 'failed'; refreshUi();
      sys(tt('py.errLoad', { e: e.message || 'worker error' }));
      finish({ ok: false, stopped: false, error: { kind: 'WorkerError', msg: e.message || '', line: null } });
    };
    worker.postMessage({
      t: 'init',
      indexURL: new URL('../node_modules/pyodide/', location.href).href,
      ctl, io
    });
  }

  function killWorker() {
    if (worker) { try { worker.terminate(); } catch (_) {} }
    worker = null; state = 'off';
  }

  function onMessage(e) {
    const m = e.data;
    if (m.t === 'ready') {
      state = 'ready'; refreshUi();
      if (pendingRun) { const p = pendingRun; pendingRun = null; startRun(p); }
      return;
    }
    if (m.t === 'fail') {
      state = 'failed'; refreshUi();
      sys(tt('py.errLoad', { e: m.msg }));
      finish({ ok: false, stopped: false, error: { kind: 'LoadError', msg: m.msg, line: null } });
      return;
    }
    if (m.t === 'out' || m.t === 'err') {
      if (current) current.out.push(m.s);
      if (!current || !current.quiet) put(m.s, m.t === 'err' ? 'c-warn' : 'c-print');
      return;
    }
    if (m.t === 'input') { state = 'input'; refreshUi(); showInput(); return; }
    if (m.t === 'done') {
      clearTimeout(stopTimer); stopTimer = null;
      hideInput();
      const stopped = m.stopped || stopping;
      stopping = false;
      state = 'ready'; refreshUi();
      if (!current || !current.quiet) {
        if (stopped) sys(tt('py.stopped'));
        else if (m.error) showError(m.error);
        else sys(m.ms < 1000 ? tt('py.done') : tt('py.doneTime', { s: (m.ms / 1000).toFixed(m.ms < 10000 ? 1 : 0) }));
      }
      finish({ ok: !!m.ok && !stopped, stopped, error: stopped ? null : m.error, ms: m.ms });
    }
  }

  function finish(result) {
    if (!current) return;
    const c = current; current = null;
    result.output = c.out.join('');
    c.resolve(result);
  }

  /* ───────── ввод для input() ───────── */
  function showInput() {
    const row = $('py-input-row'), inp = $('py-input');
    if (!row || !inp) return;
    row.classList.remove('hidden'); inp.value = ''; inp.focus();
    const el = con(); if (el) el.scrollTop = el.scrollHeight;
  }
  function hideInput() { const row = $('py-input-row'); if (row) row.classList.add('hidden'); }
  function submitInput() {
    if (state !== 'input' || !io) return;
    const inp = $('py-input'); const text = inp ? inp.value : '';
    const bytes = new TextEncoder().encode(text).slice(0, 65536);
    ioBytes.set(bytes, 8);
    const i32 = new Int32Array(io);
    Atomics.store(i32, 1, bytes.length);
    Atomics.store(i32, 0, 1);
    Atomics.notify(i32, 0);
    put(text + '\n', 'c-in');
    hideInput();
    state = 'running'; refreshUi();
  }

  /* ───────── запуск / стоп ───────── */
  function run(code, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const job = { code: String(code == null ? '' : code), stdin: Array.isArray(opts.stdin) ? opts.stdin.map(String) : null, quiet: !!opts.quiet, resolve };
      if (state === 'running' || state === 'input') { resolve({ ok: false, stopped: false, error: { kind: 'Busy', msg: 'busy', line: null }, output: '' }); return; }
      if (state === 'failed') { resolve({ ok: false, stopped: false, error: { kind: 'LoadError', msg: 'python not loaded', line: null }, output: '' }); return; }
      if (!worker) boot();
      if (state !== 'ready') { pendingRun = job; return; }
      startRun(job);
    });
  }
  function startRun(job) {
    current = { resolve: job.resolve, quiet: job.quiet, out: [] };
    clearErrLine();
    if (!job.quiet) { clearConsole(); }
    state = 'running'; stopping = false; refreshUi();
    worker.postMessage({ t: 'run', code: job.code, stdin: job.stdin });
  }
  function runEditor() {
    if (!cm) return;
    run(cm.getValue());
  }
  function stop() {
    if (!(state === 'running' || state === 'input') || !worker) return;
    stopping = true;
    new Uint8Array(ctl)[0] = 2;                       // KeyboardInterrupt в потоке Python
    const i32 = new Int32Array(io); Atomics.store(i32, 0, 2); Atomics.notify(i32, 0);   // будим input()
    // Если поток не откликнулся (застрял в чём-то без проверки сигналов) — убиваем и грузим заново
    stopTimer = setTimeout(() => {
      if (!(state === 'running' || state === 'input')) return;
      killWorker(); hideInput();
      sys(tt('py.stopped')); sys(tt('py.restart'));
      finish({ ok: false, stopped: true, error: null });
      stopping = false;
      boot();
    }, 1500);
  }

  /* ───────── ошибки по-человечески ───────── */
  const HINTS = {
    ru: {
      NameError: (m) => { const w = (m.match(/name '([^']+)'/) || [])[1]; return w ? `Имя «${w}» неизвестно. Проверь, нет ли опечатки, и что переменная создана выше по коду.` : 'Такого имени нет. Проверь опечатки.'; },
      SyntaxError: (m) => /colon|':'/.test(m) ? 'Похоже, в конце строки не хватает двоеточия «:».'
        : /unterminated|EOL|string literal|never closed/.test(m) ? 'Не закрыта кавычка или скобка — проверь пары " " и ( ).'
        : /invalid decimal literal/.test(m) ? 'Имя переменной не может начинаться с цифры.'
        : /Missing parentheses.*print/.test(m) ? 'В Python 3 print — функция: print("текст").'
        : 'Синтаксическая ошибка — проверь скобки, кавычки, двоеточия и отступы в этой строке.',
      IndentationError: () => 'Проблема с отступами. Внутри if / for / while / def каждая строка сдвигается на 4 пробела.',
      TabError: () => 'Смешаны табуляция и пробелы. Используй только пробелы (клавиша Tab в IDE ставит 4 пробела).',
      TypeError: (m) => /can only concatenate str|must be str, not/.test(m) ? 'Нельзя склеить текст и число через «+». Преврати число в текст: str(число), или перечисли через запятую в print.'
        : /unsupported operand/.test(m) ? 'Эти значения нельзя сложить/умножить между собой — проверь типы (текст это или число?).'
        : /not subscriptable/.test(m) ? 'К этому значению нельзя обратиться через [ ] — это не список и не строка.'
        : /missing \d+ required positional argument|takes \d+ positional argument/.test(m) ? 'Функция вызвана с неправильным числом аргументов.'
        : /object is not callable/.test(m) ? 'Ты пытаешься вызвать со скобками то, что не является функцией. Может, переменная названа так же, как функция?'
        : 'Неподходящий тип данных для этой операции.',
      ValueError: (m) => /invalid literal for int\(\)/.test(m) ? 'int() получил не целое число. Проверь, что вводишь цифры без букв и пробелов.'
        : /could not convert string to float/.test(m) ? 'float() получил не число.'
        : 'Значение подходящего типа, но неправильное по смыслу.',
      ZeroDivisionError: () => 'Деление на ноль. Проверь делитель перед делением.',
      IndexError: () => 'Такого номера в списке нет. Помни: нумерация с нуля, последний элемент — len(список) - 1.',
      KeyError: () => 'В словаре нет такого ключа.',
      AttributeError: () => 'У этого объекта нет такого метода или свойства — проверь написание после точки.',
      RecursionError: () => 'Функция вызывает сама себя без остановки. Нужен случай, когда рекурсия заканчивается.',
      EOFError: () => 'Программа попросила input(), а ввода не было.',
      ModuleNotFoundError: (m) => { const w = (m.match(/No module named '([^']+)'/) || [])[1]; return `Модуль «${w || '?'}» здесь недоступен. В базовом курсе хватает встроенных: math, random, time.`; },
      UnboundLocalError: () => 'Переменная используется внутри функции раньше, чем ей присвоено значение. Может, нужен global?',
      MemoryError: () => 'Закончилась память — программа создала слишком много данных.'
    },
    kk: {
      NameError: (m) => { const w = (m.match(/name '([^']+)'/) || [])[1]; return w ? `«${w}» атауы белгісіз. Қате жазылмағанын және айнымалы жоғарыда жасалғанын тексер.` : 'Мұндай атау жоқ. Қате жазылуын тексер.'; },
      SyntaxError: (m) => /colon|':'/.test(m) ? 'Жол соңында қос нүкте «:» жетпейтін сияқты.'
        : /unterminated|EOL|string literal|never closed/.test(m) ? 'Тырнақша немесе жақша жабылмаған — " " және ( ) жұптарын тексер.'
        : /invalid decimal literal/.test(m) ? 'Айнымалы атауы саннан басталмайды.'
        : /Missing parentheses.*print/.test(m) ? 'Python 3-те print — функция: print("мәтін").'
        : 'Синтаксис қатесі — осы жолда жақшаларды, тырнақшаларды, қос нүктелерді және шегіністерді тексер.',
      IndentationError: () => 'Шегініс мәселесі. if / for / while / def ішіндегі әр жол 4 бос орынға жылжиды.',
      TabError: () => 'Табуляция мен бос орындар араласқан. Тек бос орын қолдан (IDE-де Tab пернесі 4 бос орын қояды).',
      TypeError: (m) => /can only concatenate str|must be str, not/.test(m) ? 'Мәтін мен санды «+» арқылы қосуға болмайды. Санды мәтінге айналдыр: str(сан), немесе print ішінде үтірмен бөліп жаз.'
        : /unsupported operand/.test(m) ? 'Бұл мәндерді өзара қосуға/көбейтуге болмайды — түрлерін тексер (мәтін бе, сан ба?).'
        : /not subscriptable/.test(m) ? 'Бұл мәнге [ ] арқылы қол жеткізуге болмайды — ол тізім де, жол да емес.'
        : /missing \d+ required positional argument|takes \d+ positional argument/.test(m) ? 'Функция аргументтерінің саны дұрыс емес.'
        : /object is not callable/.test(m) ? 'Функция емес нәрсені жақшамен шақырып тұрсың. Айнымалы функциямен бірдей аталған шығар?'
        : 'Бұл амал үшін деректер түрі сәйкес емес.',
      ValueError: (m) => /invalid literal for int\(\)/.test(m) ? 'int() бүтін сан алған жоқ. Әріпсіз және бос орынсыз цифр енгізетініңді тексер.'
        : /could not convert string to float/.test(m) ? 'float() сан алған жоқ.'
        : 'Мәннің түрі дұрыс, бірақ мағынасы қате.',
      ZeroDivisionError: () => 'Нөлге бөлу. Бөлер алдында бөлгішті тексер.',
      IndexError: () => 'Тізімде мұндай нөмір жоқ. Есіңде болсын: нөмірлеу нөлден басталады, соңғы элемент — len(тізім) - 1.',
      KeyError: () => 'Сөздікте мұндай кілт жоқ.',
      AttributeError: () => 'Бұл нысанда мұндай әдіс немесе қасиет жоқ — нүктеден кейінгі жазылуын тексер.',
      RecursionError: () => 'Функция өзін-өзі тоқтаусыз шақырып тұр. Рекурсия аяқталатын жағдай керек.',
      EOFError: () => 'Бағдарлама input() сұрады, бірақ енгізу болмады.',
      ModuleNotFoundError: (m) => { const w = (m.match(/No module named '([^']+)'/) || [])[1]; return `«${w || '?'}» модулі мұнда қолжетімсіз. Базалық курста кіріктірілгендері жеткілікті: math, random, time.`; },
      UnboundLocalError: () => 'Айнымалы функция ішінде мән берілмей тұрып қолданылған. Мүмкін global керек шығар?',
      MemoryError: () => 'Жад таусылды — бағдарлама тым көп дерек жасады.'
    }
  };

  function showError(err) {
    const where = err.line ? tt('py.errAt', { n: err.line }) + ': ' : '';
    put('\n⛔ ' + where + err.kind + (err.msg ? ': ' + err.msg : '') + '\n', 'c-err');
    const h = (HINTS[L()] || HINTS.ru)[err.kind];
    if (h) put('   💡 ' + h(err.msg || '') + '\n', 'c-warn');
    if (err.line && cm) {
      errLine = err.line - 1;
      cm.addLineClass(errLine, 'background', 'py-errline');
      cm.scrollIntoView({ line: errLine, ch: 0 }, 60);
    }
  }
  function clearErrLine() {
    if (cm && errLine !== null) cm.removeLineClass(errLine, 'background', 'py-errline');
    errLine = null;
  }

  /* ───────── редактор ───────── */
  async function initEditor() {
    if (cm) return;
    let draft = null;
    try { const s = await window.sb.autosaveGet('python'); if (s && s.ok && typeof s.code === 'string') draft = s.code; } catch (_) {}
    cm = CodeMirror($('py-editor'), {
      value: draft === null ? STARTER : draft,
      mode: 'python', lineNumbers: true, indentUnit: 4,
      theme: document.body.dataset.theme === 'dark' ? 'material-darker' : 'default',
      extraKeys: {
        'Ctrl-Enter': () => runEditor(),
        'Cmd-Enter': () => runEditor(),
        Tab: (c) => c.replaceSelection('    ', 'end'),
        'Shift-Tab': 'indentLess'
      }
    });
    cm.on('change', () => {
      clearErrLine();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { try { window.sb.autosaveSet('python', cm.getValue()); } catch (_) {} }, 1200);
    });
    setTimeout(() => cm.refresh(), 0);
  }

  /* ───────── ползунок высоты консоли ───────── */
  function initResizer() {
    const rez = $('py-console-resizer'), wrap = $('py-console-wrap');
    if (!rez || !wrap || rez._wired) return; rez._wired = true;
    rez.addEventListener('mousedown', (e) => {
      const startY = e.clientY, startH = wrap.getBoundingClientRect().height;
      const move = (ev) => { let h = startH + (startY - ev.clientY); h = Math.max(90, Math.min(h, window.innerHeight * 0.7)); wrap.style.height = h + 'px'; if (cm) cm.refresh(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); e.preventDefault();
    });
  }

  /* ───────── кнопки ───────── */
  function wire(id, fn) { const b = $(id); if (b) b.addEventListener('click', fn); }
  wire('btn-py-run', runEditor);
  wire('btn-py-stop', stop);
  wire('btn-py-clear', clearConsole);
  wire('btn-py-send', submitInput);
  const inp = $('py-input');
  if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitInput(); } });
  initResizer();

  document.addEventListener('sb-lang-changed', () => { refreshUi(); });

  window.sbPy = {
    onShow() { initEditor(); boot(); if (cm) setTimeout(() => cm.refresh(), 0); refreshUi(); },
    applyTheme(theme) { if (cm) cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default'); },
    run, stop,
    getCode() { return cm ? cm.getValue() : ''; },
    setCode(code) { if (cm) cm.setValue(code); },
    state() { return state; }
  };
})();
