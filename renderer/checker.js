/*
 * Проверка выполнения задания урока (статические условия).
 *
 * Формат блока "check" в файле урока:
 * {
 *   "requireCompile": true,                 — код должен компилироваться
 *   "contains": [                           — код должен содержать текст
 *     { "text": "digitalWrite", "ru": "Используйте digitalWrite", "kk": "..." }
 *   ],
 *   "notContains": [                        — код НЕ должен содержать текст
 *     { "text": "delay(0)", "ru": "...", "kk": "..." }
 *   ],
 *   "regex": [                              — проверка по регулярному выражению
 *     { "pattern": "delay\\s*\\(\\s*[0-9]+\\s*\\)", "ru": "Добавьте delay(...)", "kk": "..." }
 *   ]
 * }
 */

/* Убирает комментарии и строковые литералы, чтобы условие
 * не «засчитывалось» за счёт текста в комментарии. */
function stripCommentsAndStrings(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* ... */
    .replace(/\/\/[^\n]*/g, ' ')          // // ...
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/*
 * Выполняет статические проверки. Возвращает список
 * [{ ok: true/false, msgRu, msgKk }] — по одному на условие.
 */
function runStaticChecks(code, check) {
  const results = [];
  if (!check) return results;
  const clean = stripCommentsAndStrings(code);

  for (const c of check.contains || []) {
    if (!c || !c.text) continue;
    results.push({
      ok: clean.includes(c.text),
      msgRu: c.ru || ('Код должен содержать: ' + c.text),
      msgKk: c.kk || c.ru || ('Кодта болуы керек: ' + c.text)
    });
  }
  for (const c of check.notContains || []) {
    if (!c || !c.text) continue;
    results.push({
      ok: !clean.includes(c.text),
      msgRu: c.ru || ('Код не должен содержать: ' + c.text),
      msgKk: c.kk || c.ru || ('Кодта болмауы керек: ' + c.text)
    });
  }
  for (const c of check.regex || []) {
    if (!c || !c.pattern) continue;
    let ok = false;
    try { ok = new RegExp(c.pattern, c.flags || '').test(clean); } catch (_) { ok = false; }
    results.push({
      ok,
      msgRu: c.ru || ('Условие: ' + c.pattern),
      msgKk: c.kk || c.ru || ('Шарт: ' + c.pattern)
    });
  }
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runStaticChecks, stripCommentsAndStrings };
}
