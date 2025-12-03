import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from './ui/Loading';

export default function ProtectedRoute() {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="flex flex-col items-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-slate-500 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // Сохраняем, откуда пришел пользователь (для возврата после логина)
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

