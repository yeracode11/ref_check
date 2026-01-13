import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Button, Badge } from '../components/ui/Card';

type Fridge = {
  _id: string;
  code: string;
  name: string;
  address?: string;
  description?: string;
};

type RouteParams = {
  code?: string;
};

export default function CheckinPage() {
  const { code: rawCode } = useParams<RouteParams>();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Декодируем код из URL (на случай неправильной кодировки)
  const code = rawCode ? decodeURIComponent(rawCode) : null;

  const [fridge, setFridge] = useState<Fridge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'getting' | 'success' | 'error'>('idle');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState('');

  useEffect(() => {
    if (!code) {
      setError('Не указан код холодильника в ссылке');
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      try {
        // Пробуем найти холодильник по коду
        // Backend теперь ищет и по code, и по number автоматически
        let res = await api.get(`/api/fridges?code=${encodeURIComponent(code)}`);
        if (!alive) return;
        // API возвращает объект с полем data, которое содержит массив холодильников
        let data: Fridge[] = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        
        // Если не нашли, пробуем декодировать код ещё раз (на случай двойного кодирования)
        if ((!data || data.length === 0) && code.includes('%')) {
          try {
            const decodedCode = decodeURIComponent(code);
            res = await api.get(`/api/fridges?code=${encodeURIComponent(decodedCode)}`);
            if (!alive) return;
            data = Array.isArray(res.data) ? res.data : (res.data?.data || []);
          } catch {
            // Игнорируем ошибку декодирования
          }
        }
        
        if (!data || data.length === 0 || !data[0]) {
          setError(`Холодильник с кодом "${code}" не найден. Проверьте правильность кода в QR-коде.`);
          setLoading(false);
          return;
        }
        
        const fridgeData = data[0];
        setFridge(fridgeData);
        if (fridgeData.address) {
          setAddress(fridgeData.address);
        }
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        const errorMsg = e?.response?.data?.error || e?.message || 'Не удалось загрузить данные холодильника';
        setError(errorMsg);
        console.error('Ошибка загрузки холодильника:', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [code]);

  async function getGeolocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      setLocationStatus('getting');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(loc);
          setLocationStatus('success');
          resolve(loc);
        },
        () => {
          setLocationStatus('error');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  }

  async function handleCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!code) {
      setError('Не указан код холодильника');
      return;
    }
    if (!user) {
      setError('Необходимо войти в систему');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      let geo = currentLocation;
      if (!geo) {
        geo = await getGeolocation();
        if (!geo) {
          throw new Error('Не удалось получить геолокацию. Разрешите доступ к геолокации в настройках устройства.');
        }
      }

      await api.post('/api/checkins', {
        // Важно: сохраняем managerId = _id пользователя, чтобы фильтр по пользователю работал корректно
        managerId: user._id,
        fridgeId: code,
        address: address || undefined,
        location: geo,
      });

      setSuccess('Отметка успешно сохранена!');
      setTimeout(() => {
        navigate('/'); // после отметки возвращаем на список
      }, 1500);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Ошибка при создании отметки');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="text-slate-500">Загрузка данных холодильника...</div>
          {code && (
            <div className="text-xs text-slate-400 font-mono">Код: {code}</div>
          )}
        </div>
      </div>
    );
  }

  if (error && !fridge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
        <Card className="max-w-xl w-full bg-red-50 border-red-200">
          <h1 className="text-xl font-semibold mb-2 text-red-900">Ошибка</h1>
          <p className="text-red-700 text-sm mb-4">{error}</p>
          {code && (
            <div className="text-xs text-red-600 font-mono bg-red-100 p-2 rounded mb-4">
              Код из URL: {code}
            </div>
          )}
          <Button onClick={() => navigate('/')} variant="secondary">
            Вернуться на главную
          </Button>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Card className="max-w-md w-full">
          <h1 className="text-xl font-semibold mb-2">Требуется авторизация</h1>
          <p className="text-slate-600 text-sm mb-4">
            Для отметки по холодильнику необходимо войти в систему.
          </p>
          <Button onClick={() => navigate('/login')} className="w-full">
            Войти
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Отметка по холодильнику</h1>
        {fridge && (
          <p className="text-slate-500 mt-1">
            Холодильник: <span className="font-medium">{fridge.name}</span>{' '}
            <Badge variant="info">#{fridge.code}</Badge>
          </p>
        )}
        {!fridge && code && (
          <p className="text-slate-400 text-sm mt-1">Код: {code}</p>
        )}
      </div>

      <Card>
        <form onSubmit={handleCheckin} className="space-y-5">
          {/* Информация о менеджере */}
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-sm text-slate-500">Менеджер</div>
            <div className="font-medium text-slate-900">{user?.username || user?.fullName || user?.email}</div>
          </div>

          {/* Инфо о холодильнике */}
          {fridge && (
            <div className="space-y-2">
              <div className="text-sm text-slate-600">
                <span className="font-semibold">Холодильник:</span> {fridge.name}
              </div>
              <div className="text-xs text-slate-500">
                Код: <span className="font-mono">{fridge.code}</span>
              </div>
              {fridge.description && (
                <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                  {fridge.description}
                </div>
              )}
            </div>
          )}

          {/* Адрес точки (опционально) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Адрес точки (опционально)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Улица, дом, ориентир..."
              className="w/full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Этот адрес будет сохранён как текущее местоположение холодильника.
            </p>
          </div>

          {/* Статус геолокации */}
          <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Геолокация</span>
              <span className="text-xs text-slate-500">
                {locationStatus === 'getting' && 'Определяем местоположение...'}
                {locationStatus === 'success' && 'Готово ✅'}
                {locationStatus === 'error' && 'Не удалось определить местоположение'}
                {locationStatus === 'idle' && 'Ещё не определена'}
              </span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
              {success}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Сохраняем...' : 'Отметиться'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Назад
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

