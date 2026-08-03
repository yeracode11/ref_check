import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname || '/';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    // Validate input
    if (!username.trim()) {
      setError('Введите имя пользователя');
      setLoading(false);
      return;
    }
    if (!password.trim()) {
      setError('Введите пароль');
      setLoading(false);
      return;
    }
    
    try {
      console.log('[Login] Attempting login for:', username);
      const userData = await login(username.trim(), password);
      // После успешного логина определяем, куда редиректить
      let redirectTo = from;
      
      // Админские страницы
      const adminOnlyPaths = ['/users', '/cities', '/admin'];
      // Страницы бухгалтера
      const accountantOnlyPaths = ['/accountant'];
      
      const salesOnlyPaths = ['/sales'];

      if (userData?.role === 'admin') {
        if (from === '/' || from === '/new') {
          redirectTo = '/fridges';
        }
      } else if (userData?.role === 'accountant') {
        if (from === '/' || from === '/new' || adminOnlyPaths.includes(from) || salesOnlyPaths.includes(from)) {
          redirectTo = '/fridges';
        }
      } else if (userData?.role === 'service_manager') {
        if (from.startsWith('/checkin/')) {
          redirectTo = from;
        } else if (from === '/' || from === '/new' || adminOnlyPaths.includes(from) || accountantOnlyPaths.includes(from) || salesOnlyPaths.includes(from)) {
          redirectTo = '/fridges';
        }
      } else if (userData?.role === 'sales_head') {
        if (from === '/' || from === '/new' || adminOnlyPaths.includes(from) || accountantOnlyPaths.includes(from)) {
          redirectTo = '/sales';
        } else if (!salesOnlyPaths.includes(from) && from !== '/fridges') {
          redirectTo = '/sales';
        }
      } else {
        if (adminOnlyPaths.includes(from) || accountantOnlyPaths.includes(from) || salesOnlyPaths.includes(from)) {
          redirectTo = '/';
        }
      }
      
      navigate(redirectTo, { replace: true });
    } catch (e: any) {
      console.error('Login error:', e);
      // Более детальная обработка ошибок
      let errorMessage = 'Ошибка входа';
      
      if (e?.response) {
        // Сервер вернул ответ с ошибкой
        const serverError = e.response.data?.error || e.response.data?.message;
        console.error('[Login] Server error response:', e.response.data);
        
        if (e.response.status === 401) {
          errorMessage = serverError || 'Неверное имя пользователя или пароль';
        } else if (e.response.status === 403) {
          errorMessage = serverError || 'Доступ запрещен. Аккаунт может быть отключен.';
        } else {
          errorMessage = serverError || `Ошибка ${e.response.status}: ${e.response.statusText}`;
        }
      } else if (e?.request) {
        // Запрос был отправлен, но ответа не получено
        console.error('[Login] No response received:', e.request);
        errorMessage = 'Не удалось подключиться к серверу. Проверьте подключение к интернету.';
      } else {
        // Ошибка при настройке запроса
        console.error('[Login] Request setup error:', e.message);
        errorMessage = e?.message || 'Ошибка входа. Попробуйте еще раз.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Вход</h1>
          <p className="text-slate-500">Войдите в систему для продолжения</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Имя пользователя
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent transition-all"
                placeholder="Введите имя пользователя"
                required
                autoComplete="username"
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent transition-all"
                placeholder="Введите пароль"
                required
                autoComplete="current-password"
              />
            </div>
            
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 text-white px-4 py-3 font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
        
        <div className="mt-6 text-center text-sm text-slate-500">
          Система управления холодильниками
        </div>
      </div>
    </div>
  );
}

