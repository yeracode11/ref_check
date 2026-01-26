import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { QRCode } from '../components/ui/QRCode';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import { AnalyticsPanel } from '../components/admin/AnalyticsPanel';
import { AdminFridgeMap } from '../components/admin/AdminFridgeMap';
import { showToast } from '../components/ui/Toast';

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
  number?: string; // Длинный номер из Excel
  name: string;
  address?: string;
  cityId?: { _id: string; name: string; code: string } | null;
  warehouseStatus: 'warehouse' | 'installed' | 'returned' | 'moved';
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
  const navigate = useNavigate();
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalFridges, setTotalFridges] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Данные для карты
  const [mapFridges, setMapFridges] = useState<any[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  
  // Проверка доступа при смене пользователя
  useEffect(() => {
    if (user && user.role !== 'accountant' && user.role !== 'admin') {
      // Если пользователь не бухгалтер и не админ, редиректим
      if (user.role === 'manager') {
        navigate('/', { replace: true });
      } else {
        navigate('/fridges', { replace: true });
      }
    }
  }, [user, navigate]);
  
  // Модальные окна
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  
  const [selectedFridge, setSelectedFridge] = useState<Fridge | null>(null);
  const [selectedFridgeDetailId, setSelectedFridgeDetailId] = useState<string | null>(null); // Для детального просмотра
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // Импорт Excel
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number; total: number } | null>(null);

  // Форма нового холодильника
  const [newFridge, setNewFridge] = useState({
    name: '',
    address: '',
    description: '',
    cityId: '',
    number: '',
    clientInn: '',
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
  const isCreatingRef = useRef(false); // Защита от двойного вызова

  // Экспорт холодильников в Excel (для бухгалтера — только его город, для админа — все)
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      // Для больших объемов отключаем геокодирование (быстрее)
      // Можно добавить опцию для пользователя, но пока отключаем для скорости
      const response = await api.get('/api/admin/export-fridges?geocode=false', {
        responseType: 'blob',
        timeout: 300000, // 5 минут
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // Имя файла из заголовка, если есть
      const contentDisposition = response.headers['content-disposition'];
      let fileName = 'холодильники.xlsx';
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = decodeURIComponent(fileNameMatch[1].replace(/['"]/g, ''));
        }
      }

      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Ошибка экспорта:', e);
      alert('Ошибка при экспорте файла: ' + (e?.message || 'Неизвестная ошибка'));
    } finally {
      setExporting(false);
    }
  };

  // Загрузка городов
  useEffect(() => {
    if (!user) return;
    
    // Для бухгалтера загружаем только его город
    if (user.role === 'accountant' && user.cityId) {
      api.get(`/api/cities/${user.cityId}`)
        .then(res => {
          setCities([res.data]);
          // Автоматически устанавливаем город бухгалтера
          setNewFridge(prev => ({ ...prev, cityId: res.data._id }));
        })
        .catch(console.error);
    } else {
      // Для админа загружаем все города
      api.get('/api/cities?active=true')
        .then(res => {
          setCities(res.data);
          if (res.data.length > 0 && !newFridge.cityId) {
            setNewFridge(prev => ({ ...prev, cityId: res.data[0]._id }));
          }
        })
        .catch(console.error);
    }
  }, [user]);

  // Функция для загрузки данных карты
  const loadMapData = useCallback(async () => {
    if (!user) return;
    
    try {
      setMapLoading(true);
      // Загружаем все холодильники для карты (all=true)
      const res = await api.get('/api/admin/fridge-status?all=true');
      // Фильтруем только те, у которых есть координаты и они не нулевые
      const fridgesWithLocation = res.data.filter((f: any) => 
        f.location && 
        f.location.coordinates && 
        f.location.coordinates[0] !== 0 && 
        f.location.coordinates[1] !== 0
      );
      setMapFridges(fridgesWithLocation);
    } catch (error) {
      console.error('Ошибка загрузки данных для карты:', error);
    } finally {
      setMapLoading(false);
    }
  }, [user]);

  // Загрузка данных для карты при монтировании
  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

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
    // Защита от двойного вызова
    if (isCreatingRef.current || saving) {
      return;
    }

    if (!newFridge.name.trim()) {
      alert('Укажите название холодильника');
      return;
    }

    // Определяем город для проверки
    const cityIdToCheck = user?.role === 'accountant' && user?.cityId 
      ? user.cityId 
      : newFridge.cityId;
    
    const selectedCity = cities.find(c => c._id === cityIdToCheck);
    const cityNameLower = (selectedCity?.name || '').toLowerCase();
    const isKyzylorda = cityNameLower === 'кызылорда' || 
                        cityNameLower === 'қызылорда' ||
                        cityNameLower === 'kyzylorda';
    const isNumberCity = cityNameLower === 'шымкент' || 
                         cityNameLower === 'талдыкорган' ||
                         cityNameLower === 'талдыкорған' ||
                         cityNameLower === 'taldykorgan' ||
                         cityNameLower === 'taldikorgan';

    // Для Кызылорды ИНН клиента обязателен
    if (isKyzylorda && !newFridge.clientInn.trim()) {
      alert('Для Кызылорды необходимо указать ИНН клиента');
      return;
    }

    // Для других городов с номерами number обязателен
    if (isNumberCity && !newFridge.number.trim()) {
      alert('Для этого города необходимо указать номер холодильника');
      return;
    }

    try {
      isCreatingRef.current = true;
      setSaving(true);
      
      // Показываем toast и закрываем модальное окно сразу
      showToast('Холодильник добавляется... Можете закрыть окно, мы сообщим когда он будет готов.', 'info', 5000);
      setShowAddModal(false);
      
      // Для бухгалтера всегда используем его город
      const cityIdToSend = user?.role === 'accountant' && user?.cityId 
        ? user.cityId 
        : newFridge.cityId || undefined;
      
      const requestData: any = {
        name: newFridge.name.trim(),
        address: newFridge.address.trim() || undefined,
        description: newFridge.description.trim() || undefined,
        cityId: cityIdToSend,
      };
      
      // Для Кызылорды отправляем ИНН клиента
      if (isKyzylorda && newFridge.clientInn.trim()) {
        requestData.clientInfo = { inn: newFridge.clientInn.trim() };
      }
      
      // Для других городов отправляем number
      if (isNumberCity && newFridge.number.trim()) {
        requestData.number = newFridge.number.trim();
      }
      
      const res = await api.post('/api/admin/fridges', requestData);

      // Преобразуем ответ в формат Fridge
      const newFridgeItem: Fridge = {
        _id: res.data._id,
        code: res.data.code,
        name: res.data.name,
        address: res.data.address,
        cityId: res.data.cityId,
        warehouseStatus: res.data.warehouseStatus || 'warehouse',
        clientInfo: res.data.clientInfo || null,
        createdAt: res.data.createdAt || new Date().toISOString(),
      };

      // Очищаем форму
      setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
      
      // Добавляем новый холодильник в начало списка сразу (мгновенное отображение)
      setFridges((prev) => [newFridgeItem, ...prev]);
      setTotalFridges((prev) => prev + 1);
      
      // Показываем успешное уведомление
      showToast(`Холодильник "${res.data.name}" успешно добавлен!`, 'success', 4000);
      
      // Открываем QR-код с небольшой задержкой, чтобы не блокировать UI
      requestAnimationFrame(() => {
        setTimeout(() => {
          setSelectedFridge(res.data);
          setShowQRModal(true);
        }, 100);
      });
      
      // Обновляем данные в фоне для синхронизации
      loadFridges(0, true);
      // Обновляем карту
      loadMapData();
    } catch (e: any) {
      showToast(`Ошибка: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    } finally {
      isCreatingRef.current = false;
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
      const response = await api.patch(`/api/admin/fridges/${selectedFridge._id}/client`, {
        clientInfo: clientForm,
      });
      
      // Обновляем данные холодильника в списке
      setFridges((prev) => 
        prev.map((f) => 
          f._id === selectedFridge._id 
            ? { ...f, clientInfo: response.data.clientInfo }
            : f
        )
      );
      
      // Обновляем selectedFridge, если он все еще выбран
      if (selectedFridge._id === response.data._id) {
        setSelectedFridge(response.data);
      }
      
      setShowEditModal(false);
      showToast('Данные клиента успешно сохранены', 'success');
    } catch (e: any) {
      console.error('Ошибка сохранения данных клиента:', e);
      const errorMessage = e?.response?.data?.error || e?.response?.data?.details || e?.message || 'Неизвестная ошибка';
      showToast(`Ошибка сохранения: ${errorMessage}`, 'error');
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

  // Функция для импорта холодильников из Excel
  const handleImportExcel = async () => {
    if (!importFile) {
      alert('Пожалуйста, выберите файл для импорта');
      return;
    }

    try {
      setImporting(true);
      setImportResult(null);
      setUploadProgress(0);

      const formData = new FormData();
      formData.append('file', importFile);

      const response = await api.post('/api/admin/import-fridges', formData, {
        headers: {},
        timeout: 300000, // 5 минут
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        },
      });

      setUploadProgress(100);
      setImportResult(response.data);

      // Перезагружаем данные
      loadFridges(0, true);

      alert(`Импорт завершен!\nИмпортировано: ${response.data.imported}\nДубликаты: ${response.data.duplicates}\nОшибки: ${response.data.errors}`);
      
      // Очищаем файл после успешного импорта
      setImportFile(null);
      setUploadProgress(0);
    } catch (e: any) {
      console.error('Ошибка импорта:', e);
      
      let errorMessage = 'Неизвестная ошибка';
      if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
        errorMessage = 'Превышено время ожидания. Файл слишком большой или сервер не отвечает.';
      } else if (e?.message?.includes('CORS') || e?.code === 'ERR_NETWORK') {
        errorMessage = 'Сетевая ошибка. Проверьте подключение к интернету.';
      } else if (e?.response?.data?.error) {
        errorMessage = e.response.data.error;
        if (e.response.data.details) {
          errorMessage += ': ' + e.response.data.details;
        }
      } else if (e?.message) {
        errorMessage = e.message;
      }
      
      alert('Ошибка при импорте файла: ' + errorMessage);
    } finally {
      setImporting(false);
      setTimeout(() => {
        if (!importing) {
          setUploadProgress(0);
        }
      }, 2000);
    }
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
      // Обновляем карту
      loadMapData();
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
        return <Badge className="bg-blue-100 text-blue-700">На складе</Badge>;
      case 'installed':
        return <Badge className="bg-green-100 text-green-700">Установлен</Badge>;
      case 'returned':
        return <Badge className="bg-red-100 text-red-700">Возврат</Badge>;
      case 'moved':
        return <Badge className="bg-gray-900 text-white">Перемещен</Badge>;
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const input = document.getElementById('import-file-input');
              if (input) {
                input.click();
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Импорт из Excel</span>
          </button>
          <input
            id="import-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              if (file) {
                setImportFile(file);
                setImportResult(null);
              }
            }}
            className="hidden"
            disabled={importing}
          />
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Добавить холодильник</span>
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exporting || fridges.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
          >
            {exporting ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Экспорт...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Экспорт в Excel</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Аналитика */}
      <AnalyticsPanel endpoint="/api/admin/analytics/accountant" />

      {/* Карта холодильников */}
      <Card>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Карта холодильников {user?.role === 'accountant' && user?.cityId && cities.length > 0 && `- ${cities[0]?.name}`}
        </h2>
        {mapLoading ? (
          <div className="h-[480px] flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : mapFridges.length === 0 ? (
          <div className="h-[480px] flex items-center justify-center text-slate-500">
            <p>Нет холодильников с координатами для отображения на карте</p>
          </div>
        ) : (
          <AdminFridgeMap fridges={mapFridges} />
        )}
      </Card>

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
                    {(f.cityId?.name === 'Шымкент' || f.cityId?.name === 'Кызылорда' || f.cityId?.name === 'Талдыкорган') && f.number ? (
                      <p><span className="text-slate-500">Номер:</span> {f.number}</p>
                    ) : (
                      <p><span className="text-slate-500">Код:</span> {f.code}</p>
                    )}
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
                    className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => {
          setShowAddModal(false);
          setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
        }}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Добавить холодильник</h3>
            <div className="space-y-4">
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
                {user?.role === 'accountant' && user?.cityId ? (
                  // Для бухгалтера показываем только его город (только для чтения)
                  <input
                    type="text"
                    value={cities.find(c => c._id === user.cityId)?.name || 'Город не назначен'}
                    disabled
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-slate-50 text-slate-600 cursor-not-allowed"
                  />
                ) : (
                  // Для админа - выбор города
                  <select
                    value={newFridge.cityId}
                    onChange={(e) => setNewFridge({ ...newFridge, cityId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {cities.map((c) => (
                      <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              {(() => {
                const cityIdToCheck = user?.role === 'accountant' && user?.cityId 
                  ? user.cityId 
                  : newFridge.cityId;
                const selectedCity = cities.find(c => c._id === cityIdToCheck);
                const cityNameLower = (selectedCity?.name || '').toLowerCase();
                const isKyzylorda = cityNameLower === 'кызылорда' || 
                                    cityNameLower === 'қызылорда' ||
                                    cityNameLower === 'kyzylorda';
                const isNumberCity = cityNameLower === 'шымкент' || 
                                     cityNameLower === 'талдыкорган' ||
                                     cityNameLower === 'талдыкорған' ||
                                     cityNameLower === 'taldykorgan' ||
                                     cityNameLower === 'taldikorgan';
                
                // Для Кызылорды показываем поле "ИНН клиента"
                if (isKyzylorda) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        ИНН клиента <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newFridge.clientInn}
                        onChange={(e) => setNewFridge({ ...newFridge, clientInn: e.target.value })}
                        placeholder="Введите ИНН клиента"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  );
                }
                
                // Для Шымкента и Талдыкоргана показываем поле "Номер холодильника"
                if (isNumberCity) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Номер холодильника <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newFridge.number}
                        onChange={(e) => setNewFridge({ ...newFridge, number: e.target.value })}
                        placeholder="Введите номер холодильника"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  );
                }
                return null;
              })()}
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
                  disabled={(() => {
                    if (saving || !newFridge.name.trim()) return true;
                    const cityIdToCheck = user?.role === 'accountant' && user?.cityId 
                      ? user.cityId 
                      : newFridge.cityId;
                    const selectedCity = cities.find(c => c._id === cityIdToCheck);
                    const cityNameLower = (selectedCity?.name || '').toLowerCase();
                    const isKyzylorda = cityNameLower === 'кызылорда' || 
                                        cityNameLower === 'қызылорда' ||
                                        cityNameLower === 'kyzylorda';
                    const isNumberCity = cityNameLower === 'шымкент' || 
                                         cityNameLower === 'талдыкорган' ||
                                         cityNameLower === 'талдыкорған' ||
                                         cityNameLower === 'taldykorgan' ||
                                         cityNameLower === 'taldikorgan';
                    if (isKyzylorda && !newFridge.clientInn.trim()) return true;
                    if (isNumberCity && !newFridge.number.trim()) return true;
                    return false;
                  })()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? 'Создание...' : 'Создать'}
                </button>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
                  }}
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
            <p className="text-sm text-slate-600 mb-4">
              Холодильник: {selectedFridge.name}{' '}
              {(() => {
                // Для Кызылорды используем ИНН клиента, если он есть
                if (selectedFridge.cityId?.name === 'Кызылорда' && selectedFridge.clientInfo?.inn) {
                  return `(${selectedFridge.clientInfo.inn})`;
                }
                // Для Шымкента и Талдыкоргана используем number
                if ((selectedFridge.cityId?.name === 'Шымкент' || selectedFridge.cityId?.name === 'Талдыкорган') && selectedFridge.number) {
                  return `(${selectedFridge.number})`;
                }
                // Для остальных городов используем code с префиксом #
                return `(#${selectedFridge.code})`;
              })()}
            </p>
            
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
                  statusForm.warehouseStatus === 'installed' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
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
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4" 
          onClick={() => setShowQRModal(false)}
          style={{ zIndex: 1000 }}
        >
          <div 
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative z-[1001]" 
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: 1001 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">QR-код холодильника</h3>
              <button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <div className="mb-4">
              {(() => {
                // Для Кызылорды используем ИНН клиента, если он есть
                if (selectedFridge.cityId?.name === 'Кызылорда' && selectedFridge.clientInfo?.inn) {
                  return <p className="text-xs text-slate-500 font-mono text-center">{selectedFridge.clientInfo.inn}</p>;
                }
                // Для Шымкента и Талдыкоргана используем number
                if ((selectedFridge.cityId?.name === 'Шымкент' || selectedFridge.cityId?.name === 'Талдыкорган') && selectedFridge.number) {
                  return <p className="text-xs text-slate-500 font-mono text-center">{selectedFridge.number}</p>;
                }
                // Для остальных городов используем code
                return <p className="text-xs text-slate-500 font-mono text-center">#{selectedFridge.code}</p>;
              })()}
            </div>
            <div className="flex justify-center mb-4">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(
                  (() => {
                    // Для Кызылорды используем ИНН клиента, если он есть
                    if (selectedFridge.cityId?.name === 'Кызылорда' && selectedFridge.clientInfo?.inn) {
                      return selectedFridge.clientInfo.inn;
                    }
                    // Для Шымкента и Талдыкоргана используем number
                    if ((selectedFridge.cityId?.name === 'Шымкент' || selectedFridge.cityId?.name === 'Талдыкорган') && selectedFridge.number) {
                      return selectedFridge.number;
                    }
                    // Для остальных городов используем code
                    return selectedFridge.code;
                  })()
                )}`}
                code={selectedFridge.code}
                number={(() => {
                  // Для Кызылорды используем ИНН клиента, если он есть
                  if (selectedFridge.cityId?.name === 'Кызылорда' && selectedFridge.clientInfo?.inn) {
                    return selectedFridge.clientInfo.inn;
                  }
                  // Для остальных городов используем number
                  return selectedFridge.number;
                })()}
                cityName={selectedFridge.cityId?.name}
                size={200}
              />
            </div>
            <p className="text-xs text-slate-500 text-center">
              Отсканируйте QR-код для отметки посещения холодильника
            </p>
          </div>
        </div>
      )}

      {/* Модальное окно импорта Excel */}
      {(importFile !== null || importing) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !importing && setImportFile(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Импорт холодильников из Excel</h3>
              {!importing && (
                <button
                  onClick={() => setImportFile(null)}
                  className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                >
                  ×
                </button>
              )}
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Выберите Excel файл
                </label>
                <input
                  id="import-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  disabled={importing}
                  className="hidden"
                />
                {importFile && (
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{importFile.name}</p>
                      <p className="text-xs text-slate-500">{(importFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    {!importing && (
                      <button
                        onClick={() => setImportFile(null)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {importing && uploadProgress > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-600">Загрузка...</span>
                    <span className="text-sm font-medium text-slate-900">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {importResult && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-900 mb-2">Импорт завершен!</p>
                  <div className="text-sm text-green-700 space-y-1">
                    <p>Импортировано: <strong>{importResult.imported}</strong></p>
                    <p>Дубликаты: <strong>{importResult.duplicates}</strong></p>
                    {importResult.errors > 0 && (
                      <p className="text-red-600">Ошибки: <strong>{importResult.errors}</strong></p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleImportExcel}
                  disabled={!importFile || importing}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {importing ? 'Импорт...' : 'Импортировать'}
                </button>
                {!importing && (
                  <button
                    onClick={() => {
                      setImportFile(null);
                      setImportResult(null);
                    }}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    Отмена
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500">
                💡 Холодильники будут автоматически привязаны к вашему городу: <strong>{user?.cityId ? cities.find(c => c._id === user.cityId)?.name || 'Ваш город' : 'Ваш город'}</strong>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

