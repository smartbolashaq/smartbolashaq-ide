/* Вкладка «Python»: рабочая панель (редактор + консоль + холст черепашки),
 * код исполняется настоящим CPython (Pyodide) в фоновом потоке — см.
 * py-worker.js. Панель одна, её «пристыковывают» то к песочнице, то к
 * заданию урока (course.js). Отсюда наружу:
 *   window.sbPy = { onShow, applyTheme, run, stop, getCode, setCode,
 *                   dock, setContext, state }
 * run(code, opts):
 *   opts.stdin  — массив готовых ответов на input() (иначе спрашиваем ученика)
 *   opts.test   — режим проверки: тихо, без анимации, файлы не пишутся на диск,
 *                 подсказки input() не печатаются; возвращает segments черепашки
 * Возвращает {ok, stopped, error, output, files, segments, ms}. */
(() => {
  const $ = (id) => document.getElementById(id);
  const tt = (key, vars) => {
    let s; try { s = t(key); } catch (_) { s = key; }
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  };
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');

  const STARTER = {
    ru: [
      '# Привет! Это настоящий Python прямо в IDE.',
      '# Нажми ▶ Запустить (или Ctrl+Enter) и смотри в консоль внизу.',
      '',
      'name = input("Как тебя зовут? ")',
      'print("Привет,", name + "!")',
      '',
      'for i in range(1, 6):',
      '    print(i, "x", i, "=", i * i)',
      ''
    ].join('\n'),
    kk: [
      '# Сәлем! Бұл — IDE ішіндегі нағыз Python.',
      '# ▶ Іске қосу (немесе Ctrl+Enter) бас та, төмендегі консольге қара.',
      '',
      'name = input("Атың кім? ")',
      'print("Сәлем,", name + "!")',
      '',
      'for i in range(1, 6):',
      '    print(i, "x", i, "=", i * i)',
      ''
    ].join('\n')
  };

  const MAX_CONSOLE_CHARS = 400000;   // консоль не растёт бесконечно

  let cm = null;
  let worker = null, ctl = null, io = null, ioBytes = null;
  let state = 'off';        // off | loading | ready | running | input | failed
  let stopping = false, stopTimer = null;
  let current = null;       // { resolve, quiet, test, out: [] }
  let errLine = null, saveTimer = null;
  let pendingRun = null;    // запуск, нажатый до окончания загрузки
  let ctxKey = 'python';    // ключ автосохранения текущего кода (песочница / задание)
  let ctxLoaded = false;

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
  const busy = () => state === 'running' || state === 'input';
  function refreshUi() {
    const run = $('btn-py-run'), stop = $('btn-py-stop');
    if (run) run.disabled = (busy() || state === 'failed');
    if (stop) stop.disabled = !busy();
    if (state === 'loading') setStatus('busy', tt('py.loading'));
    else if (state === 'ready') setStatus('on', tt('py.ready'));
    else if (state === 'running') setStatus('busy', tt('py.running'));
    else if (state === 'input') setStatus('busy', tt('py.waitInput'));
    else if (state === 'failed') setStatus('off', tt('py.failed'));
    else setStatus('off', '');
    const badge = $('py-badge');
    if (badge) { badge.className = 'badge ' + (busy() ? 'busy' : ''); badge.textContent = busy() ? '▶' : ''; }
    document.dispatchEvent(new CustomEvent('sb-py-state', { detail: { state } }));
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
    if (m.t === 'turtle') {
      if ((!current || !current.quiet) && window.sbTurtle) window.sbTurtle.apply(m.cmds);
      return;
    }
    if (m.t === 'input') { state = 'input'; refreshUi(); showInput(); return; }
    if (m.t === 'done') {
      clearTimeout(stopTimer); stopTimer = null;
      hideInput();
      const stopped = m.stopped || stopping;
      stopping = false;
      state = 'ready'; refreshUi();
      const quiet = current && current.quiet;
      if (!quiet) {
        if (stopped) sys(tt('py.stopped'));
        else if (m.error) showError(m.error);
        else sys(m.ms < 1000 ? tt('py.done') : tt('py.doneTime', { s: (m.ms / 1000).toFixed(m.ms < 10000 ? 1 : 0) }));
      }
      // файлы, которые программа создала или изменила, — в папку ученика (кроме режима проверки)
      if (current && !current.test && m.files) syncFilesBack(m.files, quiet);
      finish({ ok: !!m.ok && !stopped, stopped, error: stopped ? null : m.error, ms: m.ms,
        files: m.files || { writes: {}, deletes: [] }, segments: m.segments || null });
    }
  }

  async function syncFilesBack(files, quiet) {
    const names = Object.keys(files.writes || {});
    if (!names.length && !(files.deletes || []).length) return;
    try {
      const r = await window.sb.pyFilesApply(files.writes, files.deletes);
      const toast = (msg, name) => { if (window.sbToast) window.sbToast(msg, { action: () => window.sb.revealProject(name || ''), label: tt('proj.show') }); else sys(msg); };
      if (!quiet && r && r.written && r.written.length) toast('✓ ' + tt('py.filesSaved', { names: r.written.join(', ') }), r.written[0].replace(/\.py$/i, ''));
      if (!quiet && r && r.removed && r.removed.length) toast('🗑 ' + tt('py.filesRemoved', { names: r.removed.join(', ') }));
    } catch (_) {}
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
      const job = {
        code: String(code == null ? '' : code),
        stdin: Array.isArray(opts.stdin) ? opts.stdin.map(String) : null,
        quiet: !!opts.quiet || !!opts.test, test: !!opts.test, resolve
      };
      const fail = (kind) => resolve({ ok: false, stopped: false, error: { kind, msg: kind, line: null }, output: '', files: { writes: {}, deletes: [] }, segments: null });
      if (busy()) return fail('Busy');
      if (state === 'failed') return fail('LoadError');
      if (!worker) boot();
      if (state !== 'ready') { pendingRun = job; return; }
      startRun(job);
    });
  }
  async function startRun(job) {
    current = { resolve: job.resolve, quiet: job.quiet, test: job.test, out: [] };
    clearErrLine();
    if (!job.quiet) { clearConsole(); if (window.sbTurtle) window.sbTurtle.reset(); }
    state = 'running'; stopping = false; refreshUi();
    // файлы из папки ученика — в рабочую папку программы
    let files = {};
    try { const r = await window.sb.pyFilesList(); if (r && r.files) files = r.files; } catch (_) {}
    if (!worker) return;   // пока читали файлы, поток убили
    worker.postMessage({ t: 'run', code: job.code, stdin: job.stdin, files, test: job.test });
  }
  function runEditor() {
    if (!cm || busy()) return;
    run(cm.getValue());
  }
  function stop() {
    if (!busy() || !worker) return;
    stopping = true;
    new Uint8Array(ctl)[0] = 2;                       // KeyboardInterrupt в потоке Python
    const i32 = new Int32Array(io); Atomics.store(i32, 0, 2); Atomics.notify(i32, 0);   // будим input()
    // Если поток не откликнулся (застрял в чём-то без проверки сигналов) — убиваем и грузим заново
    stopTimer = setTimeout(() => {
      if (!busy()) return;
      killWorker(); hideInput();
      sys(tt('py.stopped')); sys(tt('py.restart'));
      finish({ ok: false, stopped: true, error: null, files: { writes: {}, deletes: [] }, segments: null });
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
        : /invalid character/.test(m) ? 'В коде есть символ, которого Python не понимает: русские кавычки «», длинное тире или похожая буква. Кавычки — только прямые " или \'.'
        : /cannot assign|invalid syntax. Maybe you meant '=='/.test(m) ? 'В условии сравнение пишется двумя знаками: ==.'
        : 'Синтаксическая ошибка — проверь скобки, кавычки, двоеточия и отступы в этой строке.',
      IndentationError: () => 'Проблема с отступами. Внутри if / for / while / def каждая строка сдвигается на 4 пробела.',
      TabError: () => 'Смешаны табуляция и пробелы. Используй только пробелы (клавиша Tab в IDE ставит 4 пробела).',
      TypeError: (m) => /can only concatenate str|must be str, not/.test(m) ? 'Нельзя склеить текст и число через «+». Преврати число в текст: str(число), или перечисли через запятую в print.'
        : /unsupported operand|not supported between/.test(m) ? 'Эти значения нельзя сравнить или сложить между собой — проверь типы (текст это или число?). После input() всегда строка — нужен int().'
        : /not subscriptable/.test(m) ? 'К этому значению нельзя обратиться через [ ] — это не список и не строка.'
        : /missing \d+ required positional argument|takes \d+ positional argument/.test(m) ? 'Функция вызвана с неправильным числом аргументов.'
        : /object is not callable/.test(m) ? 'Ты пытаешься вызвать со скобками то, что не является функцией. Может, переменная названа так же, как функция?'
        : /does not support item assignment/.test(m) ? 'Это значение нельзя изменить по индексу — строки и кортежи неизменяемы.'
        : /'NoneType'/.test(m) ? 'Значение None: скорее всего функция ничего не вернула (нет return) или ты написал lst = lst.append(...).'
        : 'Неподходящий тип данных для этой операции.',
      ValueError: (m) => /invalid literal for int\(\)/.test(m) ? 'int() получил не целое число. Проверь, что вводишь цифры без букв и пробелов.'
        : /could not convert string to float/.test(m) ? 'float() получил не число.'
        : /not in list/.test(m) ? 'Такого элемента в списке нет — удалить нечего. Сначала проверь: if x in lst.'
        : 'Значение подходящего типа, но неправильное по смыслу.',
      ZeroDivisionError: () => 'Деление на ноль. Проверь делитель перед делением.',
      IndexError: () => 'Такого номера в списке (или строке) нет. Помни: нумерация с нуля, последний элемент — len(...) - 1.',
      KeyError: () => 'В словаре нет такого ключа. Проверь: if key in d, или используй d.get(key, запасное).',
      AttributeError: () => 'У этого объекта нет такого метода или свойства — проверь написание после точки.',
      RecursionError: () => 'Функция вызывает сама себя без остановки. Нужен случай, когда рекурсия заканчивается.',
      EOFError: () => 'Программа попросила input(), а ввода не было (в проверке ответов оказалось меньше, чем input() в программе).',
      ModuleNotFoundError: (m) => { const w = (m.match(/No module named '([^']+)'/) || [])[1]; return `Модуль «${w || '?'}» здесь недоступен. В базовом курсе хватает встроенных: math, random, time, turtle.`; },
      UnboundLocalError: () => 'Переменная используется внутри функции раньше, чем ей присвоено значение. Может, нужен global?',
      FileNotFoundError: () => 'Файла с таким именем нет в папке ученика. Проверь имя или сначала создай файл в режиме "w".',
      MemoryError: () => 'Закончилась память — программа создала слишком много данных.'
    },
    kk: {
      NameError: (m) => { const w = (m.match(/name '([^']+)'/) || [])[1]; return w ? `«${w}» атауы белгісіз. Қате жазылмағанын және айнымалы жоғарыда жасалғанын тексер.` : 'Мұндай атау жоқ. Қате жазылуын тексер.'; },
      SyntaxError: (m) => /colon|':'/.test(m) ? 'Жол соңында қос нүкте «:» жетпейтін сияқты.'
        : /unterminated|EOL|string literal|never closed/.test(m) ? 'Тырнақша немесе жақша жабылмаған — " " және ( ) жұптарын тексер.'
        : /invalid decimal literal/.test(m) ? 'Айнымалы атауы саннан басталмайды.'
        : /Missing parentheses.*print/.test(m) ? 'Python 3-те print — функция: print("мәтін").'
        : /invalid character/.test(m) ? 'Кодта Python түсінбейтін таңба бар: «» тырнақшалары, ұзын сызықша немесе ұқсас әріп. Тырнақша — тек тік " немесе \'.'
        : /cannot assign|invalid syntax. Maybe you meant '=='/.test(m) ? 'Шартта салыстыру екі таңбамен жазылады: ==.'
        : 'Синтаксис қатесі — осы жолда жақшаларды, тырнақшаларды, қос нүктелерді және шегіністерді тексер.',
      IndentationError: () => 'Шегініс мәселесі. if / for / while / def ішіндегі әр жол 4 бос орынға жылжиды.',
      TabError: () => 'Табуляция мен бос орындар араласқан. Тек бос орын қолдан (IDE-де Tab пернесі 4 бос орын қояды).',
      TypeError: (m) => /can only concatenate str|must be str, not/.test(m) ? 'Мәтін мен санды «+» арқылы қосуға болмайды. Санды мәтінге айналдыр: str(сан), немесе print ішінде үтірмен бөліп жаз.'
        : /unsupported operand|not supported between/.test(m) ? 'Бұл мәндерді өзара салыстыруға/қосуға болмайды — түрлерін тексер (мәтін бе, сан ба?). input() әрқашан жол қайтарады — int() керек.'
        : /not subscriptable/.test(m) ? 'Бұл мәнге [ ] арқылы қол жеткізуге болмайды — ол тізім де, жол да емес.'
        : /missing \d+ required positional argument|takes \d+ positional argument/.test(m) ? 'Функция аргументтерінің саны дұрыс емес.'
        : /object is not callable/.test(m) ? 'Функция емес нәрсені жақшамен шақырып тұрсың. Айнымалы функциямен бірдей аталған шығар?'
        : /does not support item assignment/.test(m) ? 'Бұл мәнді индекс бойынша өзгертуге болмайды — жолдар мен кортеждер өзгермейді.'
        : /'NoneType'/.test(m) ? 'None мәні: функция ештеңе қайтармаған (return жоқ) немесе lst = lst.append(...) деп жазылған шығар.'
        : 'Бұл амал үшін деректер түрі сәйкес емес.',
      ValueError: (m) => /invalid literal for int\(\)/.test(m) ? 'int() бүтін сан алған жоқ. Әріпсіз және бос орынсыз цифр енгізетініңді тексер.'
        : /could not convert string to float/.test(m) ? 'float() сан алған жоқ.'
        : /not in list/.test(m) ? 'Тізімде мұндай элемент жоқ — өшіретін ештеңе жоқ. Алдымен тексер: if x in lst.'
        : 'Мәннің түрі дұрыс, бірақ мағынасы қате.',
      ZeroDivisionError: () => 'Нөлге бөлу. Бөлер алдында бөлгішті тексер.',
      IndexError: () => 'Тізімде (немесе жолда) мұндай нөмір жоқ. Есіңде болсын: нөмірлеу нөлден басталады, соңғы элемент — len(...) - 1.',
      KeyError: () => 'Сөздікте мұндай кілт жоқ. Тексер: if key in d, немесе d.get(key, қосалқы) қолдан.',
      AttributeError: () => 'Бұл нысанда мұндай әдіс немесе қасиет жоқ — нүктеден кейінгі жазылуын тексер.',
      RecursionError: () => 'Функция өзін-өзі тоқтаусыз шақырып тұр. Рекурсия аяқталатын жағдай керек.',
      EOFError: () => 'Бағдарлама input() сұрады, бірақ енгізу болмады (тексеруде жауап саны бағдарламадағы input() санынан аз).',
      ModuleNotFoundError: (m) => { const w = (m.match(/No module named '([^']+)'/) || [])[1]; return `«${w || '?'}» модулі мұнда қолжетімсіз. Базалық курста кіріктірілгендері жеткілікті: math, random, time, turtle.`; },
      UnboundLocalError: () => 'Айнымалы функция ішінде мән берілмей тұрып қолданылған. Мүмкін global керек шығар?',
      FileNotFoundError: () => 'Оқушы қалтасында мұндай атаумен файл жоқ. Атауын тексер немесе алдымен файлды "w" режимінде жаса.',
      MemoryError: () => 'Жад таусылды — бағдарлама тым көп дерек жасады.'
    }
  };

  function hintFor(err) {
    const h = (HINTS[L()] || HINTS.ru)[err.kind];
    return h ? h(err.msg || '') : '';
  }
  function showError(err) {
    const where = err.line ? tt('py.errAt', { n: err.line }) + ': ' : '';
    put('\n⛔ ' + where + err.kind + (err.msg ? ': ' + err.msg : '') + '\n', 'c-err');
    const h = hintFor(err);
    if (h) put('   💡 ' + h + '\n', 'c-warn');
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

  /* ───────── «Мои программы» — общая панель проектов (projects.js) ───────── */
  const proj = window.sbProjects.create({
    prefix: 'pyproj', panelId: 'py-work-panel', lastKey: 'lastPyProject',
    getCode: () => (cm ? cm.getValue() : ''),
    setCode: (code) => { if (cm) { cm.setValue(code); cm.clearHistory(); } },
    focus: () => { if (cm) cm.focus(); },
    starter: () => STARTER[L()] || STARTER.ru
  });
  function showProjbar(v) { const b = $('py-projbar'); if (b) b.classList.toggle('hidden', !v); proj.setEnabled(v); }

  /* ───────── редактор и контексты (песочница / задание) ───────── */
  function initEditor() {
    if (cm) return;
    cm = CodeMirror($('py-editor'), {
      value: '',
      mode: 'python', lineNumbers: true, indentUnit: 4,
      theme: document.body.dataset.theme === 'dark' ? 'material-darker' : 'default',
      extraKeys: {
        'Ctrl-Enter': () => runEditor(),
        'Cmd-Enter': () => runEditor(),
        Esc: () => { if (busy()) stop(); },
        Tab: (c) => c.replaceSelection('    ', 'end'),
        'Shift-Tab': 'indentLess'
      }
    });
    cm.on('change', () => {
      clearErrLine();
      if (!ctxLoaded) return;
      if (ctxKey === 'python') proj.markDirty();
      clearTimeout(saveTimer);
      const key = ctxKey, code = cm.getValue();
      saveTimer = setTimeout(() => { try { window.sb.autosaveSet(key, code); } catch (_) {} }, 800);
    });
  }
  /* Переключить панель на другой код: key — ключ автосохранения,
   * initial — что показать, если ученик ещё ничего не писал. */
  async function setContext(key, initial) {
    initEditor();
    if (ctxLoaded && ctxKey) {     // текущий код — сразу на диск, не дожидаясь таймера
      clearTimeout(saveTimer);
      try { await window.sb.autosaveSet(ctxKey, cm.getValue()); } catch (_) {}
    }
    ctxLoaded = false; ctxKey = key;
    let draft = null;
    try { const s = await window.sb.autosaveGet(key); if (s && s.ok && typeof s.code === 'string') draft = s.code; } catch (_) {}
    // пустой черновик — как отсутствующий: ученик всё стёр, покажем заготовку заново
    if (draft !== null && !draft.trim()) draft = null;
    if (key === 'python') {
      // песочница: «Мои программы» решают, что показать (файл или черновик)
      showProjbar(true);
      cm.setValue(await proj.init(draft));
    } else {
      showProjbar(false);
      cm.setValue(draft === null ? (initial == null ? STARTER[L()] || STARTER.ru : initial) : draft);
    }
    cm.clearHistory();
    ctxLoaded = true;
    clearConsole(); clearErrLine();
    if (window.sbTurtle) window.sbTurtle.reset();
    setTimeout(() => cm.refresh(), 0);
  }
  /* Перенести рабочую панель в другой контейнер (песочница ↔ задание). */
  function dock(container, mode) {
    const p = $('py-work-panel');
    if (!p || !container) return;
    p.classList.toggle('py-docked', mode === 'task');
    if (p.parentElement !== container) container.appendChild(p);
    if (cm) setTimeout(() => cm.refresh(), 0);
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
  // Esc останавливает программу, даже если курсор не в редакторе
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && busy()) {
      const p = $('py-work-panel');
      if (p && p.isConnected && !p.closest('.hidden')) { e.preventDefault(); stop(); }
    }
  });

  window.sbPy = {
    onShow() { initEditor(); boot(); if (cm) setTimeout(() => cm.refresh(), 0); refreshUi(); },
    applyTheme(theme) { if (cm) cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default'); },
    run, stop, dock, setContext, hintFor,
    getCode() { return cm ? cm.getValue() : ''; },
    setCode(code) { if (cm) { cm.setValue(code); cm.clearHistory(); } },
    ctxKey() { return ctxKey; },
    ctxLoaded() { return ctxLoaded; },
    busy,
    state() { return state; }
  };
})();
