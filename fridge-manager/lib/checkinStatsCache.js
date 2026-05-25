const Checkin = require('../models/Checkin');
const {
  buildCheckinFridgeIdCandidates,
  mergeCheckinStatsAggregationIntoMap,
} = require('./fridgeVisitHelpers');

const TTL_MS = parseInt(process.env.CHECKIN_STATS_CACHE_TTL_MS || '30000', 10);

/** @type {Map<string, { stats: Map<string, object>, at: number }>} */
const cacheByScope = new Map();

function buildFridgeIdMatchValues(fridgeLikeDocs) {
  const idSet = new Set();
  for (const f of fridgeLikeDocs) {
    for (const id of buildCheckinFridgeIdCandidates(f)) {
      idSet.add(id);
      const n = Number(id);
      if (Number.isFinite(n)) idSet.add(n);
    }
  }
  return [...idSet];
}

function invalidateCheckinStatsCache() {
  cacheByScope.clear();
}

/**
 * Агрегация lastVisit/totalCheckins только для переданных холодильников (не full scan).
 * @param {Array<object>} fridgeLikeDocs — lean-документы с code, number, clientInfo
 * @param {string} [cacheScopeKey] — ключ кэша (например JSON.stringify(fridgeQuery))
 * @param {{ useCache?: boolean }} [opts]
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

  const ids = buildFridgeIdMatchValues(fridgeLikeDocs);
  if (ids.length === 0) return new Map();

  const rows = await Checkin.aggregate([
    { $match: { fridgeId: { $in: ids } } },
    {
      $group: {
        _id: '$fridgeId',
        lastVisit: { $max: '$visitedAt' },
        totalCheckins: { $sum: 1 },
      },
    },
  ]);

  const stats = mergeCheckinStatsAggregationIntoMap(rows);
  if (useCache) {
    cacheByScope.set(cacheScopeKey, { stats, at: Date.now() });
  }
  return stats;
}

module.exports = {
  getCheckinStatsForFridges,
  invalidateCheckinStatsCache,
  buildFridgeIdMatchValues,
};
