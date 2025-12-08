import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { QRCode } from '../components/ui/QRCode';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import { AnalyticsPanel } from '../components/admin/AnalyticsPanel';

type ClientInfo = {
  name?: string;
  inn?: string;
  contractNumber?: string;
  contactPhone?: string;
  contactPerson?: string;
  installDate?: string;
  notes?: string;
};

type Fridge = {
  _id: string;
  code: string;
  serialNumber?: string;
  name: string;
  address?: string;
  cityId?: { _id: string; name: string; code: string } | null;
  warehouseStatus: 'warehouse' | 'installed' | 'returned';
  clientInfo?: ClientInfo | null;
  createdAt: string;
};

type City = {
  _id: string;
  name: string;
  code: string;
};

const ITEMS_PER_PAGE = 30;

export default function AccountantDashboard() {
  const { user } = useAuth();
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalFridges, setTotalFridges] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Модальные окна
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  
  const [selectedFridge, setSelectedFridge] = useState<Fridge | null>(null);
  const [selectedFridgeDetailId, setSelectedFridgeDetailId] = useState<string | null>(null); // Для детального просмотра
  const [saving, setSaving] = useState(false);

  // Форма нового холодильника
  const [newFridge, setNewFridge] = useState({
    serialNumber: '',
    name: '',
    address: '',
    description: '',
    cityId: '',
  });

  // Форма редактирования клиента
  const [clientForm, setClientForm] = useState<ClientInfo>({
    name: '',
    inn: '',
    contractNumber: '',
    contactPhone: '',
    contactPerson: '',
    installDate: '',
    notes: '',
  });

  // Форма изменения статуса
  const [statusForm, setStatusForm] = useState({
    warehouseStatus: 'installed' as 'warehouse' | 'installed' | 'returned',
    notes: '',
  });

  const observerTarget = useRef<HTMLDivElement | null>(null);

  // Загрузка городов
  useEffect(() => {
    if (!user) return;
    api.get('/api/cities?active=true')
      .then(res => {
        setCities(res.data);
        if (res.data.length > 0 && !newFridge.cityId) {
          setNewFridge(prev => ({ ...prev, cityId: res.data[0]._id }));
        }
      })
      .catch(console.error);
  }, [user]);

  // Загрузка холодильников
  const loadFridges = useCallback(async (skip = 0, reset = false) => {
    if (!user) return;
    
    try {
      if (skip === 0) setLoading(true);
      else setLoadingMore(true);

      const params = new URLSearchParams();
      params.append('limit', String(ITEMS_PER_PAGE));
      params.append('skip', String(skip));
      if (search) params.append('search', search);
      if (statusFilter !== 'all') params.append('warehouseStatus', statusFilter);

      const res = await api.get(`/api/fridges?${params.toString()}`);
      const data = res.data.data || res.data;
      const pagination = res.data.pagination;

      if (reset) {
        setFridges(data);
      } else {
        setFridges(prev => [...prev, ...data]);
      }

      if (pagination) {
        setTotalFridges(pagination.total);
        setHasMore(pagination.hasMore);
      } else {
        setTotalFridges(data.length);
        setHasMore(false);
      }
    } catch (e) {
      console.error('Ошибка загрузки:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, search, statusFilter]);

  useEffect(() => {
    loadFridges(0, true);
  }, [loadFridges]);

  // Бесконечный скролл
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadFridges(fridges.length, false);
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loadingMore, fridges.length, loadFridges]);

  // Создание холодильника
  const handleCreateFridge = async () => {
    if (!newFridge.name.trim()) {
      alert('Укажите название холодильника');
      return;
    }

    try {
      setSaving(true);
      const res = await api.post('/api/admin/fridges', {
        serialNumber: newFridge.serialNumber.trim() || undefined,
        name: newFridge.name.trim(),
        address: newFridge.address.trim() || undefined,
        description: newFridge.description.trim() || undefined,
        cityId: newFridge.cityId || undefined,
      });

      setSelectedFridge(res.data);
      setShowAddModal(false);
      setShowQRModal(true);
      setNewFridge({ serialNumber: '', name: '', address: '', description: '', cityId: cities[0]?._id || '' });
      loadFridges(0, true);
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // Открыть редактирование клиента
  const openEditClient = (fridge: Fridge) => {
    setSelectedFridge(fridge);
    setClientForm({
      name: fridge.clientInfo?.name || '',
      inn: fridge.clientInfo?.inn || '',
      contractNumber: fridge.clientInfo?.contractNumber || '',
      contactPhone: fridge.clientInfo?.contactPhone || '',
      contactPerson: fridge.clientInfo?.contactPerson || '',
      installDate: fridge.clientInfo?.installDate ? fridge.clientInfo.installDate.substring(0, 10) : '',
      notes: fridge.clientInfo?.notes || '',
    });
    setShowEditModal(true);
  };

  // Сохранить данные клиента
  const handleSaveClient = async () => {
    if (!selectedFridge) return;

    try {
      setSaving(true);
      await api.patch(`/api/admin/fridges/${selectedFridge._id}/client`, {
        clientInfo: clientForm,
      });
      setShowEditModal(false);
      loadFridges(0, true);
      alert('Данные клиента сохранены');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // Открыть изменение статуса
  const openStatusChange = (fridge: Fridge) => {
    setSelectedFridge(fridge);
    setStatusForm({
      warehouseStatus: fridge.warehouseStatus === 'installed' ? 'returned' : 'installed',
      notes: '',
    });
    setClientForm({
      name: '',
      inn: '',
      contractNumber: '',
      contactPhone: '',
      contactPerson: '',
      installDate: new Date().toISOString().substring(0, 10),
      notes: '',
    });
    setShowStatusModal(true);
  };

  // Изменить статус холодильника
  const handleChangeStatus = async () => {
    if (!selectedFridge) return;

    // При установке требуем данные клиента
    if (statusForm.warehouseStatus === 'installed' && !clientForm.name?.trim()) {
      alert('Укажите название ИП/организации клиента');
      return;
    }

    try {
      setSaving(true);
      await api.patch(`/api/admin/fridges/${selectedFridge._id}/status`, {
        warehouseStatus: statusForm.warehouseStatus,
        clientInfo: statusForm.warehouseStatus === 'installed' ? clientForm : undefined,
        notes: statusForm.notes,
      });
      setShowStatusModal(false);
      loadFridges(0, true);
      alert('Статус изменен');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // Открыть QR код
  const openQR = (fridge: Fridge) => {
    setSelectedFridge(fridge);
    setShowQRModal(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'warehouse':
        return <Badge className="bg-orange-100 text-orange-700">На складе</Badge>;
      case 'installed':
        return <Badge className="bg-green-100 text-green-700">Установлен</Badge>;
      case 'returned':
        return <Badge className="bg-orange-100 text-orange-700">Возврат</Badge>;
      default:
        return <Badge className="bg-slate-100 text-slate-700">{status}</Badge>;
    }
  };

  if (!user || (user.role !== 'accountant' && user.role !== 'admin')) {
    return (
      <Card>
        <p className="text-red-600">Доступ запрещен. Только для бухгалтеров и администраторов.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Управление холодильниками</h1>
          <p className="text-slate-500 mt-1">Создание, редактирование и генерация QR-кодов</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Добавить холодильник</span>
        </button>
      </div>

      {/* Аналитика */}
      <AnalyticsPanel endpoint="/api/admin/analytics/accountant" />

      {/* Фильтры */}
      <Card>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Поиск по названию, номеру, адресу..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Все статусы</option>
            <option value="warehouse">На складе</option>
            <option value="installed">Установлен</option>
            <option value="returned">Возврат</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Найдено: {totalFridges} холодильников
        </p>
      </Card>

      {/* Список холодильников */}
      {loading ? (
        <LoadingCard />
      ) : fridges.length === 0 ? (
        <EmptyState message="Холодильники не найдены" />
      ) : (
        <div className="grid gap-4">
          {fridges.map((f) => (
            <Card key={f._id}>
              <div className="flex flex-wrap gap-4 justify-between">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-semibold text-slate-900">{f.name}</span>
                    {getStatusBadge(f.warehouseStatus)}
                  </div>
                  <div className="text-sm text-slate-600 space-y-1">
                    <p><span className="text-slate-500">Код:</span> {f.code}</p>
                    {f.serialNumber && <p><span className="text-slate-500">Сер. номер:</span> {f.serialNumber}</p>}
                    {f.address && <p><span className="text-slate-500">Адрес:</span> {f.address}</p>}
                    {f.cityId && <p><span className="text-slate-500">Город:</span> {f.cityId.name}</p>}
                  </div>
                  {f.clientInfo?.name && (
                    <div className="mt-3 p-2 bg-slate-50 rounded-lg text-sm">
                      <p className="font-medium text-slate-700">Клиент: {f.clientInfo.name}</p>
                      {f.clientInfo.inn && <p className="text-slate-500">ИНН: {f.clientInfo.inn}</p>}
                      {f.clientInfo.contractNumber && <p className="text-slate-500">Договор: {f.clientInfo.contractNumber}</p>}
                      {f.clientInfo.contactPhone && <p className="text-slate-500">Тел: {f.clientInfo.contactPhone}</p>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setSelectedFridgeDetailId(f._id)}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                  >
                    Подробнее
                  </button>
                  <button
                    onClick={() => openQR(f)}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 transition-colors"
                  >
                    QR-код
                  </button>
                  <button
                    onClick={() => openEditClient(f)}
                    className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  >
                    Редактировать клиента
                  </button>
                  <button
                    onClick={() => openStatusChange(f)}
                    className="px-3 py-1.5 text-sm bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors"
                  >
                    {f.warehouseStatus === 'installed' ? 'Возврат' : 'Установить'}
                  </button>
                </div>
              </div>
            </Card>
          ))}

          {/* Бесконечный скролл */}
          {hasMore && (
            <div ref={observerTarget} className="py-4 flex justify-center">
              {loadingMore ? <LoadingSpinner size="md" /> : <span className="text-xs text-slate-500">Загрузка...</span>}
            </div>
          )}
        </div>
      )}

      {/* Модальное окно: Добавить холодильник */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Добавить холодильник</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Заводской номер</label>
                <input
                  type="text"
                  value={newFridge.serialNumber}
                  onChange={(e) => setNewFridge({ ...newFridge, serialNumber: e.target.value })}
                  placeholder="Например: SN-12345"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Название <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newFridge.name}
                  onChange={(e) => setNewFridge({ ...newFridge, name: e.target.value })}
                  placeholder="Название холодильника"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Город</label>
                <select
                  value={newFridge.cityId}
                  onChange={(e) => setNewFridge({ ...newFridge, cityId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {cities.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Описание</label>
                <textarea
                  value={newFridge.description}
                  onChange={(e) => setNewFridge({ ...newFridge, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateFridge}
                  disabled={saving || !newFridge.name.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? 'Создание...' : 'Создать'}
                </button>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно: Редактировать клиента */}
      {showEditModal && selectedFridge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Данные клиента: {selectedFridge.name}
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
                  onClick={handleSaveClient}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно: Изменить статус */}
      {showStatusModal && selectedFridge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowStatusModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {statusForm.warehouseStatus === 'installed' ? 'Установка холодильника' : 'Возврат на склад'}
            </h3>
            <p className="text-sm text-slate-600 mb-4">Холодильник: {selectedFridge.name} (#{selectedFridge.code})</p>
            
            {statusForm.warehouseStatus === 'installed' && (
              <div className="space-y-4 mb-4 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm font-medium text-slate-700">Данные клиента:</p>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Название ИП/организации <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={clientForm.name || ''}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">ИНН</label>
                  <input
                    type="text"
                    value={clientForm.inn || ''}
                    onChange={(e) => setClientForm({ ...clientForm, inn: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Номер договора</label>
                  <input
                    type="text"
                    value={clientForm.contractNumber || ''}
                    onChange={(e) => setClientForm({ ...clientForm, contractNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Контактный телефон</label>
                  <input
                    type="text"
                    value={clientForm.contactPhone || ''}
                    onChange={(e) => setClientForm({ ...clientForm, contactPhone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Дата установки</label>
                  <input
                    type="date"
                    value={clientForm.installDate || ''}
                    onChange={(e) => setClientForm({ ...clientForm, installDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Примечание</label>
              <textarea
                value={statusForm.notes}
                onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })}
                placeholder="Причина изменения статуса..."
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleChangeStatus}
                disabled={saving}
                className={`flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 transition-colors font-medium ${
                  statusForm.warehouseStatus === 'installed' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {saving ? 'Сохранение...' : statusForm.warehouseStatus === 'installed' ? 'Установить' : 'Вернуть на склад'}
              </button>
              <button
                onClick={() => setShowStatusModal(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно детального просмотра */}
      {selectedFridgeDetailId && (
        <FridgeDetailModal
          fridgeId={selectedFridgeDetailId}
          onClose={() => setSelectedFridgeDetailId(null)}
        />
      )}

      {/* Модальное окно: QR-код */}
      {showQRModal && selectedFridge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowQRModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">QR-код холодильника</h3>
              <button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Холодильник:</span> {selectedFridge.name}
              </p>
              <p className="text-xs text-slate-500 font-mono">#{selectedFridge.code}</p>
              {selectedFridge.serialNumber && (
                <p className="text-xs text-slate-500">Сер. номер: {selectedFridge.serialNumber}</p>
              )}
            </div>
            <div className="flex justify-center mb-4">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(selectedFridge.code)}`}
                title={selectedFridge.name}
                code={selectedFridge.code}
                size={200}
              />
            </div>
            <p className="text-xs text-slate-500 text-center">
              Отсканируйте QR-код для отметки посещения холодильника
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

