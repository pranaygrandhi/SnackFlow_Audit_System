import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
} from 'lucide-react';
import { formatINR, formatQty } from '../api/client.ts';

export interface LowStockAlertItem {
  id: number;
  name: string;
  unit: string;
  balance: number;
  reorderLevel: number;
}

interface DashboardSummaryCardProps {
  asOfDate?: string;
  dailySalesPaise: number;
  todaysInvoiceCount: number;
  totalSalesPaise: number;
  pendingOrdersCount: number;
  submittedOrdersCount: number;
  approvedOrdersCount: number;
  todaysOrderCount: number;
  lowStockAlerts: LowStockAlertItem[];
  userRole?: string;
}

export function DashboardSummaryCard({
  asOfDate,
  dailySalesPaise,
  todaysInvoiceCount,
  totalSalesPaise,
  pendingOrdersCount,
  submittedOrdersCount,
  approvedOrdersCount,
  todaysOrderCount,
  lowStockAlerts,
  userRole,
}: DashboardSummaryCardProps) {
  const canViewBilling = userRole === 'owner' || userRole === 'admin' || userRole === 'accountant';
  const canViewInventory = userRole !== 'salesman';

  return (
    <section
      aria-label="Daily Operations Summary"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-900">
            Daily Operations Summary
          </h2>
          <p className="text-xs text-slate-500">
            Live commercial intake, fulfillment queue, and raw material reorder watch
          </p>
        </div>
        {asOfDate && (
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            As of {asOfDate}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* 1. Daily Total Sales Value */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Daily Total Sales Value</span>
              <IndianRupee className="w-4 h-4 text-slate-400" />
            </div>
            <div className="mt-2.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatINR(dailySalesPaise)}
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              <span className="font-mono tabular-nums font-medium text-slate-700">
                {todaysInvoiceCount}
              </span>{' '}
              tax {todaysInvoiceCount === 1 ? 'invoice' : 'invoices'} raised today ·{' '}
              <span className="font-mono tabular-nums">{formatINR(totalSalesPaise)}</span> billed
              overall
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Active GST tax invoices</span>
            {canViewBilling ? (
              <Link
                to="/billing"
                className="font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
              >
                <span>Open Billing</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <Link
                to="/orders"
                className="font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
              >
                <span>View Orders</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* 2. Pending Orders Count */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Pending Orders</span>
              <ClipboardList className="w-4 h-4 text-slate-400" />
            </div>
            <div
              className={`mt-2.5 font-mono text-2xl font-semibold tabular-nums ${
                pendingOrdersCount > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {pendingOrdersCount}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>
                <span className="font-mono tabular-nums font-medium text-slate-700">
                  {submittedOrdersCount}
                </span>{' '}
                awaiting approval
              </span>
              <span>·</span>
              <span>
                <span className="font-mono tabular-nums font-medium text-slate-700">
                  {approvedOrdersCount}
                </span>{' '}
                ready to invoice
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              <span className="font-mono tabular-nums font-medium text-slate-700">
                {todaysOrderCount}
              </span>{' '}
              field {todaysOrderCount === 1 ? 'order' : 'orders'} placed today
            </span>
            <Link
              to="/orders"
              className="font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
            >
              <span>Review Queue</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* 3. Recent Low-Stock Alerts */}
        <div className="p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Recent Low-Stock Alerts</span>
              {lowStockAlerts.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
            </div>

            {lowStockAlerts.length === 0 ? (
              <div className="mt-2.5">
                <div className="font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                  0
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  All raw materials are currently above reorder threshold.
                </p>
              </div>
            ) : (
              <div className="mt-2.5 space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold text-red-600 tabular-nums">
                    {lowStockAlerts.length}
                  </span>
                  <span className="text-xs text-slate-500">
                    {lowStockAlerts.length === 1 ? 'material' : 'materials'} at or below reorder
                    level
                  </span>
                </div>
                <ul className="space-y-1.5 pt-1">
                  {lowStockAlerts.slice(0, 3).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 text-xs py-1 px-2.5 rounded-md bg-red-50/70 border border-red-200/80 text-red-950"
                    >
                      <span className="font-medium truncate">{item.name}</span>
                      <span className="font-mono tabular-nums text-red-800 shrink-0">
                        {formatQty(item.balance)} / {formatQty(item.reorderLevel)} {item.unit}
                      </span>
                    </li>
                  ))}
                  {lowStockAlerts.length > 3 && (
                    <li className="text-xs text-slate-500 font-medium">
                      +{lowStockAlerts.length - 3} more low-stock item(s)
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Ledger-verified balances</span>
            {canViewInventory ? (
              <Link
                to="/inventory"
                className="font-medium text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
              >
                <span>Open Inventory</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <span className="text-slate-400">Stock watch</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
