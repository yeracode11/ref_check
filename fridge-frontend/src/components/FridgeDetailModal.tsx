import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Badge } from './ui/Card';
import { QRCode } from './ui/QRCode';
import { api } from '../shared/apiClient';

type ClientInfo = {
  name?: string;
  inn?: string;
  contractNumber?: string;
  contactPhone?: string;
  contactPerson?: string;
  installDate?: string;
  notes?: string;
};

type StatusHistoryItem = {
  status: 'warehouse' | 'installed' | 'returned';
  changedAt: string;
  changedBy?: { username: string; fullName?: string };
  notes?: string;
};

type CheckinItem = {
  id: number;
  managerId: string;
  fridgeId: string;
  visitedAt: string;
  address?: string;
  notes?: string;
  location?: { lat: number; lng: number };
};

type FridgeDetail = {
  _id: string;
  code: string;
  serialNumber?: string;
  name: string;
  address?: string;
  description?: string;
  cityId?: { _id: string; name: string; code: string };
  location?: { type: 'Point'; coordinates: [number, number] };
  warehouseStatus: 'warehouse' | 'installed' | 'returned';
  clientInfo?: ClientInfo;
  statusHistory?: StatusHistoryItem[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  fridgeId: string;
  onClose: () => void;
  onShowQR?: (fridge: FridgeDetail) => void;
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'warehouse': return 'На складе';
    case 'installed': return 'Установлен';
    case 'returned': return 'Возврат';
    default: return status;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'warehouse': return 'bg-orange-100 text-orange-700';
    case 'installed': return 'bg-green-100 text-green-700';
    case 'returned': return 'bg-orange-100 text-orange-700';
    default: return 'bg-slate-100 text-slate-700';
  }
}

// Мини-карта для отображения местоположения
function MiniMap({ location, name }: { location: { coordinates: [number, number] }; name: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !location?.coordinates) return;

    const [lng, lat] = location.coordinates;
    
    // Если координаты нулевые, не показываем карту
    if (lat === 0 && lng === 0) return;

    // Инициализация карты
    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: true,
        dragging: true,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 19,
      }).addTo(map);

      // Маркер
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      L.marker([lat, lng], { icon })
        .addTo(map)
        .bindPopup(`<strong>${name}</strong>`)
        .openPopup();

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [location, name]);

  const [lng, lat] = location?.coordinates || [0, 0];
  
  if (lat === 0 && lng === 0) {
    return (
      <div className="w-full h-[200px] bg-slate-100 rounded-lg flex items-center justify-center">
        <div className="text-center text-slate-500">
          <svg className="w-12 h-12 mx-auto mb-2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-sm">Местоположение не определено</p>
          <p className="text-xs mt-1">Будет обновлено при первой отметке</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[200px] rounded-lg overflow-hidden border border-slate-200">
      <div ref={mapRef} className="w-full h-full" />
      <style>{`
        .custom-marker { background: transparent !important; border: none !important; }
      `}</style>
    </div>
  );
}

export function FridgeDetailModal({ fridgeId, onClose, onShowQR }: Props) {
  const [fridge, setFridge] = useState<FridgeDetail | null>(null);
  const [checkins, setCheckins] = useState<CheckinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'history'>('info');

  // Загрузка истории посещений
  const loadCheckins = async () => {
    if (!fridgeId) return;
    try {
      setLoadingCheckins(true);
      const res = await api.get(`/api/admin/fridges/${fridgeId}/checkins?limit=50`);
      setCheckins(res.data);
    } catch (e) {
      console.error('Ошибка загрузки истории:', e);
    } finally {
      setLoadingCheckins(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && checkins.length === 0) {
      loadCheckins();
    }
  }, [activeTab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/api/admin/fridges/${fridgeId}`);
        if (!alive) return;
        setFridge(res.data);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.error || e?.message || 'Ошибка загрузки');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fridgeId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-900"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !fridge) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center py-8">
            <div className="text-red-500 mb-4">⚠️</div>
            <p className="text-red-600">{error || 'Не удалось загрузить данные'}</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-200 rounded-lg hover:bg-slate-300">
              Закрыть
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <span className="text-xl">🧊</span>
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">{fridge.name}</h2>
              <p className="text-sm text-slate-500 font-mono">#{fridge.code}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getStatusColor(fridge.warehouseStatus)}>
              {getStatusLabel(fridge.warehouseStatus)}
            </Badge>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('info')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'info'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            📋 Информация
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            📅 История посещений {checkins.length > 0 && `(${checkins.length})`}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'info' ? (
            <>
              {/* Карта */}
              {fridge.location && (
                <div>
                  <h3 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Местоположение
              </h3>
              <MiniMap location={fridge.location} name={fridge.name} />
            </div>
          )}

          {/* Основная информация */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Информация</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Код:</dt>
                  <dd className="font-mono text-slate-900">{fridge.code}</dd>
                </div>
                {fridge.serialNumber && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Сер. номер:</dt>
                    <dd className="font-mono text-slate-900">{fridge.serialNumber}</dd>
                  </div>
                )}
                {fridge.cityId && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Город:</dt>
                    <dd className="text-slate-900">{fridge.cityId.name}</dd>
                  </div>
                )}
                {fridge.address && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Адрес:</dt>
                    <dd className="text-slate-900 text-right max-w-[60%]">{fridge.address}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-500">Создан:</dt>
                  <dd className="text-slate-900">{formatDate(fridge.createdAt)}</dd>
                </div>
              </dl>
            </div>

            {/* Данные клиента */}
            <div className="bg-slate-50 rounded-lg p-3">
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Клиент</h3>
              {fridge.clientInfo?.name ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-slate-500 text-xs">Название:</dt>
                    <dd className="font-medium text-slate-900">{fridge.clientInfo.name}</dd>
                  </div>
                  {fridge.clientInfo.inn && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">ИНН:</dt>
                      <dd className="font-mono text-slate-900">{fridge.clientInfo.inn}</dd>
                    </div>
                  )}
                  {fridge.clientInfo.contractNumber && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Договор:</dt>
                      <dd className="text-slate-900">{fridge.clientInfo.contractNumber}</dd>
                    </div>
                  )}
                  {fridge.clientInfo.contactPhone && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Телефон:</dt>
                      <dd className="text-slate-900">{fridge.clientInfo.contactPhone}</dd>
                    </div>
                  )}
                  {fridge.clientInfo.contactPerson && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Контакт:</dt>
                      <dd className="text-slate-900">{fridge.clientInfo.contactPerson}</dd>
                    </div>
                  )}
                  {fridge.clientInfo.installDate && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Установка:</dt>
                      <dd className="text-slate-900">{new Date(fridge.clientInfo.installDate).toLocaleDateString('ru-RU')}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-slate-400 italic">Нет данных о клиенте</p>
              )}
            </div>
          </div>

          {/* Описание */}
          {fridge.description && (
            <div className="bg-slate-50 rounded-lg p-3">
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Описание</h3>
              <p className="text-sm text-slate-700">{fridge.description}</p>
            </div>
          )}

          {/* История статусов */}
          {fridge.statusHistory && fridge.statusHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                История изменений
              </h3>
              <div className="bg-slate-50 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                <div className="space-y-3">
                  {fridge.statusHistory.slice().reverse().map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                        item.status === 'installed' ? 'bg-green-500' :
                        item.status === 'warehouse' ? 'bg-orange-500' :
                        'bg-orange-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-900">{getStatusLabel(item.status)}</span>
                          <span className="text-slate-400 text-xs">{formatDate(item.changedAt)}</span>
                        </div>
                        {item.changedBy && (
                          <p className="text-xs text-slate-500">
                            {item.changedBy.fullName || item.changedBy.username}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-xs text-slate-600 mt-1">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
            </>
          ) : (
            /* История посещений */
            <div className="space-y-3">
              {loadingCheckins ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-900"></div>
                </div>
              ) : checkins.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-2">📭</div>
                  <p>Нет записей о посещениях</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {checkins.map((c, idx) => (
                    <div key={c.id || idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-900">👤 {c.managerId}</span>
                            <span className="text-slate-400 text-xs">{formatDate(c.visitedAt)}</span>
                          </div>
                          {c.address && (
                            <p className="text-sm text-slate-600 mt-1">
                              <span className="text-slate-400">📍</span> {c.address}
                            </p>
                          )}
                          {c.notes && (
                            <p className="text-sm text-slate-500 mt-1 italic">{c.notes}</p>
                          )}
                          {c.location && c.location.lat !== undefined && c.location.lng !== undefined && (
                            <p className="text-xs text-slate-400 mt-1 font-mono">
                              {c.location.lat.toFixed(6)}, {c.location.lng.toFixed(6)}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 bg-slate-200 px-2 py-1 rounded">
                          #{c.id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={() => setShowQR(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            QR-код
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-sm font-medium"
          >
            Закрыть
          </button>
        </div>

        {/* QR Modal */}
        {showQR && (
          <div className="absolute inset-0 bg-white rounded-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">QR-код: {fridge.name}</h3>
              <button
                onClick={() => setShowQR(false)}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(fridge.code)}`}
                title={fridge.name}
                code={fridge.code}
                size={250}
              />
              <p className="text-sm text-slate-500 mt-4 text-center">
                Отсканируйте QR-код для отметки посещения
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

