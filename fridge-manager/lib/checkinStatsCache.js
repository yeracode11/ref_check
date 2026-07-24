const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  parseVisitTimeMs,
} = require('./fridgeVisitHelpers');
const { fridgeIdMatchesCandidates } = require('./checkinDedup');

const TTL_MS = parseInt(process.env.CHECKIN_STATS_CACHE_TTL_MS || '60000', 10);

/** @type {Map<string, { stats: Map<string, object>, at: number }>} */
const cacheByScope = new Map();

function invalidateCheckinStatsCache() {
  cacheByScope.clear();
}

function mergeStatsEntry(existing, visitAt, condition, addCount = 1) {
  const visitMs = parseVisitTimeMs(visitAt);
  const exMs = parseVisitTimeMs(existing?.lastVisit);
  let nextVisit = existing?.lastVisit ?? null;
  let nextCondition = existing?.lastFridgeCondition ?? null;
  if (visitMs != null && (exMs == null || visitMs > exMs)) {
    nextVisit = visitAt;
    nextCondition = condition ?? null;
  }
  return {
    lastVisit: nextVisit,
    lastFridgeCondition: nextCondition,
    totalCheckins: (existing?.totalCheckins || 0) + addCount,
  };
}

/**
 * Статистика lastVisit по каждому холодильнику в scope (без смешивания одинаковых number между городами).
 */
async function getCheckinStatsForFridges(fridgeLikeDocs, cacheScopeKey, opts = {}) {
  const useCache = opts.useCache !== false && !!cacheScopeKey;

  if (!Array.isArray(fridgeLikeDocs) || fridgeLikeDocs.length === 0) {
    return new Map();
  }

  if (useCache) {
    const cached = cacheByScope.get(cacheScopeKey);
    if (cached && Date.now() - cached.at < TTL_MS) {
      return cached.stats;
    }
  }

  const fridgeDocs = fridgeLikeDocs.filter((f) => f && f._id);
  if (!fridgeDocs.length) return new Map();

  const fridgeObjectIds = fridgeDocs.map((f) => f._id);
  const legacyIds = new Set();
  for (const f of fridgeDocs) {
    for (const id of buildCheckinFridgeIdCandidates(f)) {
      legacyIds.add(id);
      const n = Number(id);
      if (Number.isFinite(n)) legacyIds.add(n);
    }
  }

  const checkins = await Checkin.find({
    $or: [
      { fridgeRef: { $in: fridgeObjectIds } },
      {
        $and: [
          { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] },
          { fridgeId: { $in: [...legacyIds] } },
        ],
      },
    ],
  })
    .select('fridgeId fridgeRef visitedAt fridgeCondition')
    .sort({ visitedAt: -1 })
    .lean();

  const statsByKey = new Map();

  for (const f of fridgeDocs) {
    const docKey = String(f._id);
    const candidates = buildCheckinFridgeIdCandidates(f);
    let bucket = statsByKey.get(docKey) || {
      lastVisit: null,
      lastFridgeCondition: null,
      totalCheckins: 0,
    };

    for (const c of checkins) {
      let matches = false;
      if (c.fridgeRef && String(c.fridgeRef) === docKey) {
        matches = true;
      } else if (!c.fridgeRef && fridgeIdMatchesCandidates(c.fridgeId, candidates)) {
        matches = true;
      }
      if (!matches) continue;
      bucket = mergeStatsEntry(bucket, c.visitedAt, c.fridgeCondition, 1);
    }

    statsByKey.set(docKey, bucket);
    for (const id of candidates) {
      statsByKey.set(String(id).trim(), bucket);
      const n = Number(id);
      if (Number.isFinite(n)) statsByKey.set(n, bucket);
    }
  }

  if (useCache) {
    cacheByScope.set(cacheScopeKey, { stats: statsByKey, at: Date.now() });
  }
  return statsByKey;
}

/**
 * Статистика чекинов по всем холодильникам в scope (не только текущая страница).
 */
async function getCheckinStatsForFridgeQuery(fridgeQuery, cacheScopeKey, opts = {}) {
  if (opts.useCache !== false && cacheScopeKey) {
    const cached = cacheByScope.get(cacheScopeKey);
    if (cached && Date.now() - cached.at < TTL_MS) {
      return cached.stats;
    }
  }

  const fridgeDocs = await Fridge.find(fridgeQuery)
    .select('_id code number clientInfo.inn type')
    .lean();

  return getCheckinStatsForFridges(fridgeDocs, cacheScopeKey, opts);
}

module.exports = {
  getCheckinStatsForFridges,
  getCheckinStatsForFridgeQuery,
  invalidateCheckinStatsCache,
};
