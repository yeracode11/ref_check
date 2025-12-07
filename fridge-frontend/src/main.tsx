import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRouteGuard from './components/AdminRouteGuard';
import App from './App';
import CheckinsList from './pages/CheckinsList';
import NewCheckin from './pages/NewCheckin';
import FridgesList from './pages/FridgesList';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import CheckinPage from './pages/CheckinPage';
import AccountantDashboard from './pages/AccountantDashboard';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <App />,
        children: [
          { 
            index: true, 
            element: (
              <AdminRouteGuard>
                <CheckinsList />
              </AdminRouteGuard>
            ),
          },
          { 
            path: 'new', 
            element: (
              <AdminRouteGuard>
                <NewCheckin />
              </AdminRouteGuard>
            ),
          },
          { path: 'fridges', element: <FridgesList /> },
          { path: 'admin', element: <AdminDashboard /> },
          { path: 'accountant', element: <AccountantDashboard /> },
          { path: 'checkin/:code', element: <CheckinPage /> },
        ],
      },
    ],
  },
]);

function Root() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);


