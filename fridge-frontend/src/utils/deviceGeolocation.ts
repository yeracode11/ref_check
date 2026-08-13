export type DeviceGeoPoint = { lat: number; lng: number };

export type DeviceGeoError = {
  code: number;
  message: string;
};

type GeoAttemptOptions = {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
};

const ATTEMPTS: GeoAttemptOptions[] = [
  { enableHighAccuracy: true, timeout: 15000, maximumAge: 120_000 },
  { enableHighAccuracy: false, timeout: 20000, maximumAge: 300_000 },
];

function requestPosition(options: GeoAttemptOptions): Promise<DeviceGeoPoint | DeviceGeoError> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        resolve({ code: err.code, message: geolocationErrorMessage(err.code) });
      },
      options,
    );
  });
}

/** Одна попытка через watchPosition — иногда срабатывает, когда getCurrentPosition падает по таймауту. */
function watchPositionOnce(options: GeoAttemptOptions, waitMs = 20000): Promise<DeviceGeoPoint | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DeviceGeoPoint | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), waitMs);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => finish(null),
      options,
    );
  });
}

export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.geolocation
    && (typeof window === 'undefined' || window.isSecureContext);
}

export function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Доступ к геолокации запрещён. Разрешите её для сайта stellref.kz в настройках браузера или телефона.';
    case 2:
      return 'GPS недоступен. Включите геолокацию на устройстве и попробуйте ближе к окну или на улице.';
    case 3:
      return 'Превышено время ожидания GPS. Нажмите «Обновить геолокацию» и подождите 10–20 секунд.';
    default:
      return 'Не удалось определить местоположение. Проверьте GPS и разрешения для браузера.';
  }
}

export function isGeoPoint(value: DeviceGeoPoint | DeviceGeoError): value is DeviceGeoPoint {
  return 'lat' in value && 'lng' in value;
}

/**
 * Запрашивает координаты: точный GPS → сеть/Wi‑Fi → watchPosition.
 */
export async function getDeviceGeolocation(): Promise<DeviceGeoPoint | DeviceGeoError> {
  if (!navigator.geolocation) {
    return { code: 0, message: 'Браузер не поддерживает геолокацию.' };
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { code: 0, message: 'Геолокация работает только по HTTPS (stellref.kz).' };
  }

  let lastError: DeviceGeoError = { code: 0, message: geolocationErrorMessage(0) };

  for (const attempt of ATTEMPTS) {
    const result = await requestPosition(attempt);
    if (isGeoPoint(result)) return result;
    lastError = result;
    if (result.code === 1) return result;
  }

  const watched = await watchPositionOnce(ATTEMPTS[1]);
  if (watched) return watched;

  return lastError;
}
