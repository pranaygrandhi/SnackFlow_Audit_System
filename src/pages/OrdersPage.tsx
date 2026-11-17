import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  CloudOff,
  Plus,
  RefreshCw,
  Trash2,
  X,
  FileText,
} from 'lucide-react';
import { apiRequest, formatINR, formatQty } from '../api/client.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../contexts/ToastContext.tsx';

const OFFLINE_QUEUE_KEY = 'kc_offline_orders_queue_v1';

interface Customer {
  id: number;
  name: string;
  type: string;
  stateCode: string;
  stateName: string;
  gstin: string | null;
}

interface Product {
  id: number;
  sku: string;
  name: string;
  effectivePricePaise: number;
  gstRatePct: string;
  stockOnHand: number;
}

interface OrderLineDraft {
  productId: number;
  qty: number;
  pricePaise: number;
}

interface QueuedOrder {
  clientOfflineId: string;
  customerId: number;
  customerName: string;
  orderDate: string;
  notes: string;
  lines: OrderLineDraft[];
  totalPaise: number;
  queuedAt: string;
}

export function OrdersPage({ refreshKey }: { refreshKey: number }) {
  const { dbUser } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Offline state + manual test toggle
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulateOffline, setSimulateOffline] = useState(false);
  const isOffline = !browserOnline || simulateOffline;

  const [offlineQueue, setOfflineQueue] = useState<QueuedOrder[]>(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [syncing, setSyncing] = useState(false);

  // New Order Form state
  const [customerId, setCustomerId] = useState<number>(0);
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<OrderLineDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Edit Order Qty state
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editQtyMap, setEditQtyMap] = useState<Record<number, number>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [custRes, prodRes, ordRes] = await Promise.all([
        apiRequest<{ customers: Customer[] }>('/api/masters/customers'),
        apiRequest<{ products: Product[] }>('/api/masters/products'),
        apiRequest<{ orders: any[] }>('/api/orders'),
      ]);
      setCustomers(custRes.customers);
      setProducts(prodRes.products);
      setOrders(ordRes.orders);

      if (custRes.customers.length > 0 && customerId === 0) {
        setCustomerId(custRes.customers[0].id);
      }
      if (prodRes.products.length > 0 && draftLines.length === 0) {
        setDraftLines([
          {
            productId: prodRes.products[0].id,
            qty: 150,
            pricePaise: prodRes.products[0].effectivePricePaise,
          },
        ]);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load orders', 'error');
    } finally {
      setLoading(false);
    }
  }, [customerId, draftLines.length, showToast]);

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const persistQueue = (q: QueuedOrder[]) => {
    setOfflineQueue(q);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  };

  const syncOfflineQueue = useCallback(async () => {
    if (isOffline || offlineQueue.length === 0 || syncing) return;
    setSyncing(true);
    try {
      const payload = offlineQueue.map((item) => ({
        clientOfflineId: item.clientOfflineId,
        customerId: item.customerId,
        orderDate: item.orderDate,
        notes: item.notes,
        lines: item.lines,
      }));
      const res = await apiRequest<{ syncedCount: number }>('/api/orders/sync', {
        method: 'POST',
        body: JSON.stringify({ queue: payload }),
      });
      persistQueue([]);
      showToast(`Synced ${res.syncedCount} offline field order(s)`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Offline sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }, [isOffline, offlineQueue, syncing, showToast, loadData]);

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOffline && offlineQueue.length > 0) {
      syncOfflineQueue();
    }
  }, [isOffline, offlineQueue.length]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const handleCustomerChange = async (newCustId: number) => {
    setCustomerId(newCustId);
    try {
      const res = await apiRequest<{ products: Product[] }>(
        `/api/masters/products?customerId=${newCustId}`
      );
      setProducts(res.products);
      setDraftLines((prev) =>
        prev.map((l) => {
          const p = res.products.find((prod) => prod.id === l.productId);
          return p ? { ...l, pricePaise: p.effectivePricePaise } : l;
        })
      );
    } catch {
      // Keep existing prices if offline
    }
  };

  const addLine = () => {
    if (products.length === 0) return;
    const p = products[0];
    setDraftLines([...draftLines, { productId: p.id, qty: 20, pricePaise: p.effectivePricePaise }]);
  };

  const updateLine = (idx: number, patch: Partial<OrderLineDraft>) => {
    setDraftLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const prod = products.find((p) => p.id === patch.productId);
          if (prod) next.pricePaise = prod.effectivePricePaise;
        }
        return next;
      })
    );
  };

  const removeLine = (idx: number) => {
    setDraftLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const draftSubtotalPaise = draftLines.reduce((s, l) => s + l.qty * l.pricePaise, 0);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId || draftLines.length === 0) {
      showToast('Select a customer and at least one product', 'error');
      return;
    }

    const clientOfflineId = `off-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    if (isOffline) {
      const queued: QueuedOrder = {
        clientOfflineId,
        customerId,
        customerName: selectedCustomer?.name || 'Customer',
        orderDate,
        notes,
        lines: draftLines,
        totalPaise: draftSubtotalPaise,
        queuedAt: new Date().toLocaleTimeString(),
      };
      persistQueue([...offlineQueue, queued]);
      setNotes('');
      showToast('Saved to offline queue. Will auto-sync when online.', 'info');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          orderDate,
          notes,
          clientOfflineId,
          lines: draftLines,
        }),
      });
      showToast('Field order submitted successfully', 'success');
      setNotes('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to submit order', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (orderId: number, status: string) => {
    try {
      await apiRequest(`/api/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast(`Order marked ${status}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Status update failed', 'error');
    }
  };

  const handleSaveEditedLines = async (order: any) => {
    try {
      const updatedLines = order.lines.map((l: any) => ({
        productId: l.productId,
        qty: editQtyMap[l.id] ?? l.qty,
        pricePaise: l.pricePaise,
        discountPaise: l.discountPaise,
      }));
      await apiRequest(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ lines: updatedLines }),
      });
      setEditingOrderId(null);
      showToast('Order quantities updated', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update order lines', 'error');
    }
  };

  const handleGenerateInvoice = async (orderId: number) => {
    try {
      const res = await apiRequest<{ invoice: { invoiceNo: string } }>(
        `/api/invoices/from-order/${orderId}`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      showToast(`Generated GST Invoice ${res.invoice.invoiceNo}`, 'success');
      await loadData();
      navigate('/billing');
    } catch (err: any) {
      showToast(err.message || 'Unable to generate invoice', 'error');
    }
  };

  const isAdminOrOwner = dbUser?.role === 'owner' || dbUser?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Offline Banner & Simulation Switch */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-medium ${isOffline ? 'text-amber-700' : 'text-emerald-700'}`}>
            {isOffline ? 'Offline Queue Mode Active' : 'Online · Direct Server Sync'}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-600 font-mono">
            {offlineQueue.length} queued locally
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSimulateOffline(!simulateOffline)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors min-h-[36px] flex items-center gap-1.5 ${
              simulateOffline
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <CloudOff className="w-3.5 h-3.5" />
            <span>{simulateOffline ? 'Go Back Online' : 'Simulate Offline'}</span>
          </button>

          {offlineQueue.length > 0 && !isOffline && (
            <button
              type="button"
              onClick={syncOfflineQueue}
              disabled={syncing}
              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 min-h-[36px] flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync {offlineQueue.length} Order(s)</span>
            </button>
          )}
        </div>
      </div>

      {/* Offline Queue Preview */}
      {offlineQueue.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-amber-950">
            Pending Offline Queue (localStorage)
          </div>
          <div className="divide-y divide-amber-200/70">
            {offlineQueue.map((q) => (
              <div key={q.clientOfflineId} className="py-2 flex items-center justify-between text-xs text-amber-900">
                <div>
                  <span className="font-medium">{q.customerName}</span> · {q.lines.length} line(s) · queued at {q.queuedAt}
                </div>
                <div className="font-mono font-medium">{formatINR(q.totalPaise)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Field Order Entry Form (Mobile-Optimized 5 cols on desktop) */}
        <form
          onSubmit={handleSubmitOrder}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-900">
                Field Order Entry
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mobile-ready salesman capture with automatic GST classification
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Customer / Outlet
              </label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerChange(Number(e.target.value))}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600 min-h-[44px]"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.stateName} ({c.stateCode})
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <div className="mt-1 text-xs text-slate-500">
                  Tax Rule:{' '}
                  <span className="font-medium text-slate-700">
                    {selectedCustomer.stateCode === '33'
                      ? 'Intra-State TN → CGST 2.5% + SGST 2.5%'
                      : `Inter-State (${selectedCustomer.stateName}) → IGST 5.0%`}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Order Date
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg min-h-[44px]"
              />
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Order Items</span>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-xs font-medium text-amber-700 hover:text-amber-800 flex items-center gap-1 py-1 px-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Product</span>
                </button>
              </div>

              {draftLines.map((line, idx) => {
                const prod = products.find((p) => p.id === line.productId);
                const avail = prod?.stockOnHand ?? 0;
                const isShort = line.qty > avail;

                return (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={line.productId}
                        onChange={(e) => updateLine(idx, { productId: Number(e.target.value) })}
                        className="flex-1 px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg min-h-[42px]"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatINR(p.effectivePricePaise)})
                          </option>
                        ))}
                      </select>
                      {draftLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="p-2 text-slate-400 hover:text-red-600 min-h-[42px] min-w-[42px] flex items-center justify-center"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 items-center">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">
                          Qty (Packets)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={line.qty}
                          onChange={(e) => updateLine(idx, { qty: Math.max(1, Number(e.target.value)) })}
                          className="w-full px-2.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg min-h-[42px]"
                        />
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">
                          Stock: <span className="font-mono">{formatQty(avail)} pkts</span>
                        </div>
                        <div className="font-mono text-sm font-semibold text-slate-900 mt-1">
                          {formatINR(line.qty * line.pricePaise)}
                        </div>
                      </div>
                    </div>

                    {isShort && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-800">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>
                          Stock alert: only {formatQty(avail)} on hand (short by{' '}
                          {formatQty(line.qty - avail)} pkts)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Delivery Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Morning route dispatch"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg min-h-[42px]"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Taxable Subtotal (+5% GST)</div>
              <div className="font-mono text-lg font-semibold text-slate-900">
                {formatINR(draftSubtotalPaise)}
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors min-h-[44px] whitespace-nowrap"
            >
              {isOffline
                ? 'Queue Offline'
                : submitting
                ? 'Submitting...'
                : 'Submit Order'}
            </button>
          </div>
        </form>

        {/* Incoming Orders Queue (Admin & Tracking View - 7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-900">
                Orders Queue &amp; Stock Check
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live finished-goods availability per line before invoicing
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500">{orders.length} order(s)</span>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No field orders submitted yet. Use the form to log your first order.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {orders.map((ord) => {
                const isEditing = editingOrderId === ord.id;
                const canMutate =
                  isAdminOrOwner && (ord.status === 'submitted' || ord.status === 'approved');

                return (
                  <div key={ord.id} className="p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono font-semibold text-slate-900">
                            {ord.orderNo}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-medium text-slate-900">{ord.customerName}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {ord.orderDate} · State {ord.customerStateCode} ({ord.customerStateName}) ·{' '}
                          {ord.customerStateCode === '33' ? 'CGST + SGST' : 'IGST'} · By {ord.salesmanName}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {formatINR(ord.subtotalPaise)}
                        </div>
                        <div
                          className={`text-xs font-medium capitalize mt-0.5 ${
                            ord.status === 'rejected'
                              ? 'text-red-600'
                              : ord.status === 'dispatched' || ord.status === 'invoiced'
                              ? 'text-emerald-700'
                              : ord.status === 'approved'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {ord.status}
                        </div>
                      </div>
                    </div>

                    {/* Line items with live stock availability check */}
                    <div className="bg-slate-50 rounded-lg border border-slate-200/80 divide-y divide-slate-200/70">
                      {ord.lines.map((l: any) => (
                        <div
                          key={l.id}
                          className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="font-medium text-slate-800">
                            {l.productName}{' '}
                            <span className="font-mono text-slate-500">
                              @ {formatINR(l.pricePaise)}
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            {isEditing ? (
                              <input
                                type="number"
                                min={1}
                                value={editQtyMap[l.id] ?? l.qty}
                                onChange={(e) =>
                                  setEditQtyMap({
                                    ...editQtyMap,
                                    [l.id]: Math.max(1, Number(e.target.value)),
                                  })
                                }
                                className="w-20 px-2 py-1 font-mono bg-white border border-slate-300 rounded text-right"
                              />
                            ) : (
                              <span className="font-mono font-medium text-slate-900">
                                {l.qty} pkts
                              </span>
                            )}

                            {ord.status !== 'invoiced' && ord.status !== 'dispatched' && (
                              <span
                                className={`font-mono ${
                                  l.hasShortage ? 'text-red-600 font-semibold' : 'text-emerald-700'
                                }`}
                              >
                                {l.hasShortage
                                  ? `Shortage: ${l.shortage} (Avail ${l.availableStock})`
                                  : `In Stock (${l.availableStock})`}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Admin Action Bar */}
                    {canMutate && (
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => handleSaveEditedLines(ord)}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                            >
                              Save Quantities
                            </button>
                            <button
                              onClick={() => setEditingOrderId(null)}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              const m: Record<number, number> = {};
                              ord.lines.forEach((l: any) => (m[l.id] = l.qty));
                              setEditQtyMap(m);
                              setEditingOrderId(ord.id);
                            }}
                            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                          >
                            Edit Qty
                          </button>
                        )}

                        {ord.status === 'submitted' && (
                          <>
                            <button
                              onClick={() => handleStatusChange(ord.id, 'approved')}
                              className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              onClick={() => handleStatusChange(ord.id, 'rejected')}
                              className="px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => handleGenerateInvoice(ord.id)}
                          disabled={ord.hasAnyShortage}
                          title={
                            ord.hasAnyShortage
                              ? 'Insufficient finished goods stock to invoice'
                              : 'Generate GST Tax Invoice & Deduct Stock'
                          }
                          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 ${
                            ord.hasAnyShortage
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              : 'bg-amber-700 text-white hover:bg-amber-800'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Generate GST Invoice</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
