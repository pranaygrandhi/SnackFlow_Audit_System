import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { apiRequest, formatINR, formatQty } from '../api/client.ts';
import { useToast } from '../contexts/ToastContext.tsx';

type MasterTab = 'products' | 'customers' | 'suppliers' | 'pricelists';

export function MastersPage({ refreshKey }: { refreshKey: number }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<MasterTab>('products');
  const [loading, setLoading] = useState(true);

  const [products, setProducts] = useState<any[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [priceLists, setPriceLists] = useState<any[]>([]);

  // Product form
  const [sku, setSku] = useState('');
  const [prodName, setProdName] = useState('');
  const [packSizeG, setPackSizeG] = useState('200');
  const [hsnCode, setHsnCode] = useState('21069099');
  const [sellingRupees, setSellingRupees] = useState('50');
  const [gstRate, setGstRate] = useState('5');
  const [batchOutQty, setBatchOutQty] = useState('200');

  // BOM Editor
  const [bomProductId, setBomProductId] = useState<number>(0);
  const [bomRows, setBomRows] = useState<Array<{ rawMaterialId: number; qtyPerBatch: number; unit: string }>>([]);
  const [savingBom, setSavingBom] = useState(false);

  // Customer form
  const [custName, setCustName] = useState('');
  const [custType, setCustType] = useState('retailer');
  const [custGstin, setCustGstin] = useState('');
  const [custStateCode, setCustStateCode] = useState('33');
  const [custStateName, setCustStateName] = useState('Tamil Nadu');
  const [custAddress, setCustAddress] = useState('');
  const [custPhone, setCustPhone] = useState('');

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supGstin, setSupGstin] = useState('');
  const [supStateCode, setSupStateCode] = useState('33');
  const [supAddress, setSupAddress] = useState('');
  const [supPhone, setSupPhone] = useState('');

  // Price list form
  const [plProductId, setPlProductId] = useState<number>(0);
  const [plCustomerId, setPlCustomerId] = useState<string>('');
  const [plRupees, setPlRupees] = useState<string>('48');

  const loadBom = useCallback(async (prodId: number) => {
    try {
      const res = await apiRequest<{ bomLines: any[] }>(`/api/masters/bom/${prodId}`);
      setBomRows(
        res.bomLines.map((b) => ({
          rawMaterialId: b.rawMaterialId,
          qtyPerBatch: Number(b.qtyPerBatch),
          unit: b.unit,
        }))
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to load BOM', 'error');
    }
  }, [showToast]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, rmRes, cRes, sRes, plRes] = await Promise.all([
        apiRequest<{ products: any[] }>('/api/masters/products'),
        apiRequest<{ rawMaterials: any[] }>('/api/masters/raw-materials'),
        apiRequest<{ customers: any[] }>('/api/masters/customers'),
        apiRequest<{ suppliers: any[] }>('/api/masters/suppliers'),
        apiRequest<{ priceLists: any[] }>('/api/masters/price-lists'),
      ]);
      setProducts(pRes.products);
      setRawMaterials(rmRes.rawMaterials);
      setCustomers(cRes.customers);
      setSuppliers(sRes.suppliers);
      setPriceLists(plRes.priceLists);

      if (pRes.products.length > 0) {
        const targetProd = bomProductId || pRes.products[0].id;
        setBomProductId(targetProd);
        if (!plProductId) setPlProductId(pRes.products[0].id);
        await loadBom(targetProd);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load masters', 'error');
    } finally {
      setLoading(false);
    }
  }, [bomProductId, loadBom, plProductId, showToast]);

  useEffect(() => {
    loadAll();
  }, [refreshKey]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/masters/products', {
        method: 'POST',
        body: JSON.stringify({
          sku,
          name: prodName,
          packSizeG: Number(packSizeG),
          hsnCode,
          sellingPricePaise: Math.round(Number(sellingRupees) * 100),
          gstRatePct: Number(gstRate),
          batchOutputQty: Number(batchOutQty),
        }),
      });
      showToast('Product added', 'success');
      setSku('');
      setProdName('');
      await loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to add product', 'error');
    }
  };

  const handleSaveBom = async () => {
    if (!bomProductId || bomRows.length === 0) return;
    setSavingBom(true);
    try {
      await apiRequest(`/api/masters/bom/${bomProductId}`, {
        method: 'PUT',
        body: JSON.stringify({ lines: bomRows }),
      });
      showToast('BOM recipe saved', 'success');
      await loadBom(bomProductId);
    } catch (err: any) {
      showToast(err.message || 'Failed to save BOM', 'error');
    } finally {
      setSavingBom(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/masters/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: custName,
          type: custType,
          gstin: custGstin,
          stateCode: custStateCode,
          stateName: custStateName,
          address: custAddress,
          phone: custPhone,
        }),
      });
      showToast('Customer added', 'success');
      setCustName('');
      setCustGstin('');
      setCustAddress('');
      setCustPhone('');
      await loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to add customer', 'error');
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/masters/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: supName,
          gstin: supGstin,
          stateCode: supStateCode,
          address: supAddress,
          phone: supPhone,
        }),
      });
      showToast('Supplier added', 'success');
      setSupName('');
      setSupGstin('');
      setSupAddress('');
      setSupPhone('');
      await loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to add supplier', 'error');
    }
  };

  const handleCreatePriceList = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/masters/price-lists', {
        method: 'POST',
        body: JSON.stringify({
          productId: plProductId,
          customerId: plCustomerId ? Number(plCustomerId) : null,
          pricePaise: Math.round(Number(plRupees) * 100),
        }),
      });
      showToast('Custom price rule saved', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to save price rule', 'error');
    }
  };

  const handleDeletePriceList = async (id: number) => {
    try {
      await apiRequest(`/api/masters/price-lists/${id}`, { method: 'DELETE' });
      showToast('Price rule removed', 'info');
      await loadAll();
    } catch (err: any) {
      showToast(err.message || 'Failed to remove price rule', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            ['products', 'Products & BOM Recipes'],
            ['customers', 'Customers'],
            ['suppliers', 'Suppliers'],
            ['pricelists', 'Customer Price Lists'],
          ] as [MasterTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">
          Loading master catalog...
        </div>
      ) : (
        <>
          {tab === 'products' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Products List + Add Form */}
              <div className="lg:col-span-6 space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h2 className="font-display font-semibold text-sm text-slate-900">
                      Finished Products Catalog
                    </h2>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                        <th className="py-2.5 px-4">Product</th>
                        <th className="py-2.5 px-4">HSN / GST</th>
                        <th className="py-2.5 px-4 text-right">Batch</th>
                        <th className="py-2.5 px-4 text-right">Selling Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {products.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {p.name}
                            <span className="block font-mono text-[11px] text-slate-500 font-normal">
                              {p.sku} · {p.packSizeG}g
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                            {p.hsnCode} · {p.gstRatePct}%
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600">
                            {p.batchOutputQty} pkts
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                            {formatINR(p.sellingPricePaise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form
                  onSubmit={handleCreateProduct}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                >
                  <h3 className="font-display font-semibold text-sm text-slate-900">
                    Add New Finished Product
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">SKU</label>
                      <input
                        type="text"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder="e.g. OMAP-200"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Product Name
                      </label>
                      <input
                        type="text"
                        value={prodName}
                        onChange={(e) => setProdName(e.target.value)}
                        placeholder="e.g. Omapodi 200g"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Pack (g)</label>
                      <input
                        type="number"
                        value={packSizeG}
                        onChange={(e) => setPackSizeG(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">HSN</label>
                      <input
                        type="text"
                        value={hsnCode}
                        onChange={(e) => setHsnCode(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Price (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={sellingRupees}
                        onChange={(e) => setSellingRupees(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GST %</label>
                      <input
                        type="number"
                        step="0.5"
                        value={gstRate}
                        onChange={(e) => setGstRate(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Batch Pkts</label>
                      <input
                        type="number"
                        value={batchOutQty}
                        onChange={(e) => setBatchOutQty(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                    >
                      Save Product
                    </button>
                  </div>
                </form>
              </div>

              {/* BOM Recipe Editor */}
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <h2 className="font-display font-semibold text-sm text-slate-900">
                      Bill of Materials (BOM) Editor
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Standard raw material recipe per 1 production batch
                    </p>
                  </div>
                  <select
                    value={bomProductId}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setBomProductId(id);
                      loadBom(id);
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  {bomRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={row.rawMaterialId}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          const mat = rawMaterials.find((m) => m.id === id);
                          setBomRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, rawMaterialId: id, unit: mat ? mat.unit : r.unit }
                                : r
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
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={row.qtyPerBatch}
                        onChange={(e) =>
                          setBomRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, qtyPerBatch: Number(e.target.value) } : r
                            )
                          )
                        }
                        className="w-28 px-2.5 py-2 text-sm font-mono text-right border border-slate-300 rounded-lg"
                      />
                      <span className="text-xs text-slate-500 w-10">{row.unit}</span>
                      <button
                        type="button"
                        onClick={() => setBomRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      if (rawMaterials.length === 0) return;
                      const m = rawMaterials[0];
                      setBomRows([...bomRows, { rawMaterialId: m.id, qtyPerBatch: 1, unit: m.unit }]);
                    }}
                    className="text-xs font-medium text-amber-700 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Ingredient</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveBom}
                    disabled={savingBom}
                    className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingBom ? 'Saving...' : 'Save BOM Recipe'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'customers' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Registered Customers &amp; Distributors
                  </h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Customer</th>
                      <th className="py-2.5 px-4">Type</th>
                      <th className="py-2.5 px-4">GSTIN</th>
                      <th className="py-2.5 px-4">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {c.name}
                          <span className="block text-[11px] text-slate-500 font-normal">
                            {c.address}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs capitalize text-slate-600">{c.type}</td>
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-700">
                          {c.gstin || 'Unregistered'}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">
                          {c.stateName} (<span className="font-mono">{c.stateCode}</span>)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form
                onSubmit={handleCreateCustomer}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <h3 className="font-display font-semibold text-sm text-slate-900">
                  Add Customer
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Business Name</label>
                  <input
                    type="text"
                    value={custName}
                    onChange={(e) => setCustName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Channel Type</label>
                    <select
                      value={custType}
                      onChange={(e) => setCustType(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="retailer">Retailer</option>
                      <option value="distributor">Distributor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
                    <input
                      type="text"
                      value={custGstin}
                      onChange={(e) => setCustGstin(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">State Code</label>
                    <input
                      type="text"
                      value={custStateCode}
                      onChange={(e) => setCustStateCode(e.target.value)}
                      placeholder="33=TN, 29=KA"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">State Name</label>
                    <input
                      type="text"
                      value={custStateName}
                      onChange={(e) => setCustStateName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={custAddress}
                    onChange={(e) => setCustAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone (WhatsApp)</label>
                  <input
                    type="text"
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                    placeholder="+91 ..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  Save Customer
                </button>
              </form>
            </div>
          )}

          {tab === 'suppliers' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Raw Material &amp; Packaging Suppliers
                  </h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Supplier</th>
                      <th className="py-2.5 px-4">GSTIN</th>
                      <th className="py-2.5 px-4">State</th>
                      <th className="py-2.5 px-4">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {s.name}
                          <span className="block text-[11px] text-slate-500 font-normal">
                            {s.address}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs">{s.gstin || '—'}</td>
                        <td className="py-2.5 px-4 font-mono text-xs">{s.stateCode}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">{s.phone || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form
                onSubmit={handleCreateSupplier}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <h3 className="font-display font-semibold text-sm text-slate-900">
                  Add Supplier
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Supplier Name</label>
                  <input
                    type="text"
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
                    <input
                      type="text"
                      value={supGstin}
                      onChange={(e) => setSupGstin(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">State Code</label>
                    <input
                      type="text"
                      value={supStateCode}
                      onChange={(e) => setSupStateCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={supAddress}
                    onChange={(e) => setSupAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  Save Supplier
                </button>
              </form>
            </div>
          )}

          {tab === 'pricelists' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="font-display font-semibold text-sm text-slate-900">
                    Customer &amp; Channel Price Lists
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Customer-specific rates override default product prices during field order entry
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Product</th>
                      <th className="py-2.5 px-4">Customer</th>
                      <th className="py-2.5 px-4 text-right">Base Price</th>
                      <th className="py-2.5 px-4 text-right">List Price</th>
                      <th className="py-2.5 px-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priceLists.map((pl) => (
                      <tr key={pl.id}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{pl.productName}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-700">{pl.customerName}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-500">
                          {formatINR(pl.basePricePaise)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                          {formatINR(pl.pricePaise)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => handleDeletePriceList(pl.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600"
                            aria-label="Delete price rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form
                onSubmit={handleCreatePriceList}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <h3 className="font-display font-semibold text-sm text-slate-900">
                  Assign Customer Rate
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Product</label>
                  <select
                    value={plProductId}
                    onChange={(e) => setPlProductId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Base {formatINR(p.sellingPricePaise)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Customer (Optional = Default)
                  </label>
                  <select
                    value={plCustomerId}
                    onChange={(e) => setPlCustomerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Default (All Customers)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Rate per Packet (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={plRupees}
                    onChange={(e) => setPlRupees(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                >
                  Save Price Rule
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
