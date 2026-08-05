/* Мини-тесты уроков: проверка данных из облачного quizzes.json.
 *
 * Файл лежит в репозитории материалов рядом с manifest.json:
 *   { "version": 1, "quizzes": { "lesson0": { "ru": [...], "kk": [...] }, ... } }
 * Каждый вопрос: { "q": "...", "answers": ["...", ...], "correct": 0, "expl": "..." }
 * (correct — индекс верного варианта с нуля, expl — пояснение, необязательно).
 *
 * normalize() отбрасывает битые вопросы, чтобы опечатка в облачном файле
 * не сломала урок: тест просто станет короче или не покажется вовсе. */
(function () {
  function normalize(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const item of list) {
      if (!item || typeof item.q !== 'string' || !item.q.trim()) continue;
      if (!Array.isArray(item.answers)) continue;
      const answers = item.answers.filter((a) => typeof a === 'string' && a.trim());
      if (answers.length < 2) continue;
      const correct = (Number.isInteger(item.correct) && item.correct >= 0 && item.correct < answers.length)
        ? item.correct : 0;
      out.push({
        q: item.q.trim(),
        answers,
        correct,
        expl: (typeof item.expl === 'string') ? item.expl.trim() : ''
      });
    }
    return out.length ? out : null;
  }

  /* Выбор языка: entry = { ru: [...], kk: [...] }, lang = 'ru' | 'kk' */
  function forLang(entry, lang) {
    if (!entry || typeof entry !== 'object') return null;
    const pick = (lang === 'kk')
      ? (entry.kk || entry.ru)
      : (entry.ru || entry.kk);
    return normalize(pick);
  }

  const api = { normalize, forLang };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.sbQuiz = api;
})();
