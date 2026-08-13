/**
 * Формат fridgeId в checkins: длинные серийные номера только как строка.
 * Number() ломает значения длиннее Number.MAX_SAFE_INTEGER (~16 цифр).
 */

function bareFridgeId(value) {
  return String(value ?? '').trim().replace(/^#+/, '');
}

function isSafeIntegerFridgeId(bare) {
  if (!bare || !/^\d+$/.test(bare)) return false;
  const n = Number(bare);
  return Number.isSafeInteger(n);
}

/** Числовой вариант для Mongo $in — только короткие legacy-id (1133, не Excel-номер). */
function legacyNumericFridgeIdVariant(bare) {
  return isSafeIntegerFridgeId(bare) ? Number(bare) : null;
}

/**
 * Значение fridgeId при записи новой отметки (всегда строка для number/code).
 */
function canonicalCheckinFridgeId(fridge, normalizedFridgeId) {
  if (!fridge) {
    const bare = bareFridgeId(normalizedFridgeId);
    return bare || normalizedFridgeId;
  }
  if (fridge.number != null && String(fridge.number).trim() !== '') {
    return bareFridgeId(fridge.number);
  }
  if (fridge.code != null && String(fridge.code).trim() !== '') {
    return bareFridgeId(fridge.code);
  }
  const bare = bareFridgeId(normalizedFridgeId);
  return bare || normalizedFridgeId;
}

function appendLegacyNumericMatchVariants(or, id) {
  const bare = bareFridgeId(id);
  if (!bare) return;
  const numeric = legacyNumericFridgeIdVariant(bare);
  if (numeric != null) {
    or.push({ fridgeId: numeric });
  }
}

module.exports = {
  bareFridgeId,
  isSafeIntegerFridgeId,
  legacyNumericFridgeIdVariant,
  canonicalCheckinFridgeId,
  appendLegacyNumericMatchVariants,
};
