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

  // Страницы ТП доступны только менеджерам
  if (
    user?.role === 'admin'
    || user?.role === 'accountant'
    || user?.role === 'service_manager'
    || user?.role === 'sales_head'
  ) {
    return <Navigate to="/fridges" replace />;
  }

  return <>{children}</>;
}

