export type CityMapCenter = {
  lat: number;
  lng: number;
  zoom?: number;
};

/** Центры городов Казахстана для карты (lat/lng как в Leaflet) */
const BY_NAME: Record<string, CityMapCenter> = {
  алматы: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  almaty: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  астана: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  astana: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  'нур-султан': { lat: 51.169392, lng: 71.449074, zoom: 11 },
  тараз: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  taraz: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  актобе: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  aktobe: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  шымкент: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  shymkent: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  taldykorgan: { lat: 45.0156, lng: 78.3739, zoom: 12 },
  талдыкорган: { lat: 45.0156, lng: 78.3739, zoom: 12 },
  караганда: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  karaganda: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  павлодар: { lat: 52.287, lng: 76.966, zoom: 11 },
  pavlodar: { lat: 52.287, lng: 76.966, zoom: 11 },
  'усть-каменогорск': { lat: 49.948, lng: 82.627, zoom: 11 },
  semey: { lat: 50.411, lng: 80.227, zoom: 11 },
  семей: { lat: 50.411, lng: 80.227, zoom: 11 },
  костанай: { lat: 53.214, lng: 63.624, zoom: 11 },
  kostanay: { lat: 53.214, lng: 63.624, zoom: 11 },
  атбасар: { lat: 51.816, lng: 68.358, zoom: 12 },
  кокшетау: { lat: 53.283, lng: 69.4, zoom: 11 },
};

const BY_CODE: Record<string, CityMapCenter> = {
  ALA: { lat: 43.238949, lng: 76.889709, zoom: 12 },
  AST: { lat: 51.169392, lng: 71.449074, zoom: 11 },
  TRZ: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  TAR: { lat: 42.8996, lng: 71.3696, zoom: 12 },
  AKX: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  AKT: { lat: 50.283933, lng: 57.166978, zoom: 11 },
  SHM: { lat: 42.341737, lng: 69.590101, zoom: 12 },
  TDK: { lat: 45.0156, lng: 78.3739, zoom: 12 },
  KGF: { lat: 49.804683, lng: 73.109406, zoom: 11 },
  PAV: { lat: 52.287, lng: 76.966, zoom: 11 },
};

export const KAZAKHSTAN_CENTER: CityMapCenter = { lat: 48.0, lng: 66.0, zoom: 5 };

export function resolveCityMapCenter(cityName?: string, cityCode?: string): CityMapCenter | null {
  if (cityCode) {
    const byCode = BY_CODE[cityCode.trim().toUpperCase()];
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

/** Точка в радиусе города (для отсечения ошибочных координат) */
export function isNearCityCenter(
  lat: number,
  lng: number,
  center: CityMapCenter,
  maxKm = 150,
): boolean {
  return haversineKm(lat, lng, center.lat, center.lng) <= maxKm;
}

export function toLatLngTuple(center: CityMapCenter): [number, number] {
  return [center.lat, center.lng];
}
