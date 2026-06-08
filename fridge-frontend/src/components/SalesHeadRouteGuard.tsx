import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  children: React.ReactNode;
};

export default function SalesHeadRouteGuard({ children }: Props) {
  const { user } = useAuth();

  if (user?.role !== 'sales_head' && user?.role !== 'admin') {
    return <Navigate to="/fridges" replace />;
  }

  return <>{children}</>;
}
