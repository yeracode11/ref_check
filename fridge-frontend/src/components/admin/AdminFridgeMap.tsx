import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
// @ts-ignore - leaflet.markercluster расширяет L namespace
import 'leaflet.markercluster';

type AdminFridgeForMap = {
  id: string;
  name: string;
  code: string;
  address?: string;
  status: 'today' | 'week' | 'old' | 'never' | 'warehouse' | 'location_changed';
  warehouseStatus?: 'warehouse' | 'installed' | 'returned' | 'moved';
  location?: { type: 'Point'; coordinates: [number, number] };
};

type Props = {
  fridges: AdminFridgeForMap[];
};

// Иконки для разных статусов
// location_changed (местоположение изменилось) = черный
// today/week (свежие отметки в пределах недели) = зеленый
// old (старые отметки, больше недели) = красный
// never (нет посещений) = синий (на складе)
function getMarkerIcon(status: 'today' | 'week' | 'old' | 'never' | 'warehouse' | 'location_changed', hasCheckin: boolean): L.DivIcon {
  let color = '#2563eb'; // синий по умолчанию (нет посещений / на складе)
  
  // Если местоположение изменилось - черный
  if (status === 'location_changed') {
    color = '#1f2937'; // черный
  } else if (status === 'today' || status === 'week') {
    // Свежие отметки в пределах недели - зеленый
    color = '#28a745'; // зелёный
  } else if (status === 'old') {
    // Старые отметки (больше недели) - красный
    color = '#dc3545'; // красный
  }

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// Функция для определения цвета кластера по статусам
// Приоритет: location_changed (черный) > старые отметки (красный) > свежие отметки (зеленый) > нет посещений (синий)
function getClusterColor(statuses: string[]): string {
  // Если есть хотя бы один маркер с измененным местоположением - черный
  if (statuses.some(s => s === 'location_changed')) return '#1f2937'; // черный
  // Если есть хотя бы один маркер со старыми отметками (old) - красный
  if (statuses.some(s => s === 'old')) return '#dc3545'; // красный
  // Если есть хотя бы один маркер со свежими отметками (today/week) - зеленый
  if (statuses.some(s => s === 'today' || s === 'week')) return '#28a745'; // зелёный
  return '#2563eb'; // синий (только если все маркеры без посещений / на складе)
}

export function AdminFridgeMap({ fridges }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Инициализация карты
    if (!mapInstanceRef.current) {
      // Центр Тараза (примерные координаты)
      const center: [number, number] = [42.8996, 71.3696];
      
      const map = L.map(mapRef.current, {
        center,
        zoom: 12,
        zoomControl: true,
      });

      // Добавляем тайлы OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // Создаём кластеризатор с кастомными стилями
      const markers = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        iconCreateFunction: (cluster) => {
          const childMarkers = cluster.getAllChildMarkers();
          const statuses = childMarkers.map((m: any) => m.options.status || 'never');
          const color = getClusterColor(statuses);
          const count = childMarkers.length;

          return L.divIcon({
            className: 'custom-cluster',
            html: `<div style="background-color: ${color}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${count}</div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          });
        },
      });

      map.addLayer(markers);
      mapInstanceRef.current = map;
      markersRef.current = markers;
    }

    // Обновляем маркеры
    const markers = markersRef.current;
    if (!markers) return;

    markers.clearLayers();

    const bounds: L.LatLngBoundsExpression = [];

    fridges.forEach((f) => {
      if (!f.location || !Array.isArray(f.location.coordinates)) return;
      const [lng, lat] = f.location.coordinates;
      if (lat === 0 && lng === 0) return; // пропускаем временные координаты

      // Leaflet использует [lat, lng], а у нас [lng, lat] из GeoJSON
      const position: [number, number] = [lat, lng];
      bounds.push(position);

      // Определяем, есть ли посещения (чек-ины)
      // Если статус не 'never', значит есть посещения
      const hasCheckin = f.status !== 'never';
      const icon = getMarkerIcon(f.status, hasCheckin);
      const marker = L.marker(position, { icon, status: f.status } as any);

      const warehouseLabel = f.warehouseStatus === 'warehouse' ? 'На складе' :
                            f.warehouseStatus === 'returned' ? 'Возврат на склад' :
                            'Установлен';
      const visitLabel = f.status === 'location_changed' ? 'Местоположение изменилось' :
                         f.status === 'today' ? 'Сегодня' :
                         f.status === 'week' ? 'Неделя' :
                         f.status === 'old' ? 'Давно' :
                         f.status === 'warehouse' ? warehouseLabel : 'Нет отметок';

      const popupContent = `
        <div style="min-width: 200px;">
          <strong>${f.name}</strong><br/>
          <div>Код: ${f.code}</div>
          ${f.address ? `<div>Адрес: ${f.address}</div>` : ''}
          <div>Статус: ${visitLabel}</div>
        </div>
      `;

      marker.bindPopup(popupContent);
      markers.addLayer(marker);
    });

    // Устанавливаем границы карты, чтобы показать все маркеры
    if (bounds.length > 0 && mapInstanceRef.current) {
      try {
        mapInstanceRef.current.fitBounds(bounds as L.LatLngBoundsExpression, {
          padding: [40, 40],
          maxZoom: 15,
        });
      } catch (e) {
        // Если не удалось установить границы, просто центрируем на первом маркере
        if (bounds.length > 0) {
          mapInstanceRef.current.setView(bounds[0] as [number, number], 12);
        }
      }
    }

    return () => {
      // Очистка при размонтировании
      if (markers) {
        markers.clearLayers();
      }
    };
  }, [fridges]);

  return (
    <div className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-200">
      <div ref={mapRef} className="w-full h-full" />
      <style>{`
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        .custom-cluster {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
