const {
  buildCheckinFridgeIdCandidates,
} = require('./fridgeVisitHelpers');
const {
  normalizeFridgeIdForCompare,
  canonicalCheckinFridgeId,
} = require('./checkinDedup');
const { haversineMeters } = require('../utils/checkinGeodesic');

function buildFridgeCandidateIndex(fridges) {
  /** @type {Map<string, object[]>} */
  const index = new Map();

  for (const fridge of fridges) {
    const idKeys = [
      ...buildCheckinFridgeIdCandidates(fridge),
      String(fridge._id),
    ];
    for (const candidate of idKeys) {
      const key = normalizeFridgeIdForCompare(candidate);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      const list = index.get(key);
      if (!list.some((f) => String(f._id) === String(fridge._id))) {
        list.push(fridge);
      }
    }
  }

  return index;
}

function buildManagerCityMap(users) {
  /** @type {Map<string, import('mongoose').Types.ObjectId|null>} */
  const map = new Map();
  for (const user of users) {
    if (!user) continue;
    if (user.username) map.set(String(user.username), user.cityId || null);
    map.set(String(user._id), user.cityId || null);
  }
  return map;
}

function fridgeCoords(fridge) {
  const coords = fridge?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng === 0 && lat === 0) return null;
  return { lng, lat };
}

function checkinCoords(checkin) {
  const coords = checkin?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function pickByManagerCity(candidates, managerCityId) {
  if (!managerCityId || !candidates.length) return candidates;
  const filtered = candidates.filter(
    (f) => f.cityId && String(f.cityId) === String(managerCityId),
  );
  return filtered.length ? filtered : candidates;
}

function pickClosestFridge(candidates, checkin) {
  if (candidates.length <= 1) return candidates[0] || null;
  const from = checkinCoords(checkin);
  if (!from) return candidates[0];

  let best = candidates[0];
  let bestDist = Infinity;
  for (const f of candidates) {
    const to = fridgeCoords(f);
    if (!to) continue;
    const d = haversineMeters(from.lng, from.lat, to.lng, to.lat);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

/**
 * Подбирает холодильник для старой отметки (без fridgeRef).
 *
 * @returns {{ fridge: object|null, reason: string, candidates: number }}
 */
function resolveFridgeForCheckinRecord(checkin, fridgeIndex, managerCityMap) {
  const rawId = checkin?.fridgeId;
  const key = normalizeFridgeIdForCompare(rawId);
  if (!key) {
    return { fridge: null, reason: 'empty_fridge_id', candidates: 0 };
  }

  let candidates = fridgeIndex.get(key) || [];
  if (!candidates.length) {
    return { fridge: null, reason: 'no_fridge_match', candidates: 0 };
  }

  if (candidates.length === 1) {
    return { fridge: candidates[0], reason: 'unique_match', candidates: 1 };
  }

  const managerKey = String(checkin.managerId || '');
  const managerCityId = managerCityMap.get(managerKey) || null;
  const afterCity = pickByManagerCity(candidates, managerCityId);
  if (afterCity.length === 1) {
    return { fridge: afterCity[0], reason: 'manager_city', candidates: candidates.length };
  }

  const closest = pickClosestFridge(afterCity, checkin);
  if (closest) {
    return {
      fridge: closest,
      reason: afterCity.length < candidates.length ? 'manager_city+geo' : 'geo',
      candidates: candidates.length,
    };
  }

  return { fridge: null, reason: 'ambiguous', candidates: candidates.length };
}

function buildCheckinUpdate(checkin, fridge, fixFridgeId) {
  const update = { fridgeRef: fridge._id };
  if (fixFridgeId) {
    const canonical = canonicalCheckinFridgeId(fridge, checkin.fridgeId);
    if (canonical !== undefined && String(canonical) !== String(checkin.fridgeId)) {
      update.fridgeId = canonical;
    }
  }
  return update;
}

module.exports = {
  buildFridgeCandidateIndex,
  buildManagerCityMap,
  resolveFridgeForCheckinRecord,
  buildCheckinUpdate,
};
