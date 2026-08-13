const Fridge = require('../models/Fridge');

const GENERIC_ADDRESS_MIN_DUPLICATES = 3;

/** Известные складские заглушки из импорта Excel */
const KNOWN_PLACEHOLDER_PATTERNS = [
  /^г\.?\s*алматы,?\s*ул\.?\s*рыскулова,?\s*д\.?\s*97$/i,
];

function normalizeAddressKey(address) {
  return String(address || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isKnownPlaceholderAddress(address) {
  const key = normalizeAddressKey(address);
  if (!key) return true;
  return KNOWN_PLACEHOLDER_PATTERNS.some((re) => re.test(key));
}

/**
 * Адрес, общий для многих ХО в городе — не использовать для точки на карте
 * (даёт «кашу» из сотен меток в одном здании).
 */
async function isGenericWarehouseAddress(cityId, address, minDuplicates = GENERIC_ADDRESS_MIN_DUPLICATES) {
  const trimmed = String(address || '').trim();
  if (!trimmed || !cityId) return true;
  if (isKnownPlaceholderAddress(trimmed)) return true;

  const count = await Fridge.countDocuments({
    cityId,
    active: true,
    warehouseStatus: { $in: ['warehouse', 'returned'] },
    address: trimmed,
  });

  return count >= minDuplicates;
}

module.exports = {
  GENERIC_ADDRESS_MIN_DUPLICATES,
  isKnownPlaceholderAddress,
  isGenericWarehouseAddress,
  normalizeAddressKey,
};
