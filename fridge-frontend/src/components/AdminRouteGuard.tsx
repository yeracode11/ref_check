import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  children: React.ReactNode;
};

/**
 * Компонент для редиректа админа на доступные страницы
 * Админ может видеть только /fridges и /admin
 */
export default function AdminRouteGuard({ children }: Props) {
  const { user } = useAuth();

  // Если пользователь - админ, редиректим на /fridges
  if (user?.role === 'admin') {
    return <Navigate to="/fridges" replace />;
  }

  return <>{children}</>;
}

