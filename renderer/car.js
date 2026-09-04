/* «Бортовой компьютер» — Python-программа ученика, работающая на машинке.
 * Код выполняется НА машинке в песочнице: отдельный процесс без доступа к
 * железу, все команды идут через проверяемый API `car` (см. malinka_new).
 * Здесь — только редактор, кнопки и живая консоль. */
(function () {
  const $ = (id) => document.getElementById(id);

  /* Стартовая заготовка: рабочий пример + весь API в комментариях */
  const STARTER = [
    '# Бортовой компьютер машинки Phygital Machines',
    '# Эта программа выполняется прямо на машинке!',
    '#',
    '# Команды:',
    '#   car.led(r, g, b)   - зажечь ленту цветом (числа 0-255)',
    '#   car.led_off()      - погасить ленту',
    '#   car.beacon(sec)    - включить маячок-флешбенг на sec секунд',
    '#   car.fire()         - выстрел из ИК-пушки',
    '#   car.drop()         - сбросить препятствие',
    '#   car.wait(sec)      - подождать sec секунд',
    '#   car.on_hit(func)   - вызывать func, когда в нас попали',
    '#   car.forever()      - не завершать программу (ждать событий)',
    '',
    'import car',
    '',
    'car.led(0, 255, 0)      # зелёный: бортовой компьютер включён',
    'print("Поехали!")',
    '',
    'def alarm():',
    '    print("В нас попали!")',
    '    car.led(255, 120, 0)    # оранжевая тревога',
    '    car.wait(2)',
    '    car.led(0, 255, 0)',
    '',
    'car.on_hit(alarm)',
    '',
    'car.forever()           # программа живёт, пока не нажмёшь "Остановить"',
    ''
  ].join('\n');

  let cm = null;
  let connected = false;
  let running = false;
  let hasSaved = false;   // на машинке лежит сохранённая программа
  let carId = '';
  let saveTimer = null;

  function consoleEl() { return $('car-console'); }
  function log(text) {
    const el = consoleEl();
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
  }

  /* ── Статус и кнопки ── */
  function setStatus(cls, text) {
    const el = $('car-status');
    el.className = 'car-status ' + cls;
    el.textContent = text;
  }

  function refreshUi() {
    $('btn-car-upload').disabled = !connected;
    $('btn-car-stop').disabled = !connected || !running;
    $('btn-car-clear').disabled = !connected || !hasSaved;
    const btn = $('btn-car-connect');
    btn.querySelector('[data-i18n]').textContent = connected ? t('car.disconnect') : t('car.connect');
    if (!connected) setStatus('off', t('car.off'));
    else if (running) setStatus('busy', (carId ? '№' + carId + ' · ' : '') + t('car.running'));
    else setStatus('on', t('car.on') + (carId ? ' · №' + carId : '') +
                    (hasSaved ? ' · ' + t('car.savedBadge') : ''));
    const badge = $('car-badge');
    badge.className = 'badge ' + (running ? 'busy' : connected ? 'ok' : '');
    badge.textContent = running ? '▶' : '';
  }

  /* ── Редактор ── */
  async function initEditor() {
    const saved = await window.sb.autosaveGet('car');
    cm = CodeMirror($('car-editor'), {
      value: (saved.ok && saved.code) ? saved.code : STARTER,
      mode: 'python',
      lineNumbers: true,
      indentUnit: 4,
      viewportMargin: Infinity,
      theme: document.body.dataset.theme === 'dark' ? 'material-darker' : 'default'
    });
    cm.on('change', () => {
      clearTimeout(saveTimer);
      const code = cm.getValue();
      saveTimer = setTimeout(() => window.sb.autosaveSet('car', code), 1500);
    });
  }

  /* ── Кнопки ── */
  $('btn-car-connect').addEventListener('click', async () => {
    if (connected) {
      await window.sb.carDisconnect();
      return; // состояние придёт событием car-state
    }
    setStatus('busy', t('car.connecting'));
    const r = await window.sb.carConnect();
    if (!r.ok) {
      connected = false;
      refreshUi();
      log('\n' + t('car.errConn') + '\n');
    }
  });

  $('btn-car-upload').addEventListener('click', async () => {
    if (!connected || !cm) return;
    consoleEl().textContent = '';
    await window.sb.carSave(cm.getValue());
  });

  $('btn-car-stop').addEventListener('click', () => window.sb.carStop());

  $('btn-car-clear').addEventListener('click', async () => {
    if (!connected) return;
    if (!confirm(t('car.clearConfirm'))) return;
    await window.sb.carClear();
  });

  $('btn-car-reset').addEventListener('click', () => {
    if (!cm) return;
    if (!confirm(t('msg.resetConfirm'))) return;
    cm.setValue(STARTER);
  });

  /* ── События от машинки ── */
  window.sb.onCarOutput((text) => log(text));
  window.sb.onCarState((st) => {
    if (st.ev === 'hello') {
      carId = String(st.car || '');
      hasSaved = !!st.saved;
      refreshUi();
      return;
    }
    if (st.ev === 'saved') {
      if (st.ok) { hasSaved = true; log(t('car.savedMsg') + '\n'); }
      else log('\n' + String(st.error || 'error') + '\n');
      refreshUi();
      return;
    }
    if (st.ev === 'cleared') {
      hasSaved = false;
      log(t('car.clearedMsg') + '\n');
      refreshUi();
      return;
    }
    if ('connected' in st) {
      const was = connected;
      connected = !!st.connected;
      if (!connected) {
        running = false;
        carId = '';
        if (was) log('\n' + t('car.lost') + '\n');
      }
    }
    if ('running' in st) {
      const was = running;
      running = !!st.running;
      if (was && !running) {
        if (st.error) log('\n' + String(st.error) + '\n');
        log((st.stopped ? t('car.stoppedMsg') : t('car.doneMsg')) + '\n');
      }
    }
    refreshUi();
  });

  /* ── Интеграция с приложением ── */
  window.sbCar = {
    onShow() {
      if (!cm) initEditor().then(() => cm.refresh());
      else setTimeout(() => cm.refresh(), 0);
      refreshUi();
      if (!connected && !consoleEl().textContent) log(t('car.hint') + '\n');
    },
    applyTheme(theme) {
      if (cm) cm.setOption('theme', theme === 'dark' ? 'material-darker' : 'default');
    }
  };
})();
