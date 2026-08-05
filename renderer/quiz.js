/* Разбор данных мини-теста, зашитых в PDF-урок крошечным моноширинным блоком.
 *
 * Формат (кодирует генератор уроков):
 *   SBTEST1|k=2,1,3        — метка + ключ: номер верного варианта (с единицы) для каждого вопроса
 *   ?Текст_вопроса          — «?» начинает вопрос
 *   *Вариант_ответа         — «*» добавляет вариант
 *   !Пояснение              — «!» пояснение (показывается после верного ответа)
 *   ~хвост_длинной_строки   — «~» продолжение предыдущей строки
 * Пробелы закодированы как «_», настоящий «_» — как «__»
 * (реконструкция пробелов из зазоров PDF ненадёжна, а «_» — обычный глиф). */
(function () {
  function decode(s) {
    return String(s).replace(/__/g, '\x00').replace(/_/g, ' ').replace(/\x00/g, '_');
  }

  /* text — текст блока, как его восстановил просмотрщик (строки через \n).
   * Возвращает [{q, answers[], correct, expl}] или null, если это не тест. */
  function parse(text) {
    const raw = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
    const lines = [];
    for (const l of raw) {
      if (l.startsWith('~') && lines.length) lines[lines.length - 1] += l.slice(1);
      else lines.push(l);
    }
    if (!lines.length || !lines[0].startsWith('SBTEST1')) return null;
    const m = lines[0].match(/k=([0-9,]+)/);
    if (!m) return null;
    const key = m[1].split(',').map((n) => parseInt(n, 10) - 1);

    const qs = [];
    let cur = null;
    for (const l of lines.slice(1)) {
      const c = l[0];
      const body = decode(l.slice(1));
      if (c === '?') { cur = { q: body, answers: [], expl: '', correct: 0 }; qs.push(cur); }
      else if (c === '*' && cur) cur.answers.push(body);
      else if (c === '!' && cur) cur.expl = body;
    }
    qs.forEach((q, i) => { q.correct = (key[i] >= 0 && key[i] < q.answers.length) ? key[i] : 0; });
    return qs.length ? qs : null;
  }

  const api = { parse, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.sbQuiz = api;
})();
