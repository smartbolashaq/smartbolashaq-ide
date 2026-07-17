/* Локализация: русский и казахский */
const I18N = {
  ru: {
    'tab.compiler': 'Компилятор',
    'tab.materials': 'Материалы',
    'tab.settings': 'Настройки',
    'btn.verify': 'Проверить',
    'btn.upload': 'Загрузить на плату',
    'btn.reset': 'Сбросить код',
    'btn.refresh': 'Обновить',
    'btn.back': 'Назад',
    'btn.external': 'Открыть отдельно',
    'btn.save': 'Сохранить',
    'lbl.board': 'Плата:',
    'lbl.port': 'Порт:',
    'lbl.output': 'Вывод',
    'mat.title': 'Методические материалы',
    'set.title': 'Настройки',
    'set.url': 'Адрес облачной папки с материалами:',
    'set.urlHint': 'Укажите ссылку на папку GitHub-репозитория, где лежат manifest.json и PDF-файлы. Подробности — в документе «Инструкция по GitHub».',
    'set.saved': 'Сохранено ✓',
    'setup.title': 'Подготовка компонентов Arduino…',
    'setup.hint': 'Это выполняется один раз при первом запуске.',
    'status.compiling': 'Компиляция…',
    'status.uploading': 'Загрузка…',
    'status.ok': 'Готово ✓',
    'status.error': 'Ошибка',
    'msg.compileOk': '✓ Компиляция завершена успешно. Ошибок нет.',
    'msg.compileErr': '✗ Ошибка компиляции. Проверьте код.',
    'msg.uploadOk': '✓ Программа успешно загружена на плату!',
    'msg.uploadErr': '✗ Не удалось загрузить программу на плату.',
    'msg.noPort': 'Плата не найдена. Подключите Arduino по USB и нажмите ⟳.',
    'msg.portsNone': '— плата не найдена —',
    'msg.resetConfirm': 'Вернуть код к исходному шаблону? Ваши изменения будут удалены.',
    'msg.lockedHint': 'Эту строку изменить нельзя — она является обязательной частью проекта.',
    'mat.noUrl': 'Облачная папка не настроена. Откройте «Настройки» и укажите адрес папки с материалами.',
    'mat.offline': 'Нет подключения к интернету. Показаны ранее скачанные материалы.',
    'mat.empty': 'Материалы пока не добавлены.',
    'mat.cached': '✓ скачано, доступно офлайн',
    'mat.cloud': 'в облаке — откроется при нажатии',
    'mat.downloadErr': 'Не удалось скачать файл. Проверьте интернет.',
    'setup.copy': 'Копирование встроенных компонентов…',
    'setup.download': 'Скачивание компонентов из интернета…',
    'setup.error': 'Не удалось подготовить компоненты Arduino. Проверьте интернет и перезапустите программу.'
  },
  kk: {
    'tab.compiler': 'Компилятор',
    'tab.materials': 'Материалдар',
    'tab.settings': 'Баптаулар',
    'btn.verify': 'Тексеру',
    'btn.upload': 'Платаға жүктеу',
    'btn.reset': 'Кодты бастапқы қалпына келтіру',
    'btn.refresh': 'Жаңарту',
    'btn.back': 'Артқа',
    'btn.external': 'Бөлек ашу',
    'btn.save': 'Сақтау',
    'lbl.board': 'Плата:',
    'lbl.port': 'Порт:',
    'lbl.output': 'Нәтиже',
    'mat.title': 'Әдістемелік материалдар',
    'set.title': 'Баптаулар',
    'set.url': 'Материалдар сақталған бұлттық қалта мекенжайы:',
    'set.urlHint': 'manifest.json және PDF файлдары орналасқан GitHub-репозиторий қалтасының сілтемесін көрсетіңіз. Толығырақ — «GitHub нұсқаулығы» құжатында.',
    'set.saved': 'Сақталды ✓',
    'setup.title': 'Arduino компоненттері дайындалуда…',
    'setup.hint': 'Бұл алғашқы іске қосу кезінде бір рет орындалады.',
    'status.compiling': 'Компиляция жүруде…',
    'status.uploading': 'Жүктелуде…',
    'status.ok': 'Дайын ✓',
    'status.error': 'Қате',
    'msg.compileOk': '✓ Компиляция сәтті аяқталды. Қате жоқ.',
    'msg.compileErr': '✗ Компиляция қатесі. Кодты тексеріңіз.',
    'msg.uploadOk': '✓ Бағдарлама платаға сәтті жүктелді!',
    'msg.uploadErr': '✗ Бағдарламаны платаға жүктеу мүмкін болмады.',
    'msg.noPort': 'Плата табылмады. Arduino-ны USB арқылы қосып, ⟳ басыңыз.',
    'msg.portsNone': '— плата табылмады —',
    'msg.resetConfirm': 'Кодты бастапқы үлгіге қайтару керек пе? Өзгерістеріңіз жойылады.',
    'msg.lockedHint': 'Бұл жолды өзгертуге болмайды — ол жобаның міндетті бөлігі.',
    'mat.noUrl': 'Бұлттық қалта бапталмаған. «Баптаулар» бөлімінде материалдар қалтасының мекенжайын көрсетіңіз.',
    'mat.offline': 'Интернет байланысы жоқ. Бұрын жүктелген материалдар көрсетілді.',
    'mat.empty': 'Материалдар әзірге қосылмаған.',
    'mat.cached': '✓ жүктелген, офлайн қолжетімді',
    'mat.cloud': 'бұлтта — басқанда ашылады',
    'mat.downloadErr': 'Файлды жүктеу мүмкін болмады. Интернетті тексеріңіз.',
    'setup.copy': 'Кірістірілген компоненттер көшірілуде…',
    'setup.download': 'Компоненттер интернеттен жүктелуде…',
    'setup.error': 'Arduino компоненттерін дайындау мүмкін болмады. Интернетті тексеріп, бағдарламаны қайта іске қосыңыз.'
  }
};

let currentLang = 'ru';

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.ru[key] || key;
}

function applyLang(lang) {
  currentLang = I18N[lang] ? lang : 'ru';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.getElementById('lang-ru').classList.toggle('active', currentLang === 'ru');
  document.getElementById('lang-kk').classList.toggle('active', currentLang === 'kk');
}
