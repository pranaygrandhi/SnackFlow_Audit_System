import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileCode2 } from 'lucide-react';
import { apiRequest, downloadAuthorizedFile, formatINR, formatQty } from '../api/client.ts';
import { useToast } from '../contexts/ToastContext.tsx';

type ReportTab = 'sales' | 'gst' | 'purchases' | 'production' | 'stock' | 'receivables' | 'statement';

export function ReportsPage({ refreshKey }: { refreshKey: number }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<ReportTab>('sales');
  const [loading, setLoading] = useState(true);

  const [salesRegister, setSalesRegister] = useState<any[]>([]);
  const [gstB2B, setGstB2B] = useState<any[]>([]);
  const [gstHsn, setGstHsn] = useState<any[]>([]);
  const [purchaseRegister, setPurchaseRegister] = useState<any[]>([]);
  const [productionReport, setProductionReport] = useState<any[]>([]);
  const [stockSummary, setStockSummary] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  // Customer statement
  const [stmtCustomerId, setStmtCustomerId] = useState<number>(0);
  const [stmtData, setStmtData] = useState<{ entries: any[]; closingBalancePaise: number } | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadStatement = useCallback(async (cid: number) => {
    if (!cid) return;
    try {
      const res = await apiRequest<{ entries: any[]; closingBalancePaise: number }>(
        `/api/reports/customer-statement/${cid}`
      );
      setStmtData(res);
    } catch (err: any) {
      showToast(err.message || 'Failed to load customer statement', 'error');
    }
  }, [showToast]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const query = qs.toString() ? `?${qs.toString()}` : '';

      const [sr, gst, pr, prod, stk, rec, custRes] = await Promise.all([
        apiRequest<{ salesRegister: any[] }>(`/api/reports/sales-register${query}`),
        apiRequest<{ b2bSummary: any[]; hsnSummary: any[] }>('/api/reports/gst-summary'),
        apiRequest<{ purchaseRegister: any[] }>('/api/reports/purchase-register'),
        apiRequest<{ productionReport: any[] }>('/api/reports/production'),
        apiRequest<{ stockSummary: any[] }>('/api/reports/stock-summary'),
        apiRequest<{ receivables: any[] }>('/api/reports/receivables'),
        apiRequest<{ customers: any[] }>('/api/masters/customers'),
      ]);

      setSalesRegister(sr.salesRegister);
      setGstB2B(gst.b2bSummary);
      setGstHsn(gst.hsnSummary);
      setPurchaseRegister(pr.purchaseRegister);
      setProductionReport(prod.productionReport);
      setStockSummary(stk.stockSummary);
      setReceivables(rec.receivables);
      setCustomers(custRes.customers);

      if (custRes.customers.length > 0) {
        const cid = stmtCustomerId || custRes.customers[0].id;
        setStmtCustomerId(cid);
        await loadStatement(cid);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load auditor reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, loadStatement, showToast, stmtCustomerId, toDate]);

  useEffect(() => {
    loadReports();
  }, [refreshKey]);

  const exportFile = async (endpoint: string, filename: string) => {
    try {
      await downloadAuthorizedFile(endpoint, filename);
    } catch (err: any) {
      showToast(err.message || 'Export failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(
            [
              ['sales', 'Sales Register'],
              ['gst', 'GSTR-1 Summary'],
              ['purchases', 'Purchase Register'],
              ['production', 'Production Cost'],
              ['stock', 'Stock Valuation'],
              ['receivables', 'Receivables'],
              ['statement', 'Party Ledger'],
            ] as [ReportTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => exportFile('/api/reports/tally-xml', 'kaveri-crunch-tally-vouchers.xml')}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
          >
            <FileCode2 className="w-3.5 h-3.5 text-amber-700" />
            <span>Tally XML</span>
          </button>

          {tab === 'sales' && (
            <>
              <button
                onClick={() => exportFile('/api/reports/sales-register?format=csv', 'sales-register.csv')}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => exportFile('/api/reports/sales-register?format=pdf', 'sales-register.pdf')}
                className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
            </>
          )}
          {tab === 'gst' && (
            <>
              <button
                onClick={() => exportFile('/api/reports/gst-summary?format=csv', 'gstr1-summary.csv')}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => exportFile('/api/reports/gst-summary?format=pdf', 'gstr1-summary.pdf')}
                className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
            </>
          )}
          {tab === 'stock' && (
            <>
              <button
                onClick={() => exportFile('/api/reports/stock-summary?format=csv', 'stock-summary.csv')}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => exportFile('/api/reports/stock-summary?format=pdf', 'stock-summary.pdf')}
                className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
            </>
          )}
          {tab === 'purchases' && (
            <button
              onClick={() => exportFile('/api/reports/purchase-register?format=csv', 'purchase-register.csv')}
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
          {tab === 'production' && (
            <button
              onClick={() => exportFile('/api/reports/production?format=csv', 'production-report.csv')}
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
          {tab === 'receivables' && (
            <button
              onClick={() => exportFile('/api/reports/receivables?format=csv', 'receivables-ageing.csv')}
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
          {tab === 'statement' && stmtCustomerId > 0 && (
            <button
              onClick={() =>
                exportFile(
                  `/api/reports/customer-statement/${stmtCustomerId}?format=csv`,
                  `statement-customer-${stmtCustomerId}.csv`
                )
              }
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Compiling auditor reports...
        </div>
      ) : (
        <>
          {tab === 'sales' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Sales Register
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Filterable tax invoice &amp; credit note register
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Invoice No</th>
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Customer</th>
                      <th className="py-2.5 px-4">POS</th>
                      <th className="py-2.5 px-4 text-right">Taxable</th>
                      <th className="py-2.5 px-4 text-right">CGST</th>
                      <th className="py-2.5 px-4 text-right">SGST</th>
                      <th className="py-2.5 px-4 text-right">IGST</th>
                      <th className="py-2.5 px-4 text-right">Total</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesRegister.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-500">
                          No invoices recorded in this range.
                        </td>
                      </tr>
                    ) : (
                      salesRegister.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900">
                            {r.invoiceNo}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{r.invoiceDate}</td>
                          <td className="py-2.5 px-4 text-slate-900">{r.customerName}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                            {r.placeOfSupplyStateCode}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.taxableAmountPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.cgstPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.sgstPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.igstPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                            {formatINR(r.totalPaise)}
                          </td>
                          <td className="py-2.5 px-4 text-xs capitalize text-slate-600">{r.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'gst' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    GSTR-1 B2B Customer-Wise Summary
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4">GSTIN</th>
                        <th className="py-2.5 px-4">POS</th>
                        <th className="py-2.5 px-4 text-right">Docs</th>
                        <th className="py-2.5 px-4 text-right">Taxable</th>
                        <th className="py-2.5 px-4 text-right">CGST</th>
                        <th className="py-2.5 px-4 text-right">SGST</th>
                        <th className="py-2.5 px-4 text-right">IGST</th>
                        <th className="py-2.5 px-4 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gstB2B.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            No active GST invoices yet.
                          </td>
                        </tr>
                      ) : (
                        gstB2B.map((b) => (
                          <tr key={b.customerId}>
                            <td className="py-2.5 px-4 font-medium text-slate-900">{b.customerName}</td>
                            <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{b.gstin}</td>
                            <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{b.stateCode}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{b.invoiceCount}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(b.taxablePaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(b.cgstPaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(b.sgstPaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(b.igstPaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                              {formatINR(b.totalPaise)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    GSTR-1 HSN &amp; Rate-Wise Summary
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">HSN Code</th>
                        <th className="py-2.5 px-4 text-right">GST Rate %</th>
                        <th className="py-2.5 px-4 text-right">Total Qty</th>
                        <th className="py-2.5 px-4 text-right">Taxable</th>
                        <th className="py-2.5 px-4 text-right">CGST</th>
                        <th className="py-2.5 px-4 text-right">SGST</th>
                        <th className="py-2.5 px-4 text-right">IGST</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gstHsn.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No HSN line data yet.
                          </td>
                        </tr>
                      ) : (
                        gstHsn.map((h, i) => (
                          <tr key={i}>
                            <td className="py-2.5 px-4 font-mono text-xs font-semibold">{h.hsnCode}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{h.gstRatePct}%</td>
                            <td className="py-2.5 px-4 text-right font-mono">{h.totalQty}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(h.taxablePaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(h.cgstPaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(h.sgstPaise)}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{formatINR(h.igstPaise)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'purchases' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-display font-semibold text-sm text-slate-900">
                  Purchase Register
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Supplier Invoice</th>
                      <th className="py-2.5 px-4">Supplier</th>
                      <th className="py-2.5 px-4">GSTIN</th>
                      <th className="py-2.5 px-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchaseRegister.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No purchases recorded yet.
                        </td>
                      </tr>
                    ) : (
                      purchaseRegister.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 px-4 font-mono text-xs">{p.purchaseDate}</td>
                          <td className="py-2.5 px-4 font-mono text-xs font-semibold">{p.invoiceNo}</td>
                          <td className="py-2.5 px-4">{p.supplierName}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                            {p.supplierGstin || 'URD'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold">
                            {formatINR(p.totalPaise)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'production' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-display font-semibold text-sm text-slate-900">
                  Production Yield &amp; Cost Report
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Run No</th>
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Product</th>
                      <th className="py-2.5 px-4 text-right">Expected</th>
                      <th className="py-2.5 px-4 text-right">Actual</th>
                      <th className="py-2.5 px-4 text-right">Yield Var %</th>
                      <th className="py-2.5 px-4 text-right">Total Cost</th>
                      <th className="py-2.5 px-4 text-right">Cost / Pkt</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {productionReport.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-500">
                          No production runs recorded yet.
                        </td>
                      </tr>
                    ) : (
                      productionReport.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 px-4 font-mono text-xs font-semibold">{r.runNo}</td>
                          <td className="py-2.5 px-4 font-mono text-xs">{r.runDate}</td>
                          <td className="py-2.5 px-4">{r.productName}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatQty(r.expectedOutput)}</td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatQty(r.actualOutput)}</td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono ${
                              r.yieldFlagged ? 'text-amber-700 font-semibold' : ''
                            }`}
                          >
                            {r.yieldVariancePct}%
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.totalCostPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold">
                            {formatINR(r.costPerPacketPaise)}
                          </td>
                          <td className="py-2.5 px-4 text-xs capitalize">{r.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'stock' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-display font-semibold text-sm text-slate-900">
                  Stock Summary &amp; FIFO Inventory Valuation
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Closing quantities from ledger SUM(qty); raw materials valued at FIFO batch rates
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4">Item</th>
                      <th className="py-2.5 px-4 text-right">Closing Balance</th>
                      <th className="py-2.5 px-4 text-right">Reorder Level</th>
                      <th className="py-2.5 px-4 text-right">Valuation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockSummary.map((s, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-4 text-xs text-slate-500">{s.category}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{s.name}</td>
                        <td className="py-2.5 px-4 text-right font-mono">
                          {formatQty(s.balance)} {s.unit}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500">
                          {s.reorderLevel > 0 ? `${formatQty(s.reorderLevel)} ${s.unit}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                          {formatINR(s.valuationPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'receivables' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="font-display font-semibold text-sm text-slate-900">
                  Customer Outstanding &amp; Ageing Schedule
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Customer</th>
                      <th className="py-2.5 px-4 text-right">Billed</th>
                      <th className="py-2.5 px-4 text-right">Collected</th>
                      <th className="py-2.5 px-4 text-right">Outstanding</th>
                      <th className="py-2.5 px-4 text-right">0–30d</th>
                      <th className="py-2.5 px-4 text-right">31–60d</th>
                      <th className="py-2.5 px-4 text-right">61–90d</th>
                      <th className="py-2.5 px-4 text-right">90d+</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivables.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-500">
                          No customer receivables recorded yet.
                        </td>
                      </tr>
                    ) : (
                      receivables.map((r) => (
                        <tr key={r.customerId}>
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {r.customerName}
                            <span className="block text-[11px] text-slate-500 capitalize font-normal">
                              {r.customerType} · {r.stateName}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono">{formatINR(r.totalBilledPaise)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-emerald-700">
                            {formatINR(r.totalPaidPaise)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-amber-700">
                            {formatINR(r.outstandingPaise)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{formatINR(r.bucket0_30)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{formatINR(r.bucket31_60)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{formatINR(r.bucket61_90)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{formatINR(r.bucket90Plus)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'statement' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Customer Account Statement (Party Ledger)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chronological invoices, credit notes, and receipts with running balance
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={stmtCustomerId}
                    onChange={(e) => {
                      const cid = Number(e.target.value);
                      setStmtCustomerId(cid);
                      loadStatement(cid);
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {stmtData && (
                    <div className="text-xs font-mono font-semibold text-slate-900">
                      Closing: {formatINR(stmtData.closingBalancePaise)}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Document</th>
                      <th className="py-2.5 px-4">Type</th>
                      <th className="py-2.5 px-4">Notes</th>
                      <th className="py-2.5 px-4 text-right">Debit</th>
                      <th className="py-2.5 px-4 text-right">Credit</th>
                      <th className="py-2.5 px-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!stmtData || stmtData.entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No ledger transactions for this customer yet.
                        </td>
                      </tr>
                    ) : (
                      stmtData.entries.map((e, i) => (
                        <tr key={i}>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{e.date}</td>
                          <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900">
                            {e.docNo}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-700">{e.type}</td>
                          <td className="py-2.5 px-4 text-xs text-slate-500">{e.notes}</td>
                          <td className="py-2.5 px-4 text-right font-mono">
                            {e.debitPaise > 0 ? formatINR(e.debitPaise) : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-emerald-700">
                            {e.creditPaise > 0 ? formatINR(e.creditPaise) : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                            {formatINR(e.balancePaise)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
