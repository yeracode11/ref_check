const { resolveCityMapCenter } = require('./cityMapCenters');

const DEFAULT_CITY_FILTER_KM = 180;

const MAX_FILTER_KM_BY_CODE = {
  '02': 220, // Алматы + пригороды/область
  '19': 340, // Талдыкорган
};

function getCityFilterRadiusKm(cityDoc) {
  const center = resolveCityMapCenter(cityDoc?.name, cityDoc?.code);
  if (center?.maxFilterKm) return center.maxFilterKm;
  const code = cityDoc?.code ? String(cityDoc.code).trim() : '';
  if (MAX_FILTER_KM_BY_CODE[code]) return MAX_FILTER_KM_BY_CODE[code];
  return DEFAULT_CITY_FILTER_KM;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function extractLatLng(location) {
  const coords = location?.coordinates;
  if (!coords || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function isLocationNearCity(location, cityDoc, maxKm) {
  const point = extractLatLng(location);
  if (!point) return false;
  const center = resolveCityMapCenter(cityDoc?.name, cityDoc?.code);
  if (!center) return true;
  const radius = maxKm ?? getCityFilterRadiusKm(cityDoc);
  return haversineKm(point.lat, point.lng, center.lat, center.lng) <= radius;
}

module.exports = {
  DEFAULT_CITY_FILTER_KM,
  getCityFilterRadiusKm,
  isLocationNearCity,
  haversineKm,
  extractLatLng,
};
