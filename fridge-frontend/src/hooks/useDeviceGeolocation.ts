import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DeviceGeoPoint,
  getDeviceGeolocation,
  geolocationErrorMessage,
  isGeoPoint,
  isGeolocationAvailable,
} from '../utils/deviceGeolocation';

type LocationStatus = 'idle' | 'getting' | 'success' | 'error';

export function useDeviceGeolocation(options?: { prefetch?: boolean }) {
  const prefetch = options?.prefetch !== false;
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [currentLocation, setCurrentLocation] = useState<DeviceGeoPoint | null>(null);
  const [geoRefreshWarning, setGeoRefreshWarning] = useState<string | null>(null);
  const [lastGeoError, setLastGeoError] = useState<string | null>(null);
  const locationRef = useRef<DeviceGeoPoint | null>(null);

  useEffect(() => {
    locationRef.current = currentLocation;
  }, [currentLocation]);

  const refreshGeolocation = useCallback(async (): Promise<DeviceGeoPoint | null> => {
    if (!isGeolocationAvailable()) {
      const msg = typeof window !== 'undefined' && !window.isSecureContext
        ? 'Геолокация работает только по HTTPS (stellref.kz).'
        : 'Браузер не поддерживает геолокацию.';
      setLocationStatus('error');
      setLastGeoError(msg);
      return null;
    }

    setLocationStatus('getting');
    setLastGeoError(null);

    const result = await getDeviceGeolocation();
    if (isGeoPoint(result)) {
      setCurrentLocation(result);
      setLocationStatus('success');
      setGeoRefreshWarning(null);
      return result;
    }

    if (locationRef.current) {
      setLocationStatus('success');
      setGeoRefreshWarning(
        `${result.message} При отправке будет использована ранее определённая точка.`,
      );
      return locationRef.current;
    }

    setLocationStatus('error');
    setGeoRefreshWarning(null);
    setLastGeoError(result.message);
    return null;
  }, []);

  useEffect(() => {
    if (!prefetch || !isGeolocationAvailable()) return;
    void refreshGeolocation();
  }, [prefetch, refreshGeolocation]);

  const ensureGeolocation = useCallback(async (): Promise<DeviceGeoPoint> => {
    if (currentLocation) return currentLocation;

    const geo = await refreshGeolocation();
    if (geo) return geo;

    const fallback = await getDeviceGeolocation();
    if (isGeoPoint(fallback)) {
      setCurrentLocation(fallback);
      setLocationStatus('success');
      return fallback;
    }

    throw new Error(fallback.message || geolocationErrorMessage(0));
  }, [currentLocation, refreshGeolocation]);

  return {
    locationStatus,
    currentLocation,
    geoRefreshWarning,
    lastGeoError,
    refreshGeolocation,
    ensureGeolocation,
  };
}
