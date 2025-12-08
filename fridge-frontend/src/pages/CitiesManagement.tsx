import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';

type City = {
  _id: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
};

type CityForm = {
  name: string;
  code: string;
  active: boolean;
};

type Fridge = {
  _id: string;
  code: string;
  name: string;
  address?: string;
  warehouseStatus?: 'warehouse' | 'installed' | 'returned';
  active: boolean;
};

const emptyForm: CityForm = {
  name: '',
  code: '',
  active: true,
};

export default function CitiesManagement() {
  const { user: currentUser } = useAuth();
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Модальные окна
  const [showModal, setShowModal] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [form, setForm] = useState<CityForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<City | null>(null);
  
  // Модальное окно со списком холодильников
  const [showFridgesModal, setShowFridgesModal] = useState(false);
  const [selectedCityForFridges, setSelectedCityForFridges] = useState<City | null>(null);
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [fridgesLoading, setFridgesLoading] = useState(false);
  const [fridgesError, setFridgesError] = useState<string | null>(null);

  // Загрузка данных
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') return;
    loadCities();
  }, [currentUser]);

  const loadCities = async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/cities');
      setCities(res.data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  // Открыть модалку для создания
  const openCreateModal = () => {
    setEditingCity(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  // Открыть модалку для редактирования
  const openEditModal = (city: City) => {
    setEditingCity(city);
    setForm({
      name: city.name,
      code: city.code,
      active: city.active,
    });
    setShowModal(true);
  };

  // Сохранить город
  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      alert('Заполните название и код города');
      return;
    }

    try {
      setSaving(true);

      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        active: form.active,
      };

      if (editingCity) {
        await api.patch(`/api/cities/${editingCity._id}`, payload);
        alert('Город обновлён');
      } else {
        await api.post('/api/cities', payload);
        alert('Город создан');
      }

      setShowModal(false);
      loadCities();
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // Удалить город
  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await api.delete(`/api/cities/${deleteConfirm._id}`);
      setDeleteConfirm(null);
      loadCities();
      alert('Город удалён');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    }
  };

  // Быстрое переключение активности
  const toggleActive = async (city: City) => {
    try {
      await api.patch(`/api/cities/${city._id}`, { active: !city.active });
      loadCities();
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    }
  };

  // Открыть модальное окно со списком холодильников города
  const openFridgesModal = async (city: City) => {
    setSelectedCityForFridges(city);
    setShowFridgesModal(true);
    setFridgesLoading(true);
    setFridgesError(null);
    
    try {
      // Загружаем все холодильники города (до 10000 для админа)
      const res = await api.get(`/api/fridges?cityId=${city._id}&limit=10000`);
      const fridgesData = res.data.data || res.data;
      setFridges(Array.isArray(fridgesData) ? fridgesData : []);
      setFridgesError(null);
    } catch (e: any) {
      setFridgesError(e?.response?.data?.error || e.message || 'Ошибка загрузки');
      setFridges([]);
    } finally {
      setFridgesLoading(false);
    }
  };

  function getStatusBadge(status?: string) {
    switch (status) {
      case 'warehouse':
        return <Badge className="bg-blue-100 text-blue-700">На складе</Badge>;
      case 'installed':
        return <Badge className="bg-green-100 text-green-700">Установлен</Badge>;
      case 'returned':
        return <Badge className="bg-yellow-100 text-yellow-700">Возврат</Badge>;
      default:
        return null;
    }
  }

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <Card>
        <p className="text-red-600">Доступ запрещён. Только для администраторов.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🏙️ Управление городами</h1>
          <p className="text-slate-500 mt-1">Добавление и редактирование городов</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить город
        </button>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">{cities.length}</p>
            <p className="text-sm text-slate-500">Всего городов</p>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{cities.filter(c => c.active).length}</p>
            <p className="text-sm text-slate-500">Активных</p>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <p className="text-3xl font-bold text-slate-400">{cities.filter(c => !c.active).length}</p>
            <p className="text-sm text-slate-500">Неактивных</p>
          </div>
        </Card>
      </div>

      {/* Список городов */}
      {loading ? (
        <LoadingCard />
      ) : error ? (
        <Card><p className="text-red-600">{error}</p></Card>
      ) : cities.length === 0 ? (
        <EmptyState message="Города не найдены" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => (
            <Card 
              key={city._id} 
              className={`${!city.active ? 'opacity-60' : ''} cursor-pointer hover:shadow-md hover:border-blue-300 transition-all`}
              onClick={() => openFridgesModal(city)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900 truncate">{city.name}</span>
                    {city.active ? (
                      <Badge className="bg-green-100 text-green-700 text-xs">Активен</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 text-xs">Неактивен</Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    Код: <span className="font-mono font-medium text-slate-700">{city.code}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Создан: {new Date(city.createdAt).toLocaleDateString('ru-RU')}
                  </p>
                  <p className="text-xs text-blue-600 mt-2 font-medium">
                    👆 Кликните, чтобы увидеть холодильники
                  </p>
                </div>
                <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => openEditModal(city)}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    title="Редактировать"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => toggleActive(city)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      city.active 
                        ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                    title={city.active ? 'Деактивировать' : 'Активировать'}
                  >
                    {city.active ? '⏸️' : '▶️'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(city)}
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Модальное окно создания/редактирования */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingCity ? `Редактировать: ${editingCity.name}` : 'Новый город'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Название города <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Например: Тараз"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Код города <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="Например: 08"
                  maxLength={10}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">По коду авто</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cityActive"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <label htmlFor="cityActive" className="text-sm text-slate-700">Активен</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? 'Сохранение...' : editingCity ? 'Сохранить' : 'Создать'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение удаления */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Удалить город?</h3>
            <p className="text-slate-600 mb-4">
              Вы уверены, что хотите удалить город <strong>{deleteConfirm.name}</strong> ({deleteConfirm.code})?
              <br /><br />
              <span className="text-amber-600 text-sm">⚠️ Если к городу привязаны холодильники или пользователи, это может вызвать проблемы.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                🗑️ Удалить
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно со списком холодильников города */}
      {showFridgesModal && selectedCityForFridges && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowFridgesModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Заголовок */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">
                  Холодильники города: {selectedCityForFridges.name}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Код города: <span className="font-mono">{selectedCityForFridges.code}</span>
                </p>
              </div>
              <button
                onClick={() => setShowFridgesModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Содержимое */}
            <div className="flex-1 overflow-y-auto p-6">
              {fridgesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : fridgesError ? (
                <div className="text-center py-12">
                  <p className="text-red-600">{fridgesError}</p>
                </div>
              ) : fridges.length === 0 ? (
                <EmptyState 
                  icon="🧊"
                  title="Нет холодильников"
                  description={`В городе "${selectedCityForFridges.name}" пока нет холодильников.`}
                />
              ) : (
                <div className="space-y-3">
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                      Всего холодильников: <span className="font-semibold">{fridges.length}</span>
                    </p>
                    {fridges.length > 100 && (
                      <p className="text-xs text-blue-600 mt-1">
                        💡 Прокрутите список для просмотра всех холодильников
                      </p>
                    )}
                  </div>
                  <div className="grid gap-3 max-h-[60vh] overflow-y-auto pr-2">
                    {fridges.map((fridge) => (
                      <Card key={fridge._id} className="hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-semibold text-slate-900">{fridge.name}</span>
                              {getStatusBadge(fridge.warehouseStatus)}
                              {!fridge.active && (
                                <Badge className="bg-red-100 text-red-700 text-xs">Неактивен</Badge>
                              )}
                            </div>
                            <div className="text-sm text-slate-600 space-y-1">
                              <p><span className="text-slate-500">Код:</span> <span className="font-mono">{fridge.code}</span></p>
                              {fridge.address && (
                                <p><span className="text-slate-500">Адрес:</span> {fridge.address}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Футер */}
            <div className="p-6 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => setShowFridgesModal(false)}
                className="w-full px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

