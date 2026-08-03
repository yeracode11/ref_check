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

type MapClusterItem = {
  type: 'cluster';
  count: number;
  status: string;
  location: { type: 'Point'; coordinates: [number, number] };
  bbox: { west: number; south: number; east: number; north: number };
};

type MapPointItem = AdminFridgeForMap & { type: 'point' };

type ViewportResponse = {
  mode: 'points' | 'clusters';
  items: Array<MapClusterItem | MapPointItem>;
  truncated?: boolean;
};

type Props = {
  /** City _id or "all" (admin). Accountants get city from backend scope. */
  cityId?: string;
};

const DEFAULT_CENTER: L.LatLngTuple = [42.8996, 71.3696];
const DEFAULT_ZOOM = 12;

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

const clusterIconCache = new Map<string, L.DivIcon>();

function createServerClusterIcon(color: string, count: number): L.DivIcon {
  const label = count > 99 ? '99+' : String(count);
  const cacheKey = `${color}:${label}`;
  let icon = clusterIconCache.get(cacheKey);
  if (!icon) {
    const size = count > 99 ? 44 : count > 20 ? 40 : 36;
    icon = L.divIcon({
      className: 'custom-cluster',
      html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 13px;">${label}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    clusterIconCache.set(cacheKey, icon);
  }
  return icon;
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
  const serverClusterLayerRef = useRef<L.LayerGroup | null>(null);
  const iconCacheRef = useRef(new Map<string, L.DivIcon>());
  const popupDataRef = useRef(new Map<number, AdminFridgeForMap>());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cityIdRef = useRef(cityId);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  cityIdRef.current = cityId;

  const clearLayers = useCallback(() => {
    pointClusterRef.current?.clearLayers();
    serverClusterLayerRef.current?.clearLayers();
    popupDataRef.current.clear();
  }, []);

  const renderViewport = useCallback((data: ViewportResponse) => {
    const map = mapInstanceRef.current;
    const pointCluster = pointClusterRef.current;
    const serverLayer = serverClusterLayerRef.current;
    if (!map || !pointCluster || !serverLayer) return;

    clearLayers();

    if (data.mode === 'clusters') {
      map.removeLayer(pointCluster);
      if (!map.hasLayer(serverLayer)) map.addLayer(serverLayer);

      for (const item of data.items) {
        if (item.type !== 'cluster') continue;
        const [lng, lat] = item.location.coordinates;
        const color = getVisitMarkerColor(item.status);
        const marker = L.marker([lat, lng], {
          icon: createServerClusterIcon(color, item.count),
        });
        marker.bindPopup(`<strong>${item.count}</strong> холодильников`);
        marker.on('click', () => {
          const { south, west, north, east } = item.bbox;
          map.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 16 });
        });
        serverLayer.addLayer(marker);
      }
      return;
    }

    map.removeLayer(serverLayer);
    if (!map.hasLayer(pointCluster)) map.addLayer(pointCluster);

    const markerLayers: L.Marker[] = [];
    let popupId = 0;

    for (const raw of data.items) {
      if (raw.type !== 'point') continue;
      const f = raw as MapPointItem;
      if (!f.location?.coordinates) continue;
      const [lng, lat] = f.location.coordinates;
      if (lat === 0 && lng === 0) continue;

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

      const marker = L.marker([lat, lng], {
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
      pointCluster.addLayers(markerLayers);
    }

    if (data.truncated) {
      setHint('Показаны не все точки в области — увелите масштаб.');
    } else {
      setHint(null);
    }
  }, [clearLayers]);

  const fetchViewport = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const bounds = map.getBounds();
    const params = new URLSearchParams({
      west: String(bounds.getWest()),
      south: String(bounds.getSouth()),
      east: String(bounds.getEast()),
      north: String(bounds.getNorth()),
      zoom: String(map.getZoom()),
    });
    const cid = cityIdRef.current;
    if (cid && cid !== 'all') params.set('cityId', cid);

    setLoading(true);
    try {
      const res = await api.get<ViewportResponse>(`/api/admin/map-fridges?${params.toString()}`, {
        signal: controller.signal,
        timeout: 120000,
      });
      if (controller.signal.aborted) return;
      renderViewport(res.data);
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      const err = e as { message?: string };
      setHint(err?.message || 'Ошибка загрузки области карты');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [renderViewport]);

  const scheduleFetch = useCallback(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchViewport();
    }, 350);
  }, [fetchViewport]);

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
      chunkInterval: 120,
      chunkDelay: 30,
      maxClusterRadius: 50,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      removeOutsideVisibleBounds: true,
    });

    const serverLayer = L.layerGroup();

    map.addLayer(pointCluster);
    mapInstanceRef.current = map;
    pointClusterRef.current = pointCluster;
    serverClusterLayerRef.current = serverLayer;

    map.on('moveend', scheduleFetch);
    map.whenReady(() => {
      scheduleFetch();
    });

    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      abortRef.current?.abort();
      map.off('moveend', scheduleFetch);
      pointCluster.clearLayers();
      serverLayer.clearLayers();
      map.remove();
      mapInstanceRef.current = null;
      pointClusterRef.current = null;
      serverClusterLayerRef.current = null;
    };
  }, [scheduleFetch]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    clearLayers();
    setHint(null);
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    scheduleFetch();
  }, [cityId, clearLayers, scheduleFetch]);

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
        {loading && <span className="text-slate-400 ml-auto">Загрузка…</span>}
        {!loading && hint && <span className="text-amber-700 ml-auto">{hint}</span>}
      </div>
      <div className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-200 relative">
        <div ref={mapRef} className="w-full h-full" />
        <style>{`
          .custom-marker, .custom-cluster {
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
