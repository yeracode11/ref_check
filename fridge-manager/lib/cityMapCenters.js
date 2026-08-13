/** Центры городов (lat/lng). Синхронизировано с fridge-frontend/src/utils/cityMapCenters.ts */

const BY_NAME = {
  алматы: { lat: 43.238949, lng: 76.889709 },
  almaty: { lat: 43.238949, lng: 76.889709 },
  астана: { lat: 51.169392, lng: 71.449074 },
  astana: { lat: 51.169392, lng: 71.449074 },
  'нур-султан': { lat: 51.169392, lng: 71.449074 },
  тараз: { lat: 42.8996, lng: 71.3696 },
  taraz: { lat: 42.8996, lng: 71.3696 },
  шымкент: { lat: 42.341737, lng: 69.590101 },
  shymkent: { lat: 42.341737, lng: 69.590101 },
  актобе: { lat: 50.283933, lng: 57.166978 },
  aktobe: { lat: 50.283933, lng: 57.166978 },
  атырау: { lat: 47.116667, lng: 51.883333 },
  atyrau: { lat: 47.116667, lng: 51.883333 },
  уральск: { lat: 51.227222, lng: 51.376389 },
  oral: { lat: 51.227222, lng: 51.376389 },
  костанай: { lat: 53.214, lng: 63.624 },
  kostanay: { lat: 53.214, lng: 63.624 },
  кокшетау: { lat: 53.283, lng: 69.4 },
  kokchetav: { lat: 53.283, lng: 69.4 },
  оскемен: { lat: 49.948, lng: 82.627 },
  'усть-каменогорск': { lat: 49.948, lng: 82.627 },
  павлодар: { lat: 52.287, lng: 76.966 },
  pavlodar: { lat: 52.287, lng: 76.966 },
  семей: { lat: 50.411, lng: 80.227 },
  semey: { lat: 50.411, lng: 80.227 },
  талдыкорган: { lat: 45.0156, lng: 78.3739 },
  taldykorgan: { lat: 45.0156, lng: 78.3739 },
  кызылорда: { lat: 44.848831, lng: 65.509167 },
  kyzylorda: { lat: 44.848831, lng: 65.509167 },
  караганда: { lat: 49.804683, lng: 73.109406 },
  караганды: { lat: 49.804683, lng: 73.109406 },
  karaganda: { lat: 49.804683, lng: 73.109406 },
  балхаш: { lat: 46.848331, lng: 74.995917 },
  balkhash: { lat: 46.848331, lng: 74.995917 },
  атбасар: { lat: 51.816, lng: 68.358 },
};

const BY_CODE = {
  '01': { lat: 51.169392, lng: 71.449074 },
  '02': { lat: 43.238949, lng: 76.889709 },
  '03': { lat: 53.283, lng: 69.4 },
  '04': { lat: 50.283933, lng: 57.166978 },
  '06': { lat: 47.116667, lng: 51.883333 },
  '07': { lat: 51.227222, lng: 51.376389 },
  '08': { lat: 42.8996, lng: 71.3696 },
  '09': { lat: 49.804683, lng: 73.109406 },
  '10': { lat: 53.214, lng: 63.624 },
  '11': { lat: 44.848831, lng: 65.509167 },
  '14': { lat: 52.287, lng: 76.966 },
  '16': { lat: 49.948, lng: 82.627 },
  '17': { lat: 42.341737, lng: 69.590101 },
  '18': { lat: 50.411, lng: 80.227 },
  '19': { lat: 45.0156, lng: 78.3739 },
  ALA: { lat: 43.238949, lng: 76.889709 },
  AST: { lat: 51.169392, lng: 71.449074 },
  TRZ: { lat: 42.8996, lng: 71.3696 },
  AKX: { lat: 50.283933, lng: 57.166978 },
  SHM: { lat: 42.341737, lng: 69.590101 },
  KGF: { lat: 49.804683, lng: 73.109406 },
  PAV: { lat: 52.287, lng: 76.966 },
  BLH: { lat: 46.848331, lng: 74.995917 },
};

function resolveCityMapCenter(cityName, cityCode) {
  if (cityCode) {
    const byCode = BY_CODE[String(cityCode).trim()];
    if (byCode) return byCode;
  }
  if (cityName) {
    const key = String(cityName).trim().toLowerCase();
    if (BY_NAME[key]) return BY_NAME[key];
  }
  return null;
}

function cityCenterToGeoPoint(center) {
  return { type: 'Point', coordinates: [center.lng, center.lat] };
}

module.exports = {
  resolveCityMapCenter,
  cityCenterToGeoPoint,
};
