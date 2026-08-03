export type CityMapCenter = {
  lat: number;
  lng: number;
  zoom?: number;
};

type MapPointLike = {
  location?: { coordinates?: [number, number] };
};

/** Центры городов (lat/lng для Leaflet). Имена — lower case. */
const BY_NAME: Record<string, CityMapCenter> = {
  алматы: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  almaty: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  астана: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  astana: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  'нур-султан': { lat: 51.169392, lng: 71.449074, zoom: 11 },
  тараз: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  taraz: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  шымкент: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  shymkent: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  актобе: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  aktobe: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  атырау: { lat: 47.116667, lng: 51.883333, zoom: 11 },
  atyrau: { lat: 47.116667, lng: 51.883333, zoom: 11 },
  уральск: { lat: 51.227222, lng: 51.376389, zoom: 11 },
  oral: { lat: 51.227222, lng: 51.376389, zoom: 11 },
  костанай: { lat: 53.214, lng: 63.624, zoom: 11 },
  kostanay: { lat: 53.214, lng: 63.624, zoom: 11 },
  кокшетау: { lat: 53.283, lng: 69.4, zoom: 11 },
  kokchetav: { lat: 53.283, lng: 69.4, zoom: 11 },
  оскемен: { lat: 49.948, lng: 82.627, zoom: 11 },
  'усть-каменогорск': { lat: 49.948, lng: 82.627, zoom: 11 },
  павлодар: { lat: 52.287, lng: 76.966, zoom: 11 },
  pavlodar: { lat: 52.287, lng: 76.966, zoom: 11 },
  семей: { lat: 50.411, lng: 80.227, zoom: 11 },
  semey: { lat: 50.411, lng: 80.227, zoom: 11 },
  талдыкорган: { lat: 45.0156, lng: 78.3739, zoom: 12 },
  taldykorgan: { lat: 45.0156, lng: 78.3739, zoom: 12 },
  кызылорда: { lat: 44.848831, lng: 65.509167, zoom: 11 },
  kyzylorda: { lat: 44.848831, lng: 65.509167, zoom: 11 },
  караганда: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  караганды: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  karaganda: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  балхаш: { lat: 46.848331, lng: 74.995917, zoom: 11 },
  balkhash: { lat: 46.848331, lng: 74.995917, zoom: 11 },
  атбасар: { lat: 51.816, lng: 68.358, zoom: 12 },
};

/** Коды из справочника городов Stellref (01, 02, …) + латинские аббревиатуры */
const BY_CODE: Record<string, CityMapCenter> = {
  '01': { lat: 51.169392, lng: 71.449074, zoom: 11 },
  '02': { lat: 43.238949, lng: 76.889709, zoom: 12 },
  '03': { lat: 53.283, lng: 69.4, zoom: 11 },
  '04': { lat: 50.283933, lng: 57.166978, zoom: 11 },
  '06': { lat: 47.116667, lng: 51.883333, zoom: 11 },
  '07': { lat: 51.227222, lng: 51.376389, zoom: 11 },
  '08': { lat: 42.8996, lng: 71.3696, zoom: 12 },
  '09': { lat: 49.804683, lng: 73.109406, zoom: 11 },
  '10': { lat: 53.214, lng: 63.624, zoom: 11 },
  '11': { lat: 44.848831, lng: 65.509167, zoom: 11 },
  '14': { lat: 52.287, lng: 76.966, zoom: 11 },
  '16': { lat: 49.948, lng: 82.627, zoom: 11 },
  '17': { lat: 42.341737, lng: 69.590101, zoom: 12 },
  '18': { lat: 50.411, lng: 80.227, zoom: 11 },
  '19': { lat: 45.0156, lng: 78.3739, zoom: 12 },
  ALA: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  AST: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  TRZ: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  AKX: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  SHM: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  KGF: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  PAV: { lat: 52.287, lng: 76.966, zoom: 11 },
  BLH: { lat: 46.848331, lng: 74.995917, zoom: 11 },
};

export const KAZAKHSTAN_CENTER: CityMapCenter = { lat: 48.0, lng: 66.0, zoom: 5 };

export function resolveCityMapCenter(cityName?: string, cityCode?: string): CityMapCenter | null {
  if (cityCode) {
    const codeKey = cityCode.trim();
    const byCode = BY_CODE[codeKey] ?? BY_CODE[codeKey.toUpperCase()];
    if (byCode) return byCode;
  }
  if (cityName) {
    const key = cityName.trim().toLowerCase();
    if (BY_NAME[key]) return BY_NAME[key];
  }
  return null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function isNearCityCenter(
  lat: number,
  lng: number,
  center: CityMapCenter,
  maxKm = 180,
): boolean {
  return haversineKm(lat, lng, center.lat, center.lng) <= maxKm;
}

export function toLatLngTuple(center: CityMapCenter): [number, number] {
  return [center.lat, center.lng];
}

export function computeCentroidFromPoints(points: MapPointLike[]): CityMapCenter | null {
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const p of points) {
    const coords = p.location?.coordinates;
    if (!coords) continue;
    const [lng, lat] = coords;
    if (lat === 0 && lng === 0) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    sumLat += lat;
    sumLng += lng;
    count++;
  }

  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count, zoom: 11 };
}

export type MapViewSettings = {
  center: CityMapCenter;
  /** Фильтровать точки далеко от центра — только если город есть в справочнике */
  filterOutliers: boolean;
};

export function buildMapViewSettings(
  cityId?: string,
  cityName?: string,
  cityCode?: string,
  points?: MapPointLike[],
): MapViewSettings {
  const singleCity = Boolean(cityId && cityId !== 'all');
  if (!singleCity) {
    return { center: KAZAKHSTAN_CENTER, filterOutliers: false };
  }

  const known = resolveCityMapCenter(cityName, cityCode);
  if (known) {
    return { center: known, filterOutliers: true };
  }

  const derived = points?.length ? computeCentroidFromPoints(points) : null;
  return {
    center: derived ?? KAZAKHSTAN_CENTER,
    filterOutliers: false,
  };
}
