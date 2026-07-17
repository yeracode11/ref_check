/** Экранирует строку для безопасного использования в RegExp (литеральный поиск). */
function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** RegExp для case-insensitive поиска подстроки без интерпретации спецсимволов. */
function buildCaseInsensitiveRegex(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  return new RegExp(escapeRegExp(trimmed), 'i');
}

module.exports = {
  escapeRegExp,
  buildCaseInsensitiveRegex,
};
