/**
 * Прямой геокодинг через Nominatim (OpenStreetMap).
 * Политика использования: не больше ~1 запроса в секунду.
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

const axios = require('axios');

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  'FridgeManager/1.0 (https://github.com; fridge address geocoding)';

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * @param {string} query — полная строка поиска (адрес + город + страна)
 * @returns {Promise<[number, number] | null>} [lng, lat] или null
 */
async function forwardGeocodeQuery(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  await throttle();

  try {
    const url = `${NOMINATIM_SEARCH}?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 20000,
      validateStatus: () => true,
    });

    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) {
      return null;
    }

    const hit = res.data[0];
    const lat = parseFloat(hit.lat);
    const lon = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat === 0 && lon === 0) return null;

    return [lon, lat];
  } catch (err) {
    console.error('[Nominatim] forwardGeocodeQuery error:', err.message);
    return null;
  }
}

module.exports = {
  forwardGeocodeQuery,
  MIN_INTERVAL_MS,
};
