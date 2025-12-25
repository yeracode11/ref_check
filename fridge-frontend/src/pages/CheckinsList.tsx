import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge } from '../components/ui/Card';
import { LoadingSpinner, LoadingCard, EmptyState } from '../components/ui/Loading';
import { GeocodedAddress } from '../components/ui/GeocodedAddress';

type Checkin = {
  id: number;
  managerId: string;
  fridgeId: string;
  visitedAt: string;
  address?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  notes?: string;
  photos?: string[];
};

export default function CheckinsList() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const [items, setItems] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFridgeId, setSearchFridgeId] = useState('');

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Almaty' }),
      time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }),
      full: date.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }),
    };
  }

  useEffect(() => {
    let alive = true;
    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (searchFridgeId.trim()) {
          params.append('fridgeId', searchFridgeId.trim());
        }
        // Для менеджера не передаем managerId - бэкенд сам фильтрует по роли
        // Для админа можно передать managerId в query, если нужно отфильтровать

        const res = await api.get(`/api/checkins?${params.toString()}`);
        if (!alive) return;
        setItems(res.data);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    }, searchFridgeId ? 500 : 0); // Debounce search

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [searchFridgeId, isManager, user?._id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 bg-slate-200 rounded w-48 mb-2 animate-pulse"></div>
            <div className="h-4 bg-slate-200 rounded w-32 animate-pulse"></div>
          </div>
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <LoadingCard key={`loading-${i}`} />
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {user?.role === 'manager' ? 'Мои отметки' : 'Отметки посещений'}
          </h1>
          <p className="text-slate-500 mt-1">
            {searchFridgeId ? (
              <>Найдено: <span className="font-medium">{items.length}</span></>
            ) : (
              <>
                {user?.role === 'manager' ? 'Мои отметки' : 'Все отметки'}: <span className="font-medium">{items.length}</span>
              </>
            )}
          </p>
        </div>
        <Link to="/new">
          <button className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium">
            + Новая отметка
          </button>
        </Link>
      </div>

      {/* Search */}
      <Card className="bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
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
              value={searchFridgeId}
              onChange={(e) => setSearchFridgeId(e.target.value)}
              placeholder="Поиск по холодильнику (ID или код)..."
              className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
          {searchFridgeId && (
            <button
              onClick={() => setSearchFridgeId('')}
              className="px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors font-medium"
            >
              Очистить
            </button>
          )}
        </div>
      </Card>

      {/* List */}
      {!loading && items.length === 0 ? (
        <EmptyState
          icon="📋"
          title={searchFridgeId ? "Ничего не найдено" : "Нет отметок"}
          description={searchFridgeId ? "Попробуйте изменить поисковый запрос" : "Пока нет данных для отображения. Создайте первую отметку посещения."}
        />
      ) : !loading ? (
        <div className="grid gap-4">
          {items.map((c, index) => {
            const dateInfo = formatDate(c.visitedAt);
            const uniqueKey = c.id ? `checkin-${c.id}` : `checkin-temp-${index}-${c.visitedAt}`;
            return (
              <Card key={uniqueKey} className="hover:shadow-md transition-shadow">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-semibold text-slate-900">Отметка #{c.id}</h3>
                      <Badge variant="info">{dateInfo.date}</Badge>
                      <span className="text-slate-400 text-sm">{dateInfo.time}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-slate-500">Менеджер:</span>{' '}
                        <span className="font-medium text-slate-700">{c.managerId}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Холодильник:</span>{' '}
                        <span className="font-medium text-slate-700">{c.fridgeId}</span>
                      </div>
                    </div>
                    {c.address && (
                      <div className="text-sm">
                        <span className="text-slate-500">📍</span>{' '}
                        <span className="text-slate-600">{c.address}</span>
                      </div>
                    )}
                    {c.location && c.location.coordinates && (
                      <div className="text-xs">
                        <GeocodedAddress
                          lat={c.location.coordinates[1]}
                          lng={c.location.coordinates[0]}
                          fallback={`Координаты: ${c.location.coordinates[1].toFixed(6)}, ${c.location.coordinates[0].toFixed(6)}`}
                        />
                      </div>
                    )}
                    {c.notes && (
                      <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded border-l-2 border-slate-300">
                        {c.notes}
                      </div>
                    )}
                    {c.photos && c.photos.length > 0 && (
                      <div className="text-sm text-slate-500">
                        📷 Фото: {c.photos.length}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}


