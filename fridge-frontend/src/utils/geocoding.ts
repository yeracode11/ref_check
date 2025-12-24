/**
 * Утилита для конвертации координат в читабельный адрес (reverse geocoding)
 * Использует OpenStreetMap Nominatim API
 */

import { useState, useEffect } from 'react';

// Кэш для хранения результатов геокодирования
const geocodingCache = new Map<string, { address: string; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

// Очередь запросов для соблюдения лимита Nominatim (1 запрос в секунду)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 секунда между запросами

/**
 * Конвертирует координаты в адрес
 * @param lat - широта
 * @param lng - долгота
 * @returns Promise с адресом или null
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  // Проверяем кэш
  const cacheKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const cached = geocodingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.address;
  }

  try {
    // Соблюдаем лимит Nominatim (1 запрос в секунду)
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    // Используем OpenStreetMap Nominatim API
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'FridgeManager/1.0', // Требуется Nominatim
        },
      }
    );

    if (!response.ok) {
      console.warn('[Geocoding] Failed to fetch address:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.error) {
      console.warn('[Geocoding] Error from Nominatim:', data.error);
      return null;
    }

    // Формируем читабельный адрес из данных OSM
    const address = formatAddress(data);
    
    // Сохраняем в кэш
    if (address) {
      geocodingCache.set(cacheKey, { address, timestamp: Date.now() });
    }

    return address;
  } catch (error) {
    console.error('[Geocoding] Error:', error);
    return null;
  }
}

/**
 * Форматирует адрес из ответа Nominatim
 */
function formatAddress(data: any): string | null {
  if (!data.address) {
    return null;
  }

  const addr = data.address;
  const parts: string[] = [];

  // Приоритет компонентов адреса
  if (addr.road) parts.push(addr.road);
  if (addr.house_number) parts.push(addr.house_number);
  if (addr.suburb) parts.push(addr.suburb);
  if (addr.city || addr.town || addr.village) {
    parts.push(addr.city || addr.town || addr.village);
  }
  if (addr.state) parts.push(addr.state);
  if (addr.country) parts.push(addr.country);

  if (parts.length === 0) {
    // Если нет структурированного адреса, используем display_name
    return data.display_name || null;
  }

  return parts.join(', ');
}

/**
 * Хук для использования reverse geocoding в компонентах
 */
export function useReverseGeocode(lat: number | null, lng: number | null) {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lat === null || lng === null || (lat === 0 && lng === 0)) {
      setAddress(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    reverseGeocode(lat, lng)
      .then((addr) => {
        if (!cancelled) {
          setAddress(addr);
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('[useReverseGeocode] Error:', error);
        if (!cancelled) {
          setAddress(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return { address, loading };
}

