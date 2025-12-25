import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Badge } from './ui/Card';
import { QRCode } from './ui/QRCode';
import { GeocodedAddress } from './ui/GeocodedAddress';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';

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
  status: 'warehouse' | 'installed' | 'returned' | 'moved';
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
  location?: { type: 'Point'; coordinates: [number, number] };
};

type FridgeDetail = {
  _id: string;
  code: string;
  name: string;
  address?: string;
  description?: string;
  cityId?: { _id: string; name: string; code: string };
  location?: { type: 'Point'; coordinates: [number, number] };
  warehouseStatus: 'warehouse' | 'installed' | 'returned' | 'moved';
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
  onDeleted?: () => void; // Callback после удаления
  onUpdated?: () => void; // Callback после обновления
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
    case 'moved': return 'Перемещен';
    default: return status;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'warehouse': return 'bg-blue-100 text-blue-700';
    case 'installed': return 'bg-green-100 text-green-700';
    case 'returned': return 'bg-blue-100 text-blue-700';
    case 'moved': return 'bg-orange-100 text-orange-700';
    default: return 'bg-slate-100 text-slate-700';
  }
}

// Мини-карта для отображения местоположения
function MiniMap({ location, name, height = '200px' }: { location: { coordinates: [number, number] }; name: string; height?: string }) {
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
    <div className="w-full rounded-lg overflow-hidden border border-slate-200" style={{ height }}>
      <div ref={mapRef} className="w-full h-full" />
      <style>{`
        .custom-marker { background: transparent !important; border: none !important; }
      `}</style>
    </div>
  );
}

export function FridgeDetailModal({ fridgeId, onClose, onShowQR, onDeleted, onUpdated }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isAccountant = user?.role === 'accountant';
  const isPrivileged = isAdmin || isAccountant;
  
  const [fridge, setFridge] = useState<FridgeDetail | null>(null);
  const [checkins, setCheckins] = useState<CheckinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'history'>('info');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', address: '', description: '' });
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [selectedCheckin, setSelectedCheckin] = useState<CheckinItem | null>(null);
  const [clientForm, setClientForm] = useState<ClientInfo>({
    name: '',
    inn: '',
    contractNumber: '',
    contactPhone: '',
    contactPerson: '',
    installDate: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [savingClient, setSavingClient] = useState(false);

  // Загрузка истории посещений
  const loadCheckins = async (fridgeCode?: string) => {
    if (!fridgeId && !fridgeCode) return;
    try {
      setLoadingCheckins(true);
      if (isPrivileged) {
        const res = await api.get(`/api/admin/fridges/${fridgeId}/checkins?limit=50`);
        setCheckins(res.data);
      } else {
        // Менеджер: грузим свои отметки по коду холодильника
        const code = fridgeCode || fridge?.code;
        if (!code) return;
        const params = new URLSearchParams();
        params.append('fridgeId', code);
        if (user?._id) params.append('managerId', user._id);
        const res = await api.get(`/api/checkins?${params.toString()}`);
        setCheckins(res.data);
      }
    } catch (e) {
      console.error('Ошибка загрузки истории:', e);
    } finally {
      setLoadingCheckins(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history' && checkins.length === 0) {
      loadCheckins(fridge?.code);
    }
  }, [activeTab, fridge?.code, checkins.length]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = isPrivileged
          ? await api.get(`/api/admin/fridges/${fridgeId}`)
          : await api.get(`/api/fridges/${fridgeId}`);
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
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4" 
        onClick={onClose}
        style={{ zIndex: 1000 }}
      >
        <div 
          className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 relative z-[1001]" 
          onClick={(e) => e.stopPropagation()}
          style={{ zIndex: 1001 }}
        >
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-900"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !fridge) {
    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4" 
        onClick={onClose}
        style={{ zIndex: 1000 }}
      >
        <div 
          className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative z-[1001]" 
          onClick={(e) => e.stopPropagation()}
          style={{ zIndex: 1001 }}
        >
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
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4" 
      onClick={onClose}
      style={{ zIndex: 1000 }}
    >
      <div 
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[1001]" 
        onClick={(e) => e.stopPropagation()}
        style={{ zIndex: 1001 }}
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
                        item.status === 'warehouse' ? 'bg-blue-500' :
                        'bg-blue-400'
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
                  {checkins.map((c, idx) => {
                    const hasLocation = c.location && c.location.coordinates && c.location.coordinates.length === 2;
                    const [lng, lat] = hasLocation && c.location?.coordinates ? c.location.coordinates : [0, 0];
                    return (
                      <div 
                        key={c.id || idx} 
                        className={`bg-slate-50 rounded-lg p-3 border border-slate-100 ${hasLocation ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors' : ''}`}
                        onClick={() => hasLocation && setSelectedCheckin(c)}
                      >
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
                            {hasLocation && (
                              <p className="text-xs mt-1 text-blue-600">
                                <GeocodedAddress
                                  lat={lat}
                                  lng={lng}
                                  className="text-blue-600"
                                />
                                {hasLocation && <span className="ml-2 text-blue-500">Нажмите для просмотра на карте</span>}
                              </p>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 bg-slate-200 px-2 py-1 rounded">
                            #{c.id}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50 gap-2 flex-wrap">
          <div className="flex gap-2">
            <button
              onClick={() => setShowQR(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              📱 QR-код
            </button>
            {isAccountant && (
              <>
                <button
                  onClick={() => {
                    if (fridge) {
                      setEditForm({
                        name: fridge.name,
                        address: fridge.address || '',
                        description: fridge.description || '',
                      });
                      setShowEditModal(true);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  ✏️ Редактировать
                </button>
                <button
                  onClick={() => {
                    if (fridge) {
                      setClientForm({
                        name: fridge.clientInfo?.name || '',
                        inn: fridge.clientInfo?.inn || '',
                        contractNumber: fridge.clientInfo?.contractNumber || '',
                        contactPhone: fridge.clientInfo?.contactPhone || '',
                        contactPerson: fridge.clientInfo?.contactPerson || '',
                        installDate: fridge.clientInfo?.installDate ? fridge.clientInfo.installDate.substring(0, 10) : '',
                        notes: fridge.clientInfo?.notes || '',
                      });
                      setShowEditClientModal(true);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                >
                  👤 Данные клиента
                </button>
              </>
            )}
            {isAdmin && (
              <>
                <button
                  onClick={() => {
                    setEditForm({
                      name: fridge.name,
                      address: fridge.address || '',
                      description: fridge.description || '',
                    });
                    setShowEditModal(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  ✏️ Редактировать
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                >
                  🗑️ Удалить
                </button>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-sm font-medium"
          >
            Закрыть
          </button>
        </div>

        {/* QR Modal */}
        {showQR && (
          <div className="absolute inset-0 bg-white rounded-xl flex flex-col z-[1002]" style={{ zIndex: 1002 }}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200 flex-shrink-0">
              <h3 className="font-semibold text-slate-900">QR-код: {fridge.name}</h3>
              <button
                onClick={() => setShowQR(false)}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto min-h-0">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(fridge.code)}`}
                title={fridge.name}
                code={fridge.code}
                size={250}
              />
              <p className="text-sm text-slate-500 mt-4 text-center max-w-md">
                Отсканируйте QR-код для отметки посещения
              </p>
            </div>
          </div>
        )}

        {/* Модальное окно подтверждения удаления */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Удалить холодильник?</h3>
              <p className="text-slate-600 text-sm mb-4">
                Вы уверены, что хотите удалить холодильник <strong>{fridge.name}</strong> (#{fridge.code})?
                Все связанные отметки также будут удалены. Это действие нельзя отменить.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    try {
                      setDeleting(true);
                      await api.delete(`/api/admin/fridges/${fridge._id}`);
                      setShowDeleteConfirm(false);
                      onDeleted?.();
                      onClose();
                      alert('Холодильник удалён');
                    } catch (e: any) {
                      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {deleting ? 'Удаление...' : '🗑️ Удалить'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно редактирования */}
        {showEditModal && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center overflow-auto p-4">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Редактировать холодильник</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Адрес</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={async () => {
                      if (!editForm.name.trim()) {
                        alert('Название обязательно');
                        return;
                      }
                      try {
                        setSaving(true);
                        await api.patch(`/api/admin/fridges/${fridge._id}`, {
                          name: editForm.name.trim(),
                          address: editForm.address.trim() || null,
                          description: editForm.description.trim() || null,
                        });
                        // Перезагружаем данные
                        const res = await api.get(`/api/admin/fridges/${fridge._id}`);
                        setFridge(res.data);
                        setShowEditModal(false);
                        onUpdated?.();
                        alert('Холодильник обновлён');
                      } catch (e: any) {
                        alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                  >
                    {saving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    onClick={() => setShowEditModal(false)}
                    disabled={saving}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно редактирования данных клиента (для бухгалтера) */}
        {showEditClientModal && fridge && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center overflow-auto p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                Данные клиента: {fridge.name}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Название ИП/организации</label>
                  <input
                    type="text"
                    value={clientForm.name || ''}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ИНН</label>
                  <input
                    type="text"
                    value={clientForm.inn || ''}
                    onChange={(e) => setClientForm({ ...clientForm, inn: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Номер договора</label>
                  <input
                    type="text"
                    value={clientForm.contractNumber || ''}
                    onChange={(e) => setClientForm({ ...clientForm, contractNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Контактный телефон</label>
                  <input
                    type="text"
                    value={clientForm.contactPhone || ''}
                    onChange={(e) => setClientForm({ ...clientForm, contactPhone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Контактное лицо</label>
                  <input
                    type="text"
                    value={clientForm.contactPerson || ''}
                    onChange={(e) => setClientForm({ ...clientForm, contactPerson: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Дата установки</label>
                  <input
                    type="date"
                    value={clientForm.installDate || ''}
                    onChange={(e) => setClientForm({ ...clientForm, installDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Примечания</label>
                  <textarea
                    value={clientForm.notes || ''}
                    onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={async () => {
                      try {
                        setSavingClient(true);
                        const response = await api.patch(`/api/admin/fridges/${fridge._id}/client`, {
                          clientInfo: clientForm,
                        });
                        
                        // Обновляем данные холодильника
                        setFridge({ ...fridge, clientInfo: response.data.clientInfo });
                        setShowEditClientModal(false);
                        onUpdated?.();
                        alert('Данные клиента сохранены');
                      } catch (e: any) {
                        alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                      } finally {
                        setSavingClient(false);
                      }
                    }}
                    disabled={savingClient}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                  >
                    {savingClient ? 'Сохранение...' : 'Сохранить'}
                  </button>
                  <button
                    onClick={() => setShowEditClientModal(false)}
                    disabled={savingClient}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Модальное окно с картой для выбранной отметки */}
        {selectedCheckin && selectedCheckin.location && selectedCheckin.location.coordinates && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4"
            onClick={() => setSelectedCheckin(null)}
          >
            <div 
              className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Местоположение отметки #{selectedCheckin.id}
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {formatDate(selectedCheckin.visitedAt)} • 👤 {selectedCheckin.managerId}
                  </p>
                  {selectedCheckin.address && (
                    <p className="text-sm text-slate-600 mt-1">
                      📍 {selectedCheckin.address}
                    </p>
                  )}
                  {selectedCheckin.location.coordinates && (
                    <p className="text-xs text-slate-500 mt-1">
                      <GeocodedAddress
                        lat={selectedCheckin.location.coordinates[1]}
                        lng={selectedCheckin.location.coordinates[0]}
                      />
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCheckin(null)}
                  className="text-slate-400 hover:text-slate-600 transition-colors p-2"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 min-h-0" style={{ minHeight: '400px', height: '60vh' }}>
                {selectedCheckin.location.coordinates && (
                  <MiniMap
                    location={{ coordinates: selectedCheckin.location.coordinates }}
                    name={`Отметка #${selectedCheckin.id}`}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

