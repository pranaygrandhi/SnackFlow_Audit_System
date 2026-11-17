import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { apiRequest, formatINR, formatQty } from '../api/client.ts';
import {
  DashboardSummaryCard,
  LowStockAlertItem,
} from '../components/DashboardSummaryCard.tsx';
import { useToast } from '../contexts/ToastContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

interface DashboardData {
  asOfDate?: string;
  todaysOrderCount: number;
  totalOrdersCount: number;
  pendingOrdersCount: number;
  submittedOrdersCount?: number;
  approvedOrdersCount?: number;
  lowStockAlerts: LowStockAlertItem[];
  finishedSummary: Array<{
    id: number;
    name: string;
    sku: string;
    balance: number;
    sellingPricePaise: number;
  }>;
  latestPostedRun: {
    id: number;
    runNo: string;
    productName: string;
    runDate: string;
    actualOutput: string;
    expectedOutput: string;
    costPerPacketPaise: number;
    yieldVariancePct: string;
    yieldFlagged: boolean;
  } | null;
  varianceAlerts: {
    yieldAlerts: Array<{
      id: number;
      runNo: string;
      productName: string;
      yieldVariancePct: string;
    }>;
    materialAlerts: Array<{
      id: number;
      productionRunId: number;
      materialName: string;
      variancePct: string;
    }>;
  };
  expiringBatches?: Array<{
    id: number;
    materialName: string;
    batchNo: string;
    qtyRemaining: string;
    unit: string;
    expiryDate: string;
    daysLeft: number;
  }>;
  totalRawValuePaise?: number;
  financials: {
    dailySalesPaise?: number;
    todaysInvoiceCount?: number;
    totalSalesPaise: number;
    totalCollectedPaise: number;
    totalOutstandingPaise: number;
  };
}

export function DashboardPage({ refreshKey }: { refreshKey: number }) {
  const { dbUser } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [dash, inv] = await Promise.all([
          apiRequest<DashboardData>('/api/reports/dashboard'),
          apiRequest<{ rawMaterials: any[] }>('/api/inventory/balances'),
        ]);
        if (active) {
          setData(dash);
          setRawMaterials(inv.rawMaterials || []);
        }
      } catch (err: any) {
        if (active) showToast(err.message || 'Failed to load dashboard', 'error');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [refreshKey, showToast]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  const totalAlerts =
    data.lowStockAlerts.length +
    data.varianceAlerts.yieldAlerts.length +
    data.varianceAlerts.materialAlerts.length +
    (data.expiringBatches?.length || 0);

  return (
    <div className="space-y-6">
      {/* Daily KPI Summary Card */}
      <DashboardSummaryCard
        asOfDate={data.asOfDate}
        dailySalesPaise={data.financials.dailySalesPaise ?? 0}
        todaysInvoiceCount={data.financials.todaysInvoiceCount ?? 0}
        totalSalesPaise={data.financials.totalSalesPaise}
        pendingOrdersCount={data.pendingOrdersCount}
        submittedOrdersCount={data.submittedOrdersCount ?? 0}
        approvedOrdersCount={data.approvedOrdersCount ?? 0}
        todaysOrderCount={data.todaysOrderCount}
        lowStockAlerts={data.lowStockAlerts}
        userRole={dbUser?.role}
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Orders Today / Open Queue</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.todaysOrderCount}
            </span>
            <span className="text-xs text-slate-500">
              today · {data.pendingOrdersCount} pending fulfillment
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Latest Cost per Packet</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.latestPostedRun
                ? formatINR(data.latestPostedRun.costPerPacketPaise)
                : '—'}
            </span>
            <span className="text-xs text-slate-500 truncate">
              {data.latestPostedRun
                ? `${data.latestPostedRun.productName} (${data.latestPostedRun.runNo})`
                : 'No posted runs yet'}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Receivables Outstanding</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {formatINR(data.financials.totalOutstandingPaise)}
            </span>
            <span className="text-xs text-slate-500">
              of {formatINR(data.financials.totalSalesPaise)} billed
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Alerts &amp; FIFO Inventory</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`font-mono text-2xl font-semibold tabular-nums ${
                totalAlerts > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {totalAlerts}
            </span>
            <span className="text-xs text-slate-500">
              {data.lowStockAlerts.length} low ·{' '}
              {data.varianceAlerts.yieldAlerts.length + data.varianceAlerts.materialAlerts.length}{' '}
              var · Raw FIFO {formatINR(data.totalRawValuePaise || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Split: Stock Position & Variance Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Raw & Finished Balances */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900">
                Real-Time Ledger Stock Position
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Computed live as SUM(qty) across stock_movements
              </p>
            </div>
            {dbUser?.role !== 'salesman' && (
              <Link
                to="/inventory"
                className="text-xs font-medium text-amber-700 hover:text-amber-800 flex items-center gap-1 whitespace-nowrap"
              >
                <span>Open Ledger</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5">Item</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4 text-right">On Hand</th>
                  <th className="py-2.5 px-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.finishedSummary.map((fg) => (
                  <tr key={`fg-${fg.id}`} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-5 font-medium text-slate-900">
                      {fg.name}{' '}
                      <span className="font-mono text-xs text-slate-400">· {fg.sku}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">Finished Good</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatQty(fg.balance)} pkts
                    </td>
                    <td className="py-2.5 px-5 text-right text-xs">
                      {fg.balance > 0 ? (
                        <span className="text-emerald-700 font-medium">Available</span>
                      ) : (
                        <span className="text-red-600 font-medium">Out of Stock</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rawMaterials.map((rm) => (
                  <tr key={`rm-${rm.id}`} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-5 font-medium text-slate-900">{rm.name}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">Raw Material</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatQty(rm.balance)} {rm.unit}
                    </td>
                    <td className="py-2.5 px-5 text-right text-xs">
                      {rm.isLowStock ? (
                        <span className="text-amber-700 font-medium">
                          Low (Min {formatQty(rm.reorderLevel)})
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium">Healthy</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Variance & Low Stock Alerts + Quick Links */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-5">
          <div>
            <h2 className="font-display font-semibold text-sm text-slate-900">
              Control Exceptions (&gt;3% Variance &amp; Reorder)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatic exceptions flagged during production &amp; stock checks
            </p>

            <div className="mt-4 space-y-3">
              {totalAlerts === 0 ? (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>All stock balances and production variances are within tolerance.</span>
                </div>
              ) : (
                <>
                  {data.varianceAlerts.yieldAlerts.map((ya) => (
                    <div
                      key={`ya-${ya.id}`}
                      className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-950"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          Yield Variance Flag · {ya.runNo}
                        </div>
                        <div className="text-amber-800 mt-0.5">
                          {ya.productName}: <span className="font-mono">{ya.yieldVariancePct}%</span> vs expected output
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.varianceAlerts.materialAlerts.map((ma) => (
                    <div
                      key={`ma-${ma.id}`}
                      className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-950"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          Material Consumption Flag
                        </div>
                        <div className="text-amber-800 mt-0.5">
                          {ma.materialName}: <span className="font-mono">{ma.variancePct}%</span> variance vs BOM
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.lowStockAlerts.map((ls) => (
                    <div
                      key={`ls-${ls.id}`}
                      className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50/70 border border-red-200 text-xs text-red-950"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Reorder Alert · {ls.name}</div>
                        <div className="text-red-800 mt-0.5">
                          On hand <span className="font-mono">{formatQty(ls.balance)} {ls.unit}</span> (min {formatQty(ls.reorderLevel)})
                        </div>
                      </div>
                    </div>
                  ))}
                  {(data.expiringBatches || []).map((eb) => (
                    <div
                      key={`eb-${eb.id}`}
                      className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-950"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          Expiry Alert · {eb.materialName} ({eb.batchNo})
                        </div>
                        <div className="text-amber-800 mt-0.5">
                          <span className="font-mono">{formatQty(eb.qtyRemaining)} {eb.unit}</span> expires {eb.expiryDate} ({eb.daysLeft <= 0 ? 'EXPIRED' : `${eb.daysLeft}d left`})
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-2">
            <div className="text-xs font-medium text-slate-500">Quick Operations</div>
            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/orders"
                className="px-3 py-2 text-xs font-medium text-center bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                New Field Order
              </Link>
              {dbUser?.role !== 'salesman' && (
                <Link
                  to="/production"
                  className="px-3 py-2 text-xs font-medium text-center bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Post Batch Run
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
