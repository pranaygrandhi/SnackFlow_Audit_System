import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, History, ShieldAlert } from 'lucide-react';
import { apiRequest, downloadAuthorizedFile, formatINR, formatQty } from '../api/client.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';

interface BomLine {
  id: number;
  rawMaterialId: number;
  materialName: string;
  materialCategory: string;
  qtyPerBatch: string;
  unit: string;
  defaultRatePaise: number;
  stockOnHand: number;
}

interface IssueFormRow {
  rawMaterialId: number;
  materialName: string;
  materialCategory: string;
  unit: string;
  plannedQty: number;
  actualQty: number;
  stockOnHand: number;
  defaultRatePaise: number;
}

export function ProductionPage({ refreshKey }: { refreshKey: number }) {
  const { dbUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New Run Form
  const [productId, setProductId] = useState<number>(0);
  const [runDate, setRunDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [batchSize, setBatchSize] = useState<number>(1);
  const [expectedOutput, setExpectedOutput] = useState<number>(200);
  const [actualOutput, setActualOutput] = useState<number>(188);
  const [damagedUnits, setDamagedUnits] = useState<number>(6);
  const [labourRupees, setLabourRupees] = useState<number>(1200);
  const [overheadRupees, setOverheadRupees] = useState<number>(600);
  const [issues, setIssues] = useState<IssueFormRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Admin Override Modal
  const [overrideRun, setOverrideRun] = useState<any | null>(null);
  const [overrideLabour, setOverrideLabour] = useState<string>('');
  const [overrideOverhead, setOverrideOverhead] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');

  const loadBomForProduct = useCallback(async (prodId: number, batches: number, productsList?: any[]) => {
    try {
      const res = await apiRequest<{ bomLines: BomLine[] }>(`/api/masters/bom/${prodId}`);
      const prods = productsList || products;
      const prod = prods.find((p) => p.id === prodId);
      const batchOut = prod ? prod.batchOutputQty : 200;
      const expOut = Math.round(batchOut * batches);
      setExpectedOutput(expOut);

      setIssues(
        res.bomLines.map((b) => {
          const planned = Number((Number(b.qtyPerBatch) * batches).toFixed(4));
          return {
            rawMaterialId: b.rawMaterialId,
            materialName: b.materialName,
            materialCategory: b.materialCategory,
            unit: b.unit,
            plannedQty: planned,
            actualQty: planned,
            stockOnHand: b.stockOnHand,
            defaultRatePaise: b.defaultRatePaise,
          };
        })
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to load BOM', 'error');
    }
  }, [products, showToast]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, runsRes] = await Promise.all([
        apiRequest<{ products: any[] }>('/api/masters/products'),
        apiRequest<{ runs: any[] }>('/api/production/runs'),
      ]);
      setProducts(prodRes.products);
      setRuns(runsRes.runs);

      if (prodRes.products.length > 0) {
        const targetId = productId || prodRes.products[0].id;
        setProductId(targetId);
        await loadBomForProduct(targetId, batchSize, prodRes.products);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load production runs', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const handleProductChange = async (newProdId: number) => {
    setProductId(newProdId);
    await loadBomForProduct(newProdId, batchSize);
  };

  const handleBatchSizeChange = async (newBatches: number) => {
    const safeBatches = Math.max(0.1, newBatches);
    setBatchSize(safeBatches);
    if (productId) {
      await loadBomForProduct(productId, safeBatches);
    }
  };

  const updateIssueActual = (idx: number, val: number) => {
    setIssues((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, actualQty: Math.max(0, val) } : row))
    );
  };

  // Compute live sufficiency & variance previews
  const hasStockShortfall = issues.some((row) => {
    const extraDamaged = row.materialCategory === 'pouch' ? damagedUnits : 0;
    return row.actualQty + extraDamaged > row.stockOnHand + 0.0001;
  });

  const yieldVarPct =
    expectedOutput > 0
      ? Number((((actualOutput - expectedOutput) / expectedOutput) * 100).toFixed(2))
      : 0;
  const yieldFlagged = Math.abs(yieldVarPct) > 3;

  const cartonsRow = issues.find((i) => i.materialCategory === 'carton');
  const cartonsUsed = cartonsRow ? Math.round(cartonsRow.actualQty) : 0;

  const handleCreateRun = async (postImmediately: boolean) => {
    if (!productId || issues.length === 0) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/production/runs', {
        method: 'POST',
        body: JSON.stringify({
          productId,
          runDate,
          batchSize,
          expectedOutput,
          actualOutput,
          damagedUnits,
          cartonsUsed,
          labourCostPaise: Math.round(labourRupees * 100),
          overheadCostPaise: Math.round(overheadRupees * 100),
          postImmediately,
          issues: issues.map((i) => ({
            rawMaterialId: i.rawMaterialId,
            plannedQty: i.plannedQty,
            actualQty: i.actualQty,
            unit: i.unit,
          })),
        }),
      });
      showToast(
        postImmediately
          ? 'Production run posted · FIFO stock deducted & finished goods credited'
          : 'Production run saved as draft',
        'success'
      );
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Production run failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostDraft = async (runId: number) => {
    try {
      await apiRequest(`/api/production/runs/${runId}/post`, { method: 'POST' });
      showToast('Draft run posted to ledger', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to post draft run', 'error');
    }
  };

  const handleOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideRun) return;
    try {
      await apiRequest(`/api/production/runs/${overrideRun.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          labourCostPaise: Math.round(Number(overrideLabour) * 100),
          overheadCostPaise: Math.round(Number(overrideOverhead) * 100),
          reason: overrideReason,
        }),
      });
      showToast('Posted run updated with audit log entry', 'success');
      setOverrideRun(null);
      setOverrideReason('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Override failed', 'error');
    }
  };

  const canOverride = dbUser?.role === 'owner' || dbUser?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* New Production Run Builder */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-900">
              New Production Run (BOM &amp; FIFO Costing)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select product to auto-fill planned BOM quantities. Variances exceeding ±3% are automatically flagged.
            </p>
          </div>
          <div className="text-xs font-medium">
            {hasStockShortfall ? (
              <span className="text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Insufficient Raw Material Stock</span>
              </span>
            ) : (
              <span className="text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Raw Material Stock Sufficient</span>
              </span>
            )}
          </div>
        </div>

        {/* Run Header Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Product</label>
            <select
              value={productId}
              onChange={(e) => handleProductChange(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg min-h-[42px]"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (1 batch = {p.batchOutputQty} pkts)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Run Date</label>
            <input
              type="date"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg min-h-[42px]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Batches</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={batchSize}
              onChange={(e) => handleBatchSizeChange(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg min-h-[42px]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Actual Output (Pkts)
            </label>
            <input
              type="number"
              min={1}
              value={actualOutput}
              onChange={(e) => setActualOutput(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg min-h-[42px]"
            />
            <div className={`text-[11px] font-mono mt-1 ${yieldFlagged ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
              Exp {expectedOutput} · Var {yieldVarPct > 0 ? `+${yieldVarPct}` : yieldVarPct}%{' '}
              {yieldFlagged ? '(Flagged >3%)' : ''}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Damaged Pouches
            </label>
            <input
              type="number"
              min={0}
              value={damagedUnits}
              onChange={(e) => setDamagedUnits(Math.max(0, Number(e.target.value)))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg min-h-[42px]"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Extra scrap deducted from Pouch stock
            </div>
          </div>
        </div>

        {/* BOM Issue Lines Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Raw Material / Packaging</th>
                <th className="py-2.5 px-4 text-right">Stock On Hand</th>
                <th className="py-2.5 px-4 text-right">Planned (BOM)</th>
                <th className="py-2.5 px-4 text-right">Actual Issued</th>
                <th className="py-2.5 px-4 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.map((row, idx) => {
                const extraDamaged = row.materialCategory === 'pouch' ? damagedUnits : 0;
                const totalRequired = row.actualQty + extraDamaged;
                const short = totalRequired > row.stockOnHand + 0.0001;
                const vPct =
                  row.plannedQty > 0
                    ? Number((((row.actualQty - row.plannedQty) / row.plannedQty) * 100).toFixed(2))
                    : 0;
                const flagged = Math.abs(vPct) > 3;

                return (
                  <tr key={row.rawMaterialId}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      {row.materialName}
                      {extraDamaged > 0 && (
                        <span className="block text-[11px] text-slate-500 font-normal">
                          + {extraDamaged} damaged pouches = {totalRequired} total deducted
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono text-xs ${short ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                      {formatQty(row.stockOnHand)} {row.unit}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600">
                      {formatQty(row.plannedQty)} {row.unit}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.actualQty}
                          onChange={(e) => updateIssueActual(idx, Number(e.target.value))}
                          className="w-24 px-2.5 py-1.5 text-sm font-mono text-right border border-slate-300 rounded-md"
                        />
                        <span className="text-xs text-slate-500 w-10 text-left">{row.unit}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs">
                      <span className={flagged ? 'text-amber-700 font-semibold' : 'text-slate-600'}>
                        {vPct > 0 ? `+${vPct}%` : `${vPct}%`}
                        {flagged ? ' · Flagged' : ''}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Direct Labour & Overhead + Post Actions */}
        <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Direct Labour (₹)
              </label>
              <input
                type="number"
                min={0}
                value={labourRupees}
                onChange={(e) => setLabourRupees(Math.max(0, Number(e.target.value)))}
                className="w-36 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Gas / Power / Overhead (₹)
              </label>
              <input
                type="number"
                min={0}
                value={overheadRupees}
                onChange={(e) => setOverheadRupees(Math.max(0, Number(e.target.value)))}
                className="w-40 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleCreateRun(false)}
              className="px-4 py-2.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg min-h-[42px]"
            >
              Save Draft
            </button>
            <button
              type="button"
              disabled={submitting || hasStockShortfall}
              onClick={() => handleCreateRun(true)}
              className={`px-5 py-2.5 text-xs font-medium rounded-lg min-h-[42px] ${
                hasStockShortfall
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {submitting ? 'Posting...' : 'Post Run & Compute FIFO Cost'}
            </button>
          </div>
        </div>
      </div>

      {/* Production Runs & Per-Run Costing Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-900">
              Production Runs &amp; Costing Breakdown
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              FIFO material cost + packaging + labour + overheads allocated per packet
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">{runs.length} run(s)</span>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading production runs...</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No production runs logged yet. Post a run above to deduct raw materials via FIFO and add finished packets.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {runs.map((run) => {
              const marginPct =
                run.status === 'posted' && run.sellingPricePaise > 0
                  ? (
                      ((run.sellingPricePaise - run.costPerPacketPaise) /
                        run.sellingPricePaise) *
                      100
                    ).toFixed(1)
                  : null;

              return (
                <div key={run.id} className="p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono font-semibold text-slate-900">{run.runNo}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-medium text-slate-900">{run.productName}</span>
                        <span className="text-slate-300">·</span>
                        <span
                          className={`text-xs font-medium uppercase ${
                            run.status === 'posted' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {run.runDate} · {formatQty(run.batchSize)} batch · Output:{' '}
                        <span className="font-mono text-slate-800">
                          {formatQty(run.actualOutput)}
                        </span>{' '}
                        vs {formatQty(run.expectedOutput)} exp (
                        <span
                          className={`font-mono ${
                            run.yieldFlagged ? 'text-amber-700 font-semibold' : ''
                          }`}
                        >
                          {Number(run.yieldVariancePct) > 0
                            ? `+${run.yieldVariancePct}%`
                            : `${run.yieldVariancePct}%`}
                          {run.yieldFlagged ? ' Yield Flag' : ''}
                        </span>
                        ) · Damaged Pouches: <span className="font-mono">{run.damagedUnits}</span>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      {run.status === 'posted' ? (
                        <>
                          <div className="text-base font-semibold text-slate-900">
                            {formatINR(run.costPerPacketPaise)}{' '}
                            <span className="text-xs font-normal text-slate-500">/ pkt</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Total {formatINR(run.totalCostPaise)} · Margin {marginPct}% (SP{' '}
                            {formatINR(run.sellingPricePaise)})
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => handlePostDraft(run.id)}
                          className="px-3.5 py-1.5 text-xs font-sans font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                        >
                          Post Draft Run
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Material Issues Breakdown */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {run.issues.map((iss: any) => (
                      <div
                        key={iss.id}
                        className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                          iss.flagged
                            ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                            : 'bg-slate-50 border-slate-200/80 text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{iss.materialName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {formatQty(iss.actualQty)} / {formatQty(iss.plannedQty)} {iss.unit} (
                            {Number(iss.variancePct) > 0
                              ? `+${iss.variancePct}%`
                              : `${iss.variancePct}%`}
                            )
                          </div>
                        </div>
                        <div className="font-mono font-medium text-right">
                          {run.status === 'posted' ? formatINR(iss.fifoCostPaise) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Labour + Overhead + Cost Sheet PDF + Audit Override */}
                  {run.status === 'posted' && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 pt-1">
                      <div>
                        Labour: <span className="font-mono font-medium">{formatINR(run.labourCostPaise)}</span> · Overheads:{' '}
                        <span className="font-mono font-medium">{formatINR(run.overheadCostPaise)}</span>
                      </div>

                      <div className="flex items-center gap-4">
                        <button
                          onClick={async () => {
                            try {
                              await downloadAuthorizedFile(
                                `/api/production/runs/${run.id}/pdf`,
                                `${run.runNo}-cost-sheet.pdf`
                              );
                            } catch (err: any) {
                              showToast(err.message || 'Cost sheet download failed', 'error');
                            }
                          }}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Cost Sheet PDF</span>
                        </button>

                        {canOverride && (
                          <button
                            onClick={() => {
                              setOverrideRun(run);
                              setOverrideLabour((run.labourCostPaise / 100).toFixed(2));
                              setOverrideOverhead((run.overheadCostPaise / 100).toFixed(2));
                            }}
                            className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1"
                          >
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                            <span>Admin Override</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Audit Log Entries if any */}
                  {run.auditLogs && run.auditLogs.length > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <History className="w-3.5 h-3.5" />
                        <span>Post-Run Override Audit Log</span>
                      </div>
                      {run.auditLogs.map((al: any) => (
                        <div key={al.id} className="text-xs text-slate-600">
                          <span className="font-medium text-slate-900">{al.changedByName}</span> ·{' '}
                          {new Date(al.changedAt).toLocaleString()} · Reason: "{al.reason}" · Cost/pkt{' '}
                          <span className="font-mono">
                            {formatINR(al.oldValues?.costPerPacketPaise || 0)} →{' '}
                            {formatINR(al.newValues?.costPerPacketPaise || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin Override Modal */}
      {overrideRun && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleOverrideSubmit}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900">
                Admin Override · {overrideRun.runNo}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Posted run modifications are permanently recorded in the audit log.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Labour Cost (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={overrideLabour}
                  onChange={(e) => setOverrideLabour(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Overhead Cost (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={overrideOverhead}
                  onChange={(e) => setOverrideOverhead(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mandatory Audit Reason
              </label>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Updated gas cylinder meter reading"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                required
                minLength={4}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOverrideRun(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
              >
                Save Override &amp; Log
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
