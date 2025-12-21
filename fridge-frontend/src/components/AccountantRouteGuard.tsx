import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  children: React.ReactNode;
};

/**
 * Компонент для защиты маршрута /accountant
 * Доступен только для бухгалтеров и администраторов
 * Если пользователь не бухгалтер и не админ, редиректим на доступную страницу
 */
export default function AccountantRouteGuard({ children }: Props) {
  const { user, loading } = useAuth();

  // Пока загружается, не редиректим
  if (loading) {
    return null; // или можно показать загрузку
  }

  // Если пользователь не авторизован, редиректим на логин
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Если пользователь не бухгалтер и не админ, редиректим на доступную страницу
  if (user.role !== 'accountant' && user.role !== 'admin') {
    // Менеджер редиректится на главную
    if (user.role === 'manager') {
      return <Navigate to="/" replace />;
    }
    // Для других ролей - на /fridges
    return <Navigate to="/fridges" replace />;
  }

  return <>{children}</>;
}

