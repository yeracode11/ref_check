import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  children: React.ReactNode;
};

/**
 * Компонент для редиректа админа/бухгалтера на доступные страницы
 * Админ может видеть только /fridges и /admin
 * Бухгалтер может видеть только /fridges и /accountant
 */
export default function AdminRouteGuard({ children }: Props) {
  const { user } = useAuth();

  // Если пользователь - админ или бухгалтер, редиректим на /fridges
  if (user?.role === 'admin' || user?.role === 'accountant') {
    return <Navigate to="/fridges" replace />;
  }

  return <>{children}</>;
}

