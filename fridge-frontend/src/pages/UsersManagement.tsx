import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../shared/apiClient';
import { Card, Badge } from '../components/ui/Card';
import { LoadingCard, EmptyState, LoadingSpinner } from '../components/ui/Loading';

type City = {
  _id: string;
  name: string;
  code: string;
};

type User = {
  _id: string;
  username: string;
  role: 'manager' | 'admin' | 'accountant' | 'service_manager' | 'sales_head';
  fullName?: string;
  phone?: string;
  cityId?: City | null;
  active: boolean;
  createdAt: string;
};

type UserForm = {
  username: string;
  password: string;
  role: 'manager' | 'admin' | 'accountant' | 'service_manager' | 'sales_head';
  fullName: string;
  phone: string;
  cityId: string;
  active: boolean;
};

const emptyForm: UserForm = {
  username: '',
  password: '',
  role: 'manager',
  fullName: '',
  phone: '',
  cityId: '',
  active: true,
};

function getRoleBadge(role: string) {
  switch (role) {
    case 'admin':
      return <Badge className="bg-purple-100 text-purple-700">Админ</Badge>;
    case 'accountant':
      return <Badge className="bg-blue-100 text-blue-700">Бухгалтер</Badge>;
    case 'manager':
      return <Badge className="bg-green-100 text-green-700">Менеджер</Badge>;
    case 'service_manager':
      return <Badge className="bg-orange-100 text-orange-700">МХО</Badge>;
    case 'sales_head':
      return <Badge className="bg-indigo-100 text-indigo-700">НОП</Badge>;
    default:
      return <Badge>{role}</Badge>;
  }
}

export default function UsersManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Фильтры
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Модальные окна
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null);

  // Загрузка данных
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') return;

    Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/cities?active=true'),
    ])
      .then(([usersRes, citiesRes]) => {
        setUsers(usersRes.data);
        setCities(citiesRes.data);
        setError(null);
      })
      .catch((e) => setError(e?.message || 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, [currentUser]);

  const loadUsers = async () => {
    try {
      const res = await api.get('/api/admin/users');
      setUsers(res.data);
    } catch (e) {
      console.error('Ошибка загрузки пользователей:', e);
    }
  };

  // Открыть модалку для создания
  const openCreateModal = () => {
    setEditingUser(null);
    setForm({ ...emptyForm, cityId: cities[0]?._id || '' });
    setShowModal(true);
  };

  // Открыть модалку для редактирования
  const openEditModal = (user: User) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      password: '', // Пустой - не меняем если не заполнено
      role: user.role,
      fullName: user.fullName || '',
      phone: user.phone || '',
      cityId: user.cityId?._id || '',
      active: user.active,
    });
    setShowModal(true);
  };

  // Сохранить пользователя
  const handleSave = async () => {
    if (!form.username.trim()) {
      alert('Заполните обязательное поле: username');
      return;
    }

    if (!editingUser && (!form.password || form.password.length < 6)) {
      alert('Для нового пользователя укажите пароль (минимум 6 символов)');
      return;
    }

    if (
      ['accountant', 'service_manager', 'sales_head', 'manager'].includes(form.role)
      && !form.cityId
    ) {
      alert('Для ролей МХО, НОП, менеджера и бухгалтера необходимо выбрать город');
      return;
    }

    try {
      setSaving(true);

      const payload: any = {
        username: form.username.trim(),
        role: form.role,
        fullName: form.fullName.trim() || form.username.trim(),
        phone: form.phone.trim() || null,
        cityId: form.cityId || null,
        active: form.active,
      };

      if (form.password && form.password.length >= 6) {
        payload.password = form.password;
      }

      if (editingUser) {
        await api.patch(`/api/admin/users/${editingUser._id}`, payload);
        alert('Пользователь обновлён');
      } else {
        payload.password = form.password;
        await api.post('/api/admin/users', payload);
        alert('Пользователь создан');
      }

      setShowModal(false);
      loadUsers();
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // Удалить пользователя
  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      await api.delete(`/api/admin/users/${deleteConfirm._id}`);
      setDeleteConfirm(null);
      loadUsers();
      alert('Пользователь удалён');
    } catch (e: any) {
      alert('Ошибка: ' + (e?.response?.data?.error || e.message));
    }
  };

  // Фильтрация
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const searchStr = `${u.username} ${u.fullName || ''}`.toLowerCase();
      if (!searchStr.includes(q)) return false;
    }
    return true;
  });

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
          <h1 className="text-2xl font-bold text-slate-900">👥 Управление пользователями</h1>
          <p className="text-slate-500 mt-1">Создание и редактирование бухгалтеров, менеджеров</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Добавить пользователя
        </button>
      </div>

      {/* Фильтры */}
      <Card>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Поиск по имени, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Все роли</option>
            <option value="manager">Менеджеры</option>
            <option value="service_manager">МХО</option>
            <option value="sales_head">НОП</option>
            <option value="accountant">Бухгалтеры</option>
            <option value="admin">Админы</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Найдено: {filteredUsers.length} пользователей
        </p>
      </Card>

      {/* Список пользователей */}
      {loading ? (
        <LoadingCard />
      ) : error ? (
        <Card><p className="text-red-600">{error}</p></Card>
      ) : filteredUsers.length === 0 ? (
        <EmptyState message="Пользователи не найдены" />
      ) : (
        <div className="grid gap-4">
          {filteredUsers.map((u) => (
            <Card key={u._id}>
              <div className="flex flex-wrap gap-4 justify-between items-start">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-semibold text-slate-900">{u.fullName || u.username}</span>
                    {getRoleBadge(u.role)}
                    {!u.active && <Badge className="bg-red-100 text-red-700">Неактивен</Badge>}
                  </div>
                  <div className="text-sm text-slate-600 space-y-1">
                    <p><span className="text-slate-500">Username:</span> {u.username}</p>
                    {u.phone && <p><span className="text-slate-500">Телефон:</span> {u.phone}</p>}
                    {u.cityId && <p><span className="text-slate-500">Город:</span> {u.cityId.name}</p>}
                    <p className="text-xs text-slate-400">
                      Создан: {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => openEditModal(u)}
                    className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                  >
                    ✏️ Редактировать
                  </button>
                  {u._id !== currentUser._id && (
                    <button
                      onClick={() => setDeleteConfirm(u)}
                      className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    >
                      🗑️ Удалить
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Модальное окно создания/редактирования */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingUser ? `Редактировать: ${editingUser.username}` : 'Новый пользователь'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Username <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Пароль {!editingUser && <span className="text-red-500">*</span>}
                  {editingUser && <span className="text-slate-400 text-xs">(оставьте пустым, чтобы не менять)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingUser ? '••••••' : 'Минимум 6 символов'}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Роль</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as any })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="manager">Менеджер (ТП)</option>
                  <option value="service_manager">МХО</option>
                  <option value="sales_head">НОП</option>
                  <option value="accountant">Бухгалтер</option>
                  <option value="admin">Админ</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Полное имя</label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Телефон</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Город
                  {['accountant', 'service_manager', 'sales_head', 'manager'].includes(form.role) && (
                    <span className="text-red-500"> *</span>
                  )}
                </label>
                <select
                  value={form.cityId}
                  onChange={(e) => setForm({ ...form, cityId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Не выбран —</option>
                  {cities.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <label htmlFor="active" className="text-sm text-slate-700">Активен</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {saving ? 'Сохранение...' : editingUser ? 'Сохранить' : 'Создать'}
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Удалить пользователя?</h3>
            <p className="text-slate-600 mb-4">
              Вы уверены, что хотите удалить пользователя <strong>{deleteConfirm.username}</strong>?
              Это действие нельзя отменить.
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
    </div>
  );
}

