import React, { Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRouteGuard from './components/AdminRouteGuard';
import AccountantRouteGuard from './components/AccountantRouteGuard';
import SalesHeadRouteGuard from './components/SalesHeadRouteGuard';
import RouteErrorFallback from './components/RouteErrorFallback';
import App from './App';
import { LoadingSpinner } from './components/ui/Loading';
import { clearChunkReloadFlag, lazyWithRetry } from './utils/lazyWithRetry';

const LoginPage = lazyWithRetry(() => import('./pages/LoginPage'));
const CheckinsList = lazyWithRetry(() => import('./pages/CheckinsList'));
const NewCheckin = lazyWithRetry(() => import('./pages/NewCheckin'));
const FridgesList = lazyWithRetry(() => import('./pages/FridgesList'));
const AdminDashboard = lazyWithRetry(() => import('./pages/AdminDashboard'));
const CheckinPage = lazyWithRetry(() => import('./pages/CheckinPage'));
const AccountantDashboard = lazyWithRetry(() => import('./pages/AccountantDashboard'));
const UsersManagement = lazyWithRetry(() => import('./pages/UsersManagement'));
const CitiesManagement = lazyWithRetry(() => import('./pages/CitiesManagement'));
const SalesHeadDashboard = lazyWithRetry(() => import('./pages/SalesHeadDashboard'));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <LoadingSpinner />
  </div>
);

const router = createBrowserRouter([
  {
    path: '/login',
    errorElement: <RouteErrorFallback />,
    element: (
      <Suspense fallback={<PageLoader />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorFallback />,
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
            path: 'sales',
            element: (
              <Suspense fallback={<PageLoader />}>
                <SalesHeadRouteGuard>
                  <SalesHeadDashboard />
                </SalesHeadRouteGuard>
              </Suspense>
            ),
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
  useEffect(() => {
    clearChunkReloadFlag();
  }, []);

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


