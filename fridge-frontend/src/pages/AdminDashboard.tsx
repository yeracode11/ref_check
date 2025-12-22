import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge, Button } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { AdminFridgeMap } from '../components/admin/AdminFridgeMap';
import { QRCode } from '../components/ui/QRCode';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import { AnalyticsPanel } from '../components/admin/AnalyticsPanel';
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

type AdminFridge = {
  id: string;
  code: string;
  name: string;
  address?: string;
  city?: { _id?: string; name: string; code: string } | null;
  location?: { type: 'Point'; coordinates: [number, number] };
  lastVisit?: string | null;
  status: 'today' | 'week' | 'old' | 'never' | 'warehouse';
  warehouseStatus?: 'warehouse' | 'installed' | 'returned';
  visitStatus?: 'today' | 'week' | 'old' | 'never';
  clientInfo?: ClientInfo | null;
};

type Checkin = {
  id: number;
  managerId: string;
  fridgeId: string;
  visitedAt: string;
  address?: string;
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

const ITEMS_PER_PAGE = 50; // Количество холодильников на странице

export default function AdminDashboard() {
  const { user } = useAuth();
  const [fridges, setFridges] = useState<AdminFridge[]>([]); // Для списка (пагинация)
  const [allFridges, setAllFridges] = useState<AdminFridge[]>([]); // Для карты (все)
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fridgeFilter, setFridgeFilter] = useState('');
  const [selectedQRFridge, setSelectedQRFridge] = useState<AdminFridge | null>(null);
  const [selectedFridgeId, setSelectedFridgeId] = useState<string | null>(null); // Для детального просмотра
  const [hasMore, setHasMore] = useState(false);
  const [totalFridges, setTotalFridges] = useState(0);
  const [deleteCheckinId, setDeleteCheckinId] = useState<number | null>(null); // Для подтверждения удаления отметки
  const [deletingCheckin, setDeletingCheckin] = useState(false);
  const [showDeleteAllCheckins, setShowDeleteAllCheckins] = useState(false); // Для подтверждения удаления всех отметок
  const [deletingAllCheckins, setDeletingAllCheckins] = useState(false);
  const [showDeleteAllFridges, setShowDeleteAllFridges] = useState(false); // Для подтверждения удаления всех холодильников
  const [deletingAllFridges, setDeletingAllFridges] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number; total: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showAddFridgeModal, setShowAddFridgeModal] = useState(false);
  const [newFridge, setNewFridge] = useState({ name: '', address: '', description: '', cityId: '' });
  const [creatingFridge, setCreatingFridge] = useState(false);
  const [cities, setCities] = useState<Array<{ _id: string; name: string; code: string }>>([]);
  const [selectedCityIdForMap, setSelectedCityIdForMap] = useState<string>('all'); // 'all' для всех городов
  // Метки на карте отключены по требованию (показываем пустую карту)
  const observerTarget = useRef<HTMLDivElement | null>(null);
  const isCreatingRef = useRef(false); // Защита от двойного вызова

  // Загрузка городов
  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    let alive = true;
    (async () => {
      try {
        const res = await api.get('/api/cities?active=true');
        if (!alive) return;
        setCities(res.data);
        // Устанавливаем первый город по умолчанию
        if (res.data.length > 0 && !newFridge.cityId) {
          setNewFridge(prev => ({ ...prev, cityId: res.data[0]._id }));
        }
      } catch (e: any) {
        console.error('Ошибка загрузки городов:', e);
      }
    })();

    return () => { alive = false; };
  }, [user]);

  // Загрузка всех холодильников для карты и статистики
  useEffect(() => {
    if (!user || user.role !== 'admin') {
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [fridgeStatusRes, checkinsRes] = await Promise.all([
          api.get('/api/admin/fridge-status?all=true'), // Все для карты
          api.get('/api/checkins'),
        ]);
        if (!alive) return;
        setAllFridges(fridgeStatusRes.data);
        setCheckins(checkinsRes.data);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Ошибка загрузки данных');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  // Загрузка холодильников для списка (с пагинацией)
  const loadFridges = useCallback(async (skip = 0, reset = false) => {
    if (!user || user.role !== 'admin') return;

    let alive = true;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      params.append('limit', String(ITEMS_PER_PAGE));
      params.append('skip', String(skip));
      
      const res = await api.get(`/api/admin/fridge-status?${params.toString()}`);
      if (!alive) return;

      const { data, pagination } = res.data;
      
      if (reset) {
        setFridges(data);
      } else {
        setFridges((prev) => [...prev, ...data]);
      }
      
      setHasMore(pagination.hasMore);
      setTotalFridges(pagination.total);
      setError(null);
    } catch (e: any) {
      if (!alive) return;
      setError(e?.message || 'Ошибка загрузки данных');
    } finally {
      if (alive) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [user]);

  // Первоначальная загрузка списка холодильников
  useEffect(() => {
    if (user && user.role === 'admin') {
      loadFridges(0, true);
    }
  }, [user, loadFridges]);

  // Бесконечный скролл
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadFridges(fridges.length, false);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, loading, fridges.length, loadFridges]);

  // Функция для экспорта холодильников в Excel
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      const response = await api.get('/api/admin/export-fridges', {
        responseType: 'blob', // Важно для скачивания файла
      });
      
      // Создаем ссылку для скачивания
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Получаем имя файла из заголовка Content-Disposition
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

      // Проверяем, что файл существует
      if (!importFile) {
        alert('Файл не выбран');
        return;
      }

      console.log('Подготовка файла к отправке:', {
        name: importFile.name,
        size: importFile.size,
        type: importFile.type,
        lastModified: importFile.lastModified
      });

      const formData = new FormData();
      formData.append('file', importFile);

      // Проверяем, что файл добавлен в FormData
      console.log('FormData создан, проверка содержимого...');
      for (const pair of formData.entries()) {
        console.log('FormData entry:', pair[0], pair[1] instanceof File ? `File: ${pair[1].name} (${pair[1].size} bytes)` : pair[1]);
      }

      // Явно создаем конфигурацию для axios, чтобы убедиться, что FormData обрабатывается правильно
      // Важно: не устанавливаем Content-Type - axios должен автоматически установить multipart/form-data
      const axiosConfig = {
        headers: {
          // НЕ устанавливаем Content-Type - axios сделает это автоматически для FormData
        },
        timeout: 300000, // 5 минут
        // Явно указываем, что это FormData, чтобы axios не пытался сериализовать как JSON
        transformRequest: [(data) => {
          // Если это FormData, возвращаем как есть
          if (data instanceof FormData) {
            console.log('[API] transformRequest: FormData detected, returning as-is');
            return data;
          }
          // Для других типов данных используем стандартную сериализацию
          return data;
        }],
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        },
      };

      console.log('Отправка запроса с конфигурацией:', {
        url: '/api/admin/import-fridges',
        method: 'POST',
        hasFormData: formData instanceof FormData,
        formDataType: formData.constructor.name,
        configHeaders: axiosConfig.headers
      });

      const response = await api.post('/api/admin/import-fridges', formData, axiosConfig);

      setUploadProgress(100);
      setImportResult(response.data);

      // Перезагружаем данные
      if (user && user.role === 'admin') {
        const [fridgeStatusRes] = await Promise.all([
          api.get('/api/admin/fridge-status?all=true'),
        ]);
        setAllFridges(fridgeStatusRes.data);
        loadFridges(0, true);
      }

      alert(`Импорт завершен!\nИмпортировано: ${response.data.imported}\nДубликаты: ${response.data.duplicates}\nОшибки: ${response.data.errors}`);
      
      // Очищаем файл после успешного импорта
      setImportFile(null);
      setUploadProgress(0);
    } catch (e: any) {
      console.error('Ошибка импорта:', e);
      console.error('Ошибка импорта (полные данные):', {
        message: e?.message,
        code: e?.code,
        status: e?.response?.status,
        statusText: e?.response?.statusText,
        data: e?.response?.data,
        config: e?.config
      });
      
      // Проверяем тип ошибки
      let errorMessage = 'Неизвестная ошибка';
      if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
        errorMessage = 'Превышено время ожидания. Файл слишком большой или сервер не отвечает. Попробуйте уменьшить размер файла или повторите попытку позже.';
      } else if (e?.message?.includes('CORS') || e?.code === 'ERR_NETWORK') {
        errorMessage = 'Сетевая ошибка. Проверьте подключение к интернету и настройки CORS на сервере.';
      } else if (e?.response?.data) {
        // Детальная обработка ответа от сервера
        if (e.response.data.error) {
          errorMessage = e.response.data.error;
          if (e.response.data.details) {
            errorMessage += '\n\nДетали: ' + e.response.data.details;
          }
        } else if (e.response.data.message) {
          errorMessage = e.response.data.message;
        } else {
          errorMessage = `Ошибка ${e.response.status}: ${e.response.statusText || 'Bad Request'}`;
          if (typeof e.response.data === 'string') {
            errorMessage += '\n\n' + e.response.data;
          } else if (typeof e.response.data === 'object') {
            errorMessage += '\n\n' + JSON.stringify(e.response.data, null, 2);
          }
        }
      } else if (e?.message) {
        errorMessage = e.message;
      }
      
      alert('Ошибка при импорте файла:\n\n' + errorMessage);
    } finally {
      setImporting(false);
      // Не сбрасываем прогресс сразу, чтобы пользователь видел, что загрузка завершилась
      setTimeout(() => {
        if (!importing) {
          setUploadProgress(0);
        }
      }, 2000);
    }
  };

  // Функция для создания нового холодильника
  const handleCreateFridge = async () => {
    // Защита от двойного вызова
    if (isCreatingRef.current || creatingFridge) {
      return;
    }

    if (!newFridge.name.trim()) {
      alert('Пожалуйста, укажите название холодильника');
      return;
    }

    try {
      isCreatingRef.current = true;
      setCreatingFridge(true);
      
      // Показываем toast и закрываем модальное окно сразу
      showToast('Холодильник добавляется... Можете закрыть окно, мы сообщим когда он будет готов.', 'info', 5000);
      setShowAddFridgeModal(false);
      
      // Создаем холодильник в фоне
      const response = await api.post('/api/admin/fridges', {
        name: newFridge.name.trim(),
        address: newFridge.address.trim() || undefined,
        description: newFridge.description.trim() || undefined,
        cityId: newFridge.cityId || undefined,
      });

      // Показываем QR-код для нового холодильника (отложенно для лучшей производительности)
      const createdFridge: AdminFridge = {
        id: response.data._id,
        code: response.data.code,
        name: response.data.name,
        address: response.data.address,
        city: response.data.cityId,
        location: response.data.location,
        status: 'never',
        warehouseStatus: response.data.warehouseStatus || 'warehouse',
        visitStatus: 'never',
      };
      
      // Сбрасываем состояние загрузки
      isCreatingRef.current = false;
      setCreatingFridge(false);
      
      // Очищаем форму
      setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '' });
      
      // Добавляем новый холодильник в начало списка сразу (мгновенное отображение)
      setFridges((prev) => [createdFridge, ...prev]);
      setTotalFridges((prev) => prev + 1);
      
      // Показываем успешное уведомление
      showToast(`Холодильник "${createdFridge.name}" успешно добавлен!`, 'success', 4000);
      
      // Открываем QR-код с небольшой задержкой, чтобы не блокировать UI
      requestAnimationFrame(() => {
        setTimeout(() => {
          setSelectedQRFridge(createdFridge);
        }, 100);
      });

      // Перезагружаем данные в фоне для синхронизации (не блокируя UI)
      (async () => {
        try {
          const [fridgeStatusRes] = await Promise.all([
            api.get('/api/admin/fridge-status?all=true'),
          ]);
          setAllFridges(fridgeStatusRes.data);
          // Обновляем список с сервера для синхронизации
          loadFridges(0, true);
        } catch (e) {
          console.error('Ошибка обновления данных после создания:', e);
        }
      })();
    } catch (e: any) {
      console.error('Ошибка создания холодильника:', e);
      const errorMessage = e?.response?.data?.error || e?.message || 'Неизвестная ошибка';
      showToast(`Ошибка при создании холодильника: ${errorMessage}`, 'error', 5000);
      isCreatingRef.current = false;
      setCreatingFridge(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <EmptyState
        icon="⛔"
        title="Нет доступа"
        description="Эта страница доступна только администраторам."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 bg-slate-200 rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-slate-200 rounded w-64 animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <LoadingCard key={`admin-loading-${i}`} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <div className="text-red-600">Ошибка: {error}</div>
      </Card>
    );
  }

  // Статистика на основе всех холодильников (для карты)
  const filterQuery = fridgeFilter.trim().toLowerCase();
  
  // Фильтруем холодильники для карты: показываем только те, у которых есть реальные отметки посещений
  // Проверяем visitStatus (статус последнего визита), а не общий status
  // Холодильники со статусом 'warehouse' без отметок не должны показываться
  const fridgesWithCheckins = allFridges.filter(f => {
    // Показываем только если есть реальная отметка посещения (visitStatus !== 'never')
    // или если есть lastVisit (дата последнего посещения)
    return f.visitStatus && f.visitStatus !== 'never' || f.lastVisit;
  });
  
  // Фильтрация по городу для карты
  let fridgesByCity = fridgesWithCheckins;
  if (selectedCityIdForMap !== 'all') {
    fridgesByCity = fridgesWithCheckins.filter((f) => {
      // Проверяем по _id или по code города
      return f.city?._id === selectedCityIdForMap || f.city?.code === selectedCityIdForMap;
    });
  }
  
  const fridgesForMap: AdminFridge[] = filterQuery
    ? fridgesByCity.filter((f) => {
        const text = `${f.name ?? ''} ${f.code ?? ''} ${f.address ?? ''}`.toLowerCase();
        return text.includes(filterQuery);
      })
    : fridgesByCity;
  const filteredAllFridges = allFridges;

  // Фильтрация загруженных холодильников для списка
  const filteredFridges = filterQuery
    ? fridges.filter((f) => {
        const text = `${f.name ?? ''} ${f.code ?? ''} ${f.address ?? ''}`.toLowerCase();
        return text.includes(filterQuery);
      })
    : fridges;

  const warehouseFridges = filteredAllFridges.filter((f) => f.status === 'warehouse').length;
  const todayFridges = filteredAllFridges.filter((f) => f.status === 'today').length;
  const weekFridges = filteredAllFridges.filter((f) => f.status === 'week').length;
  const oldFridges = filteredAllFridges.filter((f) => f.status === 'old').length;
  const neverFridges = filteredAllFridges.filter((f) => f.status === 'never').length;
  const totalCheckins = checkins.length;
  const uniqueManagers = new Set(checkins.map((c) => c.managerId)).size;

  const recentCheckins = checkins.slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Админ-панель</h1>
          <p className="text-slate-500 mt-1">Мониторинг холодильников и посещений</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Добавить холодильник */}
          <button
            onClick={() => setShowAddFridgeModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Добавить холодильник</span>
          </button>
          {/* Импорт */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>Импорт из Excel</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="hidden"
                disabled={importing}
              />
            </label>
            {importFile && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 max-w-[150px] truncate">{importFile.name}</span>
                  <span className="text-xs text-slate-500">
                    ({(importFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                  <button
                    onClick={handleImportExcel}
                    disabled={importing}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {importing ? (
                      <>
                        <svg className="animate-spin h-4 w-4 inline mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Импорт...
                      </>
                    ) : (
                      'Загрузить'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setImportFile(null);
                      setUploadProgress(0);
                    }}
                    disabled={importing}
                    className="px-2 py-1.5 text-slate-600 hover:text-slate-800 disabled:opacity-50"
                    title="Отменить"
                  >
                    ✕
                  </button>
                </div>
                {importing && uploadProgress > 0 && (
                  <div className="w-full max-w-md">
                    <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                      <span>Загрузка файла...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Экспорт */}
          <button
            onClick={handleExportExcel}
            disabled={exporting || allFridges.length === 0}
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
          {/* Удалить все холодильники */}
          {allFridges.length > 0 && (
            <button
              onClick={() => setShowDeleteAllFridges(true)}
              disabled={deletingAllFridges}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
              title="Удалить все холодильники"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Удалить все</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-sm text-slate-500">Всего холодильников</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{allFridges.length}</p>
          <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> На складе: {warehouseFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> Сегодня: {todayFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" /> Неделя: {weekFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Давно: {oldFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400" /> Нет отметок: {neverFridges}
            </span>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Всего отметок</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalCheckins}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Менеджеры</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{uniqueManagers}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Пользователь</p>
          <p className="text-base font-semibold text-slate-900 mt-1">{user.username}</p>
          <p className="text-xs text-slate-500 mt-1 capitalize">{user.role}</p>
        </Card>
      </div>

      {/* Recent checkins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900">Последние отметки</h2>
            <div className="flex items-center gap-2">
              <Badge variant="info">{recentCheckins.length}</Badge>
              {checkins.length > 0 && (
                <button
                  onClick={() => setShowDeleteAllCheckins(true)}
                  className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
                  title="Удалить все отметки"
                >
                  🗑️ Удалить все
                </button>
              )}
            </div>
          </div>
          {recentCheckins.length === 0 ? (
            <EmptyState
              icon="📋"
              title="Нет отметок"
              description="Отметки еще не были созданы."
            />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {recentCheckins.map((c) => {
                const dt = formatDate(c.visitedAt);
                return (
                  <div
                    key={c.id}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1 bg-white hover:border-red-300 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">
                        #{c.id} — {dt.date}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{dt.time}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCheckinId(c.id);
                          }}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
                          title="Удалить отметку"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>Менеджер: {c.managerId}</span>
                      <span>Холодильник: {c.fridgeId}</span>
                    </div>
                    {c.address && (
                      <div className="text-xs text-slate-500 truncate">
                        <span className="text-slate-400">📍</span> {c.address}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Fridges list with pagination */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900">Холодильники</h2>
            <Badge variant="info">
              {filteredFridges.length} {totalFridges > 0 && `из ${totalFridges}`}
            </Badge>
          </div>
          <div className="mb-3">
            <input
              type="text"
              value={fridgeFilter}
              onChange={(e) => setFridgeFilter(e.target.value)}
              placeholder="Фильтр по контрагенту, коду, адресу..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
          {loading && fridges.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <LoadingCard key={`fridge-loading-${i}`} />
              ))}
            </div>
          ) : filteredFridges.length === 0 ? (
            <EmptyState
              icon="🧊"
              title="Нет холодильников"
              description="Холодильники еще не были импортированы."
            />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredFridges.map((f) => {
                let statusLabel = 'Нет отметок';
                let statusColor = 'bg-slate-200 text-slate-700';
                if (f.status === 'warehouse') {
                  statusLabel = f.warehouseStatus === 'returned' ? 'Возврат' : 'На складе';
                  statusColor = 'bg-blue-100 text-blue-700';
                } else if (f.status === 'today') {
                  statusLabel = 'Сегодня';
                  statusColor = 'bg-green-100 text-green-700';
                } else if (f.status === 'week') {
                  statusLabel = 'Неделя';
                  statusColor = 'bg-yellow-100 text-yellow-700';
                } else if (f.status === 'old') {
                  statusLabel = 'Давно';
                  statusColor = 'bg-red-100 text-red-700';
                }

                return (
                  <div
                    key={f.id}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1 bg-white hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => setSelectedFridgeId(f.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{f.name}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">#{f.code}</p>
                      </div>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    {f.address && (
                      <p className="text-xs text-slate-500 truncate">
                        <span className="text-slate-400">📍</span> {f.address}
                      </p>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedFridgeId(f.id); }}
                        className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded transition-colors"
                      >
                        Подробнее
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedQRFridge(f); }}
                        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                      >
                        📱 QR-код
                      </button>
                    </div>
                  </div>
                );
              })}
              {/* Индикатор загрузки и триггер для бесконечного скролла */}
              {hasMore && (
                <div ref={observerTarget} className="py-4 flex justify-center">
                  {loadingMore ? (
                    <LoadingSpinner size="md" />
                  ) : (
                    <div className="text-xs text-slate-500">Загрузка...</div>
                  )}
                </div>
              )}
              {!hasMore && fridges.length > 0 && (
                <div className="py-2 text-center text-xs text-slate-500">
                  Загружено все ({fridges.length} из {totalFridges})
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Карта холодильников */}
      <Card>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="font-semibold text-slate-900">
            Карта холодильников
            {selectedCityIdForMap !== 'all' && (
              <span className="text-blue-600 ml-2">
                ({cities.find(c => c._id === selectedCityIdForMap)?.name || 'Выбранный город'})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Фильтр по городу:</label>
              <select
                value={selectedCityIdForMap}
                onChange={(e) => setSelectedCityIdForMap(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[150px] shadow-sm"
              >
                <option value="all">🌍 Все города</option>
                {cities.map((city) => (
                  <option key={city._id} value={city._id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>
            {checkins.length > 0 && (
              <button
                onClick={() => setShowDeleteAllCheckins(true)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium shadow-sm flex items-center gap-2"
                title="Удалить все отметки и очистить карту"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Очистить все отметки
              </button>
            )}
          </div>
        </div>
        {fridgesForMap.length === 0 ? (
          <div className="h-[500px] flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
            <div className="text-center">
              <p className="text-slate-500 mb-2 text-lg">Нет холодильников для отображения</p>
              <p className="text-sm text-slate-400">Метки отключены.</p>
            </div>
          </div>
        ) : (
          <AdminFridgeMap fridges={fridgesForMap} />
        )}
      </Card>

      {/* Аналитика */}
      <AnalyticsPanel />

      {/* Модальное окно для добавления холодильника */}
      {showAddFridgeModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddFridgeModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Добавить холодильник</h3>
              <button
                onClick={() => setShowAddFridgeModal(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Название <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newFridge.name}
                  onChange={(e) => setNewFridge({ ...newFridge, name: e.target.value })}
                  placeholder="Введите название холодильника"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Город
                </label>
                <select
                  value={newFridge.cityId}
                  onChange={(e) => setNewFridge({ ...newFridge, cityId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {cities.map((city) => (
                    <option key={city._id} value={city._id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Адрес
                </label>
                <input
                  type="text"
                  value={newFridge.address}
                  onChange={(e) => setNewFridge({ ...newFridge, address: e.target.value })}
                  placeholder="Введите адрес (опционально)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Описание
                </label>
                <textarea
                  value={newFridge.description}
                  onChange={(e) => setNewFridge({ ...newFridge, description: e.target.value })}
                  placeholder="Введите описание (опционально)"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateFridge}
                  disabled={creatingFridge || !newFridge.name.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {creatingFridge ? 'Создание...' : 'Создать'}
                </button>
                <button
                  onClick={() => {
                    setShowAddFridgeModal(false);
                    setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '' });
                  }}
                  disabled={creatingFridge}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 disabled:opacity-50 transition-colors font-medium"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно детального просмотра холодильника */}
      {selectedFridgeId && (
        <FridgeDetailModal
          fridgeId={selectedFridgeId}
          onClose={() => setSelectedFridgeId(null)}
        />
      )}

      {/* Модальное окно для QR-кода */}
      {selectedQRFridge && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1000] p-4"
          onClick={() => setSelectedQRFridge(null)}
          style={{ zIndex: 1000 }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative z-[1001]"
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: 1001 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">QR-код холодильника</h3>
              <button
                onClick={() => setSelectedQRFridge(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-slate-600 mb-1">
                <span className="font-medium">Холодильник:</span> {selectedQRFridge.name}
              </p>
              <p className="text-xs text-slate-500 font-mono">#{selectedQRFridge.code}</p>
            </div>
            <div className="flex justify-center mb-4">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(selectedQRFridge.code)}`}
                title={selectedQRFridge.name}
                code={selectedQRFridge.code}
                size={200}
              />
            </div>
            <div className="text-xs text-slate-500 text-center">
              Отсканируйте QR-код для отметки посещения холодильника
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения удаления отметки */}
      {deleteCheckinId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setDeleteCheckinId(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Удалить отметку?</h3>
            <p className="text-slate-600 mb-4">
              Вы уверены, что хотите удалить отметку <strong>#{deleteCheckinId}</strong>?
              <br /><br />
              <span className="text-amber-600 text-sm">⚠️ Это действие нельзя отменить.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  try {
                    setDeletingCheckin(true);
                    await api.delete(`/api/checkins/${deleteCheckinId}`);
                    // Обновляем список отметок
                    const checkinsRes = await api.get('/api/checkins');
                    setCheckins(checkinsRes.data);
                    // Перезагружаем данные холодильников для карты, чтобы обновить статусы
                    const fridgeStatusRes = await api.get('/api/admin/fridge-status?all=true');
                    setAllFridges(fridgeStatusRes.data);
                    setDeleteCheckinId(null);
                    alert('Отметка удалена. Карта обновлена.');
                  } catch (e: any) {
                    alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                  } finally {
                    setDeletingCheckin(false);
                  }
                }}
                disabled={deletingCheckin}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deletingCheckin ? 'Удаление...' : '🗑️ Удалить'}
              </button>
              <button
                onClick={() => setDeleteCheckinId(null)}
                disabled={deletingCheckin}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения удаления всех отметок */}
      {showDeleteAllCheckins && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteAllCheckins(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">🗑️ Удалить все отметки?</h3>
            <p className="text-slate-600 mb-4">
              Вы уверены, что хотите удалить <strong>все {checkins.length} отметок</strong>?
              <br /><br />
              <span className="text-red-600 text-sm font-medium">⚠️ Это действие нельзя отменить.</span>
              <br />
              <span className="text-slate-500 text-sm">После удаления все метки на карте исчезнут, и карта станет пустой.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  try {
                    setDeletingAllCheckins(true);
                    await api.delete('/api/checkins');
                    // Обновляем список отметок
                    setCheckins([]);
                    // Перезагружаем данные холодильников для карты, чтобы обновить статусы
                    // После удаления всех отметок все холодильники должны получить status = 'never'
                    const fridgeStatusRes = await api.get('/api/admin/fridge-status?all=true');
                    setAllFridges(fridgeStatusRes.data);
                    setShowDeleteAllCheckins(false);
                    // Принудительно обновляем страницу, чтобы карта точно обновилась и старые метки исчезли
                    setTimeout(() => {
                      window.location.reload();
                    }, 1000);
                  } catch (e: any) {
                    alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                  } finally {
                    setDeletingAllCheckins(false);
                  }
                }}
                disabled={deletingAllCheckins}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deletingAllCheckins ? 'Удаление...' : '🗑️ Удалить все'}
              </button>
              <button
                onClick={() => setShowDeleteAllCheckins(false)}
                disabled={deletingAllCheckins}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения удаления всех холодильников */}
      {showDeleteAllFridges && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteAllFridges(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">🗑️ Удалить все холодильники?</h3>
            <p className="text-slate-600 mb-4">
              Вы уверены, что хотите удалить <strong>все {allFridges.length} холодильников</strong>?
              <br /><br />
              <span className="text-red-600 text-sm font-medium">⚠️ ВНИМАНИЕ: Это действие нельзя отменить!</span>
              <br />
              <span className="text-slate-500 text-sm">
                Будет удалено:
                <br />• Все холодильники ({allFridges.length})
                <br />• Все связанные отметки посещений
                <br />• Все данные будут потеряны безвозвратно
              </span>
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800 font-medium">
                ⚠️ Это критическая операция. Убедитесь, что вы экспортировали данные перед удалением.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  try {
                    setDeletingAllFridges(true);
                    const response = await api.delete('/api/admin/fridges/all');
                    
                    // Обновляем состояние
                    setFridges([]);
                    setAllFridges([]);
                    setTotalFridges(0);
                    setCheckins([]);
                    
                    setShowDeleteAllFridges(false);
                    
                    // Показываем сообщение об успехе
                    const message = response.data?.message || `Удалено ${response.data?.deleted || 0} холодильников`;
                    alert(message);
                    
                    // Перезагружаем страницу для полного обновления
                    setTimeout(() => {
                      window.location.reload();
                    }, 1000);
                  } catch (e: any) {
                    alert('Ошибка: ' + (e?.response?.data?.error || e.message));
                  } finally {
                    setDeletingAllFridges(false);
                  }
                }}
                disabled={deletingAllFridges}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deletingAllFridges ? 'Удаление...' : '🗑️ Удалить все'}
              </button>
              <button
                onClick={() => setShowDeleteAllFridges(false)}
                disabled={deletingAllFridges}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


