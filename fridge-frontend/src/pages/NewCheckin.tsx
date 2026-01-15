import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../shared/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { Card, Button } from '../components/ui/Card';

type Fridge = {
  _id: string;
  code: string;
  number?: string;
  name: string;
  cityId?: { name: string };
};

export default function NewCheckin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fridgeId, setFridgeId] = useState('');
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'getting' | 'success' | 'error'>('idle');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/fridges?active=true');
        setFridges(res.data);
      } catch (e: any) {
        console.error('Failed to load fridges', e);
      }
    })();
  }, []);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    
    try {
      let geo = currentLocation;
      if (!geo) {
        geo = await getGeolocation();
        if (!geo) throw new Error('Не удалось получить геолокацию. Разрешите доступ к геолокации в настройках браузера.');
      }

      const res = await api.post('/api/checkins', {
        managerId: user?.username || user?._id || '',
        fridgeId,
        notes: notes || undefined,
        address: address || undefined,
        location: geo,
      });
      
      setSuccess('Отметка успешно создана!');
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Ошибка при создании отметки');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Новая отметка посещения</h1>
        <p className="text-slate-500 mt-1">Создайте новую отметку с геолокацией</p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          {/* Manager Info */}
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-sm text-slate-500">Менеджер</div>
            <div className="font-medium text-slate-900">{user?.username || user?.fullName || user?.email}</div>
          </div>

          {/* Fridge Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Холодильник <span className="text-red-500">*</span>
            </label>
            {fridges.length > 0 ? (
              <select
                value={fridgeId}
                onChange={(e) => setFridgeId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
                required
              >
                <option value="">Выберите холодильник</option>
                {fridges.map((f) => (
                  <option key={f._id} value={f.code}>
                    {f.name} {(f.cityId?.name === 'Шымкент' || f.cityId?.name === 'Кызылорда') && f.number ? `(${f.number})` : `(#${f.code})`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={fridgeId}
                onChange={(e) => setFridgeId(e.target.value)}
                placeholder="Введите код холодильника"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
                required
              />
            )}
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Адрес
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Улица, дом, город"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Заметки
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Дополнительная информация о посещении..."
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
            />
          </div>

          {/* Location Status */}
          <div className="bg-slate-50 p-4 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Геолокация</span>
              {locationStatus === 'success' && currentLocation && (
                <span className="text-xs text-green-600">✓ Получена</span>
              )}
              {locationStatus === 'error' && (
                <span className="text-xs text-red-600">✗ Ошибка</span>
              )}
            </div>
            {currentLocation ? (
              <div className="text-xs text-slate-600 font-mono">
                {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                {locationStatus === 'getting' ? 'Получение геолокации...' : 'Геолокация будет получена при отправке формы'}
              </div>
            )}
            {locationStatus !== 'getting' && (
              <button
                type="button"
                onClick={getGeolocation}
                className="mt-2 text-sm text-slate-600 hover:text-slate-900 underline"
              >
                Обновить геолокацию
              </button>
            )}
          </div>

          {/* Error/Success Messages */}
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

          {/* Submit Button */}
          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={submitting || locationStatus === 'getting'}
              className="flex-1"
            >
              {submitting ? 'Сохраняю...' : 'Создать отметку'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/')}
            >
              Отмена
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
