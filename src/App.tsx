import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { permissionsFor } from './auth/permissions';
import { PageBoundary } from './components/PageBoundary';
import { ToastProvider } from './components/Toasts';
import { Loading } from './components/ui';
import {
  BillsPage,
  DashboardPage,
  ExplosivesPage,
  FinancePage,
  HistoryPage,
  LoginPage,
  SalesPage,
  Shell,
  StorePage,
  UsersPage,
  VerifyPage,
} from './pages/lazy';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          {/* The login screen and the signed-in shell are downloads of their
              own; one that fails gets a retry rather than a blank page. */}
          <PageBoundary fullScreen>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<RequireSession />}>
                <Route index element={<DashboardPage />} />
                <Route path="store" element={<StorePage />} />
                <Route path="bills" element={<BillsPage />} />
                <Route path="explosives" element={<ExplosivesPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="sales" element={<SalesPage />} />
                <Route path="verify" element={<VerifyPage />} />
                <Route
                  path="finance"
                  element={
                    <AdminOnly>
                      <FinancePage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="users"
                  element={
                    <AdminOnly>
                      <UsersPage />
                    </AdminOnly>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageBoundary>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loading />
    </div>
  );
}

/** Every page but the login sits behind a staff sign-in. */
function RequireSession() {
  const { status, profile } = useAuth();
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'loading' || !profile) return <FullScreenLoading />;
  return (
    <Suspense fallback={<FullScreenLoading />}>
      <Shell />
    </Suspense>
  );
}

function LoginRoute() {
  const { status, profile } = useAuth();
  if (status === 'signedIn' && profile) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<FullScreenLoading />}>
      <LoginPage />
    </Suspense>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  return profile && permissionsFor(profile).manageUsers ? children : <Navigate to="/" replace />;
}
