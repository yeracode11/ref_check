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
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Админ-панель</h1>
        <p className="text-slate-500 mt-1">Мониторинг холодильников и посещений</p>
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


