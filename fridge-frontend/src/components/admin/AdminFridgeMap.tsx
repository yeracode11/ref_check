import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
// @ts-ignore - leaflet.markercluster расширяет L namespace
import 'leaflet.markercluster';
import {
  getEquipmentIndicator,
  getEquipmentMarkerColor,
  getEquipmentStatusLabel,
  EquipmentStatus,
} from '../../utils/fridgeUtils';

type AdminFridgeForMap = {
  id: string;
  name: string;
  code: string;
  address?: string;
  status: 'today' | 'week' | 'old' | 'never' | 'warehouse' | 'location_changed';
  warehouseStatus?: 'warehouse' | 'installed' | 'returned' | 'moved';
  visitStatus?: 'today' | 'week' | 'old' | 'never';
  equipmentStatus?: EquipmentStatus;
  location?: { type: 'Point'; coordinates: [number, number] };
};

type Props = {
  fridges: AdminFridgeForMap[];
};

function getVisitMarkerColor(status: AdminFridgeForMap['status']): string {
  const normalizedStatus = status === 'location_changed' ? 'old' : status;
  if (normalizedStatus === 'today' || normalizedStatus === 'week') return '#28a745';
  if (normalizedStatus === 'old') return '#dc3545';
  return '#2563eb';
}

function getMarkerColor(
  visitStatus: AdminFridgeForMap['status'],
  equipmentStatus?: EquipmentStatus,
): string {
  if (equipmentStatus === 'broken' || equipmentStatus === 'under_repair') {
    return getEquipmentMarkerColor(getEquipmentIndicator(equipmentStatus));
  }
  return getVisitMarkerColor(visitStatus);
}

function getMarkerIcon(
  visitStatus: AdminFridgeForMap['status'],
  equipmentStatus?: EquipmentStatus,
): L.DivIcon {
  const color = getMarkerColor(visitStatus, equipmentStatus);

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// Приоритет кластера: сломан (фиолетовый) > на ремонте (оранжевый) > давно (красный) > свежие (зелёный) > синий
function getClusterColor(
  visitStatuses: string[],
  equipmentStatuses: (EquipmentStatus | undefined)[],
): string {
  if (equipmentStatuses.some((s) => s === 'broken')) {
    return getEquipmentMarkerColor('purple');
  }
  if (equipmentStatuses.some((s) => s === 'under_repair')) {
    return getEquipmentMarkerColor('orange');
  }

  const normalizedStatuses = visitStatuses.map((s) => (s === 'location_changed' ? 'old' : s));
  if (normalizedStatuses.some((s) => s === 'old')) return '#dc3545';
  if (normalizedStatuses.some((s) => s === 'today' || s === 'week')) return '#28a745';
  return '#2563eb';
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
          const equipmentStatuses = childMarkers.map((m: any) => m.options.equipmentStatus);
          const color = getClusterColor(statuses, equipmentStatuses);
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

      const equipmentStatus = f.equipmentStatus || 'working';
      // Сломанный / на ремонте — всегда приоритетнее цвета свежей отметки
      const icon = getMarkerIcon(
        equipmentStatus === 'broken' || equipmentStatus === 'under_repair' ? 'never' : f.status,
        equipmentStatus,
      );
      const marker = L.marker(position, {
        icon,
        status: f.status,
        equipmentStatus,
      } as any);

      const warehouseLabel = f.warehouseStatus === 'warehouse' ? 'На складе' :
                            f.warehouseStatus === 'returned' ? 'Возврат на склад' :
                            'Установлен';
      // Отметка (давность визита) и складской статус показываем раздельно,
      // чтобы не было путаницы "синий/зеленый".
      const visitSource = f.visitStatus || (f.status === 'warehouse' ? 'never' : f.status);
      const visitLabel = visitSource === 'today' ? 'Сегодня' :
                         visitSource === 'week' ? 'Неделя' :
                         visitSource === 'old' ? 'Давно' : 'Нет отметок';

      const equipmentLabel = getEquipmentStatusLabel(equipmentStatus);
      const popupContent = `
        <div style="min-width: 200px;">
          <strong>${f.name}</strong><br/>
          <div>Код: ${f.code}</div>
          ${f.address ? `<div>Адрес: ${f.address}</div>` : ''}
          <div>Оборудование: ${equipmentLabel}</div>
          <div>Склад: ${warehouseLabel}</div>
          <div>Отметка: ${visitLabel}</div>
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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#9333ea' }} />
          Сломан
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#ea580c' }} />
          На ремонте
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#28a745' }} />
          Свежая отметка
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#dc3545' }} />
          Давно без визита
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#2563eb' }} />
          Исправен / нет отметок
        </span>
      </div>
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
    </div>
  );
}
