import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Truck,
  IndianRupee,
  Ban,
  Share2,
  RotateCcw,
} from 'lucide-react';
import { apiRequest, downloadAuthorizedFile, formatINR } from '../api/client.ts';
import { useToast } from '../contexts/ToastContext.tsx';

export function BillingPage({ refreshKey }: { refreshKey: number }) {
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment modal state
  const [payInvoice, setPayInvoice] = useState<any | null>(null);
  const [payAmountRupees, setPayAmountRupees] = useState('');
  const [payMode, setPayMode] = useState('upi');
  const [payRef, setPayRef] = useState('');
  const [savingPay, setSavingPay] = useState(false);

  // Dispatch modal state
  const [dispatchInvoice, setDispatchInvoice] = useState<any | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  // Partial sales return modal state
  const [returnInvoice, setReturnInvoice] = useState<any | null>(null);
  const [returnQtyMap, setReturnQtyMap] = useState<Record<number, number>>({});
  const [restockGood, setRestockGood] = useState(true);
  const [returnNotes, setReturnNotes] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, payRes] = await Promise.all([
        apiRequest<{ invoices: any[] }>('/api/invoices'),
        apiRequest<{ payments: any[] }>('/api/payments'),
      ]);
      setInvoices(invRes.invoices);
      setPayments(payRes.payments);
    } catch (err: any) {
      showToast(err.message || 'Failed to load billing data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [refreshKey, loadData]);

  const handleDownloadPdf = async (inv: any) => {
    try {
      const safeName = `${inv.invoiceNo.replace(/\//g, '-')}.pdf`;
      await downloadAuthorizedFile(`/api/invoices/${inv.id}/pdf`, safeName);
    } catch (err: any) {
      showToast(err.message || 'Failed to download PDF', 'error');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInvoice) return;
    const paise = Math.round(Number(payAmountRupees) * 100);
    if (paise <= 0) {
      showToast('Enter a positive payment amount', 'error');
      return;
    }
    setSavingPay(true);
    try {
      await apiRequest('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: payInvoice.id,
          amountPaise: paise,
          mode: payMode,
          referenceNo: payRef,
        }),
      });
      showToast('Payment recorded successfully', 'success');
      setPayInvoice(null);
      setPayAmountRupees('');
      setPayRef('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Payment failed', 'error');
    } finally {
      setSavingPay(false);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchInvoice) return;
    try {
      await apiRequest(`/api/invoices/${dispatchInvoice.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ vehicleNo, notes: dispatchNotes }),
      });
      showToast(`Dispatched ${dispatchInvoice.invoiceNo}`, 'success');
      setDispatchInvoice(null);
      setVehicleNo('');
      setDispatchNotes('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to record dispatch', 'error');
    }
  };

  const handleCancelInvoice = async (inv: any) => {
    try {
      const res = await apiRequest<{ creditNote: { invoiceNo: string } }>(
        `/api/invoices/${inv.id}/cancel`,
        { method: 'POST' }
      );
      showToast(
        `Invoice cancelled via Credit Note ${res.creditNote.invoiceNo}; stock restored`,
        'info'
      );
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Cancellation failed', 'error');
    }
  };

  const handlePartialReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnInvoice) return;
    const items = returnInvoice.lines
      .map((l: any) => ({
        productId: l.productId,
        returnQty: returnQtyMap[l.productId] || 0,
      }))
      .filter((i: any) => i.returnQty > 0);

    if (items.length === 0) {
      showToast('Enter at least one positive return quantity', 'error');
      return;
    }

    setSavingReturn(true);
    try {
      const res = await apiRequest<{ creditNote: { invoiceNo: string } }>(
        `/api/invoices/${returnInvoice.id}/partial-return`,
        {
          method: 'POST',
          body: JSON.stringify({ items, restockGood, notes: returnNotes }),
        }
      );
      showToast(`Sales Return Credit Note ${res.creditNote.invoiceNo} issued`, 'success');
      setReturnInvoice(null);
      setReturnNotes('');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Sales return failed', 'error');
    } finally {
      setSavingReturn(false);
    }
  };

  const buildWhatsAppLink = (inv: any) => {
    const gstLine =
      inv.igstPaise > 0
        ? `IGST: ${formatINR(inv.igstPaise)}`
        : `CGST: ${formatINR(inv.cgstPaise)}, SGST: ${formatINR(inv.sgstPaise)}`;
    const text = `Kaveri Crunch Heritage Foods - GST Invoice ${inv.invoiceNo}\nCustomer: ${inv.customerName}\nDate: ${inv.invoiceDate}\nTaxable: ${formatINR(inv.taxableAmountPaise)}\n${gstLine}\nTotal: ${formatINR(inv.totalPaise)}\nBalance Due: ${formatINR(inv.outstandingPaise)}`;
    const phone = (inv.customerPhone || '').replace(/\D/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="space-y-6">
      {/* Invoices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-900">
              GST Tax Invoices &amp; Credit Notes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatic CGST+SGST (TN 33) vs IGST (Inter-state) with Credit Note audit trail
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">{invoices.length} document(s)</span>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No invoices generated yet. Approve and invoice an order from Field Orders.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {invoices.map((inv) => {
              const isCn = inv.invoiceType === 'credit_note';
              const isCancelled = inv.status === 'cancelled';

              return (
                <div key={inv.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono font-semibold text-slate-900">
                          {inv.invoiceNo}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-medium text-slate-900">{inv.customerName}</span>
                        {isCn && (
                          <span className="text-xs font-medium text-red-700">· Credit Note</span>
                        )}
                        {isCancelled && (
                          <span className="text-xs font-medium text-red-600">· Cancelled</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {inv.invoiceDate} · GSTIN: {inv.customerGstin || 'URD'} · POS State{' '}
                        {inv.placeOfSupplyStateCode} ·{' '}
                        {inv.dispatched
                          ? `Dispatched (${inv.dispatch?.dispatchDate}${
                              inv.dispatch?.vehicleNo ? ` · ${inv.dispatch.vehicleNo}` : ''
                            })`
                          : 'Awaiting Dispatch'}
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-base font-semibold text-slate-900">
                        {formatINR(inv.totalPaise)}
                      </div>
                      <div className="text-xs text-slate-500">
                        Taxable {formatINR(inv.taxableAmountPaise)} ·{' '}
                        {inv.igstPaise > 0
                          ? `IGST ${formatINR(inv.igstPaise)}`
                          : `CGST ${formatINR(inv.cgstPaise)} + SGST ${formatINR(inv.sgstPaise)}`}
                      </div>
                      {!isCn && !isCancelled && (
                        <div className="text-xs mt-1">
                          Paid{' '}
                          <span className="text-emerald-700">{formatINR(inv.paidPaise)}</span> ·{' '}
                          Outstanding{' '}
                          <span
                            className={
                              inv.outstandingPaise > 0
                                ? 'text-amber-700 font-semibold'
                                : 'text-emerald-700 font-semibold'
                            }
                          >
                            {formatINR(inv.outstandingPaise)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => handleDownloadPdf(inv)}
                      className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PDF</span>
                    </button>

                    <a
                      href={buildWhatsAppLink(inv)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>

                    {!isCn && !isCancelled && !inv.dispatched && (
                      <button
                        onClick={() => setDispatchInvoice(inv)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
                      >
                        <Truck className="w-3.5 h-3.5" />
                        <span>Record Dispatch</span>
                      </button>
                    )}

                    {!isCn && !isCancelled && inv.outstandingPaise > 0 && (
                      <button
                        onClick={() => {
                          setPayInvoice(inv);
                          setPayAmountRupees((inv.outstandingPaise / 100).toFixed(2));
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-amber-700 text-white rounded-lg hover:bg-amber-800 flex items-center gap-1.5"
                      >
                        <IndianRupee className="w-3.5 h-3.5" />
                        <span>Record Payment</span>
                      </button>
                    )}

                    {!isCn && !isCancelled && (
                      <>
                        <button
                          onClick={() => {
                            const initMap: Record<number, number> = {};
                            inv.lines.forEach((l: any) => (initMap[l.productId] = 0));
                            setReturnQtyMap(initMap);
                            setRestockGood(true);
                            setReturnInvoice(inv);
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Sales Return</span>
                        </button>
                        <button
                          onClick={() => handleCancelInvoice(inv)}
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Cancel (Credit Note)</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payments Collection Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display font-semibold text-sm text-slate-900">
            Collections &amp; Payment Receipts
          </h3>
        </div>
        {payments.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No payments recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5">Date</th>
                  <th className="py-2.5 px-4">Invoice</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Mode</th>
                  <th className="py-2.5 px-4">Ref No</th>
                  <th className="py-2.5 px-5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-5 font-mono text-xs text-slate-600">{p.paymentDate}</td>
                    <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900">
                      {p.invoiceNo}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">{p.customerName}</td>
                    <td className="py-2.5 px-4 uppercase text-xs text-slate-600">{p.mode}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                      {p.referenceNo || '—'}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono font-semibold text-emerald-700">
                      {formatINR(p.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {payInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900">
                Record Payment · {payInvoice.invoiceNo}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {payInvoice.customerName} · Remaining Balance:{' '}
                <span className="font-mono font-semibold text-slate-800">
                  {formatINR(payInvoice.outstandingPaise)}
                </span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Amount Received (INR)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={(payInvoice.outstandingPaise / 100).toFixed(2)}
                value={payAmountRupees}
                onChange={(e) => setPayAmountRupees(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="upi">UPI</option>
                  <option value="bank">Bank / NEFT</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reference / UTR
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UTR / Receipt #"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayInvoice(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPay}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                {savingPay ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dispatch Modal */}
      {dispatchInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleDispatch}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900">
                Record Dispatch · {dispatchInvoice.invoiceNo}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{dispatchInvoice.customerName}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Vehicle / LR Number
              </label>
              <input
                type="text"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
                placeholder="e.g. TN-45-AB-2041"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Dispatch Notes
              </label>
              <input
                type="text"
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                placeholder="Dispatched via Trichy local carrier"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDispatchInvoice(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Confirm Dispatch
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Partial Sales Return Modal */}
      {returnInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handlePartialReturnSubmit}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div>
              <h3 className="font-display font-semibold text-base text-slate-900">
                Sales Return · {returnInvoice.invoiceNo}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {returnInvoice.customerName} · Generates a GST Credit Note
              </p>
            </div>

            <div className="space-y-2">
              {returnInvoice.lines.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-medium text-slate-900">{l.productName}</div>
                    <div className="text-slate-500">Invoiced: {l.qty} pkts @ {formatINR(l.pricePaise)}</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={l.qty}
                    value={returnQtyMap[l.productId] ?? 0}
                    onChange={(e) =>
                      setReturnQtyMap({
                        ...returnQtyMap,
                        [l.productId]: Math.min(l.qty, Math.max(0, Number(e.target.value))),
                      })
                    }
                    className="w-24 px-2.5 py-1.5 font-mono text-right border border-slate-300 rounded-lg"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={restockGood}
                onChange={(e) => setRestockGood(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Restock returned packets as sellable finished inventory</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Return Reason</label>
              <input
                type="text"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="e.g. Transit damage or unsold expiry return"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReturnInvoice(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReturn}
                className="px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
              >
                {savingReturn ? 'Issuing Credit Note...' : 'Issue Credit Note'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
