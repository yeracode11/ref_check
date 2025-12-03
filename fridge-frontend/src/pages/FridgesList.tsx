import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../shared/apiClient';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';

type City = {
  _id: string;
  name: string;
  code: string;
  active: boolean;
};

type Fridge = {
  _id: string;
  code: string;
  name: string;
  address?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  active: boolean;
  description?: string;
  cityId?: City | string;
};

const ITEMS_PER_PAGE = 30; // Количество элементов на странице

export default function FridgesList() {
  const [items, setItems] = useState<Fridge[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const observerTarget = useRef<HTMLDivElement | null>(null);

  // Загрузка городов
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/api/cities?active=true');
        if (!alive) return;
        setCities(res.data);
        // Автоматически выбираем первый город, если есть
        if (res.data.length > 0 && !selectedCityId) {
          setSelectedCityId(res.data[0]._id);
        }
      } catch (e: any) {
        console.error('Failed to load cities', e);
      } finally {
        if (alive) setCitiesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Загрузка холодильников (с пагинацией)
  const loadFridges = useCallback(async (skip = 0, reset = false) => {
    if (!selectedCityId) {
      setItems([]);
      setLoading(false);
      return;
    }

    let alive = true;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      if (showOnlyActive) params.append('active', 'true');
      params.append('cityId', selectedCityId);
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      params.append('limit', String(ITEMS_PER_PAGE));
      params.append('skip', String(skip));
      
      const res = await api.get(`/api/fridges?${params.toString()}`);
      if (!alive) return;

      const { data, pagination } = res.data;
      
      if (reset) {
        setItems(data);
      } else {
        setItems((prev) => [...prev, ...data]);
      }
      
      setHasMore(pagination.hasMore);
      setTotal(pagination.total);
      setError(null);
    } catch (e: any) {
      if (!alive) return;
      setError(e?.message || 'Failed to load');
    } finally {
      if (alive) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [selectedCityId, showOnlyActive, searchQuery]);

  // Загрузка при изменении фильтров
  useEffect(() => {
    loadFridges(0, true);
  }, [selectedCityId, showOnlyActive, searchQuery]);

  // Бесконечный скролл
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadFridges(items.length, false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, loading, items.length]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 bg-slate-200 rounded w-48 mb-2 animate-pulse"></div>
            <div className="h-4 bg-slate-200 rounded w-64 animate-pulse"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <LoadingCard key={i} />
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

  const activeCount = items.filter(f => f.active).length;
  const inactiveCount = items.filter(f => !f.active).length;

  const selectedCity = cities.find(c => c._id === selectedCityId);

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Холодильники</h1>
        {!loading && (
          <p className="text-slate-500 mt-1">
            {searchQuery ? (
              <>Найдено: <span className="font-medium">{items.length}</span> из {total}</>
            ) : (
              <>Показано: <span className="font-medium">{items.length}</span> из {total} • Активных: {activeCount} • Неактивных: {inactiveCount}</>
            )}
          </p>
        )}
      </div>

      {/* Фильтры: Город, Поиск и Чекбокс в одной строке */}
      {!citiesLoading && (
        <Card className="bg-slate-50">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {/* Выбор города */}
            <div className="flex-1 w-full sm:w-auto min-w-[180px]">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Город
              </label>
              <select
                value={selectedCityId}
                onChange={(e) => setSelectedCityId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
              >
                <option value="">Все города</option>
                {cities.map((city) => (
                  <option key={city._id} value={city._id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Поиск */}
            <div className="flex-1 w-full sm:flex-[2]">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Поиск
              </label>
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="По названию, коду, адресу..."
                  className="w-full rounded-lg border border-slate-300 pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label="Очистить поиск"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Чекбокс "Только активные" */}
            <div className="w-full sm:w-auto">
              <label className="flex items-center gap-2 cursor-pointer h-[42px] px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showOnlyActive}
                  onChange={(e) => setShowOnlyActive(e.target.checked)}
                  className="w-4 h-4 text-slate-600 rounded focus:ring-slate-500"
                />
                <span className="text-sm text-slate-700 whitespace-nowrap">Только активные</span>
              </label>
            </div>
          </div>
        </Card>
      )}

      {!selectedCityId && !citiesLoading ? (
        <EmptyState
          icon="🏙️"
          title="Выберите город"
          description="Выберите город из списка выше, чтобы увидеть холодильники."
        />
      ) : items.length === 0 && !loading ? (
        <EmptyState
          icon="🧊"
          title={searchQuery ? "Ничего не найдено" : "Нет холодильников"}
          description={searchQuery ? "Попробуйте изменить поисковый запрос" : `В городе "${selectedCity?.name || ''}" пока нет холодильников.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((f) => (
              <Card key={f._id} className="hover:shadow-md transition-shadow">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900 text-lg mb-1">{f.name}</h3>
                      <div className="text-sm text-slate-500 font-mono">#{f.code}</div>
                    </div>
                    <Badge variant={f.active ? 'success' : 'error'}>
                      {f.active ? 'Активен' : 'Неактивен'}
                    </Badge>
                  </div>
                  
                  {f.address && (
                    <div className="text-sm text-slate-600">
                      <span className="text-slate-400">📍</span> {f.address}
                    </div>
                  )}
                  
                  {f.location && (
                    <div className="text-xs text-slate-400 bg-slate-50 p-2 rounded font-mono">
                      {f.location.coordinates[1].toFixed(6)}, {f.location.coordinates[0].toFixed(6)}
                    </div>
                  )}
                  
                  {f.description && (
                    <div className="text-sm text-slate-600 border-t pt-2">
                      {f.description}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
          
          {/* Индикатор загрузки и триггер для бесконечного скролла */}
          {hasMore && (
            <div ref={observerTarget} className="flex justify-center py-8">
              {loadingMore && (
                <div className="flex flex-col items-center gap-3">
                  <LoadingSpinner size="md" />
                  <p className="text-slate-500 text-sm">Загрузка...</p>
                </div>
              )}
            </div>
          )}
          
          {!hasMore && items.length > 0 && (
            <div className="text-center py-6 text-slate-500 text-sm">
              Все холодильники загружены
            </div>
          )}
        </>
      )}
    </div>
  );
}
