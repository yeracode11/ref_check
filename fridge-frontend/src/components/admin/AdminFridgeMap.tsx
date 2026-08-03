import { useCallback, useEffect, useRef, memo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
// @ts-ignore
import 'leaflet.markercluster';

import { api } from '../../shared/apiClient';
import {
  getEquipmentIndicator,
  getEquipmentMarkerColor,
  getEquipmentStatusLabel,
  EquipmentStatus,
} from '../../utils/fridgeUtils';

export type AdminFridgeForMap = {
  id: string;
  name: string;
  code: string;
  address?: string;
  status: 'today' | 'week' | 'old' | 'never' | 'warehouse' | 'location_changed' | 'broken' | 'under_repair';
  warehouseStatus?: 'warehouse' | 'installed' | 'returned' | 'moved';
  visitStatus?: 'today' | 'week' | 'old' | 'never';
  equipmentStatus?: EquipmentStatus;
  location?: { type: 'Point'; coordinates: [number, number] };
};

type MapPointItem = AdminFridgeForMap & { type: 'point' };

type BulkResponse = {
  items: MapPointItem[];
  total: number;
  loaded: number;
  hasMore: boolean;
};

type Props = {
  cityId?: string;
};

const DEFAULT_CENTER: L.LatLngTuple = [42.8996, 71.3696];
const DEFAULT_ZOOM = 12;
const BULK_CHUNK = 3000;

function getVisitMarkerColor(status: string): string {
  if (status === 'broken') return getEquipmentMarkerColor('purple');
  if (status === 'under_repair') return getEquipmentMarkerColor('orange');
  const normalizedStatus = status === 'location_changed' ? 'old' : status;
  if (normalizedStatus === 'today' || normalizedStatus === 'week') return '#28a745';
  if (normalizedStatus === 'old') return '#dc3545';
  return '#2563eb';
}

function getMarkerColor(visitStatus: string, equipmentStatus?: EquipmentStatus): string {
  if (equipmentStatus === 'broken' || equipmentStatus === 'under_repair') {
    return getEquipmentMarkerColor(getEquipmentIndicator(equipmentStatus));
  }
  return getVisitMarkerColor(visitStatus);
}

function createPointIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function buildPopupHtml(f: AdminFridgeForMap): string {
  const equipmentStatus = f.equipmentStatus || 'working';
  const warehouseLabel = f.warehouseStatus === 'warehouse' ? 'На складе'
    : f.warehouseStatus === 'returned' ? 'Возврат на склад'
      : 'Установлен';
  const visitSource = f.visitStatus || (f.status === 'warehouse' ? 'never' : f.status);
  const visitLabel = visitSource === 'today' ? 'Сегодня'
    : visitSource === 'week' ? 'Неделя'
      : visitSource === 'old' ? 'Давно' : 'Нет отметок';

  return `
    <div style="min-width: 200px;">
      <strong>${f.name}</strong><br/>
      <div>Код: ${f.code}</div>
      ${f.address ? `<div>Адрес: ${f.address}</div>` : ''}
      <div>Оборудование: ${getEquipmentStatusLabel(equipmentStatus)}</div>
      <div>Склад: ${warehouseLabel}</div>
      <div>Отметка: ${visitLabel}</div>
    </div>
  `;
}

function AdminFridgeMapInner({ cityId = 'all' }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pointClusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const iconCacheRef = useRef(new Map<string, L.DivIcon>());
  const popupDataRef = useRef(new Map<number, AdminFridgeForMap>());
  const abortRef = useRef<AbortController | null>(null);
  const pointsRef = useRef<MapPointItem[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const [phase, setPhase] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [hint, setHint] = useState<string | null>(null);

  const renderAllPoints = useCallback((points: MapPointItem[]) => {
    const map = mapInstanceRef.current;
    const cluster = pointClusterRef.current;
    if (!map || !cluster) return;

    cluster.clearLayers();
    popupDataRef.current.clear();

    const markerLayers: L.Marker[] = [];
    const bounds: L.LatLngTuple[] = [];
    let popupId = 0;

    for (const f of points) {
      if (!f.location?.coordinates) continue;
      const [lng, lat] = f.location.coordinates;
      if (lat === 0 && lng === 0) continue;

      const position: L.LatLngTuple = [lat, lng];
      bounds.push(position);

      const equipmentStatus = f.equipmentStatus || 'working';
      const visitForIcon = equipmentStatus === 'broken' || equipmentStatus === 'under_repair'
        ? 'never'
        : f.status;
      const iconKey = `${visitForIcon}:${equipmentStatus}`;
      let icon = iconCacheRef.current.get(iconKey);
      if (!icon) {
        icon = createPointIcon(getMarkerColor(visitForIcon, equipmentStatus));
        iconCacheRef.current.set(iconKey, icon);
      }

      const id = popupId++;
      popupDataRef.current.set(id, f);

      const marker = L.marker(position, {
        icon,
        status: f.status,
        equipmentStatus,
      } as L.MarkerOptions & { status: string; equipmentStatus: EquipmentStatus });

      marker.on('click', () => {
        const row = popupDataRef.current.get(id);
        if (!row) return;
        marker.bindPopup(buildPopupHtml(row)).openPopup();
      });

      markerLayers.push(marker);
    }

    if (markerLayers.length) {
      cluster.addLayers(markerLayers);
    }

    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      } catch {
        map.setView(bounds[0], DEFAULT_ZOOM);
      }
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, []);

  const loadAllPoints = useCallback(async (targetCityId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setHint(null);
    pointsRef.current = [];

    const params = new URLSearchParams();
    if (targetCityId && targetCityId !== 'all') {
      params.set('cityId', targetCityId);
    }

    let skip = 0;
    let total = 0;

    try {
      while (true) {
        params.set('skip', String(skip));
        params.set('limit', String(BULK_CHUNK));

        const res = await api.get<BulkResponse>(`/api/admin/map-fridges/bulk?${params.toString()}`, {
          signal: controller.signal,
          timeout: 300000,
        });

        if (controller.signal.aborted) return;

        total = res.data.total;
        pointsRef.current.push(...res.data.items);
        skip = res.data.loaded;
        setProgress({ loaded: skip, total });

        if (!res.data.hasMore) break;
      }

      if (controller.signal.aborted) return;

      setPhase('rendering');
      requestAnimationFrame(() => {
        if (controller.signal.aborted) return;
        renderAllPoints(pointsRef.current);
        setPhase('ready');
        if (pointsRef.current.length === 0) {
          setHint('Нет холодильников с координатами в выбранном регионе.');
        }
      });
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      const err = e as { message?: string; response?: { data?: { error?: string } } };
      setPhase('error');
      setHint(err?.response?.data?.error || err?.message || 'Ошибка загрузки карты');
    }
  }, [renderAllPoints]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 2,
    }).addTo(map);

    const pointCluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 150,
      chunkDelay: 40,
      maxClusterRadius: 55,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      removeOutsideVisibleBounds: true,
      zoomToBoundsOnClick: true,
    });

    map.addLayer(pointCluster);
    mapInstanceRef.current = map;
    pointClusterRef.current = pointCluster;
    map.whenReady(() => setMapReady(true));

    return () => {
      abortRef.current?.abort();
      setMapReady(false);
      pointCluster.clearLayers();
      map.remove();
      mapInstanceRef.current = null;
      pointClusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return undefined;
    pointClusterRef.current?.clearLayers();
    loadAllPoints(cityId);
    return () => abortRef.current?.abort();
  }, [cityId, mapReady, loadAllPoints]);

  const progressPct = progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
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
        {phase === 'ready' && progress.total > 0 && (
          <span className="text-slate-500 ml-auto">{progress.total} точек на карте</span>
        )}
        {hint && <span className="text-amber-700 ml-auto">{hint}</span>}
      </div>
      <div className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-200 relative">
        <div ref={mapRef} className="w-full h-full" />
        {(phase === 'loading' || phase === 'rendering') && (
          <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center gap-3 z-[500]">
            <p className="text-sm font-medium text-slate-800">
              {phase === 'rendering' ? 'Отрисовка карты…' : 'Загрузка холодильников…'}
            </p>
            {progress.total > 0 && (
              <>
                <p className="text-xs text-slate-600">
                  {progress.loaded.toLocaleString('ru-RU')} / {progress.total.toLocaleString('ru-RU')}
                </p>
                <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <style>{`
          .custom-marker {
            background: transparent !important;
            border: none !important;
          }
          .leaflet-popup-content-wrapper { border-radius: 8px; }
        `}</style>
      </div>
    </div>
  );
}

export const AdminFridgeMap = memo(AdminFridgeMapInner);
