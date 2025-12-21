import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRouteGuard from './components/AdminRouteGuard';
import AccountantRouteGuard from './components/AccountantRouteGuard';
import App from './App';
import { LoadingSpinner } from './components/ui/Loading';

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'));
const CheckinsList = lazy(() => import('./pages/CheckinsList'));
const NewCheckin = lazy(() => import('./pages/NewCheckin'));
const FridgesList = lazy(() => import('./pages/FridgesList'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const CheckinPage = lazy(() => import('./pages/CheckinPage'));
const AccountantDashboard = lazy(() => import('./pages/AccountantDashboard'));
const UsersManagement = lazy(() => import('./pages/UsersManagement'));
const CitiesManagement = lazy(() => import('./pages/CitiesManagement'));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <LoadingSpinner />
  </div>
);

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={<PageLoader />}>
        <LoginPage />
      </Suspense>
    ),
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
              <Suspense fallback={<PageLoader />}>
                <AdminRouteGuard>
                  <CheckinsList />
                </AdminRouteGuard>
              </Suspense>
            ),
          },
          { 
            path: 'new', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <AdminRouteGuard>
                  <NewCheckin />
                </AdminRouteGuard>
              </Suspense>
            ),
          },
          { 
            path: 'fridges', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <FridgesList />
              </Suspense>
            ),
          },
          { 
            path: 'admin', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <AdminDashboard />
              </Suspense>
            ),
          },
          { 
            path: 'users', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <UsersManagement />
              </Suspense>
            ),
          },
          { 
            path: 'cities', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <CitiesManagement />
              </Suspense>
            ),
          },
          { 
            path: 'accountant', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <AccountantRouteGuard>
                  <AccountantDashboard />
                </AccountantRouteGuard>
              </Suspense>
            )
          },
          { 
            path: 'checkin/:code', 
            element: (
              <Suspense fallback={<PageLoader />}>
                <CheckinPage />
              </Suspense>
            ),
          },
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


