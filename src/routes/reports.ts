import { Router } from 'express';
import { asc, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  customers,
  invoiceLines,
  invoices,
  orders,
  payments,
  productionRunIssues,
  productionRuns,
  products,
  purchases,
  rawMaterialBatches,
  rawMaterials,
  suppliers,
} from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { formatPaise } from '../services/gstService.ts';
import { getStockBalancesMap } from '../services/stockService.ts';
import { buildTabularReportPdf } from '../utils/pdfBuilder.ts';

const router = Router();

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

router.get('/dashboard', requireAuth, async (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const allOrders = await db.select().from(orders).orderBy(desc(orders.id));
    const todaysOrders = allOrders.filter((o) => o.orderDate === today);

    const rawMats = await db.select().from(rawMaterials);
    const rawBalances = await getStockBalancesMap('raw');
    const lowStockAlerts = rawMats
      .map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        balance: rawBalances.get(m.id) ?? 0,
        reorderLevel: Number(m.reorderLevel),
      }))
      .filter((m) => m.balance <= m.reorderLevel);

    const finishedProds = await db.select().from(products);
    const finishedBalances = await getStockBalancesMap('finished');
    const finishedSummary = finishedProds.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      balance: finishedBalances.get(p.id) ?? 0,
      sellingPricePaise: p.sellingPricePaise,
    }));

    const runs = await db
      .select({
        id: productionRuns.id,
        runNo: productionRuns.runNo,
        productName: products.name,
        runDate: productionRuns.runDate,
        actualOutput: productionRuns.actualOutput,
        expectedOutput: productionRuns.expectedOutput,
        costPerPacketPaise: productionRuns.costPerPacketPaise,
        yieldVariancePct: productionRuns.yieldVariancePct,
        yieldFlagged: productionRuns.yieldFlagged,
        status: productionRuns.status,
      })
      .from(productionRuns)
      .innerJoin(products, eq(productionRuns.productId, products.id))
      .orderBy(desc(productionRuns.id));

    const flaggedIssues = await db
      .select({
        id: productionRunIssues.id,
        productionRunId: productionRunIssues.productionRunId,
        materialName: rawMaterials.name,
        variancePct: productionRunIssues.variancePct,
        flagged: productionRunIssues.flagged,
      })
      .from(productionRunIssues)
      .innerJoin(rawMaterials, eq(productionRunIssues.rawMaterialId, rawMaterials.id))
      .where(eq(productionRunIssues.flagged, true));

    const activeInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, 'active'));
    const allPayments = await db.select().from(payments);

    const taxInvoices = activeInvoices.filter((i) => i.invoiceType === 'tax_invoice');
    const todaysTaxInvoices = taxInvoices.filter((i) => i.invoiceDate === today);
    const dailySalesPaise = todaysTaxInvoices.reduce((s, i) => s + i.totalPaise, 0);
    const totalSalesPaise = taxInvoices.reduce((s, i) => s + i.totalPaise, 0);
    const totalCollectedPaise = allPayments.reduce((s, p) => s + p.amountPaise, 0);
    const totalOutstandingPaise = Math.max(0, totalSalesPaise - totalCollectedPaise);

    const submittedOrdersCount = allOrders.filter((o) => o.status === 'submitted').length;
    const approvedOrdersCount = allOrders.filter((o) => o.status === 'approved').length;

    const latestPostedRun = runs.find((r) => r.status === 'posted') || null;

    // FIFO inventory valuation + expiry alerts (within 90 days)
    const activeBatches = await db
      .select({
        id: rawMaterialBatches.id,
        rawMaterialId: rawMaterialBatches.rawMaterialId,
        materialName: rawMaterials.name,
        unit: rawMaterials.unit,
        qtyRemaining: rawMaterialBatches.qtyRemaining,
        ratePaise: rawMaterialBatches.ratePaise,
        batchNo: rawMaterialBatches.batchNo,
        expiryDate: rawMaterialBatches.expiryDate,
      })
      .from(rawMaterialBatches)
      .innerJoin(rawMaterials, eq(rawMaterialBatches.rawMaterialId, rawMaterials.id))
      .where(gt(rawMaterialBatches.qtyRemaining, '0'))
      .orderBy(asc(rawMaterialBatches.expiryDate));

    const totalRawValuePaise = activeBatches.reduce(
      (s, b) => s + Math.round(Number(b.qtyRemaining) * b.ratePaise),
      0
    );

    const todayDateMs = new Date().setHours(0, 0, 0, 0);
    const ninetyDaysMs = todayDateMs + 90 * 86400000;
    const expiringBatches = activeBatches
      .filter((b) => {
        if (!b.expiryDate) return false;
        const expMs = new Date(b.expiryDate).getTime();
        return expMs <= ninetyDaysMs;
      })
      .map((b) => ({
        ...b,
        daysLeft: Math.ceil((new Date(b.expiryDate!).getTime() - todayDateMs) / 86400000),
      }));

    res.json({
      asOfDate: today,
      todaysOrderCount: todaysOrders.length,
      totalOrdersCount: allOrders.length,
      pendingOrdersCount: submittedOrdersCount + approvedOrdersCount,
      submittedOrdersCount,
      approvedOrdersCount,
      lowStockAlerts,
      finishedSummary,
      latestPostedRun,
      expiringBatches,
      totalRawValuePaise,
      varianceAlerts: {
        yieldAlerts: runs.filter((r) => r.yieldFlagged),
        materialAlerts: flaggedIssues,
      },
      financials: {
        dailySalesPaise,
        todaysInvoiceCount: todaysTaxInvoices.length,
        totalSalesPaise,
        totalCollectedPaise,
        totalOutstandingPaise,
      },
    });
  } catch (error) {
    console.error('Error loading dashboard KPIs:', error);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

router.get('/sales-register', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
    const format = req.query.format as string | undefined;

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        invoiceType: invoices.invoiceType,
        invoiceDate: invoices.invoiceDate,
        customerId: invoices.customerId,
        customerName: customers.name,
        gstin: customers.gstin,
        placeOfSupplyStateCode: invoices.placeOfSupplyStateCode,
        taxableAmountPaise: invoices.taxableAmountPaise,
        cgstPaise: invoices.cgstPaise,
        sgstPaise: invoices.sgstPaise,
        igstPaise: invoices.igstPaise,
        totalPaise: invoices.totalPaise,
        status: invoices.status,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .orderBy(desc(invoices.invoiceDate), desc(invoices.id));

    const filtered = rows.filter((r) => {
      if (from && r.invoiceDate < from) return false;
      if (to && r.invoiceDate > to) return false;
      if (customerId && r.customerId !== customerId) return false;
      return true;
    });

    if (format === 'csv') {
      const csv = toCsv(
        ['Invoice No', 'Type', 'Date', 'Customer', 'GSTIN', 'POS', 'Taxable (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total (INR)', 'Status'],
        filtered.map((r) => [
          r.invoiceNo,
          r.invoiceType,
          r.invoiceDate,
          r.customerName,
          r.gstin || 'URD',
          r.placeOfSupplyStateCode,
          (r.taxableAmountPaise / 100).toFixed(2),
          (r.cgstPaise / 100).toFixed(2),
          (r.sgstPaise / 100).toFixed(2),
          (r.igstPaise / 100).toFixed(2),
          (r.totalPaise / 100).toFixed(2),
          r.status,
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-register.csv"');
      return res.send(csv);
    }

    if (format === 'pdf') {
      const pdf = await buildTabularReportPdf(
        'Sales Register (Auditor Report)',
        `Generated ${new Date().toISOString().slice(0, 10)} | Total Records: ${filtered.length}`,
        ['Invoice No', 'Date', 'Customer', 'GSTIN', 'POS', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Status'],
        filtered.map((r) => [
          r.invoiceNo,
          r.invoiceDate,
          r.customerName,
          r.gstin || 'URD',
          r.placeOfSupplyStateCode,
          formatPaise(r.taxableAmountPaise),
          formatPaise(r.cgstPaise),
          formatPaise(r.sgstPaise),
          formatPaise(r.igstPaise),
          formatPaise(r.totalPaise),
          r.status,
        ])
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-register.pdf"');
      return res.send(pdf);
    }

    res.json({ salesRegister: filtered });
  } catch (error) {
    console.error('Error generating sales register:', error);
    res.status(500).json({ error: 'Failed to generate sales register' });
  }
});

router.get('/gst-summary', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const format = req.query.format as string | undefined;

    const invs = await db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        invoiceType: invoices.invoiceType,
        invoiceDate: invoices.invoiceDate,
        customerId: invoices.customerId,
        customerName: customers.name,
        gstin: customers.gstin,
        stateCode: invoices.placeOfSupplyStateCode,
        taxableAmountPaise: invoices.taxableAmountPaise,
        cgstPaise: invoices.cgstPaise,
        sgstPaise: invoices.sgstPaise,
        igstPaise: invoices.igstPaise,
        totalPaise: invoices.totalPaise,
        status: invoices.status,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.status, 'active'));

    // B2B Customer-wise GSTR-1 grouping
    const b2bMap = new Map<
      number,
      {
        customerId: number;
        customerName: string;
        gstin: string;
        stateCode: string;
        invoiceCount: number;
        taxablePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
        totalPaise: number;
      }
    >();

    for (const inv of invs) {
      const sign = inv.invoiceType === 'credit_note' ? -1 : 1;
      const cur = b2bMap.get(inv.customerId) || {
        customerId: inv.customerId,
        customerName: inv.customerName,
        gstin: inv.gstin || 'Unregistered',
        stateCode: inv.stateCode,
        invoiceCount: 0,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 0,
      };
      cur.invoiceCount += 1;
      cur.taxablePaise += sign * inv.taxableAmountPaise;
      cur.cgstPaise += sign * inv.cgstPaise;
      cur.sgstPaise += sign * inv.sgstPaise;
      cur.igstPaise += sign * inv.igstPaise;
      cur.totalPaise += sign * inv.totalPaise;
      b2bMap.set(inv.customerId, cur);
    }

    // HSN / Rate-wise GSTR-1 grouping
    const activeIds = new Set(invs.map((i) => i.id));
    const typeById = new Map(invs.map((i) => [i.id, i.invoiceType]));
    const lines = await db.select().from(invoiceLines);
    const rateMap = new Map<
      string,
      {
        hsnCode: string;
        gstRatePct: string;
        totalQty: number;
        taxablePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
      }
    >();

    for (const l of lines) {
      if (!activeIds.has(l.invoiceId)) continue;
      const sign = typeById.get(l.invoiceId) === 'credit_note' ? -1 : 1;
      const key = `${l.hsnCode}|${l.gstRatePct}`;
      const cur = rateMap.get(key) || {
        hsnCode: l.hsnCode,
        gstRatePct: l.gstRatePct,
        totalQty: 0,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      };
      cur.totalQty += sign * l.qty;
      cur.taxablePaise += sign * l.taxablePaise;
      cur.cgstPaise += sign * l.cgstPaise;
      cur.sgstPaise += sign * l.sgstPaise;
      cur.igstPaise += sign * l.igstPaise;
      rateMap.set(key, cur);
    }

    const b2bSummary = Array.from(b2bMap.values());
    const hsnSummary = Array.from(rateMap.values());

    if (format === 'csv') {
      const csv = toCsv(
        ['Customer', 'GSTIN', 'POS State', 'Docs', 'Taxable (INR)', 'CGST (INR)', 'SGST (INR)', 'IGST (INR)', 'Total (INR)'],
        b2bSummary.map((b) => [
          b.customerName,
          b.gstin,
          b.stateCode,
          b.invoiceCount,
          (b.taxablePaise / 100).toFixed(2),
          (b.cgstPaise / 100).toFixed(2),
          (b.sgstPaise / 100).toFixed(2),
          (b.igstPaise / 100).toFixed(2),
          (b.totalPaise / 100).toFixed(2),
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="gstr1-summary.csv"');
      return res.send(csv);
    }

    if (format === 'pdf') {
      const pdf = await buildTabularReportPdf(
        'GSTR-1 B2B Summary Report',
        `Active Tax Invoices & Credit Notes | Total Recipients: ${b2bSummary.length}`,
        ['Customer', 'GSTIN', 'State', 'Docs', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
        b2bSummary.map((b) => [
          b.customerName,
          b.gstin,
          b.stateCode,
          String(b.invoiceCount),
          formatPaise(b.taxablePaise),
          formatPaise(b.cgstPaise),
          formatPaise(b.sgstPaise),
          formatPaise(b.igstPaise),
          formatPaise(b.totalPaise),
        ])
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="gstr1-summary.pdf"');
      return res.send(pdf);
    }

    res.json({ b2bSummary, hsnSummary });
  } catch (error) {
    console.error('Error generating GST summary:', error);
    res.status(500).json({ error: 'Failed to generate GST summary' });
  }
});

router.get('/purchase-register', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const format = req.query.format as string | undefined;
    const rows = await db
      .select({
        id: purchases.id,
        purchaseDate: purchases.purchaseDate,
        invoiceNo: purchases.invoiceNo,
        supplierName: suppliers.name,
        supplierGstin: suppliers.gstin,
        totalPaise: purchases.totalPaise,
        notes: purchases.notes,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .orderBy(desc(purchases.purchaseDate), desc(purchases.id));

    if (format === 'csv') {
      const csv = toCsv(
        ['Date', 'Supplier Invoice', 'Supplier', 'GSTIN', 'Total (INR)', 'Notes'],
        rows.map((r) => [
          r.purchaseDate,
          r.invoiceNo,
          r.supplierName,
          r.supplierGstin || 'URD',
          (r.totalPaise / 100).toFixed(2),
          r.notes || '',
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="purchase-register.csv"');
      return res.send(csv);
    }

    res.json({ purchaseRegister: rows });
  } catch (error) {
    console.error('Error generating purchase register:', error);
    res.status(500).json({ error: 'Failed to load purchase register' });
  }
});

router.get('/production', requireAuth, requireRole(['owner', 'admin', 'accountant', 'production']), async (req, res) => {
  try {
    const format = req.query.format as string | undefined;
    const rows = await db
      .select({
        id: productionRuns.id,
        runNo: productionRuns.runNo,
        runDate: productionRuns.runDate,
        productName: products.name,
        batchSize: productionRuns.batchSize,
        expectedOutput: productionRuns.expectedOutput,
        actualOutput: productionRuns.actualOutput,
        damagedUnits: productionRuns.damagedUnits,
        yieldVariancePct: productionRuns.yieldVariancePct,
        yieldFlagged: productionRuns.yieldFlagged,
        totalCostPaise: productionRuns.totalCostPaise,
        costPerPacketPaise: productionRuns.costPerPacketPaise,
        status: productionRuns.status,
      })
      .from(productionRuns)
      .innerJoin(products, eq(productionRuns.productId, products.id))
      .orderBy(desc(productionRuns.id));

    if (format === 'csv') {
      const csv = toCsv(
        ['Run No', 'Date', 'Product', 'Batches', 'Expected', 'Actual', 'Damaged', 'Yield Var %', 'Flagged', 'Total Cost (INR)', 'Cost/Pkt (INR)', 'Status'],
        rows.map((r) => [
          r.runNo,
          r.runDate,
          r.productName,
          r.batchSize,
          r.expectedOutput,
          r.actualOutput,
          r.damagedUnits,
          r.yieldVariancePct,
          r.yieldFlagged ? 'YES' : 'NO',
          (r.totalCostPaise / 100).toFixed(2),
          (r.costPerPacketPaise / 100).toFixed(2),
          r.status,
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="production-report.csv"');
      return res.send(csv);
    }

    res.json({ productionReport: rows });
  } catch (error) {
    console.error('Error generating production report:', error);
    res.status(500).json({ error: 'Failed to load production report' });
  }
});

router.get('/receivables', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const format = req.query.format as string | undefined;
    const allCustomers = await db.select().from(customers);
    const invs = await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, 'active'));
    const allPays = await db.select().from(payments);

    const todayMs = new Date().setHours(0, 0, 0, 0);

    const receivables = allCustomers
      .map((c) => {
        const custInvs = invs.filter(
          (i) => i.customerId === c.id && i.invoiceType === 'tax_invoice'
        );
        let totalBilledPaise = 0;
        let totalPaidPaise = 0;
        let bucket0_30 = 0;
        let bucket31_60 = 0;
        let bucket61_90 = 0;
        let bucket90Plus = 0;

        for (const inv of custInvs) {
          const paid = allPays
            .filter((p) => p.invoiceId === inv.id)
            .reduce((s, p) => s + p.amountPaise, 0);
          const out = Math.max(0, inv.totalPaise - paid);
          totalBilledPaise += inv.totalPaise;
          totalPaidPaise += paid;

          if (out > 0) {
            const ageDays = Math.floor(
              (todayMs - new Date(inv.invoiceDate).getTime()) / 86400000
            );
            if (ageDays <= 30) bucket0_30 += out;
            else if (ageDays <= 60) bucket31_60 += out;
            else if (ageDays <= 90) bucket61_90 += out;
            else bucket90Plus += out;
          }
        }

        const outstandingPaise = Math.max(0, totalBilledPaise - totalPaidPaise);
        return {
          customerId: c.id,
          customerName: c.name,
          customerType: c.type,
          stateName: c.stateName,
          totalBilledPaise,
          totalPaidPaise,
          outstandingPaise,
          bucket0_30,
          bucket31_60,
          bucket61_90,
          bucket90Plus,
        };
      })
      .filter((r) => r.totalBilledPaise > 0 || r.outstandingPaise > 0);

    if (format === 'csv') {
      const csv = toCsv(
        ['Customer', 'Type', 'State', 'Billed (INR)', 'Collected (INR)', 'Outstanding (INR)', '0-30d', '31-60d', '61-90d', '90d+'],
        receivables.map((r) => [
          r.customerName,
          r.customerType,
          r.stateName,
          (r.totalBilledPaise / 100).toFixed(2),
          (r.totalPaidPaise / 100).toFixed(2),
          (r.outstandingPaise / 100).toFixed(2),
          (r.bucket0_30 / 100).toFixed(2),
          (r.bucket31_60 / 100).toFixed(2),
          (r.bucket61_90 / 100).toFixed(2),
          (r.bucket90Plus / 100).toFixed(2),
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="receivables-ageing.csv"');
      return res.send(csv);
    }

    res.json({ receivables });
  } catch (error) {
    console.error('Error loading receivables:', error);
    res.status(500).json({ error: 'Failed to load receivables ageing' });
  }
});

router.get('/stock-summary', requireAuth, requireRole(['owner', 'admin', 'accountant', 'production']), async (req, res) => {
  try {
    const format = req.query.format as string | undefined;
    const rawMats = await db.select().from(rawMaterials).orderBy(asc(rawMaterials.id));
    const finishedProds = await db.select().from(products).orderBy(asc(products.id));
    const rawBalances = await getStockBalancesMap('raw');
    const finishedBalances = await getStockBalancesMap('finished');

    const activeBatches = await db
      .select()
      .from(rawMaterialBatches)
      .where(gt(rawMaterialBatches.qtyRemaining, '0'));

    const rows = [
      ...rawMats.map((m) => {
        const balance = rawBalances.get(m.id) ?? 0;
        const fifoValuePaise = activeBatches
          .filter((b) => b.rawMaterialId === m.id)
          .reduce((s, b) => s + Math.round(Number(b.qtyRemaining) * b.ratePaise), 0);
        return {
          category: 'Raw Material',
          name: m.name,
          unit: m.unit,
          balance,
          reorderLevel: Number(m.reorderLevel),
          valuationPaise: fifoValuePaise,
        };
      }),
      ...finishedProds.map((p) => {
        const balance = finishedBalances.get(p.id) ?? 0;
        return {
          category: 'Finished Good',
          name: `${p.name} (${p.sku})`,
          unit: 'packet',
          balance,
          reorderLevel: 0,
          valuationPaise: Math.round(balance * p.sellingPricePaise),
        };
      }),
    ];

    if (format === 'csv') {
      const csv = toCsv(
        ['Category', 'Item', 'Unit', 'Closing Balance', 'Reorder Level', 'Valuation (INR)'],
        rows.map((r) => [
          r.category,
          r.name,
          r.unit,
          r.balance.toFixed(4),
          r.reorderLevel.toFixed(2),
          (r.valuationPaise / 100).toFixed(2),
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-summary.csv"');
      return res.send(csv);
    }

    if (format === 'pdf') {
      const pdf = await buildTabularReportPdf(
        'Stock Summary & FIFO Valuation Report',
        `Generated ${new Date().toISOString().slice(0, 10)} | Total Items: ${rows.length}`,
        ['Category', 'Item', 'Unit', 'Closing Balance', 'Reorder Lvl', 'Valuation'],
        rows.map((r) => [
          r.category,
          r.name,
          r.unit,
          r.balance.toFixed(2),
          r.reorderLevel.toFixed(2),
          formatPaise(r.valuationPaise),
        ])
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-summary.pdf"');
      return res.send(pdf);
    }

    res.json({ stockSummary: rows });
  } catch (error) {
    console.error('Error generating stock summary:', error);
    res.status(500).json({ error: 'Failed to load stock summary' });
  }
});

router.get('/customer-statement/:customerId', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    const format = req.query.format as string | undefined;

    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const custInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.customerId, customerId))
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id));

    const custPayments = await db
      .select()
      .from(payments)
      .where(eq(payments.customerId, customerId))
      .orderBy(asc(payments.paymentDate), asc(payments.id));

    type StatementEntry = {
      date: string;
      docNo: string;
      type: string;
      debitPaise: number;
      creditPaise: number;
      balancePaise: number;
      notes: string;
    };

    const rawEntries: Omit<StatementEntry, 'balancePaise'>[] = [];

    for (const inv of custInvoices) {
      if (inv.status === 'cancelled') continue;
      if (inv.invoiceType === 'credit_note') {
        rawEntries.push({
          date: inv.invoiceDate,
          docNo: inv.invoiceNo,
          type: 'Credit Note',
          debitPaise: 0,
          creditPaise: inv.totalPaise,
          notes: 'Sales return / cancellation credit',
        });
      } else {
        rawEntries.push({
          date: inv.invoiceDate,
          docNo: inv.invoiceNo,
          type: 'Tax Invoice',
          debitPaise: inv.totalPaise,
          creditPaise: 0,
          notes: `POS ${inv.placeOfSupplyStateCode}`,
        });
      }
    }

    for (const pay of custPayments) {
      rawEntries.push({
        date: pay.paymentDate,
        docNo: pay.referenceNo || `PAY-${pay.id}`,
        type: `Receipt (${pay.mode.toUpperCase()})`,
        debitPaise: 0,
        creditPaise: pay.amountPaise,
        notes: pay.notes || 'Payment received',
      });
    }

    rawEntries.sort((a, b) => a.date.localeCompare(b.date));

    let running = 0;
    const entries: StatementEntry[] = rawEntries.map((e) => {
      running += e.debitPaise - e.creditPaise;
      return { ...e, balancePaise: running };
    });

    if (format === 'csv') {
      const csv = toCsv(
        ['Date', 'Document', 'Type', 'Debit (INR)', 'Credit (INR)', 'Running Balance (INR)', 'Notes'],
        entries.map((e) => [
          e.date,
          e.docNo,
          e.type,
          (e.debitPaise / 100).toFixed(2),
          (e.creditPaise / 100).toFixed(2),
          (e.balancePaise / 100).toFixed(2),
          e.notes,
        ])
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="statement-${customer.id}.csv"`);
      return res.send(csv);
    }

    res.json({ customer, entries, closingBalancePaise: running });
  } catch (error) {
    console.error('Error loading customer statement:', error);
    res.status(500).json({ error: 'Failed to generate customer statement' });
  }
});

router.get('/tally-xml', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (_req, res) => {
  try {
    const activeInvs = await db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        invoiceType: invoices.invoiceType,
        invoiceDate: invoices.invoiceDate,
        customerName: customers.name,
        gstin: customers.gstin,
        taxableAmountPaise: invoices.taxableAmountPaise,
        cgstPaise: invoices.cgstPaise,
        sgstPaise: invoices.sgstPaise,
        igstPaise: invoices.igstPaise,
        totalPaise: invoices.totalPaise,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.status, 'active'))
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id));

    const allPurchases = await db
      .select({
        id: purchases.id,
        purchaseDate: purchases.purchaseDate,
        invoiceNo: purchases.invoiceNo,
        supplierName: suppliers.name,
        totalPaise: purchases.totalPaise,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .orderBy(asc(purchases.purchaseDate), asc(purchases.id));

    const xmlEscape = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const toTallyDate = (d: string) => d.replace(/-/g, '');
    const toRupees = (p: number) => (p / 100).toFixed(2);

    const salesVouchers = activeInvs
      .map((inv) => {
        const isCn = inv.invoiceType === 'credit_note';
        const vchType = isCn ? 'Credit Note' : 'Sales';
        const sign = isCn ? 1 : -1;
        return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${vchType}" ACTION="Create">
          <DATE>${toTallyDate(inv.invoiceDate)}</DATE>
          <VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${xmlEscape(inv.invoiceNo)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${xmlEscape(inv.customerName)}</PARTYLEDGERNAME>
          <PARTYGSTIN>${xmlEscape(inv.gstin || '')}</PARTYGSTIN>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(inv.customerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isCn ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${isCn ? toRupees(inv.totalPaise) : `-${toRupees(inv.totalPaise)}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Snacks Sales Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isCn ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${sign < 0 ? toRupees(inv.taxableAmountPaise) : `-${toRupees(inv.taxableAmountPaise)}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>${
            inv.cgstPaise > 0
              ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isCn ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${sign < 0 ? toRupees(inv.cgstPaise) : `-${toRupees(inv.cgstPaise)}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isCn ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${sign < 0 ? toRupees(inv.sgstPaise) : `-${toRupees(inv.sgstPaise)}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`
              : ''
          }${
            inv.igstPaise > 0
              ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Output IGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isCn ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${sign < 0 ? toRupees(inv.igstPaise) : `-${toRupees(inv.igstPaise)}`}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`
              : ''
          }
        </VOUCHER>
      </TALLYMESSAGE>`;
      })
      .join('');

    const purchaseVouchers = allPurchases
      .map(
        (pur) => `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${toTallyDate(pur.purchaseDate)}</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${xmlEscape(pur.invoiceNo)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${xmlEscape(pur.supplierName)}</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(pur.supplierName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${toRupees(pur.totalPaise)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Raw Material Purchases</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${toRupees(pur.totalPaise)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`
      )
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>${salesVouchers}${purchaseVouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="kaveri-crunch-tally-vouchers.xml"');
    res.send(xml);
  } catch (error) {
    console.error('Error generating Tally XML:', error);
    res.status(500).json({ error: 'Failed to generate Tally XML export' });
  }
});

export default router;
