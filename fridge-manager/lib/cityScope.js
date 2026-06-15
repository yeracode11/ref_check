const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  buildCheckinFridgeIdMatchCondition,
} = require('./fridgeVisitHelpers');

/** Роли, привязанные к одному городу (поле user.cityId) */
const CITY_SCOPED_ROLES = ['manager', 'accountant', 'service_manager', 'sales_head'];

function isCityScopedRole(role) {
  return CITY_SCOPED_ROLES.includes(role);
}

function getAssignedCityId(user) {
  if (!user?.cityId || !isCityScopedRole(user.role)) return null;
  const id = String(user.cityId);
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : user.cityId;
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
  if (!assigned) return true;
  if (!cityId) return false;
  return String(assigned) === String(cityId);
}

async function getFridgeObjectIdsForCity(cityId) {
  if (!cityId) return [];
  const fridges = await Fridge.find({ cityId }, { _id: 1 }).lean();
  return fridges.map((f) => f._id);
}

async function getCheckinFridgeIdsForCity(cityId) {
  if (!cityId) return [];
  const fridges = await Fridge.find(
    { cityId },
    { code: 1, number: 1, 'clientInfo.inn': 1 },
  ).lean();
  const ids = new Set();
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => ids.add(id));
  });
  return expandCheckinFridgeIdsForInQuery([...ids]);
}

async function findFridgeByIdentifier(identifier) {
  const normalized = String(identifier || '').trim().replace(/^#/, '');
  if (!normalized) return null;
  return Fridge.findOne({
    $or: [
      { code: normalized },
      { number: normalized },
      { 'clientInfo.inn': normalized },
    ],
  }).lean();
}

function buildCheckinFilterForFridge(fridge) {
  const idMatch = buildCheckinFridgeIdMatchCondition(fridge);
  return idMatch || { fridgeId: '__none__' };
}

module.exports = {
  CITY_SCOPED_ROLES,
  isCityScopedRole,
  getAssignedCityId,
  resolveCityFilter,
  userCanAccessCity,
  getFridgeObjectIdsForCity,
  getCheckinFridgeIdsForCity,
  findFridgeByIdentifier,
  buildCheckinFilterForFridge,
};
