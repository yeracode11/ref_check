import { useCallback, useEffect, useLayoutEffect, useRef, memo, useState } from 'react';
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
import {
  CityMapCenter,
  buildMapViewSettings,
  isNearCityCenter,
  toLatLngTuple,
} from '../../utils/cityMapCenters';
import { resolveUserCityId } from '../../utils/userCityId';

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
  warehouseHidden?: number;
};

type Props = {
  cityId?: string;
  cityName?: string;
  cityCode?: string;
};

type DataPhase = 'loading' | 'ready' | 'error';

const DEFAULT_ZOOM = 12;
const BULK_CHUNK = 3000;
const MAP_HEIGHT = 480;
/** Холодильники ближе этого расстояния считаются одной точкой на карте */
const SAME_POINT_METERS = 35;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function getVisitMarkerColor(status: string): string {
  if (status === 'broken') return getEquipmentMarkerColor('purple');
  if (status === 'under_repair') return getEquipmentMarkerColor('orange');
  if (status === 'seasonal_closure') return '#9333ea';
  const normalizedStatus = status === 'location_changed' ? 'old' : status;
  if (normalizedStatus === 'today' || normalizedStatus === 'week') return '#28a745';
  if (normalizedStatus === 'old') return '#dc3545';
  return '#2563eb';
}

function getMarkerColor(
  visitStatus: string,
  equipmentStatus?: EquipmentStatus,
  warehouseStatus?: string,
): string {
  if (equipmentStatus === 'broken' || equipmentStatus === 'under_repair') {
    return getEquipmentMarkerColor(getEquipmentIndicator(equipmentStatus));
  }
  // Синий — только «на складе / возврат» без свежей отметки (never).
  // Если ТП уже отметился — показываем зелёный/красный по давности визита.
  const atDepotWithoutVisit =
    (warehouseStatus === 'warehouse' || warehouseStatus === 'returned')
    && (visitStatus === 'never' || visitStatus === 'warehouse');
  if (atDepotWithoutVisit) {
    return '#1d4ed8';
  }
  return getVisitMarkerColor(visitStatus);
}

function createPointIcon(color: string, count = 1): L.DivIcon {
  const size = count > 1 ? 28 : 20;
  const badge = count > 1
    ? `<span style="position:absolute;top:-6px;right:-8px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#0f172a;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center;border:2px solid white;">${count > 99 ? '99+' : count}</span>`
    : '';
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="position:relative;background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Приоритет кластера: сломан > на ремонте > давно > свежие > синий */
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

function createClusterIcon(cluster: { getAllChildMarkers: () => L.Marker[]; getChildCount: () => number }): L.DivIcon {
  const childMarkers = cluster.getAllChildMarkers();
  const statuses = childMarkers.map((m) => {
    const opts = m.options as L.MarkerOptions & { status?: string };
    return opts.status || 'never';
  });
  const equipmentStatuses = childMarkers.map((m) => {
    const opts = m.options as L.MarkerOptions & { equipmentStatus?: EquipmentStatus };
    return opts.equipmentStatus;
  });
  const color = getClusterColor(statuses, equipmentStatuses);
  const count = cluster.getChildCount();
  const size = count < 10 ? 36 : count < 100 ? 40 : 44;
  const fontSize = count < 100 ? 14 : 12;

  return L.divIcon({
    className: 'custom-cluster',
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: ${fontSize}px;">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createMarkerClusterGroup(): L.MarkerClusterGroup {
  return L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 150,
    chunkDelay: 40,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 19,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction: createClusterIcon,
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

function groupPointsByProximity(points: MapPointItem[], maxMeters = SAME_POINT_METERS): MapPointItem[][] {
  if (!points.length) return [];

  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const unite = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < points.length; i += 1) {
    const [lng1, lat1] = points[i].location!.coordinates;
    for (let j = i + 1; j < points.length; j += 1) {
      const [lng2, lat2] = points[j].location!.coordinates;
      if (haversineMeters(lat1, lng1, lat2, lng2) <= maxMeters) unite(i, j);
    }
  }

  const buckets = new Map<number, MapPointItem[]>();
  for (let i = 0; i < points.length; i += 1) {
    const root = find(i);
    const list = buckets.get(root);
    if (list) list.push(points[i]);
    else buckets.set(root, [points[i]]);
  }

  return Array.from(buckets.values());
}

function exactLocationKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function groupPointsByExactLocation(points: MapPointItem[]): MapPointItem[][] {
  const groups = new Map<string, MapPointItem[]>();
  for (const point of points) {
    const [lng, lat] = point.location!.coordinates;
    const key = exactLocationKey(lat, lng);
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }
  return Array.from(groups.values());
}

function isTightGroup(group: AdminFridgeForMap[], maxMeters = SAME_POINT_METERS): boolean {
  if (group.length <= 1) return true;
  const first = group[0].location?.coordinates;
  if (!first) return false;
  const [lng0, lat0] = first;
  return group.every((item) => {
    const coords = item.location?.coordinates;
    if (!coords) return false;
    const [lng, lat] = coords;
    return haversineMeters(lat0, lng0, lat, lng) <= maxMeters;
  });
}

function collectFridgeItems(markers: L.Marker[]): AdminFridgeForMap[] {
  const items: AdminFridgeForMap[] = [];
  for (const marker of markers) {
    const group = (marker.options as L.MarkerOptions & { fridgeGroup?: AdminFridgeForMap[] }).fridgeGroup;
    if (group?.length) items.push(...group);
  }
  return items;
}

function openFridgePopup(map: L.Map, latlng: L.LatLngExpression, items: AdminFridgeForMap[]): void {
  const html = items.length > 1 ? buildStackPopupHtml(items) : buildPopupHtml(items[0]);
  L.popup({ maxWidth: 340, autoPanPadding: [24, 24] })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map);
}

function buildStackPopupHtml(items: AdminFridgeForMap[]): string {
  const sharedAddress = items.every((item) => item.address === items[0].address)
    ? items[0].address
    : null;

  const rows = items.map((item, index) => `
    <div style="padding:8px 0;border-top:1px solid #e2e8f0;">
      <div style="font-size:11px;color:#64748b;margin-bottom:4px;">${index + 1} из ${items.length}</div>
      ${buildPopupHtml(item)}
    </div>
  `).join('');

  return `
    <div style="min-width: 240px; max-width: 320px; max-height: 360px; overflow-y: auto;">
      <strong>${items.length} холодильников в одной точке</strong>
      <div style="margin-top:4px;font-size:12px;color:#64748b;">Прокрутите список, чтобы увидеть все</div>
      ${sharedAddress ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${sharedAddress}</div>` : ''}
      <div style="margin-top:4px;">${rows}</div>
    </div>
  `;
}

type MapRenderStats = {
  fridgeCount: number;
  markerCount: number;
  installedCount: number;
};

function MapLegend({
  fridgeCount,
  markerCount,
  installedCount,
  warehouseHidden,
  hint,
}: {
  fridgeCount?: number;
  markerCount?: number;
  installedCount?: number;
  warehouseHidden?: number;
  hint?: string | null;
}) {
  return (
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
        <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#1d4ed8' }} />
        На складе / возврат (по отметке)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full border border-white shadow" style={{ background: '#2563eb' }} />
        Исправен / нет отметок
      </span>
      {fridgeCount != null && fridgeCount > 0 && (
        <span className="text-slate-500 ml-auto">
          {(installedCount ?? 0) > 0
            ? `${installedCount!.toLocaleString('ru-RU')} установлено · ${fridgeCount.toLocaleString('ru-RU')} маркеров`
            : `${fridgeCount.toLocaleString('ru-RU')} маркеров на карте`}
        </span>
      )}
      {warehouseHidden != null && warehouseHidden > 0 && (
        <span className="text-slate-500">
          · на складе / возврат без отметки: {warehouseHidden.toLocaleString('ru-RU')} (скрыты)
        </span>
      )}
      {hint && <span className="text-amber-700 ml-auto">{hint}</span>}
    </div>
  );
}

function LoadingOverlay({
  title,
  progress,
}: {
  title: string;
  progress: { loaded: number; total: number };
}) {
  const progressPct = progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;

  return (
    <div className="absolute inset-0 z-[1000] bg-white/90 flex flex-col items-center justify-center gap-4 px-6 pointer-events-none">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      <p className="text-base font-medium text-slate-800">{title}</p>
      {progress.total > 0 ? (
        <>
          <p className="text-sm text-slate-600">
            {progress.loaded.toLocaleString('ru-RU')} / {progress.total.toLocaleString('ru-RU')}
            {progressPct != null && ` (${progressPct}%)`}
          </p>
          <div className="w-full max-w-md h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300 rounded-full"
              style={{ width: `${progressPct ?? 0}%` }}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">Подключение к серверу…</p>
      )}
    </div>
  );
}

function AdminFridgeMapInner({ cityId: cityIdProp, cityName, cityCode }: Props) {
  const cityId = resolveUserCityId(cityIdProp);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pointClusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const iconCacheRef = useRef(new Map<string, L.DivIcon>());
  const popupDataRef = useRef(new Map<number, AdminFridgeForMap | AdminFridgeForMap[]>());
  const abortRef = useRef<AbortController | null>(null);
  const pointsRef = useRef<MapPointItem[]>([]);

  const [mapInitialized, setMapInitialized] = useState(false);
  const [dataPhase, setDataPhase] = useState<DataPhase>('loading');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [hint, setHint] = useState<string | null>(null);
  const [mapStats, setMapStats] = useState<MapRenderStats | null>(null);
  const [warehouseHidden, setWarehouseHidden] = useState(0);

  const destroyMap = useCallback(() => {
    abortRef.current?.abort();
    const map = mapInstanceRef.current;
    const cluster = pointClusterRef.current;
    if (cluster && map) {
      cluster.clearLayers();
      map.removeLayer(cluster);
    }
    if (map) {
      map.remove();
    }
    mapInstanceRef.current = null;
    pointClusterRef.current = null;
    popupDataRef.current.clear();
    setMapInitialized(false);
  }, []);

  const renderAllPoints = useCallback((
    points: MapPointItem[],
    viewCenter: CityMapCenter,
    filterOutliers: boolean,
  ) => {
    const map = mapInstanceRef.current;
    const cluster = pointClusterRef.current;
    if (!map || !cluster) {
      return { fridgeCount: 0, markerCount: 0, installedCount: 0 };
    }

    cluster.clearLayers();
    popupDataRef.current.clear();

    const markerLayers: L.Marker[] = [];
    let skippedFar = 0;
    const visiblePoints: MapPointItem[] = [];

    for (const f of points) {
      if (!f.location?.coordinates) continue;
      const [lng, lat] = f.location.coordinates;
      if (lat === 0 && lng === 0) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

      if (filterOutliers && !isNearCityCenter(lat, lng, viewCenter)) {
        skippedFar++;
        continue;
      }

      visiblePoints.push(f);
    }

    for (const group of groupPointsByExactLocation(visiblePoints)) {
      const f = group[0];
      const [lng, lat] = f.location!.coordinates;
      const position: L.LatLngTuple = [lat, lng];
      const stackCount = group.length;
      const equipmentStatuses = group.map((item) => item.equipmentStatus);
      const visitStatuses = group.map((item) => {
        const equipmentStatus = item.equipmentStatus || 'working';
        return equipmentStatus === 'broken' || equipmentStatus === 'under_repair'
          ? 'never'
          : item.status;
      });
      const markerColor = stackCount > 1
        ? getClusterColor(visitStatuses, equipmentStatuses)
        : getMarkerColor(
          visitStatuses[0],
          equipmentStatuses[0],
          group[0].warehouseStatus,
        );
      const iconKey = stackCount > 1
        ? `stack:${markerColor}:${stackCount}:${lat}:${lng}`
        : `${visitStatuses[0]}:${equipmentStatuses[0] || 'working'}:${group[0].warehouseStatus || ''}:${f.id}`;
      let icon = iconCacheRef.current.get(iconKey);
      if (!icon) {
        icon = createPointIcon(markerColor, stackCount);
        iconCacheRef.current.set(iconKey, icon);
      }

      const marker = L.marker(position, {
        icon,
        status: visitStatuses[0],
        equipmentStatus: equipmentStatuses[0],
        fridgeGroup: group,
      } as L.MarkerOptions & { status: string; equipmentStatus: EquipmentStatus; fridgeGroup: MapPointItem[] });

      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        openFridgePopup(map, position, group);
      });

      markerLayers.push(marker);
    }

    if (markerLayers.length) {
      cluster.addLayers(markerLayers);
    }

    map.invalidateSize({ animate: false });

    if (markerLayers.length) {
      const bounds = cluster.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    } else {
      map.setView(toLatLngTuple(viewCenter), viewCenter.zoom ?? DEFAULT_ZOOM);
      if (filterOutliers && skippedFar > 0) {
        setHint(`${skippedFar} холодильников с координатами вне региона «${cityName || 'города'}» — запустите геокодирование.`);
      } else {
        setHint('Нет холодильников с координатами в выбранном регионе.');
      }
    }

    if (filterOutliers && skippedFar > 0 && markerLayers.length > 0) {
      setHint(`${skippedFar} точек скрыто — GPS далеко от «${cityName || 'города'}» (отметка в другом регионе или неверный адрес).`);
    }

    window.setTimeout(() => map.invalidateSize({ animate: false }), 100);

    const installedCount = visiblePoints.filter(
      (point) => point.warehouseStatus === 'installed' || point.warehouseStatus === 'moved',
    ).length;

    return {
      fridgeCount: visiblePoints.length,
      markerCount: markerLayers.length,
      installedCount,
    };
  }, [cityName]);

  const loadAllPoints = useCallback(async (targetCityId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDataPhase('loading');
    setHint(null);
    setMapStats(null);
    setWarehouseHidden(0);
    setProgress({ loaded: 0, total: 0 });
    pointsRef.current = [];
    pointClusterRef.current?.clearLayers();

    const params = new URLSearchParams();
    if (targetCityId && targetCityId !== 'all') {
      params.set('cityId', targetCityId);
    }

    let skip = 0;
    let hiddenWarehouse = 0;

    try {
      while (true) {
        params.set('skip', String(skip));
        params.set('limit', String(BULK_CHUNK));

        const res = await api.get<BulkResponse>(`/api/admin/map-fridges/bulk?${params.toString()}`, {
          signal: controller.signal,
          timeout: 300000,
        });

        if (controller.signal.aborted) return;

        hiddenWarehouse = res.data.warehouseHidden ?? hiddenWarehouse;
        pointsRef.current.push(...res.data.items);
        skip = res.data.loaded;
        setProgress({ loaded: skip, total: res.data.total });

        if (!res.data.hasMore) break;
      }

      if (controller.signal.aborted) return;

      setWarehouseHidden(hiddenWarehouse);

      const view = buildMapViewSettings(targetCityId, cityName, cityCode, pointsRef.current);

      const stats = renderAllPoints(pointsRef.current, view.center, view.filterOutliers);
      setMapStats(stats);
      setDataPhase('ready');
    } catch (e: unknown) {
      if (controller.signal.aborted) return;
      const err = e as { message?: string; response?: { data?: { error?: string } } };
      setDataPhase('error');
      setHint(err?.response?.data?.error || err?.message || 'Ошибка загрузки карты');
    }
  }, [renderAllPoints, cityName, cityCode]);

  useLayoutEffect(() => {
    if (!cityId || !mapRef.current) return undefined;

    const container = mapRef.current;
    const view = buildMapViewSettings(cityId, cityName, cityCode);

    const map = L.map(container, {
      center: toLatLngTuple(view.center),
      zoom: view.center.zoom ?? DEFAULT_ZOOM,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    }).addTo(map);

    const pointCluster = createMarkerClusterGroup();
    pointCluster.on('clusterclick', (event) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      const layer = event.layer as L.MarkerClusterGroup & { getAllChildMarkers: () => L.Marker[]; getBounds: () => L.LatLngBounds; getLatLng: () => L.LatLng };
      const markers = layer.getAllChildMarkers();
      const items = collectFridgeItems(markers);
      if (!items.length) return;

      if (items.length === 1) {
        openFridgePopup(map, layer.getLatLng(), items);
        return;
      }

      if (isTightGroup(items)) {
        openFridgePopup(map, layer.getLatLng(), items);
        return;
      }

      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    });

    map.addLayer(pointCluster);
    mapInstanceRef.current = map;
    pointClusterRef.current = pointCluster;

    map.whenReady(() => {
      map.invalidateSize({ animate: false });
      setMapInitialized(true);
      window.setTimeout(() => map.invalidateSize({ animate: false }), 50);
    });

    return () => {
      destroyMap();
    };
  }, [cityId, cityName, cityCode, destroyMap]);

  useEffect(() => {
    if (!cityId || !mapInitialized) return undefined;
    loadAllPoints(cityId);
    return () => abortRef.current?.abort();
  }, [cityId, mapInitialized, loadAllPoints]);

  if (!cityId) {
    return (
      <div className="space-y-2">
        <MapLegend />
        <div
          className="w-full rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2 px-6"
          style={{ height: MAP_HEIGHT }}
        >
          <p className="text-sm font-medium text-slate-700">Город не выбран</p>
          <p className="text-xs text-slate-500">Выберите регион для загрузки карты</p>
        </div>
      </div>
    );
  }

  if (dataPhase === 'error') {
    return (
      <div className="space-y-2">
        <MapLegend hint={hint} />
        <div
          className="w-full rounded-lg border border-red-200 bg-red-50 flex items-center justify-center px-6"
          style={{ height: MAP_HEIGHT }}
        >
          <p className="text-sm text-red-800 text-center">{hint || 'Не удалось загрузить карту'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MapLegend
        fridgeCount={dataPhase === 'ready' ? mapStats?.fridgeCount : undefined}
        markerCount={dataPhase === 'ready' ? mapStats?.markerCount : undefined}
        installedCount={dataPhase === 'ready' ? mapStats?.installedCount : undefined}
        warehouseHidden={warehouseHidden}
        hint={hint}
      />
      <div
        className="relative w-full rounded-lg border border-slate-200 overflow-hidden"
        style={{ height: MAP_HEIGHT }}
      >
        <div ref={mapRef} className="absolute inset-0 z-0" style={{ minHeight: MAP_HEIGHT }} />
        {dataPhase === 'loading' && (
          <LoadingOverlay title="Загрузка холодильников…" progress={progress} />
        )}
        <style>{`
          .custom-marker {
            background: transparent !important;
            border: none !important;
          }
          .custom-cluster {
            background: transparent !important;
            border: none !important;
          }
          .marker-cluster,
          .marker-cluster-small,
          .marker-cluster-medium,
          .marker-cluster-large {
            background: transparent !important;
          }
          .leaflet-popup-content-wrapper { border-radius: 8px; }
        `}</style>
      </div>
    </div>
  );
}

export const AdminFridgeMap = memo(AdminFridgeMapInner);
