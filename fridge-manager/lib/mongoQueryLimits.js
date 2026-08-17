/**
 * Лимиты MongoDB-запросов — защита от «вечных» запросов, которые вешают весь сервер.
 */

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_MAX_TIME_MS = parsePositiveInt(process.env.MONGO_MAX_TIME_MS, 120000);
const HEAVY_MAX_TIME_MS = parsePositiveInt(process.env.MONGO_HEAVY_MAX_TIME_MS, 300000);

function getDefaultMaxTimeMS() {
  return DEFAULT_MAX_TIME_MS;
}

function getHeavyMaxTimeMS() {
  return HEAVY_MAX_TIME_MS;
}

function applyFindMaxTime(query, maxTimeMS = DEFAULT_MAX_TIME_MS) {
  if (query && typeof query.maxTimeMS === 'function') {
    return query.maxTimeMS(maxTimeMS);
  }
  return query;
}

function aggregateOptions(extra = {}) {
  return {
    maxTimeMS: DEFAULT_MAX_TIME_MS,
    allowDiskUse: true,
    ...extra,
  };
}

module.exports = {
  getDefaultMaxTimeMS,
  getHeavyMaxTimeMS,
  applyFindMaxTime,
  aggregateOptions,
};
