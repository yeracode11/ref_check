const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  buildCheckinFridgeIdMatchCondition,
} = require('./fridgeVisitHelpers');
const { fridgeIdMatchesCandidates } = require('./checkinDedup');

/** Роли с фильтром списка холодильников по городу (менеджер, бухгалтер) */
const CITY_SCOPED_ROLES = ['manager', 'accountant'];
/** Роли, которым обязателен cityId в профиле */
const ROLES_REQUIRING_CITY = ['manager', 'accountant', 'service_manager', 'sales_head'];
const CITY_CHECKIN_IDS_TTL_MS = parseInt(process.env.CITY_CHECKIN_IDS_CACHE_TTL_MS || '300000', 10);
/** @type {Map<string, { ids: string[], at: number }>} */
const checkinIdsByCityCache = new Map();

function isCityScopedRole(role) {
  return CITY_SCOPED_ROLES.includes(role);
}

/** Нормализует cityId из строки, ObjectId или populate { _id, name } */
function normalizeCityId(cityRef) {
  if (cityRef == null) return null;
  if (typeof cityRef === 'string') {
    const trimmed = cityRef.trim();
    if (!trimmed || trimmed === '[object Object]') return null;
    return mongoose.Types.ObjectId.isValid(trimmed) ? new mongoose.Types.ObjectId(trimmed) : null;
  }
  if (typeof cityRef === 'object') {
    const raw = cityRef._id != null ? cityRef._id : cityRef;
    if (raw == null) return null;
    const s = String(raw);
    return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
  }
  return null;
}

function getAssignedCityId(user) {
  if (!user?.cityId || user.role === 'admin') return null;
  return normalizeCityId(user.cityId);
}

/**
 * Город для фильтрации данных:
 * - admin: из query (или null = все города)
 * - МХО/НОП/бухгалтер/менеджер: только user.cityId
 */
function resolveCityFilter(user, queryCityId) {
  if (!user) return null;
  if (user.role === 'admin') {
    if (queryCityId && mongoose.Types.ObjectId.isValid(String(queryCityId))) {
      return new mongoose.Types.ObjectId(String(queryCityId));
    }
    return null;
  }
  return getAssignedCityId(user);
}

function userCanAccessCity(user, cityId) {
  if (!user || user.role === 'admin') return true;
  const assigned = getAssignedCityId(user);
  if (ROLES_REQUIRING_CITY.includes(user.role) && !assigned) return false;
  if (!assigned) return true;
  const target = normalizeCityId(cityId) || cityId;
  if (!target) return false;
  return String(assigned) === String(target);
}

/** cityId из документа Fridge (Mongoose doc, lean, populate или ObjectId) */
function resolveFridgeCityId(fridgeOrCityId) {
  if (fridgeOrCityId == null) return null;
  if (typeof fridgeOrCityId !== 'object') return fridgeOrCityId;

  const cityRef = fridgeOrCityId.cityId;
  if (cityRef !== undefined) {
    if (cityRef == null) return null;
    if (typeof cityRef === 'object' && cityRef._id != null) {
      return cityRef._id;
    }
    return cityRef;
  }

  if (fridgeOrCityId._id != null && (fridgeOrCityId.name != null || fridgeOrCityId.code != null)) {
    return fridgeOrCityId._id;
  }

  return fridgeOrCityId._id ?? fridgeOrCityId;
}

function userCanAccessFridge(user, fridgeOrCityId) {
  return userCanAccessCity(user, resolveFridgeCityId(fridgeOrCityId));
}

function ensureCityScopedUserHasCity(req, res) {
  if (!req.user || req.user.role === 'admin') return true;
  if (!ROLES_REQUIRING_CITY.includes(req.user.role)) return true;
  if (!getAssignedCityId(req.user)) {
    res.status(403).json({
      error: 'Для роли не назначен город. Обратитесь к администратору.',
    });
    return false;
  }
  return true;
}

async function getFridgeObjectIdsForCity(cityId) {
  if (!cityId) return [];
  const fridges = await Fridge.find({ cityId }, { _id: 1 }).lean();
  return fridges.map((f) => f._id);
}

async function getCheckinFridgeIdsForCity(cityId) {
  if (!cityId) return [];

  const cacheKey = String(cityId);
  const cached = checkinIdsByCityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CITY_CHECKIN_IDS_TTL_MS) {
    return cached.ids;
  }

  const fridges = await Fridge.find(
    { cityId },
    { code: 1, number: 1, 'clientInfo.inn': 1 },
  ).lean();
  const ids = new Set();
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => ids.add(id));
  });
  const expanded = expandCheckinFridgeIdsForInQuery([...ids]);
  checkinIdsByCityCache.set(cacheKey, { ids: expanded, at: Date.now() });
  return expanded;
}

/**
 * Фильтр MongoDB для отметок одного города (fridgeRef + legacy fridgeId в scope города).
 * Не использует общий $in по числовым номерам — иначе одинаковые number в разных городах смешиваются.
 */
async function getCheckinFilterForCity(cityId) {
  if (!cityId) return {};

  const fridges = await Fridge.find(
    { cityId },
    { _id: 1, code: 1, number: 1, 'clientInfo.inn': 1 },
  ).lean();

  if (!fridges.length) {
    return { fridgeId: '__none__' };
  }

  const fridgeObjectIds = fridges.map((f) => f._id);
  const legacyOr = fridges
    .map((f) => buildCheckinFridgeIdMatchCondition(f))
    .filter(Boolean);

  const legacyClause = legacyOr.length === 1
    ? legacyOr[0]
    : { $or: legacyOr };

  return {
    $or: [
      { fridgeRef: { $in: fridgeObjectIds } },
      {
        $and: [
          { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] },
          legacyClause,
        ],
      },
    ],
  };
}

function invalidateCityCheckinIdsCache(cityId) {
  if (cityId) {
    checkinIdsByCityCache.delete(String(cityId));
    return;
  }
  checkinIdsByCityCache.clear();
}

function isMongoObjectIdString(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || '').trim());
}

async function findFridgeByIdentifier(identifier, options = {}) {
  const normalized = String(identifier || '').trim().replace(/^#/, '');
  if (!normalized) return null;

  const query = {
    active: { $ne: false },
    $or: [
      { code: normalized },
      { number: normalized },
      { 'clientInfo.inn': normalized },
    ],
  };

  if (options.cityId) {
    query.cityId = options.cityId;
  }

  const matches = await Fridge.find(query).limit(5).lean();
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  if (options.cityId) {
    return matches[0];
  }

  return null;
}

/**
 * Находит холодильник по MongoDB _id или по коду/номеру/ИНН (QR, длинный serial).
 * Для бухгалтера identifier ищется только в его городе.
 */
async function resolveFridgeDocumentByIdOrIdentifier(id, user) {
  const raw = String(id || '').trim();
  if (!raw) return null;

  const scopedCityId = user?.role === 'accountant' ? getAssignedCityId(user) : null;
  const lookupOpts = scopedCityId ? { cityId: scopedCityId } : {};

  if (isMongoObjectIdString(raw)) {
    const byId = await Fridge.findById(raw);
    if (byId) return byId;
  }

  const matched = await findFridgeByIdentifier(raw, lookupOpts);
  if (!matched?._id) return null;
  return Fridge.findById(matched._id);
}

function buildCheckinFilterForFridge(fridge) {
  const legacy = buildCheckinFridgeIdMatchCondition(fridge);
  if (!fridge?._id) {
    return legacy || { fridgeId: '__none__' };
  }
  return {
    $or: [
      { fridgeRef: fridge._id },
      legacy
        ? {
          $and: [
            { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] },
            legacy,
          ],
        }
        : { fridgeRef: fridge._id },
    ],
  };
}

module.exports = {
  CITY_SCOPED_ROLES,
  ROLES_REQUIRING_CITY,
  isCityScopedRole,
  normalizeCityId,
  getAssignedCityId,
  resolveCityFilter,
  userCanAccessCity,
  resolveFridgeCityId,
  userCanAccessFridge,
  ensureCityScopedUserHasCity,
  getFridgeObjectIdsForCity,
  getCheckinFridgeIdsForCity,
  getCheckinFilterForCity,
  invalidateCityCheckinIdsCache,
  findFridgeByIdentifier,
  isMongoObjectIdString,
  resolveFridgeDocumentByIdOrIdentifier,
  buildCheckinFilterForFridge,
};
