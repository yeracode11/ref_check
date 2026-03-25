import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';
import { FridgeDetailModal } from '../components/FridgeDetailModal';
import { GeocodedAddress } from '../components/ui/GeocodedAddress';
import { getDisplayIdentifier } from '../utils/fridgeUtils';

type City = {
  _id: string;
  name: string;
  code: string;
  active: boolean;
};

type Fridge = {
  _id: string;
  code: string;
  number?: string; // Длинный номер из Excel
  name: string;
  address?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  active: boolean;
  description?: string;
  cityId?: City | string;
  warehouseStatus?: 'warehouse' | 'installed' | 'returned' | 'moved';
  clientInfo?: {
    inn?: string;
    name?: string;
  } | null;
};

const ITEMS_PER_PAGE = 30; // Количество элементов на странице
const SEARCH_DEBOUNCE_MS = 500; // Задержка перед поиском (мс)

function getStatusBadge(status?: string) {
  if (!status) return <Badge className="bg-slate-100 text-slate-700">Неизвестно</Badge>;
  switch (status) {
    case 'warehouse':
      return <Badge className="bg-blue-100 text-blue-700">На складе</Badge>;
    case 'installed':
      return <Badge className="bg-green-100 text-green-700">Установлен</Badge>;
    case 'returned':
      return <Badge className="bg-yellow-100 text-yellow-700">Возврат</Badge>;
    case 'moved':
      return <Badge className="bg-gray-900 text-white">Перемещен</Badge>;
    default:
      return <Badge className="bg-slate-100 text-slate-700">{status}</Badge>;
  }
}

export default function FridgesList() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAccountant = user?.role === 'accountant';
  const isManager = user?.role === 'manager';
  
  const [items, setItems] = useState<Fridge[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  // Получаем выбранный город из URL параметров при инициализации
  const cityIdFromUrl = searchParams.get('city') || '';
  const [selectedCityId, setSelectedCityId] = useState<string>(cityIdFromUrl);
  const [accountantCityName, setAccountantCityName] = useState<string>('');
  const [searchInput, setSearchInput] = useState(''); // Ввод пользователя
  const [searchQuery, setSearchQuery] = useState(''); // Фактический запрос для поиска
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedFridgeId, setSelectedFridgeId] = useState<string | null>(null);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseStatusFilter, setWarehouseStatusFilter] = useState<string>('all');
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const observerTarget = useRef<HTMLDivElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Загрузка городов
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/api/cities?active=true');
        if (!alive) return;
        setCities(res.data);
        
        // Для бухгалтера и менеджера - выбираем их город
        if ((isAccountant || isManager) && user?.cityId) {
          const city = res.data.find((c: City) => c._id === user.cityId);
          if (city) {
            setAccountantCityName(city.name);
            setSelectedCityId(city._id);
          }
        } else if (!isAccountant && !isManager) {
          // Для админов - проверяем URL параметр, если есть валидный город, используем его
          const urlCityId = searchParams.get('city') || '';
          if (urlCityId) {
            const city = res.data.find((c: City) => c._id === urlCityId);
            if (city) {
              setSelectedCityId(urlCityId);
            } else {
              // Если город из URL не найден, очищаем параметр
              setSearchParams((prev) => {
                const newParams = new URLSearchParams(prev);
                newParams.delete('city');
                return newParams;
              });
              setSelectedCityId(''); // Сбрасываем на "Все города"
            }
          } else if (!urlCityId && !selectedCityId) {
            // Если в URL нет параметра и selectedCityId пустой, оставляем "Все города"
            setSelectedCityId('');
          }
        }
      } catch (e: any) {
        console.error('Failed to load cities', e);
      } finally {
        if (alive) setCitiesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isAccountant, isManager, user?.cityId, searchParams, setSearchParams]);

  // Загрузка холодильников (с пагинацией)
  const loadFridges = useCallback(async (skip = 0, reset = false) => {
    // Для бухгалтера и менеджера город фильтруется на бэкенде
    // Для остальных (админов) - если selectedCityId пустой, загружаем все холодильники из всех городов

    let alive = true;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      if (warehouseStatusFilter !== 'all') {
        params.append('warehouseStatus', warehouseStatusFilter);
      }
      // Для бухгалтера/менеджера город добавляется на бэкенде автоматически
      // Для админов - если выбран город, фильтруем по нему, иначе (пустая строка = "Все города") показываем все
      if (!isAccountant && !isManager && selectedCityId && selectedCityId.trim() !== '') {
        params.append('cityId', selectedCityId);
      }
      // Если selectedCityId пустой - не добавляем параметр cityId, backend вернет все холодильники
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
  }, [selectedCityId, warehouseStatusFilter, searchQuery, isAccountant, isManager]);

  // Debounce для поиска - обновляем searchQuery после задержки
  useEffect(() => {
    // Очищаем предыдущий таймер
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Устанавливаем новый таймер
    searchTimeoutRef.current = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    // Очистка при размонтировании
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput]);

  // Загрузка при изменении фильтров
  useEffect(() => {
    // Для бухгалтера/менеджера загружаем сразу, для админов - всегда (даже если город не выбран - показываем все)
    if (isAccountant || isManager || !citiesLoading) {
      loadFridges(0, true);
    }
  }, [selectedCityId, warehouseStatusFilter, searchQuery, isAccountant, isManager, citiesLoading]);

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
            ) : selectedCityId ? (
              <>В городе "{selectedCity?.name || ''}": <span className="font-medium">{items.length}</span> из {total}</>
            ) : (
              <>Всего холодильников: <span className="font-medium">{items.length}</span> из {total}</>
            )}
          </p>
        )}
      </div>

      {/* Фильтры: Город, Поиск и Чекбокс в одной строке */}
      {!citiesLoading && (
        <Card className="bg-slate-50">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {/* Выбор города (или отображение для бухгалтера) */}
            <div className="flex-1 w-full sm:w-auto min-w-[180px]">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Город
              </label>
              {isAccountant || isManager ? (
                <div className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 font-medium">
                  📍 {accountantCityName || 'Город не назначен'}
                </div>
              ) : (
                <select
                  value={selectedCityId}
                  onChange={(e) => {
                    const newCityId = e.target.value;
                    setSelectedCityId(newCityId);
                    // Обновляем URL параметр
                    setSearchParams((prev) => {
                      const newParams = new URLSearchParams(prev);
                      if (newCityId) {
                        newParams.set('city', newCityId);
                      } else {
                        newParams.delete('city');
                      }
                      return newParams;
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                >
                  <option value="">Все города</option>
                  {cities.map((city) => (
                    <option key={city._id} value={city._id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              )}
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
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Поиск при нажатии Enter (без задержки)
                    if (e.key === 'Enter') {
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                      setSearchQuery(searchInput.trim());
                    }
                  }}
                  placeholder="По названию, коду, адресу... (Enter для поиска)"
                  className="w-full rounded-lg border border-slate-300 pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      setSearchInput('');
                      setSearchQuery('');
                      if (searchTimeoutRef.current) {
                        clearTimeout(searchTimeoutRef.current);
                      }
                    }}
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

            {/* Статус на складе */}
            <div className="w-full sm:w-auto sm:min-w-[200px]">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Статус на складе
              </label>
              <select
                value={warehouseStatusFilter}
                onChange={(e) => setWarehouseStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
              >
                <option value="all">Все статусы</option>
                <option value="warehouse">На складе</option>
                <option value="installed">Установлен</option>
                <option value="returned">Возврат на склад</option>
                <option value="moved">Перемещён</option>
              </select>
            </div>
          </div>
        </Card>
      )}

      {items.length === 0 && !loading ? (
        <EmptyState
          icon="🧊"
          title={searchQuery ? "Ничего не найдено" : "Нет холодильников"}
          description={
            searchQuery
              ? 'Попробуйте изменить поисковый запрос'
              : warehouseStatusFilter !== 'all'
                ? 'Нет холодильников с выбранным статусом на складе.'
                : selectedCityId
                  ? `В городе "${selectedCity?.name || ''}" пока нет холодильников.`
                  : 'Холодильники не найдены.'
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((f) => (
              <Card 
                key={f._id} 
                className="hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
                onClick={() => setSelectedFridgeId(f._id)}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 text-lg mb-1 truncate">{f.name}</h3>
                      {(() => {
                        const cityName = typeof f.cityId === 'object' ? f.cityId?.name : (cities.find(c => c._id === f.cityId)?.name || '');
                        const displayId = getDisplayIdentifier(
                          { clientInfo: f.clientInfo, number: f.number, code: f.code, name: f.name },
                          cityName
                        );
                        if (!displayId) return null;
                        const isNumberCity = cityName === 'Кызылорда' || cityName === 'Шымкент' || cityName === 'Талдыкорган';
                        return <div className="text-sm text-slate-500 font-mono truncate">{isNumberCity ? displayId : `#${displayId}`}</div>;
                      })()}
                    </div>
                    <div className="flex-shrink-0">
                      {getStatusBadge(f.warehouseStatus)}
                    </div>
                  </div>
                  
                  {f.address && (
                    <div className="text-sm text-slate-600">
                      <span className="text-slate-400">📍</span> {f.address}
                    </div>
                  )}
                  
                  {f.location && f.location.coordinates[0] !== 0 && (
                    <div className="text-xs bg-slate-50 p-2 rounded">
                      <GeocodedAddress
                        lat={f.location.coordinates[1]}
                        lng={f.location.coordinates[0]}
                        fallback={`${f.location.coordinates[1].toFixed(6)}, ${f.location.coordinates[0].toFixed(6)}`}
                      />
                    </div>
                  )}
                  
                  {f.description && (
                    <div className="text-sm text-slate-600 border-t pt-2">
                      {f.description}
                    </div>
                  )}
                  
                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedFridgeId(f._id); }}
                      className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded transition-colors font-medium"
                    >
                      Подробнее
                    </button>
                  </div>
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

      {/* Модальное окно детального просмотра */}
      {selectedFridgeId && (
        <FridgeDetailModal
          fridgeId={selectedFridgeId}
          onClose={() => setSelectedFridgeId(null)}
        />
      )}
    </div>
  );
}
