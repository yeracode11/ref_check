import { useReverseGeocode } from '../../utils/geocoding';

type GeocodedAddressProps = {
  lat: number;
  lng: number;
  className?: string;
  fallback?: string;
  /** Подпись перед адресом (например «Место отметки (GPS)») */
  label?: string;
};

/**
 * Компонент для отображения адреса вместо координат
 * Автоматически конвертирует координаты в читабельный адрес
 */
export function GeocodedAddress({ lat, lng, className = '', fallback, label }: GeocodedAddressProps) {
  const { address, loading } = useReverseGeocode(lat, lng);
  const prefix = label ? `${label}: ` : '';

  if (loading) {
    return (
      <span className={`text-xs text-slate-400 ${className}`}>
        {prefix}Загрузка адреса...
      </span>
    );
  }

  if (address) {
    return (
      <span className={`text-xs text-slate-600 ${className}`}>
        📍 {prefix}{address}
      </span>
    );
  }

  // Если адрес не получен, показываем координаты или fallback
  if (fallback) {
    return (
      <span className={`text-xs text-slate-400 font-mono ${className}`}>
        {prefix}{fallback}
      </span>
    );
  }

  return (
    <span className={`text-xs text-slate-400 font-mono ${className}`}>
      {prefix}{lat.toFixed(6)}, {lng.toFixed(6)}
    </span>
  );
}

