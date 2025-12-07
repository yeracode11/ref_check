import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge, Button } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { AdminFridgeMap } from '../components/admin/AdminFridgeMap';
import { QRCode } from '../components/ui/QRCode';

type AdminFridge = {
  id: string;
  code: string;
  name: string;
  address?: string;
  city?: { name: string; code: string } | null;
  location?: { type: 'Point'; coordinates: [number, number] };
  lastVisit?: string | null;
  status: 'today' | 'week' | 'old' | 'never';
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
  const [hasMore, setHasMore] = useState(false);
  const [totalFridges, setTotalFridges] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number; total: number } | null>(null);
  const observerTarget = useRef<HTMLDivElement | null>(null);

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

      const formData = new FormData();
      formData.append('file', importFile);

      // Axios автоматически установит правильный Content-Type для FormData с boundary
      const response = await api.post('/api/admin/import-fridges', formData, {
        headers: {
          // Не устанавливаем Content-Type - axios сделает это автоматически для FormData
        },
      });

      setImportResult(response.data);
      setImportFile(null);

      // Перезагружаем данные
      if (user && user.role === 'admin') {
        const [fridgeStatusRes] = await Promise.all([
          api.get('/api/admin/fridge-status?all=true'),
        ]);
        setAllFridges(fridgeStatusRes.data);
        loadFridges(0, true);
      }

      alert(`Импорт завершен!\nИмпортировано: ${response.data.imported}\nДубликаты: ${response.data.duplicates}\nОшибки: ${response.data.errors}`);
    } catch (e: any) {
      console.error('Ошибка импорта:', e);
      const errorMessage = e?.response?.data?.error || e?.response?.data?.details || e?.message || 'Неизвестная ошибка';
      alert('Ошибка при импорте файла: ' + errorMessage);
      
      // Если это CORS ошибка, показываем более понятное сообщение
      if (e?.message?.includes('CORS') || e?.code === 'ERR_NETWORK') {
        console.error('CORS или сетевая ошибка. Проверьте настройки CORS на сервере.');
      }
    } finally {
      setImporting(false);
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
  const filteredAllFridges = filterQuery
    ? allFridges.filter((f) => {
        const text = `${f.name ?? ''} ${f.code ?? ''} ${f.address ?? ''}`.toLowerCase();
        return text.includes(filterQuery);
      })
    : allFridges;

  // Фильтрация загруженных холодильников для списка
  const filteredFridges = filterQuery
    ? fridges.filter((f) => {
        const text = `${f.name ?? ''} ${f.code ?? ''} ${f.address ?? ''}`.toLowerCase();
        return text.includes(filterQuery);
      })
    : fridges;

  const todayFridges = filteredAllFridges.filter((f) => f.status === 'today').length;
  const weekFridges = filteredAllFridges.filter((f) => f.status === 'week').length;
  const oldFridges = filteredAllFridges.filter((f) => f.status === 'old').length;
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
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 max-w-[150px] truncate">{importFile.name}</span>
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
                  onClick={() => setImportFile(null)}
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
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-sm text-slate-500">Всего холодильников</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{allFridges.length}</p>
          <p className="text-xs text-slate-500 mt-2 space-x-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> Сегодня: {todayFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" /> Неделя: {weekFridges}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Давно: {oldFridges}
            </span>
          </p>
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
            <Badge variant="info">{recentCheckins.length}</Badge>
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
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1 bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">
                        #{c.id} — {dt.date}
                      </span>
                      <span className="text-xs text-slate-500">{dt.time}</span>
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
                if (f.status === 'today') {
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
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex flex-col gap-1 bg-white"
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
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => setSelectedQRFridge(f)}
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Карта холодильников (Тараз)</h2>
        </div>
        <AdminFridgeMap fridges={filteredAllFridges} />
      </Card>

      {/* Модальное окно для QR-кода */}
      {selectedQRFridge && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedQRFridge(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}


