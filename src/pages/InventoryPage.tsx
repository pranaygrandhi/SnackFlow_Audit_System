import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest, formatINR, formatQty } from '../api/client.ts';
import { useToast } from '../contexts/ToastContext.tsx';

type Tab = 'balances' | 'ledger' | 'batches' | 'purchasing' | 'adjustment';

export function InventoryPage({ refreshKey }: { refreshKey: number }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('balances');

  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Ledger filters
  const [ledgerItemType, setLedgerItemType] = useState<string>('');
  const [ledgerMovementType, setLedgerMovementType] = useState<string>('');

  // Purchase form
  const [supplierId, setSupplierId] = useState<number>(0);
  const [purchaseDate, setPurchaseDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [purchaseNotes, setPurchaseNotes] = useState<string>('');
  const [purchaseLines, setPurchaseLines] = useState<
    Array<{ rawMaterialId: number; qty: number; rateRupees: number; batchNo: string; expiryDate: string }>
  >([]);
  const [savingPurchase, setSavingPurchase] = useState(false);

  // Adjustment form
  const [adjItemType, setAdjItemType] = useState<'raw' | 'finished'>('raw');
  const [adjItemId, setAdjItemId] = useState<number>(0);
  const [adjQty, setAdjQty] = useState<string>('');
  const [adjType, setAdjType] = useState<'adjustment' | 'damage'>('adjustment');
  const [adjNotes, setAdjNotes] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, ledRes, batchRes, supRes, purRes] = await Promise.all([
        apiRequest<{ rawMaterials: any[]; finishedGoods: any[] }>('/api/inventory/balances'),
        apiRequest<{ ledger: any[] }>('/api/inventory/ledger'),
        apiRequest<{ batches: any[] }>('/api/inventory/batches'),
        apiRequest<{ suppliers: any[] }>('/api/masters/suppliers'),
        apiRequest<{ purchases: any[] }>('/api/purchases'),
      ]);
      setRawMaterials(balRes.rawMaterials);
      setFinishedGoods(balRes.finishedGoods);
      setLedger(ledRes.ledger);
      setBatches(batchRes.batches);
      setSuppliers(supRes.suppliers);
      setPurchases(purRes.purchases);

      if (supRes.suppliers.length > 0 && supplierId === 0) {
        setSupplierId(supRes.suppliers[0].id);
      }
      if (balRes.rawMaterials.length > 0 && purchaseLines.length === 0) {
        const firstMat = balRes.rawMaterials[0];
        setPurchaseLines([
          {
            rawMaterialId: firstMat.id,
            qty: 60,
            rateRupees: 45,
            batchNo: `FLOUR-${new Date().toISOString().slice(5, 10).replace('-', '')}`,
            expiryDate: '2027-09-01',
          },
        ]);
      }
      if (balRes.rawMaterials.length > 0 && adjItemId === 0) {
        setAdjItemId(balRes.rawMaterials[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load inventory', 'error');
    } finally {
      setLoading(false);
    }
  }, [adjItemId, purchaseLines.length, showToast, supplierId]);

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !invoiceNo || purchaseLines.length === 0) {
      showToast('Supplier, invoice number, and at least one line are required', 'error');
      return;
    }
    setSavingPurchase(true);
    try {
      await apiRequest('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          purchaseDate,
          invoiceNo,
          notes: purchaseNotes,
          lines: purchaseLines.map((l) => ({
            rawMaterialId: l.rawMaterialId,
            qty: l.qty,
            ratePaise: Math.round(l.rateRupees * 100),
            batchNo: l.batchNo,
            expiryDate: l.expiryDate || undefined,
          })),
        }),
      });
      showToast('Purchase recorded · Stock ledger & FIFO batches updated', 'success');
      setInvoiceNo('');
      setPurchaseNotes('');
      await loadData();
      setTab('balances');
    } catch (err: any) {
      showToast(err.message || 'Failed to record purchase', 'error');
    } finally {
      setSavingPurchase(false);
    }
  };

  const handleAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          itemType: adjItemType,
          itemId: adjItemId,
          qty: Number(adjQty),
          movementType: adjType,
          notes: adjNotes,
        }),
      });
      showToast('Ledger adjustment recorded', 'success');
      setAdjQty('');
      setAdjNotes('');
      await loadData();
      setTab('ledger');
    } catch (err: any) {
      showToast(err.message || 'Adjustment failed', 'error');
    }
  };

  const filteredLedger = ledger.filter((row) => {
    if (ledgerItemType && row.itemType !== ledgerItemType) return false;
    if (ledgerMovementType && row.movementType !== ledgerMovementType) return false;
    return true;
  });

  const sourceLinkFor = (sourceType: string) => {
    if (sourceType === 'production_run') return '/production';
    if (sourceType === 'invoice' || sourceType === 'credit_note') return '/billing';
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Segmented Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            ['balances', 'Stock Balances'],
            ['ledger', 'Stock Ledger'],
            ['batches', 'FIFO Batches'],
            ['purchasing', 'Record Purchase (GRN)'],
            ['adjustment', 'Adjustment'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Loading ledger inventory...
        </div>
      ) : (
        <>
          {/* TAB 1: Real-time Balances */}
          {tab === 'balances' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Raw Materials &amp; Packaging
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Closing balance computed directly from SUM(stock_movements.qty)
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Material</th>
                      <th className="py-2.5 px-4 text-right">Reorder Lvl</th>
                      <th className="py-2.5 px-5 text-right">Closing Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rawMaterials.map((m) => (
                      <tr key={m.id}>
                        <td className="py-3 px-5 font-medium text-slate-900">
                          {m.name}
                          <span className="block text-[11px] text-slate-500 capitalize font-normal">
                            {m.materialCategory} · Std {formatINR(m.defaultRatePaise)}/{m.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-500">
                          {formatQty(m.reorderLevel)} {m.unit}
                        </td>
                        <td
                          className={`py-3 px-5 text-right font-mono font-semibold ${
                            m.isLowStock ? 'text-amber-700' : 'text-slate-900'
                          }`}
                        >
                          {formatQty(m.balance)} {m.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden h-fit">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Finished Goods
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ready-to-dispatch packet balances
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">SKU / Product</th>
                      <th className="py-2.5 px-4 text-right">MRP / Rate</th>
                      <th className="py-2.5 px-5 text-right">On Hand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {finishedGoods.map((fg) => (
                      <tr key={fg.id}>
                        <td className="py-3 px-5 font-medium text-slate-900">
                          {fg.name}
                          <span className="block text-[11px] font-mono text-slate-500 font-normal">
                            {fg.sku} · HSN {fg.hsnCode}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">
                          {formatINR(fg.sellingPricePaise)}
                        </td>
                        <td className="py-3 px-5 text-right font-mono font-semibold text-slate-900">
                          {formatQty(fg.balance)} pkts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Full Stock Ledger */}
          {tab === 'ledger' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Immutable Stock Movement Ledger
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Every inward and outward movement traced back to its source transaction
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={ledgerItemType}
                    onChange={(e) => setLedgerItemType(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">All Item Types</option>
                    <option value="raw">Raw Materials</option>
                    <option value="finished">Finished Goods</option>
                  </select>
                  <select
                    value={ledgerMovementType}
                    onChange={(e) => setLedgerMovementType(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">All Movements</option>
                    <option value="purchase">Purchase</option>
                    <option value="issue">Production Issue</option>
                    <option value="damage">Damage / Scrap</option>
                    <option value="production_in">Production Output</option>
                    <option value="sale">Sale</option>
                    <option value="return">Return / Credit Note</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">ID</th>
                      <th className="py-2.5 px-4">Item</th>
                      <th className="py-2.5 px-4">Movement</th>
                      <th className="py-2.5 px-4">Source</th>
                      <th className="py-2.5 px-4">Batch</th>
                      <th className="py-2.5 px-4 text-right">Qty</th>
                      <th className="py-2.5 px-4 text-right">Rate</th>
                      <th className="py-2.5 px-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLedger.map((m) => {
                      const qtyNum = Number(m.qty);
                      const link = sourceLinkFor(m.sourceType);
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-400">#{m.id}</td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {m.itemName}
                            <span className="block text-[11px] text-slate-400 capitalize">
                              {m.itemType}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-xs capitalize text-slate-700">
                            {m.movementType.replace('_', ' ')}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs">
                            {link ? (
                              <Link
                                to={link}
                                className="text-amber-700 hover:underline font-medium"
                              >
                                {m.sourceType} #{m.sourceId}
                              </Link>
                            ) : (
                              <span className="text-slate-600">
                                {m.sourceType} {m.sourceId ? `#${m.sourceId}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                            {m.batchNo || '—'}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono font-semibold ${
                              qtyNum >= 0 ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {qtyNum > 0 ? `+${formatQty(qtyNum)}` : formatQty(qtyNum)} {m.unit}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600">
                            {formatINR(m.ratePaise)}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                            {m.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: FIFO Batches */}
          {tab === 'batches' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-display font-semibold text-sm text-slate-900">
                  Raw Material Batches (FIFO Consumption Order)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Oldest batch with remaining quantity is consumed first during Production Run posting
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Material</th>
                      <th className="py-2.5 px-4">Batch No</th>
                      <th className="py-2.5 px-4">Expiry</th>
                      <th className="py-2.5 px-4 text-right">Initial</th>
                      <th className="py-2.5 px-4 text-right">Remaining</th>
                      <th className="py-2.5 px-5 text-right">FIFO Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => {
                      const rem = Number(b.qtyRemaining);
                      return (
                        <tr key={b.id} className={rem <= 0 ? 'opacity-50' : ''}>
                          <td className="py-2.5 px-5 font-medium text-slate-900">{b.materialName}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{b.batchNo}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                            {b.expiryDate || 'N/A'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500">
                            {formatQty(b.qtyInitial)} {b.unit}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                            {formatQty(rem)} {b.unit}
                          </td>
                          <td className="py-2.5 px-5 text-right font-mono text-xs font-medium text-slate-800">
                            {formatINR(b.ratePaise)}/{b.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: Purchasing (GRN) */}
          {tab === 'purchasing' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleCreatePurchase}
                className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div>
                  <h2 className="font-display font-semibold text-base text-slate-900">
                    Record Raw Material Purchase (GRN)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Creates supplier bill, adds FIFO costing batch, and posts positive stock_movements
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Supplier
                    </label>
                    <select
                      value={supplierId}
                      onChange={(e) => setSupplierId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Supplier Invoice No
                    </label>
                    <input
                      type="text"
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      placeholder="e.g. TAM-2026-089"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Notes
                    </label>
                    <input
                      type="text"
                      value={purchaseNotes}
                      onChange={(e) => setPurchaseNotes(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Material Lines</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (rawMaterials.length === 0) return;
                        const m = rawMaterials[0];
                        setPurchaseLines([
                          ...purchaseLines,
                          {
                            rawMaterialId: m.id,
                            qty: 10,
                            rateRupees: m.defaultRatePaise / 100,
                            batchNo: `B-${Date.now().toString().slice(-4)}`,
                            expiryDate: '2027-09-01',
                          },
                        ]);
                      }}
                      className="text-xs font-medium text-amber-700 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Material</span>
                    </button>
                  </div>

                  {purchaseLines.map((line, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={line.rawMaterialId}
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            const mat = rawMaterials.find((m) => m.id === id);
                            setPurchaseLines((prev) =>
                              prev.map((l, i) =>
                                i === idx
                                  ? {
                                      ...l,
                                      rawMaterialId: id,
                                      rateRupees: mat ? mat.defaultRatePaise / 100 : l.rateRupees,
                                    }
                                  : l
                              )
                            );
                          }}
                          className="flex-1 px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        >
                          {rawMaterials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.unit})
                            </option>
                          ))}
                        </select>
                        {purchaseLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPurchaseLines((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-2 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500">Qty</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={line.qty}
                            onChange={(e) =>
                              setPurchaseLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, qty: Number(e.target.value) } : l
                                )
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500">Rate (₹)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.rateRupees}
                            onChange={(e) =>
                              setPurchaseLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, rateRupees: Number(e.target.value) } : l
                                )
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500">Batch No</label>
                          <input
                            type="text"
                            value={line.batchNo}
                            onChange={(e) =>
                              setPurchaseLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, batchNo: e.target.value } : l
                                )
                              )
                            }
                            className="w-full px-2 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPurchase}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg"
                  >
                    {savingPurchase ? 'Posting GRN...' : 'Save Purchase & Credit Stock'}
                  </button>
                </div>
              </form>

              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="font-display font-semibold text-sm text-slate-900">
                    Recent Purchases
                  </h3>
                </div>
                {purchases.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No purchases recorded yet.</div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {purchases.map((p) => (
                      <div key={p.id} className="p-4 space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium text-slate-900">
                            {p.supplierName} · <span className="font-mono text-xs">{p.invoiceNo}</span>
                          </span>
                          <span className="font-mono font-semibold text-slate-900">
                            {formatINR(p.totalPaise)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.purchaseDate} ·{' '}
                          {p.lines
                            .map(
                              (l: any) =>
                                `${l.materialName}: ${formatQty(l.qty)} ${l.unit} @ ${formatINR(l.ratePaise)}`
                            )
                            .join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: Manual Adjustment */}
          {tab === 'adjustment' && (
            <form
              onSubmit={handleAdjustment}
              className="max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div>
                <h2 className="font-display font-semibold text-base text-slate-900">
                  Record Stock Adjustment / Damage
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  All corrections append signed entries to stock_movements; historical rows are never overwritten.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Item Type</label>
                  <select
                    value={adjItemType}
                    onChange={(e) => {
                      const t = e.target.value as 'raw' | 'finished';
                      setAdjItemType(t);
                      const list = t === 'raw' ? rawMaterials : finishedGoods;
                      if (list.length > 0) setAdjItemId(list[0].id);
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="raw">Raw Material</option>
                    <option value="finished">Finished Good</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Movement Type
                  </label>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as 'adjustment' | 'damage')}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="adjustment">Audit Adjustment</option>
                    <option value="damage">Damage / Spoilage</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Item</label>
                <select
                  value={adjItemId}
                  onChange={(e) => setAdjItemId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {(adjItemType === 'raw' ? rawMaterials : finishedGoods).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (On hand: {formatQty(item.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Signed Qty (+in / -out)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjQty}
                    onChange={(e) => setAdjQty(e.target.value)}
                    placeholder="e.g. -2"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
                  <input
                    type="text"
                    value={adjNotes}
                    onChange={(e) => setAdjNotes(e.target.value)}
                    placeholder="Physical verification"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                Post Ledger Adjustment
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
