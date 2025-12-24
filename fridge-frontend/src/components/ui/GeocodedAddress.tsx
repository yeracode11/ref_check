import { useReverseGeocode } from '../../utils/geocoding';

type GeocodedAddressProps = {
  lat: number;
  lng: number;
  className?: string;
  fallback?: string;
};

/**
 * Компонент для отображения адреса вместо координат
 * Автоматически конвертирует координаты в читабельный адрес
 */
export function GeocodedAddress({ lat, lng, className = '', fallback }: GeocodedAddressProps) {
  const { address, loading } = useReverseGeocode(lat, lng);

  if (loading) {
    return (
      <span className={`text-xs text-slate-400 ${className}`}>
        Загрузка адреса...
      </span>
    );
  }

  if (address) {
    return (
      <span className={`text-xs text-slate-600 ${className}`}>
        📍 {address}
      </span>
    );
  }

  // Если адрес не получен, показываем координаты или fallback
  if (fallback) {
    return (
      <span className={`text-xs text-slate-400 font-mono ${className}`}>
        {fallback}
      </span>
    );
  }

  return (
    <span className={`text-xs text-slate-400 font-mono ${className}`}>
      {lat.toFixed(6)}, {lng.toFixed(6)}
    </span>
  );
}

