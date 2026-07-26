const mongoose = require('mongoose');
const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  parseVisitTimeMs,
} = require('./fridgeVisitHelpers');

const TTL_MS = parseInt(process.env.CHECKIN_STATS_CACHE_TTL_MS || '60000', 10);
const REF_MATCH_CHUNK = parseInt(process.env.CHECKIN_STATS_REF_CHUNK || '8000', 10);

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

function mergeBucketIntoMap(statsByKey, docKey, candidates, bucket) {
  statsByKey.set(docKey, bucket);
  for (const id of candidates) {
    statsByKey.set(String(id).trim(), bucket);
    const n = Number(id);
    if (Number.isFinite(n)) statsByKey.set(n, bucket);
  }
}

/**
 * Последняя отметка по fridgeRef — агрегация в MongoDB (без загрузки всех checkins в RAM).
 */
async function aggregateStatsByFridgeRef(fridgeObjectIds) {
  const byRef = new Map();
  if (!fridgeObjectIds.length) return byRef;

  const ids = fridgeObjectIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)),
  );

  const chunkSize = Math.max(500, REF_MATCH_CHUNK);
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await Checkin.aggregate([
      { $match: { fridgeRef: { $in: chunk } } },
      { $sort: { visitedAt: -1 } },
      {
        $group: {
          _id: '$fridgeRef',
          lastVisit: { $first: '$visitedAt' },
          lastFridgeCondition: { $first: '$fridgeCondition' },
          totalCheckins: { $sum: 1 },
        },
      },
    ]).allowDiskUse(true);

    for (const row of rows) {
      byRef.set(String(row._id), {
        lastVisit: row.lastVisit ?? null,
        lastFridgeCondition: row.lastFridgeCondition ?? null,
        totalCheckins: row.totalCheckins || 0,
      });
    }
  }

  return byRef;
}

/** Отметки без fridgeRef (legacy) — их мало после backfill. */
async function aggregateLegacyStatsByFridgeId() {
  const byFridgeId = new Map();
  const rows = await Checkin.aggregate([
    {
      $match: {
        $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }],
      },
    },
    { $sort: { visitedAt: -1 } },
    {
      $group: {
        _id: '$fridgeId',
        lastVisit: { $first: '$visitedAt' },
        lastFridgeCondition: { $first: '$fridgeCondition' },
        totalCheckins: { $sum: 1 },
      },
    },
  ]).allowDiskUse(true);

  for (const row of rows) {
    if (row._id == null) continue;
    const key = String(row._id).trim();
    byFridgeId.set(key, {
      lastVisit: row.lastVisit ?? null,
      lastFridgeCondition: row.lastFridgeCondition ?? null,
      totalCheckins: row.totalCheckins || 0,
    });
    const n = Number(row._id);
    if (Number.isFinite(n)) {
      byFridgeId.set(n, byFridgeId.get(key));
    }
  }

  return byFridgeId;
}

function pickLegacyBucket(legacyByFridgeId, candidates) {
  let bucket = null;
  for (const id of candidates) {
    const direct =
      legacyByFridgeId.get(id) ??
      legacyByFridgeId.get(String(id).trim()) ??
      (Number.isFinite(Number(id)) ? legacyByFridgeId.get(Number(id)) : undefined);
    if (!direct) continue;
    bucket = bucket
      ? mergeStatsEntry(bucket, direct.lastVisit, direct.lastFridgeCondition, direct.totalCheckins || 0)
      : { ...direct };
  }
  return bucket;
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
  const [byRef, legacyByFridgeId] = await Promise.all([
    aggregateStatsByFridgeRef(fridgeObjectIds),
    aggregateLegacyStatsByFridgeId(),
  ]);

  const statsByKey = new Map();

  for (const f of fridgeDocs) {
    const docKey = String(f._id);
    const candidates = buildCheckinFridgeIdCandidates(f);
    let bucket = byRef.get(docKey) || {
      lastVisit: null,
      lastFridgeCondition: null,
      totalCheckins: 0,
    };

    const legacyBucket = pickLegacyBucket(legacyByFridgeId, candidates);
    if (legacyBucket) {
      bucket = mergeStatsEntry(
        bucket,
        legacyBucket.lastVisit,
        legacyBucket.lastFridgeCondition,
        legacyBucket.totalCheckins || 0,
      );
    }

    mergeBucketIntoMap(statsByKey, docKey, candidates, bucket);
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
  aggregateStatsByFridgeRef,
  aggregateLegacyStatsByFridgeId,
};
