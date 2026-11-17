import React, { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ToastProvider } from './contexts/ToastContext.tsx';
import { Layout } from './components/Layout.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { BillingPage } from './pages/BillingPage.tsx';
import { ProductionPage } from './pages/ProductionPage.tsx';
import { InventoryPage } from './pages/InventoryPage.tsx';
import { MastersPage } from './pages/MastersPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';

function AppRoutes() {
  const { firebaseUser, dbUser, loading } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Loading workspace...
      </div>
    );
  }

  if (!firebaseUser || !dbUser) {
    return <LoginPage />;
  }

  const defaultRoute = dbUser.role === 'salesman' ? '/orders' : '/';

  return (
    <Layout onResetBenchmark={() => setRefreshKey((k) => k + 1)}>
      <Routes>
        <Route path="/" element={<DashboardPage refreshKey={refreshKey} />} />
        <Route path="/orders" element={<OrdersPage refreshKey={refreshKey} />} />
        <Route path="/billing" element={<BillingPage refreshKey={refreshKey} />} />
        <Route path="/production" element={<ProductionPage refreshKey={refreshKey} />} />
        <Route path="/inventory" element={<InventoryPage refreshKey={refreshKey} />} />
        <Route path="/masters" element={<MastersPage refreshKey={refreshKey} />} />
        <Route path="/reports" element={<ReportsPage refreshKey={refreshKey} />} />
        <Route path="*" element={<Navigate to={defaultRoute} replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
