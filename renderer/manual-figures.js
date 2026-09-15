/* Схемы для вкладки «Инструкция» — рисуются кодом как встроенный SVG.
 *
 * Почему не картинки: SVG масштабируется без мыла, подстраивается под тёмную
 * тему через CSS-переменные, подписи переводятся вместе с интерфейсом, а
 * поправить схему можно прямо в этом файле — не нужен графический редактор.
 *
 * Каждая схема — функция (lang) → <svg>. Регистр: window.MANUAL_FIGS[имя].
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  /* ── кирпичики ── */
  const E = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    return n;
  };
  const F = (w, h) => E('svg', { viewBox: `0 0 ${w} ${h}`, class: 'man-fig-svg', role: 'img' });
  const add = (p, c) => { p.appendChild(c); return c; };

  const box = (s, x, y, w, h, cls = 'fg-box', r = 10) =>
    add(s, E('rect', { x, y, width: w, height: h, rx: r, class: cls }));
  const circ = (s, cx, cy, r, cls) => add(s, E('circle', { cx, cy, r, class: cls }));
  const path = (s, d, cls = 'fg-line') => add(s, E('path', { d, class: cls }));

  /** Текст. Перенос по «\n». anchor: start|middle|end */
  function txt(s, x, y, str, cls = 'fg-t', anchor = 'middle', lh = 16) {
    const t = E('text', { x, y, class: cls, 'text-anchor': anchor });
    String(str).split('\n').forEach((line, i) => {
      const ts = E('tspan', { x, dy: i === 0 ? 0 : lh });
      ts.textContent = line;
      t.appendChild(ts);
    });
    return add(s, t);
  }

  /** Стрелка с наконечником, без <defs> — наконечник считаем сами. */
  function arrow(s, x1, y1, x2, y2, cls = 'fg-line', head = 9) {
    path(s, `M${x1} ${y1} L${x2} ${y2}`, cls);
    const a = Math.atan2(y2 - y1, x2 - x1);
    const p = (ang, len) => `${x2 - len * Math.cos(ang)} ${y2 - len * Math.sin(ang)}`;
    add(s, E('path', { d: `M${x2} ${y2} L${p(a - 0.45, head)} L${p(a + 0.45, head)} Z`, class: 'fg-head' }));
  }
  /** Ломаная стрелка по точкам [[x,y],…] */
  function arrowPath(s, pts, cls = 'fg-line', head = 9) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    path(s, d, cls);
    const [x1, y1] = pts[pts.length - 2], [x2, y2] = pts[pts.length - 1];
    const a = Math.atan2(y2 - y1, x2 - x1);
    const p = (ang, len) => `${x2 - len * Math.cos(ang)} ${y2 - len * Math.sin(ang)}`;
    add(s, E('path', { d: `M${x2} ${y2} L${p(a - 0.45, head)} L${p(a + 0.45, head)} Z`, class: 'fg-head' }));
  }

  /* ── иконки (простые, геометричные) ── */
  function icoCar(s, x, y, w = 120) {
    // корпус, колёса, камера-глаз спереди (слева)
    const h = w * 0.42;
    box(s, x, y, w, h, 'fg-box', h / 2.2);
    circ(s, x + w * 0.22, y + h, w * 0.09, 'fg-wheel');
    circ(s, x + w * 0.78, y + h, w * 0.09, 'fg-wheel');
    circ(s, x + w * 0.16, y + h * 0.5, w * 0.06, 'fg-accent');
    // лента сверху
    for (let i = 0; i < 5; i++) circ(s, x + w * (0.38 + i * 0.1), y + h * 0.28, w * 0.025, 'fg-strip');
  }
  function icoPhone(s, x, y, w = 46) {
    const h = w * 1.9;
    box(s, x, y, w, h, 'fg-box', 7);
    box(s, x + 4, y + 8, w - 8, h - 18, 'fg-box-soft', 3);
    circ(s, x + w / 2, y + h - 6, 2.2, 'fg-muted-fill');
  }
  function icoLaptop(s, x, y, w = 110) {
    const h = w * 0.6;
    box(s, x + w * 0.08, y, w * 0.84, h, 'fg-box', 6);
    box(s, x + w * 0.12, y + 5, w * 0.76, h - 12, 'fg-box-soft', 3);
    box(s, x, y + h, w, 7, 'fg-box', 3);
  }
  function icoBattery(s, x, y, w = 70, h = 30) {
    box(s, x, y, w, h, 'fg-box', 5);
    box(s, x + w, y + h * 0.3, 5, h * 0.4, 'fg-fill-text', 1);
    txt(s, x + w / 2, y + h / 2 + 5, '⚡', 'fg-t');
  }
  function icoChip(s, x, y, w = 70, h = 52) {
    box(s, x, y, w, h, 'fg-box', 6);
    for (let i = 0; i < 5; i++) {
      path(s, `M${x + 10 + i * 12} ${y} v-7`, 'fg-line');
      path(s, `M${x + 10 + i * 12} ${y + h} v7`, 'fg-line');
    }
  }

  /* ═══════════════════ СХЕМЫ ═══════════════════ */
  const FIGS = {};
  const T = (l) => (ru, kk) => (l === 'kk' ? kk : ru);

  /* 1. Три части системы */
  FIGS.system = (l) => {
    const t = T(l), s = F(720, 250);
    // машинка в центре
    icoCar(s, 300, 92, 130);
    txt(s, 365, 190, t('Машинка', 'Көлік'), 'fg-t-b');
    txt(s, 365, 208, t('компьютер внутри', 'ішінде компьютер'), 'fg-t-muted');
    // телефон слева
    icoPhone(s, 80, 70, 52);
    txt(s, 106, 190, t('Телефон пилота', 'Пилот телефоны'), 'fg-t-b');
    txt(s, 106, 208, t('едет, смотрит видео', 'жүргізеді, бейне көреді'), 'fg-t-muted');
    // ноутбук справа
    icoLaptop(s, 545, 90, 120);
    txt(s, 605, 190, t('Компьютер', 'Компьютер'), 'fg-t-b');
    txt(s, 605, 208, t('пишет программу', 'бағдарлама жазады'), 'fg-t-muted');
    // связи
    arrow(s, 140, 100, 296, 118, 'fg-line-dash');
    arrow(s, 296, 128, 140, 112, 'fg-line-dash');
    txt(s, 214, 88, t('Wi-Fi', 'Wi-Fi'), 'fg-t-muted');
    txt(s, 214, 150, t('видео ← → управление', 'бейне ← → басқару'), 'fg-t-muted');
    arrow(s, 540, 122, 434, 122);
    txt(s, 488, 108, t('кабель или Wi-Fi', 'кабель немесе Wi-Fi'), 'fg-t-muted');
    txt(s, 488, 150, t('программа →', 'бағдарлама →'), 'fg-t-muted');
    return s;
  };

  /* 2. Две «комнаты» внутри машинки и судья между ними */
  FIGS.rooms = (l) => {
    const t = T(l), s = F(720, 300);
    box(s, 20, 20, 680, 262, 'fg-box-outer', 16);
    txt(s, 44, 44, t('Внутри машинки', 'Көлік ішінде'), 'fg-t-muted', 'start');

    // комната пилота
    box(s, 44, 62, 230, 96, 'fg-box-red', 12);
    txt(s, 159, 88, t('Комната пилота', 'Пилот бөлмесі'), 'fg-t-b');
    txt(s, 159, 110, t('мотор · руль · камера', 'қозғалтқыш · руль · камера'), 'fg-t');
    txt(s, 159, 130, t('управляет телефон', 'телефон басқарады'), 'fg-t-muted');
    txt(s, 159, 147, t('программе сюда нельзя', 'бағдарламаға бұл жерге болмайды'), 'fg-t-muted');

    // комната ученика
    box(s, 44, 178, 230, 90, 'fg-box-green', 12);
    txt(s, 159, 204, t('Твоя комната', 'Сенің бөлмең'), 'fg-t-b');
    txt(s, 159, 226, t('лента · пушка · ловушки', 'таспа · зеңбірек · тұзақтар'), 'fg-t');
    txt(s, 159, 246, t('здесь работает твоя программа', 'мұнда сенің бағдарламаң жұмыс істейді'), 'fg-t-muted');

    // судья
    box(s, 330, 150, 130, 82, 'fg-box-yellow', 12);
    txt(s, 395, 178, t('Судья', 'Төреші'), 'fg-t-b');
    txt(s, 395, 198, t('проверяет каждую', 'әр пәрменді'), 'fg-t-muted');
    txt(s, 395, 214, t('команду', 'тексереді'), 'fg-t-muted');

    // железо справа
    box(s, 520, 62, 156, 96, 'fg-box-soft', 12);
    txt(s, 598, 90, t('Мотор, руль', 'Қозғалтқыш, руль'), 'fg-t');
    txt(s, 598, 110, t('камера', 'камера'), 'fg-t');
    txt(s, 598, 136, '13 · 18', 'fg-t-muted');
    box(s, 520, 178, 156, 90, 'fg-box-soft', 12);
    txt(s, 598, 206, t('Лента, пушка', 'Таспа, зеңбірек'), 'fg-t');
    txt(s, 598, 226, t('свободные выводы', 'бос шықпалар'), 'fg-t');
    txt(s, 598, 250, '17 · 22 · 23 · 24 · 27', 'fg-t-muted');

    // стрелки
    arrow(s, 274, 110, 516, 110);
    arrow(s, 274, 222, 326, 191);
    arrow(s, 460, 191, 516, 222);
    // замок между твоей комнатой и мотором
    path(s, 'M274 186 C 330 128, 460 128, 516 132', 'fg-line-forbid');
    txt(s, 395, 134, '✗', 'fg-t-bad');
    txt(s, 395, 98, t('прямой доступ', 'тікелей қатынау'), 'fg-t-muted');
    return s;
  };

  /* 3. Питание: две цепи от одного аккумулятора */
  FIGS.power = (l) => {
    const t = T(l), s = F(720, 230);
    icoBattery(s, 40, 96, 90, 40);
    txt(s, 85, 160, t('Аккумулятор', 'Аккумулятор'), 'fg-t-b');

    // силовая цепь (верх) — толстая
    box(s, 260, 30, 150, 54, 'fg-box', 10);
    txt(s, 335, 52, t('Регулятор хода', 'Жүріс реттегіші'), 'fg-t-b');
    txt(s, 335, 72, t('вывод 13', '13-шықпа'), 'fg-t-muted');
    box(s, 520, 30, 150, 54, 'fg-box-soft', 10);
    txt(s, 595, 62, t('Мотор', 'Қозғалтқыш'), 'fg-t-b');
    arrowPath(s, [[135, 108], [200, 108], [200, 57], [256, 57]], 'fg-line-thick');
    arrow(s, 410, 57, 516, 57, 'fg-line-thick');
    txt(s, 200, 22, t('большой ток — напрямую', 'үлкен ток — тікелей'), 'fg-t-muted', 'start');

    // электроника (низ)
    box(s, 260, 138, 150, 54, 'fg-box', 10);
    txt(s, 335, 160, t('Стабилизатор', 'Тұрақтандырғыш'), 'fg-t-b');
    txt(s, 335, 180, t('делает ровные 5 В', 'тегіс 5 В жасайды'), 'fg-t-muted');
    box(s, 520, 120, 150, 90, 'fg-box-soft', 10);
    txt(s, 595, 146, t('Компьютер', 'Компьютер'), 'fg-t-b');
    txt(s, 595, 166, t('серво руля', 'руль сервосы'), 'fg-t');
    txt(s, 595, 184, t('лента, ловушки', 'таспа, тұзақтар'), 'fg-t');
    arrowPath(s, [[135, 124], [200, 124], [200, 165], [256, 165]]);
    arrow(s, 410, 165, 516, 165);
    txt(s, 200, 216, t('электроника — через стабилизатор', 'электроника — тұрақтандырғыш арқылы'), 'fg-t-muted', 'start');
    return s;
  };

  /* 4. Гребёнка 40 выводов с раскраской */
  FIGS.header = (l) => {
    const t = T(l), s = F(720, 330);
    // физический номер → BCM (null — питание/земля/служебные)
    const BCM = { 3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24,
      19: 10, 21: 9, 22: 25, 23: 11, 24: 8, 26: 7, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19, 36: 16,
      37: 26, 38: 20, 40: 21 };
    const ROLE = { 13: 'red', 18: 'red', 10: 'yellow', 25: 'yellow', 12: 'yellow',
      17: 'green', 22: 'green', 23: 'green', 24: 'green', 27: 'green' };
    const NAME = {
      13: t('мотор', 'қозғалтқыш'), 18: t('руль', 'руль'), 10: t('лента', 'таспа'),
      25: t('приём попаданий', 'тию қабылдау'), 12: t('пушка', 'зеңбірек')
    };
    const x0 = 250, y0 = 26, step = 13.6;
    box(s, x0 - 22, y0 - 14, 76, 20 * step + 12, 'fg-box-soft', 6);
    for (let i = 0; i < 40; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const phys = i + 1;
      const cx = x0 + col * 32, cy = y0 + row * step;
      const bcm = BCM[phys];
      const role = bcm !== undefined ? (ROLE[bcm] || 'plain') : 'sys';
      circ(s, cx, cy, 5.2, 'fg-pin fg-pin-' + role);
      // подписи для важных выводов: слева для левого ряда, справа для правого
      if (bcm !== undefined && ROLE[bcm]) {
        const label = 'GPIO' + bcm + (NAME[bcm] ? ' — ' + NAME[bcm] : '');
        if (col === 0) {
          path(s, `M${cx - 9} ${cy} h-22`, 'fg-line-thin');
          txt(s, cx - 34, cy + 4, label, 'fg-t-sm', 'end');
        } else {
          path(s, `M${cx + 9} ${cy} h22`, 'fg-line-thin');
          txt(s, cx + 34, cy + 4, label, 'fg-t-sm', 'start');
        }
      }
    }
    txt(s, x0 + 16, y0 + 20 * step + 12, t('гребёнка на плате, вид сверху', 'тақтадағы тарақ, үстінен қарағанда'), 'fg-t-muted');
    // легенда
    const lg = [
      ['red', t('пилот — трогать нельзя', 'пилот — тиюге болмайды')],
      ['yellow', t('встроено — через команды', 'кіріктірілген — пәрмендер арқылы')],
      ['green', t('свободно — для твоих ловушек', 'бос — сенің тұзақтарыңа')],
      ['sys', t('питание и земля', 'қуат және жер')],
      ['plain', t('прочие выводы', 'басқа шықпалар')]
    ];
    lg.forEach(([k, name], i) => {
      circ(s, 462, 232 + i * 20, 5.2, 'fg-pin fg-legend fg-pin-' + k);
      txt(s, 476, 236 + i * 20, name, 'fg-t-sm', 'start');
    });
    return s;
  };

  /* 5. Кабель — в разъём данных, не питания */
  FIGS.cable = (l) => {
    const t = T(l), s = F(720, 220);
    icoLaptop(s, 40, 60, 130);
    txt(s, 105, 160, t('Компьютер', 'Компьютер'), 'fg-t-b');
    // плата машинки — край с двумя разъёмами
    box(s, 430, 40, 250, 120, 'fg-box', 10);
    txt(s, 555, 66, t('Плата в машинке', 'Көліктегі тақта'), 'fg-t-b');
    box(s, 470, 98, 62, 26, 'fg-box-green', 4);
    txt(s, 501, 115, 'USB', 'fg-t-sm');
    box(s, 578, 98, 62, 26, 'fg-box-red', 4);
    txt(s, 609, 115, 'PWR', 'fg-t-sm');
    txt(s, 501, 146, t('✓ сюда', '✓ мұнда'), 'fg-t-ok');
    txt(s, 609, 146, t('✗ это питание', '✗ бұл қуат'), 'fg-t-bad');
    // кабель
    path(s, 'M175 110 C 260 110, 300 60, 380 60 C 430 60, 440 100, 470 111', 'fg-line-thick');
    txt(s, 300, 46, t('USB-кабель', 'USB-кабель'), 'fg-t-muted');
    txt(s, 360, 196, t('адрес машинки по кабелю: 10.55.0.1', 'кабель арқылы көлік мекенжайы: 10.55.0.1'), 'fg-t-muted');
    return s;
  };

  /* 6. Wi-Fi: телефон просит машинку включить сеть */
  FIGS.wifi = (l) => {
    const t = T(l), s = F(720, 250);
    icoPhone(s, 60, 50, 52);
    txt(s, 86, 172, t('Телефон', 'Телефон'), 'fg-t-b');
    icoCar(s, 300, 84, 130);
    txt(s, 365, 172, t('Машинка', 'Көлік'), 'fg-t-b');
    icoLaptop(s, 545, 62, 120);
    txt(s, 605, 172, t('Компьютер', 'Компьютер'), 'fg-t-b');
    // 1: команда по Bluetooth
    arrow(s, 120, 92, 296, 104, 'fg-line-dash');
    txt(s, 205, 66, t('1. «включи Wi-Fi»', '1. «Wi-Fi қос»'), 'fg-t-sm');
    txt(s, 205, 82, 'Bluetooth', 'fg-t-muted');
    // 2: машинка раздаёт сеть — дуги над ней
    for (let r = 16; r <= 44; r += 14) path(s, `M${365 - r} 78 a${r} ${r} 0 0 1 ${2 * r} 0`, 'fg-line-thin');
    txt(s, 365, 26, t('2. сеть Car_27_WiFi', '2. Car_27_WiFi желісі'), 'fg-t-sm');
    // 3: подключаются
    arrow(s, 540, 108, 434, 108, 'fg-line-dash');
    txt(s, 488, 96, t('3. подключиться', '3. қосылу'), 'fg-t-sm');
    arrow(s, 296, 128, 120, 128, 'fg-line-dash');
    txt(s, 205, 146, t('3. подключиться', '3. қосылу'), 'fg-t-sm');
    txt(s, 360, 222, t('адрес машинки по Wi-Fi: 10.42.0.1', 'Wi-Fi арқылы көлік мекенжайы: 10.42.0.1'), 'fg-t-muted');
    return s;
  };

  /* 7. Как работают strip / show / wait */
  FIGS.stripshow = (l) => {
    const t = T(l), s = F(720, 260);
    const cols = ['#e01b24', '#26a269', '#1565c0'];
    // шаг 1: буфер
    txt(s, 120, 30, 'strip(0, 255, 0, 0)\nstrip(1, 0, 255, 0)\nstrip(2, 0, 0, 255)', 'fg-code', 'middle', 15);
    box(s, 40, 96, 160, 44, 'fg-box-soft', 8);
    for (let i = 0; i < 9; i++) {
      const c = circ(s, 56 + i * 16, 118, 6, 'fg-pin-plain');
      if (i < 3) c.setAttribute('style', 'fill:' + cols[i]);
    }
    txt(s, 120, 162, t('память', 'жад'), 'fg-t-b');
    txt(s, 120, 180, t('лента ещё темная', 'таспа әлі қараңғы'), 'fg-t-muted');
    // шаг 2: show
    arrow(s, 208, 118, 262, 118);
    txt(s, 340, 30, 'show()', 'fg-code');
    box(s, 268, 96, 160, 44, 'fg-box', 8);
    for (let i = 0; i < 9; i++) {
      const c = circ(s, 284 + i * 16, 118, 6, 'fg-pin-plain');
      if (i < 3) c.setAttribute('style', 'fill:' + cols[i]);
    }
    txt(s, 348, 162, t('лента', 'таспа'), 'fg-t-b');
    txt(s, 348, 180, t('горит!', 'жанып тұр!'), 'fg-t-ok');
    // шаг 3: wait и конец
    arrow(s, 436, 118, 490, 118);
    txt(s, 590, 30, 'wait(3)', 'fg-code');
    box(s, 496, 96, 180, 44, 'fg-box-soft', 8);
    txt(s, 586, 123, t('3 секунды горит', '3 секунд жанады'), 'fg-t');
    txt(s, 586, 162, t('потом программа', 'сосын бағдарлама'), 'fg-t-muted');
    txt(s, 586, 180, t('заканчивается —', 'аяқталады —'), 'fg-t-muted');
    txt(s, 586, 198, t('всё гаснет', 'бәрі сөнеді'), 'fg-t-muted');
    txt(s, 360, 240, t('без wait лента погасла бы сразу — программа закончилась бы мгновенно',
      'wait-сыз таспа бірден сөнер еді — бағдарлама лезде аяқталар еді'), 'fg-t-muted');
    return s;
  };

  /* 8. Программа остаётся в машинке */
  FIGS.keep = (l) => {
    const t = T(l), s = F(720, 230);
    icoLaptop(s, 40, 60, 120);
    txt(s, 100, 160, t('Компьютер', 'Компьютер'), 'fg-t-b');
    arrow(s, 172, 100, 262, 100);
    txt(s, 217, 86, t('«Загрузить»', '«Жүктеу»'), 'fg-t-sm');
    icoCar(s, 270, 66, 130);
    box(s, 316, 92, 38, 22, 'fg-box-green', 4);
    txt(s, 335, 107, '.py', 'fg-t-sm');
    txt(s, 335, 160, t('Машинка', 'Көлік'), 'fg-t-b');
    txt(s, 335, 178, t('программа внутри', 'бағдарлама ішінде'), 'fg-t-muted');
    // отключили кабель — едет одна
    path(s, 'M420 100 L470 100', 'fg-line-forbid');
    txt(s, 445, 86, t('кабель долой', 'кабельді ал'), 'fg-t-sm');
    icoCar(s, 500, 66, 130);
    box(s, 546, 92, 38, 22, 'fg-box-green', 4);
    txt(s, 565, 107, '.py', 'fg-t-sm');
    txt(s, 565, 160, t('На гонке', 'Жарыста'), 'fg-t-b');
    txt(s, 565, 178, t('программа стартует сама', 'бағдарлама өзі іске қосылады'), 'fg-t-muted');
    txt(s, 565, 196, t('при каждом включении', 'әр қосылғанда'), 'fg-t-muted');
    return s;
  };

  /* 9. Три кнопки — три слота */
  FIGS.slots = (l) => {
    const t = T(l), s = F(720, 250);
    icoPhone(s, 50, 30, 60);
    // три кнопки на экране
    [0, 1, 2].forEach((i) => {
      box(s, 60, 50 + i * 26, 40, 18, 'fg-box-blue', 4);
      txt(s, 80, 63 + i * 26, String(i + 1), 'fg-t-w');
    });
    txt(s, 80, 165, t('Кнопки пилота', 'Пилот батырмалары'), 'fg-t-b');
    // код
    box(s, 230, 40, 230, 110, 'fg-box-code', 8);
    txt(s, 244, 66, 'on_button(1, zakhvat)\non_button(2, mayak)\non_button(3, tuman)\nforever()', 'fg-code-w', 'start', 22);
    txt(s, 345, 172, t('Твой код решает', 'Сенің кодың шешеді'), 'fg-t-b');
    txt(s, 345, 190, t('какая кнопка что делает', 'қай батырма не істейді'), 'fg-t-muted');
    // ловушки
    const traps = [t('захват', 'ұстағыш'), t('маячок', 'маяк'), t('дымовуха', 'түтін')];
    traps.forEach((name, i) => {
      box(s, 540, 40 + i * 38, 140, 28, 'fg-box-green', 6);
      txt(s, 610, 59 + i * 38, name, 'fg-t');
      arrow(s, 462, 62 + i * 22, 536, 54 + i * 38);
    });
    txt(s, 610, 172, t('Твои ловушки', 'Сенің тұзақтарың'), 'fg-t-b');
    txt(s, 610, 190, t('на свободных выводах', 'бос шықпаларда'), 'fg-t-muted');
    [0, 1, 2].forEach((i) => arrow(s, 106, 59 + i * 26, 226, 66 + i * 22, 'fg-line-dash'));
    txt(s, 360, 232, t('придумал десять ловушек — на гонку берёшь любые три',
      'он тұзақ ойлап таптың — жарысқа кез келген үшеуін аласың'), 'fg-t-muted');
    return s;
  };

  /* 10. Шаги пилота */
  FIGS.pilot = (l) => {
    const t = T(l), s = F(720, 150);
    const steps = [
      [t('Включи', 'Қос'), t('машинку', 'көлікті')],
      [t('Bluetooth', 'Bluetooth'), t('найди Car_27', 'Car_27 тап')],
      [t('Wi-Fi', 'Wi-Fi'), t('Car_27_WiFi', 'Car_27_WiFi')],
      [t('Видео', 'Бейне'), t('включи', 'қос')],
      [t('Поехали!', 'Кеттік!'), t('джойстик', 'джойстик')]
    ];
    steps.forEach(([a, b], i) => {
      const x = 20 + i * 140;
      box(s, x, 30, 120, 80, i === 4 ? 'fg-box-green' : 'fg-box', 12);
      circ(s, x + 22, 52, 12, 'fg-num');
      txt(s, x + 22, 57, String(i + 1), 'fg-t-w');
      txt(s, x + 60, 78, a, 'fg-t-b');
      txt(s, x + 60, 96, b, 'fg-t-muted');
      if (i < 4) arrow(s, x + 122, 70, x + 138, 70);
    });
    return s;
  };

  window.MANUAL_FIGS = FIGS;
})();
