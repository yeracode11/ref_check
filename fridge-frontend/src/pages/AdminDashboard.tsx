import { useEffect, useState, useCallback, useRef } from 'react';
import { getDisplayIdentifier } from '../utils/fridgeUtils';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
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
  number?: string; // Длинный номер из Excel
  name: string;
  address?: string;
  city?: { _id?: string; name: string; code: string } | null;
  location?: { type: 'Point'; coordinates: [number, number] };
  lastVisit?: string | null;
  status: 'today' | 'week' | 'old' | 'never' | 'warehouse' | 'location_changed';
  warehouseStatus?: 'warehouse' | 'installed' | 'returned' | 'moved';
  visitStatus?: 'today' | 'week' | 'old' | 'never';
  clientInfo?: ClientInfo | null;
};

type Checkin = {
  id: number;
  managerId: string;
  managerUsername?: string;
  managerFullName?: string;
  fridgeId: string;
  visitedAt: string;
  address?: string;
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return {
    date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Almaty' }),
    time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }),
  };
}

const ITEMS_PER_PAGE = 50; // Количество холодильников на странице
const LIST_SEARCH_DEBOUNCE_MS = 450;
/** Сколько последних отметок грузим для блока на дашборде (полное число — в поле total от API) */
const ADMIN_CHECKINS_PREVIEW_LIMIT = 20;

function parseCheckinsApiResponse(raw: unknown): {
  list: Checkin[];
  total: number;
  distinctManagers: number | null;
} {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    const r = raw as { data: Checkin[]; total?: number; distinctManagers?: number };
    return {
      list: r.data,
      total: typeof r.total === 'number' ? r.total : r.data.length,
      distinctManagers: typeof r.distinctManagers === 'number' ? r.distinctManagers : null,
    };
  }
  const arr = Array.isArray(raw) ? (raw as Checkin[]) : [];
  return { list: arr, total: arr.length, distinctManagers: null };
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [fridges, setFridges] = useState<AdminFridge[]>([]); // Для списка (пагинация)
  const [allFridges, setAllFridges] = useState<AdminFridge[]>([]); // Для карты (все)
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  /** Реальное число отметок в БД (GET /api/checkins?meta=1), не длина загруженной выборки */
  const [checkinsTotal, setCheckinsTotal] = useState<number | null>(null);
  const [checkinsDistinctManagers, setCheckinsDistinctManagers] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Фильтр списка «Холодильники» по складскому статусу (серверный) */
  const [listWarehouseStatus, setListWarehouseStatus] = useState<string>('all');
  const [listSearchInput, setListSearchInput] = useState('');
  const [listSearchQuery, setListSearchQuery] = useState('');
  const listSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [cityStatistics, setCityStatistics] = useState<any>(null);
  const [loadingCityStats, setLoadingCityStats] = useState(false);
  const [importCityId, setImportCityId] = useState<string>(''); // Выбранный город для импорта
  const [showImportModal, setShowImportModal] = useState(false); // Модальное окно выбора города
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number; total: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState<string>(''); // Прогресс обработки на сервере
  const [showAddFridgeModal, setShowAddFridgeModal] = useState(false);
  const [newFridge, setNewFridge] = useState({ name: '', address: '', description: '', cityId: '', number: '', clientInn: '' });
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
  // ВАЖНО: грузим это в фоне, не блокируя первый рендер и список
  useEffect(() => {
    if (!user || user.role !== 'admin') {
      return;
    }

    let alive = true;
    (async () => {
      try {
        // Сначала грузим холодильники: это критично для карты.
        const fridgeStatusRes = await api.get('/api/admin/fridge-status?all=true');
        if (!alive) return;

        // При all=true эндпоинт возвращает массив напрямую
        const fridgesData = Array.isArray(fridgeStatusRes.data)
          ? fridgeStatusRes.data
          : (fridgeStatusRes.data?.data || []);
        console.log('[AdminDashboard] Loaded fridges:', fridgesData.length);
        setAllFridges(fridgesData);
        setError(null);

        // Чекины догружаем отдельно: meta=1 даёт точный total в БД, в теле — только последние N.
        api.get(`/api/checkins?meta=1&limit=${ADMIN_CHECKINS_PREVIEW_LIMIT}`)
          .then((checkinsRes) => {
            if (!alive) return;
            const { list, total, distinctManagers } = parseCheckinsApiResponse(checkinsRes.data);
            setCheckins(list);
            setCheckinsTotal(total);
            setCheckinsDistinctManagers(distinctManagers);
          })
          .catch((checkinsErr: any) => {
            if (!alive) return;
            console.error('[AdminDashboard] Error loading checkins:', checkinsErr);
          });
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Ошибка загрузки данных');
      } finally {
        // Ничего не делаем с основным состоянием загрузки,
        // чтобы не блокировать первый рендер списка
      }
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  // Загрузка статистики по городам
  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'accountant')) {
      return;
    }

    let alive = true;
    (async () => {
      try {
        setLoadingCityStats(true);
        const res = await api.get('/api/admin/statistics/by-cities');
        if (!alive) return;
        setCityStatistics(res.data);
      } catch (e: any) {
        if (!alive) return;
        console.error('Ошибка загрузки статистики по городам:', e);
      } finally {
        if (alive) setLoadingCityStats(false);
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
      if (listWarehouseStatus !== 'all') {
        params.append('warehouseStatus', listWarehouseStatus);
      }
      if (listSearchQuery.trim()) {
        params.append('search', listSearchQuery.trim());
      }

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
  }, [user, listWarehouseStatus, listSearchQuery]);

  useEffect(() => {
    if (listSearchTimeoutRef.current) {
      clearTimeout(listSearchTimeoutRef.current);
    }
    listSearchTimeoutRef.current = setTimeout(() => {
      setListSearchQuery(listSearchInput.trim());
    }, LIST_SEARCH_DEBOUNCE_MS);
    return () => {
      if (listSearchTimeoutRef.current) {
        clearTimeout(listSearchTimeoutRef.current);
      }
    };
  }, [listSearchInput]);

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
      // Для больших объемов отключаем геокодирование (быстрее)
      // Можно добавить опцию для пользователя, но пока отключаем для скорости
      const response = await api.get('/api/admin/export-fridges?geocode=false', {
        responseType: 'blob', // Важно для скачивания файла
        timeout: 300000, // 5 минут
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

  // Функция для создания резервной копии
  const handleBackup = async () => {
    try {
      setBackingUp(true);
      showToast('Создание резервной копии...', 'info', 2000);
      
      const response = await api.get('/api/admin/backup', {
        responseType: 'json',
        timeout: 300000, // 5 минут
      });
      
      // Преобразуем JSON в строку с форматированием
      const jsonString = JSON.stringify(response.data, null, 2);
      
      // Создаем blob из JSON строки
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Получаем имя файла из заголовка Content-Disposition или создаем по дате
      const contentDisposition = (response.headers as any)?.['content-disposition'];
      let fileName = `backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      
      showToast('Резервная копия успешно создана!', 'success', 3000);
    } catch (e: any) {
      console.error('Ошибка создания резервной копии:', e);
      const errorMessage = e?.response?.data?.error || e?.message || 'Неизвестная ошибка';
      showToast(`Ошибка при создании резервной копии: ${errorMessage}`, 'error', 5000);
    } finally {
      setBackingUp(false);
    }
  };

  // Функция для импорта холодильников из Excel
  const handleImportExcel = async () => {
    if (!importFile) {
      alert('Пожалуйста, выберите файл для импорта');
      return;
    }

    if (!importCityId) {
      alert('Пожалуйста, выберите город для импорта');
      return;
    }

    try {
      setImporting(true);
      setImportResult(null);
      setUploadProgress(0);
      setProcessingProgress('Загрузка файла...');

      // Дополнительная проверка на наличие файла
      if (!importFile) {
        alert('Файл не выбран');
        return;
      }

      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('cityId', importCityId); // Добавляем выбранный город

      // Явно создаем конфигурацию для axios, чтобы убедиться, что FormData обрабатывается правильно
      // Важно: не устанавливаем Content-Type - axios должен автоматически установить multipart/form-data
      const axiosConfig = {
        headers: {
          // НЕ устанавливаем Content-Type - axios сделает это автоматически для FormData
        },
        timeout: 600000, // 10 минут (увеличено для больших файлов)
        // Явно указываем, что это FormData, чтобы axios не пытался сериализовать как JSON
        transformRequest: [(data: any) => data],
        onUploadProgress: (progressEvent: any) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
            if (percentCompleted >= 100) {
              setProcessingProgress('Обработка данных на сервере...');
            }
          }
        },
      };

      setProcessingProgress('Обработка данных на сервере...');
      const response = await api.post('/api/admin/import-fridges', formData, axiosConfig);

      setUploadProgress(100);
      setProcessingProgress('Импорт завершен!');
      setImportResult(response.data);

      // Перезагружаем данные
      if (user && user.role === 'admin') {
        const [fridgeStatusRes] = await Promise.all([
          api.get('/api/admin/fridge-status?all=true'),
        ]);
        const fridgesData = Array.isArray(fridgeStatusRes.data) 
          ? fridgeStatusRes.data 
          : (fridgeStatusRes.data?.data || []);
        setAllFridges(fridgesData);
        loadFridges(0, true);
      }

      alert(`Импорт завершен!\nИмпортировано: ${response.data.imported}\nДубликаты: ${response.data.duplicates}\nОшибки: ${response.data.errors}`);
      
      // Очищаем файл и закрываем модальное окно после успешного импорта
      setImportFile(null);
      setImportCityId('');
      setShowImportModal(false);
      setUploadProgress(0);
      setProcessingProgress('');
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
      setProcessingProgress('');
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

    // При ручном создании ИНН клиента обязателен для всех городов
    if (!newFridge.clientInn.trim()) {
      alert('Необходимо указать ИНН клиента');
      return;
    }

    try {
      isCreatingRef.current = true;
      setCreatingFridge(true);
      
      // Показываем toast и закрываем модальное окно сразу
      showToast('Холодильник добавляется... Можете закрыть окно, мы сообщим когда он будет готов.', 'info', 5000);
      setShowAddFridgeModal(false);
      
      // Создаем холодильник в фоне
      // При ручном создании для всех городов отправляем ИНН клиента
      const requestData: any = {
        name: newFridge.name.trim(),
        address: newFridge.address.trim() || undefined,
        description: newFridge.description.trim() || undefined,
        cityId: newFridge.cityId || undefined,
        clientInfo: { inn: newFridge.clientInn.trim() },
      };
      
      const response = await api.post('/api/admin/fridges', requestData);

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
      setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
      
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
          const fridgesData = Array.isArray(fridgeStatusRes.data) 
            ? fridgeStatusRes.data 
            : (fridgeStatusRes.data?.data || []);
          setAllFridges(fridgesData);
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

  // Показываем все холодильники с координатами на карте
  const fridgesWithCheckins = allFridges;

  // Фильтрация по городу для карты
  let fridgesByCity = fridgesWithCheckins;
  if (selectedCityIdForMap !== 'all') {
    fridgesByCity = fridgesWithCheckins.filter((f) => {
      return f.city?._id === selectedCityIdForMap || f.city?.code === selectedCityIdForMap;
    });
  }

  const fridgesWithLocation = fridgesByCity.filter((f) => {
    if (!f.location || !f.location.coordinates) return false;
    if (!Array.isArray(f.location.coordinates) || f.location.coordinates.length !== 2) return false;
    const [lng, lat] = f.location.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') return false;
    if (isNaN(lng) || isNaN(lat)) return false;
    if (lng === 0 && lat === 0) return false;
    return true;
  });

  const fridgesForMap: AdminFridge[] = fridgesWithLocation;
  const filteredAllFridges = allFridges;

  const filteredFridges = fridges;

  // Статистика по статусам
  // Зеленые: свежие отметки (today/week)
  const greenFridges = filteredAllFridges.filter((f) => 
    f.status === 'today' || f.status === 'week'
  ).length;
  // Красные: старые отметки (old)
  const redFridges = filteredAllFridges.filter((f) => 
    f.status === 'old'
  ).length;
  // ВРЕМЕННО ОТКЛЮЧЕНО: Черные: перемещенные
  // const blackFridges = filteredAllFridges.filter((f) => f.status === 'location_changed').length;
  // Синие: нет отметок (на складе)
  const blueFridges = filteredAllFridges.filter((f) => f.status === 'never').length;
  // На складе: для информации
  const warehouseFridges = filteredAllFridges.filter((f) => f.warehouseStatus === 'warehouse' || f.warehouseStatus === 'returned').length;
  const totalCheckins = checkinsTotal ?? checkins.length;
  const uniqueManagers =
    checkinsDistinctManagers ?? new Set(checkins.map((c) => c.managerId)).size;

  const recentCheckins = checkins.slice(0, ADMIN_CHECKINS_PREVIEW_LIMIT);

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
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setImportFile(file);
                  if (file) {
                    // Открываем модальное окно для выбора города
                    setShowImportModal(true);
                    // Если города еще не загружены, загружаем их
                    if (cities.length === 0) {
                      api.get('/api/cities?active=true').then(res => {
                        setCities(res.data);
                        if (res.data.length > 0) {
                          setImportCityId(res.data[0]._id);
                        }
                      });
                    } else if (cities.length > 0) {
                      setImportCityId(cities[0]._id);
                    }
                  }
                }}
                className="hidden"
                disabled={importing}
              />
            </label>
            {importFile && !showImportModal && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 max-w-[150px] truncate">{importFile.name}</span>
                <span className="text-xs text-slate-500">
                  ({(importFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
                <button
                  onClick={() => {
                    setImportFile(null);
                    setImportCityId('');
                    setShowImportModal(false);
                    setUploadProgress(0);
                  }}
                  disabled={importing}
                  className="px-2 py-1.5 text-slate-600 hover:text-slate-800 disabled:opacity-50"
                  title="Отменить"
                >
                  ✕
                </button>
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
          {/* Резервное копирование */}
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
            title="Создать резервную копию всех холодильников и отметок"
          >
            {backingUp ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Создание...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Резервная копия</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-sm text-slate-500">Всего холодильников</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{allFridges.length}</p>
          <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> Свежие отметки: {greenFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Старые отметки: {redFridges}
            </span>
            {/* ВРЕМЕННО ОТКЛЮЧЕНО: черная метка для перемещенных холодильников */}
            {/* <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-900" /> Перемещенные: {blackFridges}
            </span> */}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-600" /> На складе: {blueFridges}
            </span>
          </div>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Всего отметок</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalCheckins}</p>
          {checkinsTotal != null && checkinsTotal > checkins.length ? (
            <p className="text-xs text-slate-400 mt-1">
              В блоке «Последние отметки» — {checkins.length} из {checkinsTotal}
            </p>
          ) : null}
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

      {/* Статистика по городам */}
      {cityStatistics && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            📊 Статистика по городам
          </h2>
          {loadingCityStats ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : cityStatistics.cities && cityStatistics.cities.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 font-semibold text-slate-700">Город</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-700">Всего</th>
                    <th className="text-right py-3 px-4 font-semibold text-green-600">Свежие</th>
                    <th className="text-right py-3 px-4 font-semibold text-red-600">Старые</th>
                    <th className="text-right py-3 px-4 font-semibold text-blue-600">На складе</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-600">Установлены</th>
                    <th className="text-right py-3 px-4 font-semibold text-yellow-600">Возврат</th>
                    <th className="text-right py-3 px-4 font-semibold text-orange-600">Перемещены</th>
                  </tr>
                </thead>
                <tbody>
                  {cityStatistics.cities.map((city: any) => (
                    <tr key={city.cityId} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{city.cityName}</div>
                        {city.cityCode && (
                          <div className="text-xs text-slate-500 font-mono">{city.cityCode}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900">
                        {city.total}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          {city.fresh}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          {city.old}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-blue-600" />
                          {city.never}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600">
                        {city.installed}
                      </td>
                      <td className="py-3 px-4 text-right text-yellow-600">
                        {city.returned}
                      </td>
                      <td className="py-3 px-4 text-right text-orange-600">
                        {city.moved}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <td className="py-3 px-4 text-slate-900">Итого</td>
                    <td className="py-3 px-4 text-right text-slate-900">
                      {cityStatistics.summary.totalFridges}
                    </td>
                    <td className="py-3 px-4 text-right text-green-600">
                      {cityStatistics.summary.totalFresh}
                    </td>
                    <td className="py-3 px-4 text-right text-red-600">
                      {cityStatistics.summary.totalOld}
                    </td>
                    <td className="py-3 px-4 text-right text-blue-600">
                      {cityStatistics.summary.totalNever}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-600">
                      {cityStatistics.cities.reduce((sum: number, c: any) => sum + c.installed, 0)}
                    </td>
                    <td className="py-3 px-4 text-right text-yellow-600">
                      {cityStatistics.cities.reduce((sum: number, c: any) => sum + c.returned, 0)}
                    </td>
                    <td className="py-3 px-4 text-right text-orange-600">
                      {cityStatistics.cities.reduce((sum: number, c: any) => sum + c.moved, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              Нет данных по городам
            </div>
          )}
        </Card>
      )}

      {/* Recent checkins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900">Последние отметки</h2>
            <div className="flex items-center gap-2">
              <Badge variant="info">
                {recentCheckins.length}
                {checkinsTotal != null && checkinsTotal > recentCheckins.length
                  ? ` / ${checkinsTotal}`
                  : ''}
              </Badge>
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
                // Находим холодильник по коду для получения его id
                const fridge = allFridges.find(f => f.code === c.fridgeId);
                return (
                  <div
                    key={c.id}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1 bg-white hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => {
                      if (fridge) {
                        setSelectedFridgeId(fridge.id);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">
                        Отметка #{c.id}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{dt.date} в {dt.time}</span>
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
                      <span>👤 Менеджер: <span className="font-medium">{c.managerUsername || c.managerId}</span></span>
                      <span>🧊 Холодильник: <span className="font-medium text-blue-600">#{c.fridgeId}</span></span>
                    </div>
                    {c.address && (
                      <div className="text-xs text-slate-500 truncate">
                        <span className="text-slate-400">📍</span> {c.address}
                      </div>
                    )}
                    {fridge && (
                      <div className="text-xs text-blue-600 mt-1">
                        ℹ️ Нажмите для просмотра деталей холодильника
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
          <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Поиск
              </label>
              <input
                type="text"
                value={listSearchInput}
                onChange={(e) => setListSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (listSearchTimeoutRef.current) {
                      clearTimeout(listSearchTimeoutRef.current);
                    }
                    setListSearchQuery(listSearchInput.trim());
                  }
                }}
                placeholder="Название, код, адрес, описание…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Статус на складе
              </label>
              <select
                value={listWarehouseStatus}
                onChange={(e) => setListWarehouseStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              >
                <option value="all">Все статусы</option>
                <option value="warehouse">На складе</option>
                <option value="installed">Установлен</option>
                <option value="returned">Возврат на склад</option>
                <option value="moved">Перемещён</option>
              </select>
            </div>
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
              title={listSearchQuery.trim() ? 'Ничего не найдено' : 'Нет холодильников'}
              description={
                listSearchQuery.trim()
                  ? 'Попробуйте изменить поисковый запрос.'
                  : listWarehouseStatus !== 'all'
                    ? 'Нет холодильников с выбранным статусом на складе.'
                    : 'Холодильники еще не были импортированы.'
              }
            />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredFridges.map((f) => {
                let statusLabel = 'Нет отметок';
                let statusColor = 'bg-slate-200 text-slate-700';
                
                // Определяем статус и цвет на основе статуса карты и warehouseStatus
                // ВРЕМЕННО ОТКЛЮЧЕНО: черная метка для перемещенных холодильников
                // if (f.status === 'location_changed') {
                //   // Местоположение изменилось - черный
                //   statusLabel = 'Перемещен';
                //   statusColor = 'bg-gray-900 text-white';
                // } else 
                if (f.status === 'today') {
                  statusLabel = 'Сегодня';
                  statusColor = 'bg-green-100 text-green-700';
                } else if (f.status === 'week') {
                  statusLabel = 'Неделя';
                  statusColor = 'bg-green-100 text-green-700';
                } else if (f.status === 'old') {
                  // Старые отметки (больше недели) - красный
                  statusLabel = 'Давно';
                  statusColor = 'bg-red-100 text-red-700';
                } else {
                  // Нет посещений - показываем warehouseStatus
                  if (f.warehouseStatus === 'moved') {
                    statusLabel = 'Перемещен';
                    statusColor = 'bg-red-100 text-red-700'; // Красный для перемещенных
                  } else if (f.warehouseStatus === 'installed') {
                    statusLabel = 'Установлен';
                    statusColor = 'bg-green-100 text-green-700'; // Зеленый для установленных
                  } else if (f.warehouseStatus === 'returned') {
                    statusLabel = 'Возврат';
                    statusColor = 'bg-yellow-100 text-yellow-700'; // Желтый для возврата
                  } else if (f.warehouseStatus === 'warehouse') {
                    statusLabel = 'На складе';
                    statusColor = 'bg-slate-200 text-slate-700'; // Серый для склада
                  } else {
                    statusLabel = 'Нет отметок';
                    statusColor = 'bg-blue-100 text-blue-700';
                  }
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
                        {(() => {
                          const displayId = getDisplayIdentifier(
                            { clientInfo: f.clientInfo, number: f.number, code: f.code, name: f.name },
                            f.city?.name
                          );
                          if (!displayId) return null;
                          // Для Кызылорды и городов с number не добавляем префикс #
                          const isNumberCity = f.city?.name === 'Кызылорда' || f.city?.name === 'Шымкент' || f.city?.name === 'Талдыкорган';
                          return (
                            <p className="text-xs text-slate-500 font-mono truncate">
                              {isNumberCity ? displayId : `#${displayId}`}
                            </p>
                          );
                        })()}
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
            {(checkinsTotal ?? checkins.length) > 0 && (
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
      <AnalyticsPanel cities={cities} />

      {/* Модальное окно для добавления холодильника */}
      {showAddFridgeModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowAddFridgeModal(false);
            setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Добавить холодильник</h3>
              <button
                onClick={() => {
                  setShowAddFridgeModal(false);
                  setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
                }}
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
              {/* Поле ИНН клиента для всех городов при ручном создании */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ИНН клиента <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newFridge.clientInn}
                  onChange={(e) => setNewFridge({ ...newFridge, clientInn: e.target.value })}
                  placeholder="Введите ИНН клиента"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
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
                  disabled={creatingFridge || !newFridge.name.trim() || !newFridge.clientInn.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {creatingFridge ? 'Создание...' : 'Создать'}
                </button>
                <button
                  onClick={() => {
                    setShowAddFridgeModal(false);
                    setNewFridge({ name: '', address: '', description: '', cityId: cities[0]?._id || '', number: '', clientInn: '' });
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
              {(() => {
                const displayId = getDisplayIdentifier(
                  { clientInfo: selectedQRFridge.clientInfo, number: selectedQRFridge.number, code: selectedQRFridge.code, name: selectedQRFridge.name },
                  selectedQRFridge.city?.name
                );
                if (!displayId) return null;
                const isNumberCity = selectedQRFridge.city?.name === 'Кызылорда' || selectedQRFridge.city?.name === 'Шымкент' || selectedQRFridge.city?.name === 'Талдыкорган';
                return (
                  <p className="text-xs text-slate-500 font-mono text-center">
                    {isNumberCity ? displayId : `#${displayId}`}
                  </p>
                );
              })()}
            </div>
            <div className="flex justify-center mb-4">
              <QRCode
                value={`${window.location.origin}/checkin/${encodeURIComponent(
                  getDisplayIdentifier(
                    { clientInfo: selectedQRFridge.clientInfo, number: selectedQRFridge.number, code: selectedQRFridge.code, name: selectedQRFridge.name },
                    selectedQRFridge.city?.name
                  ) || selectedQRFridge.code
                )}`}
                code={selectedQRFridge.city?.name === 'Кызылорда' ? undefined : selectedQRFridge.code}
                number={(() => {
                  const displayId = getDisplayIdentifier(
                    { clientInfo: selectedQRFridge.clientInfo, number: selectedQRFridge.number, code: selectedQRFridge.code, name: selectedQRFridge.name },
                    selectedQRFridge.city?.name
                  );
                  // Для Кызылорды: если нет number и нет ИНН, но есть извлеченный номер, используем его
                  if (selectedQRFridge.city?.name === 'Кызылорда') {
                    return displayId || undefined;
                  }
                  // Для остальных городов используем displayId (ИНН или number)
                  return displayId || undefined;
                })()}
                cityName={selectedQRFridge.city?.name}
                title={selectedQRFridge.city?.name === 'Тараз' ? selectedQRFridge.name : undefined}
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
                    const checkinsRes = await api.get(
                      `/api/checkins?meta=1&limit=${ADMIN_CHECKINS_PREVIEW_LIMIT}`,
                    );
                    const parsed = parseCheckinsApiResponse(checkinsRes.data);
                    setCheckins(parsed.list);
                    setCheckinsTotal(parsed.total);
                    setCheckinsDistinctManagers(parsed.distinctManagers);
                    // Перезагружаем данные холодильников для карты, чтобы обновить статусы
                    const fridgeStatusRes = await api.get('/api/admin/fridge-status?all=true');
                    const fridgesData = Array.isArray(fridgeStatusRes.data) 
                      ? fridgeStatusRes.data 
                      : (fridgeStatusRes.data?.data || []);
                    setAllFridges(fridgesData);
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
              Вы уверены, что хотите удалить{' '}
              <strong>все {checkinsTotal ?? checkins.length} отметок</strong>?
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
                    setCheckins([]);
                    setCheckinsTotal(0);
                    setCheckinsDistinctManagers(0);
                    // Перезагружаем данные холодильников для карты, чтобы обновить статусы
                    // После удаления всех отметок все холодильники должны получить status = 'never'
                    const fridgeStatusRes = await api.get('/api/admin/fridge-status?all=true');
                    const fridgesData = Array.isArray(fridgeStatusRes.data) 
                      ? fridgeStatusRes.data 
                      : (fridgeStatusRes.data?.data || []);
                    setAllFridges(fridgesData);
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

      {/* Модальное окно выбора города для импорта */}
      {showImportModal && importFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => !importing && setShowImportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Импорт холодильников из Excel</h3>
              {!importing && (
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setImportCityId('');
                  }}
                  className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                >
                  ×
                </button>
              )}
            </div>
            
            <div className="space-y-4">
              {/* Информация о файле */}
              {importFile && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{importFile.name}</p>
                    <p className="text-xs text-slate-500">{(importFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
              )}

              {/* Выбор города */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Выберите город для импорта <span className="text-red-500">*</span>
                </label>
                <select
                  value={importCityId}
                  onChange={(e) => setImportCityId(e.target.value)}
                  disabled={importing || cities.length === 0}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cities.length === 0 ? (
                    <option value="">Загрузка городов...</option>
                  ) : (
                    <>
                      <option value="">-- Выберите город --</option>
                      {cities.map((city) => (
                        <option key={city._id} value={city._id}>
                          {city.name} ({city.code})
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {cities.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1">Загрузка списка городов...</p>
                )}
              </div>

              {/* Прогресс загрузки */}
              {importing && uploadProgress > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-600">Загрузка файла...</span>
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

              {/* Прогресс обработки на сервере */}
              {importing && processingProgress && uploadProgress >= 100 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-600">{processingProgress}</span>
                    <LoadingSpinner size="sm" />
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div className="bg-green-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Пожалуйста, подождите. Это может занять несколько минут для больших файлов...</p>
                </div>
              )}

              {/* Результат импорта */}
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

              {/* Кнопки */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleImportExcel}
                  disabled={!importCityId || importing || cities.length === 0}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {importing ? 'Импорт...' : 'Импортировать'}
                </button>
                {!importing && (
                  <button
                    onClick={() => {
                      setShowImportModal(false);
                      setImportFile(null);
                      setImportCityId('');
                      setImportResult(null);
                    }}
                    className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    Отмена
                  </button>
                )}
              </div>
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
                    setCheckinsTotal(0);
                    setCheckinsDistinctManagers(0);
                    
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


