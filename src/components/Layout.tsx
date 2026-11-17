import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  ReceiptIndianRupee,
  Factory,
  Boxes,
  FileSpreadsheet,
  SlidersHorizontal,
  Menu,
  X,
  LogOut,
  RotateCcw,
} from 'lucide-react';
import { useAuth, UserRole } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { apiRequest } from '../api/client.ts';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, roles: ['owner', 'admin', 'production', 'accountant', 'salesman'] },
  { to: '/orders', label: 'Field Orders', icon: ClipboardList, roles: ['owner', 'admin', 'salesman'] },
  { to: '/billing', label: 'Billing & GST', icon: ReceiptIndianRupee, roles: ['owner', 'admin', 'accountant'] },
  { to: '/production', label: 'Production', icon: Factory, roles: ['owner', 'admin', 'production', 'accountant'] },
  { to: '/inventory', label: 'Inventory & Purchases', icon: Boxes, roles: ['owner', 'admin', 'production', 'accountant'] },
  { to: '/masters', label: 'Masters & BOM', icon: SlidersHorizontal, roles: ['owner', 'admin', 'production'] },
  { to: '/reports', label: 'Audit Reports', icon: FileSpreadsheet, roles: ['owner', 'admin', 'accountant'] },
];

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Operations Overview',
  '/orders': 'Field Orders & Stock Allocation',
  '/billing': 'GST Invoicing, Dispatch & Collections',
  '/production': 'Production Runs, BOM & FIFO Costing',
  '/inventory': 'Stock Ledger, FIFO Batches & Purchasing',
  '/masters': 'Master Data, BOM Recipes & Price Lists',
  '/reports': 'Auditor Registers, GSTR-1 & Tally Export',
};

export function Layout({
  children,
  onResetBenchmark,
}: {
  children: React.ReactNode;
  onResetBenchmark?: () => void;
}) {
  const { dbUser, logout, switchRole } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [resetting, setResetting] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) =>
    dbUser ? item.roles.includes(dbUser.role) : false
  );

  const pageTitle = ROUTE_TITLES[location.pathname] || 'Order-to-Audit ERP';

  const handleRoleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as UserRole;
    setSwitchingRole(true);
    try {
      await switchRole(newRole);
      showToast(`Active role switched to ${newRole}`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Unable to switch role', 'error');
    } finally {
      setSwitchingRole(false);
    }
  };

  const handleBenchmarkReset = async () => {
    setResetting(true);
    try {
      await apiRequest('/api/seed/benchmark-reset', { method: 'POST' });
      showToast('Database reset to Section 5 Benchmark Opening State', 'success');
      if (onResetBenchmark) onResetBenchmark();
    } catch (err: any) {
      showToast(err.message || 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-5 border-b border-slate-200">
        <div className="font-display font-bold text-base tracking-tight text-slate-900 whitespace-nowrap">
          Kaveri Crunch
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          Trichy Snacks · Order-to-Audit
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[42px] whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        {(dbUser?.id === 1 || dbUser?.role === 'owner') && (
          <div>
            <label htmlFor="role-switcher" className="block text-xs font-medium text-slate-500 mb-1">
              Active Role View
            </label>
            <select
              id="role-switcher"
              value={dbUser?.role || 'owner'}
              onChange={handleRoleChange}
              disabled={switchingRole}
              className="w-full px-2.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
            >
              <option value="owner">Owner (Full Access)</option>
              <option value="admin">Admin (Orders & Dispatch)</option>
              <option value="production">Production (BOM & Runs)</option>
              <option value="accountant">Accountant (GST & Audit)</option>
              <option value="salesman">Salesman (Field Orders)</option>
            </select>
          </div>
        )}

        {(dbUser?.role === 'owner' || dbUser?.role === 'admin') && (
          <button
            onClick={handleBenchmarkReset}
            disabled={resetting}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-[40px]"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>{resetting ? 'Resetting...' : 'Reset Opening Stock'}</span>
          </button>
        )}

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">{dbUser?.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{dbUser?.email}</div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="p-2 text-slate-500 hover:text-red-600 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[252px] shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">Workspace</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {pageTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
            <span className="hidden sm:inline whitespace-nowrap">
              State Code: <span className="font-mono font-medium text-slate-800">33 (TN)</span>
            </span>
            <span className="hidden sm:inline text-slate-300">·</span>
            <span className="capitalize font-medium text-slate-700 whitespace-nowrap">
              Role: {dbUser?.role}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
