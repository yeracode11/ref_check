import { useState, useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { MobileMenu, BurgerButton } from './components/MobileMenu';
import { ToastContainer } from './components/ui/Toast';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Проверка доступа к текущей странице при смене пользователя
  useEffect(() => {
    if (!user) return;
    
    const currentPath = location.pathname;
    
    // Страницы только для менеджеров
    const managerOnlyPaths = ['/', '/new'];
    // Страницы только для админов
    const adminOnlyPaths = ['/admin', '/users', '/cities'];
    const accountantOnlyPaths = ['/accountant'];
    const salesOnlyPaths = ['/sales'];
    
    // Если менеджер пытается зайти на админские или бухгалтерские страницы
    if (user.role === 'manager' && (adminOnlyPaths.includes(currentPath) || accountantOnlyPaths.includes(currentPath) || salesOnlyPaths.includes(currentPath))) {
      navigate('/', { replace: true });
      return;
    }

    if (user.role === 'service_manager' && (managerOnlyPaths.includes(currentPath) || adminOnlyPaths.includes(currentPath) || accountantOnlyPaths.includes(currentPath) || salesOnlyPaths.includes(currentPath))) {
      navigate('/fridges', { replace: true });
      return;
    }

    if (user.role === 'sales_head' && (managerOnlyPaths.includes(currentPath) || adminOnlyPaths.includes(currentPath) || accountantOnlyPaths.includes(currentPath))) {
      navigate('/sales', { replace: true });
      return;
    }
    
    // Если админ пытается зайти на страницу бухгалтера
    if (user.role === 'admin' && accountantOnlyPaths.includes(currentPath)) {
      navigate('/fridges', { replace: true });
      return;
    }
    
    // Если бухгалтер пытается зайти на страницы менеджера или админа
    if (user.role === 'accountant' && (managerOnlyPaths.includes(currentPath) || adminOnlyPaths.includes(currentPath))) {
      navigate('/fridges', { replace: true });
      return;
    }
  }, [user, location.pathname, navigate]);

  // Мемоизируем navItems для оптимизации
  const navItems = useMemo(() => {
    const baseNavItems = [
      { path: '/', label: 'Отметки', icon: '📋' },
      { path: '/fridges', label: 'Холодильники', icon: '🧊' },
      { path: '/new', label: 'Новая отметка', icon: '➕' },
    ];

    const adminNavItems = [
      { path: '/fridges', label: 'Холодильники', icon: '🧊' },
      { path: '/sales', label: 'Сервис НОП', icon: '📈' },
      { path: '/admin', label: 'Админ', icon: '🛠️' },
      { path: '/users', label: 'Пользователи', icon: '👥' },
      { path: '/cities', label: 'Города', icon: '🏙️' },
    ];

    const accountantNavItems = [
      { path: '/fridges', label: 'Холодильники', icon: '🧊' },
      { path: '/accountant', label: 'Управление', icon: '📊' },
    ];

    const serviceManagerNavItems = [
      { path: '/fridges', label: 'Холодильники', icon: '🧊' },
    ];

    const salesHeadNavItems = [
      { path: '/sales', label: 'Аналитика НОП', icon: '📈' },
      { path: '/fridges', label: 'Холодильники', icon: '🧊' },
    ];
    
    if (user?.role === 'admin') return adminNavItems;
    if (user?.role === 'accountant') return accountantNavItems;
    if (user?.role === 'service_manager') return serviceManagerNavItems;
    if (user?.role === 'sales_head') return salesHeadNavItems;
    return baseNavItems;
  }, [user?.role]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-[800]" style={{ zIndex: 800 }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link 
              to={
                user?.role === 'admin' || user?.role === 'accountant' || user?.role === 'service_manager'
                  ? '/fridges'
                  : user?.role === 'sales_head'
                    ? '/sales'
                    : '/'
              } 
              className="flex items-center gap-2" 
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="text-2xl">🧊</span>
              <span className="font-bold text-xl text-slate-900 hidden sm:inline">Fridge Manager</span>
              <span className="font-bold text-lg text-slate-900 sm:hidden">FM</span>
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                    location.pathname === item.path
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            {/* User Menu */}
            {user && (
              <div className="flex items-center gap-3 md:gap-4">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-sm font-medium text-slate-900">{user.username}</span>
                  <span className="text-xs text-slate-500 capitalize">{user.role}</span>
                </div>
                <div className="hidden md:block w-px h-6 bg-slate-200"></div>
                <button
                  onClick={logout}
                  className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors font-medium"
                >
                  <span className="hidden sm:inline">Выйти</span>
                  <span className="sm:hidden">Выйти</span>
                </button>
                
                {/* Mobile Menu Button */}
                <BurgerButton
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  isOpen={mobileMenuOpen}
                />
              </div>
            )}
          </div>
        </div>
      </header>
      
      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        navItems={navItems}
      />
      
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}


