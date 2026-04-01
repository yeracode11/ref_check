/**
 * Расстояние между двумя точками WGS84 в метрах.
 */
function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ищет недавнюю отметку того же менеджера по тому же холодильнику с близкими координатами (идемпотентность).
 *
 * @param {Array<{ managerId: string, fridgeId: string, visitedAt: Date, location: { coordinates: [number,number] } }>} candidates
 * @param {{ managerId: string, fridgeId: string, lng: number, lat: number, now: number, windowMs: number, maxDistanceM: number }} params
 * @returns {typeof candidates[0]|null}
 */
function findRecentDuplicateCheckin(candidates, params) {
  const {
    managerId,
    fridgeId,
    lng,
    lat,
    now,
    windowMs,
    maxDistanceM,
  } = params;
  const mgr = String(managerId);
  const fid = String(fridgeId);
  const threshold = now - windowMs;

  for (const c of candidates) {
    if (String(c.fridgeId) !== fid) continue;
    if (String(c.managerId) !== mgr) continue;
    const t = c.visitedAt instanceof Date ? c.visitedAt.getTime() : new Date(c.visitedAt).getTime();
    if (!Number.isFinite(t) || t < threshold) continue;
    const coords = c.location && c.location.coordinates;
    if (!coords || coords.length !== 2) continue;
    const [clng, clat] = coords;
    const d = haversineMeters(lng, lat, clng, clat);
    if (d <= maxDistanceM) return c;
  }
  return null;
}

module.exports = { haversineMeters, findRecentDuplicateCheckin };
