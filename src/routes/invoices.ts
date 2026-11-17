import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  customers,
  dispatches,
  invoiceLines,
  invoices,
  orderLines,
  orders,
  payments,
  products,
  stockMovements,
} from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import {
  COMPANY_INFO,
  calculateGstInvoice,
  getIndianFinancialYear,
} from '../services/gstService.ts';
import { getStockBalancesMap } from '../services/stockService.ts';
import { buildInvoicePdfBuffer } from '../utils/pdfBuilder.ts';

const router = Router();

router.get('/', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (_req, res) => {
  try {
    const allInvoices = await db
      .select({
        id: invoices.id,
        orderId: invoices.orderId,
        invoiceNo: invoices.invoiceNo,
        invoiceType: invoices.invoiceType,
        invoiceDate: invoices.invoiceDate,
        customerId: invoices.customerId,
        customerName: customers.name,
        customerGstin: customers.gstin,
        customerStateCode: customers.stateCode,
        customerStateName: customers.stateName,
        customerPhone: customers.phone,
        companyStateCode: invoices.companyStateCode,
        placeOfSupplyStateCode: invoices.placeOfSupplyStateCode,
        taxableAmountPaise: invoices.taxableAmountPaise,
        cgstPaise: invoices.cgstPaise,
        sgstPaise: invoices.sgstPaise,
        igstPaise: invoices.igstPaise,
        totalPaise: invoices.totalPaise,
        status: invoices.status,
        cancelledByInvoiceId: invoices.cancelledByInvoiceId,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .orderBy(desc(invoices.id));

    const lines = await db
      .select({
        id: invoiceLines.id,
        invoiceId: invoiceLines.invoiceId,
        productId: invoiceLines.productId,
        productName: products.name,
        sku: products.sku,
        qty: invoiceLines.qty,
        hsnCode: invoiceLines.hsnCode,
        pricePaise: invoiceLines.pricePaise,
        discountPaise: invoiceLines.discountPaise,
        taxablePaise: invoiceLines.taxablePaise,
        gstRatePct: invoiceLines.gstRatePct,
        cgstPaise: invoiceLines.cgstPaise,
        sgstPaise: invoiceLines.sgstPaise,
        igstPaise: invoiceLines.igstPaise,
      })
      .from(invoiceLines)
      .innerJoin(products, eq(invoiceLines.productId, products.id));

    const allPayments = await db.select().from(payments);
    const allDispatches = await db.select().from(dispatches);

    const enriched = allInvoices.map((inv) => {
      const invPayments = allPayments.filter((p) => p.invoiceId === inv.id);
      const paidPaise = invPayments.reduce((sum, p) => sum + p.amountPaise, 0);
      const outstandingPaise =
        inv.status === 'cancelled' || inv.invoiceType === 'credit_note'
          ? 0
          : Math.max(0, inv.totalPaise - paidPaise);
      const invDispatches = allDispatches.filter((d) => d.invoiceId === inv.id);

      return {
        ...inv,
        lines: lines.filter((l) => l.invoiceId === inv.id),
        paidPaise,
        outstandingPaise,
        dispatched: invDispatches.length > 0,
        dispatch: invDispatches[0] || null,
      };
    });

    res.json({ invoices: enriched });
  } catch (error) {
    console.error('Error listing invoices:', error);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

router.post('/from-order/:orderId', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const orderId = Number(req.params.orderId);
    const userId = req.dbUser!.id;
    const invoiceDate = (req.body?.invoiceDate as string) || new Date().toISOString().slice(0, 10);

    const createdInvoice = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');

      if (!order) throw new Error('Order not found');
      if (order.status === 'rejected') throw new Error('Cannot invoice a rejected order');
      if (order.status === 'invoiced' || order.status === 'dispatched') {
        throw new Error('Order has already been invoiced');
      }

      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);

      if (!customer) throw new Error('Customer not found');

      const oLines = await tx
        .select({
          productId: orderLines.productId,
          qty: orderLines.qty,
          pricePaise: orderLines.pricePaise,
          discountPaise: orderLines.discountPaise,
          productName: products.name,
          hsnCode: products.hsnCode,
          gstRatePct: products.gstRatePct,
        })
        .from(orderLines)
        .innerJoin(products, eq(orderLines.productId, products.id))
        .where(eq(orderLines.orderId, orderId));

      if (oLines.length === 0) throw new Error('Order has no lines');

      // Check finished stock availability atomically
      const finishedBalances = await getStockBalancesMap('finished', tx);
      for (const line of oLines) {
        const avail = finishedBalances.get(line.productId) ?? 0;
        if (avail + 0.0001 < line.qty) {
          throw new Error(
            `Insufficient finished stock for ${line.productName}: ordered ${line.qty}, available ${avail} packets`
          );
        }
      }

      const computed = calculateGstInvoice(
        oLines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          hsnCode: l.hsnCode,
          pricePaise: l.pricePaise,
          discountPaise: l.discountPaise,
          gstRatePct: Number(l.gstRatePct),
        })),
        customer.stateCode,
        COMPANY_INFO.stateCode
      );

      // Financial year sequential invoice number
      const fy = getIndianFinancialYear(invoiceDate);
      const countRes = await tx
        .select({ value: sql<string>`COUNT(*)` })
        .from(invoices)
        .where(eq(invoices.invoiceType, 'tax_invoice'));
      const seq = Number(countRes[0]?.value ?? 0) + 1;
      const invoiceNo = `INV/${fy}/${String(seq).padStart(4, '0')}`;

      const [inv] = await tx
        .insert(invoices)
        .values({
          orderId: order.id,
          invoiceNo,
          invoiceType: 'tax_invoice',
          invoiceDate,
          customerId: customer.id,
          companyStateCode: COMPANY_INFO.stateCode,
          placeOfSupplyStateCode: customer.stateCode,
          taxableAmountPaise: computed.taxableAmountPaise,
          cgstPaise: computed.cgstPaise,
          sgstPaise: computed.sgstPaise,
          igstPaise: computed.igstPaise,
          totalPaise: computed.totalPaise,
          status: 'active',
          createdBy: userId,
        })
        .returning();

      for (const cl of computed.lines) {
        await tx.insert(invoiceLines).values({
          invoiceId: inv.id,
          productId: cl.productId,
          qty: cl.qty,
          hsnCode: cl.hsnCode,
          pricePaise: cl.pricePaise,
          discountPaise: cl.discountPaise,
          taxablePaise: cl.taxablePaise,
          gstRatePct: cl.gstRatePct.toFixed(2),
          cgstPaise: cl.cgstPaise,
          sgstPaise: cl.sgstPaise,
          igstPaise: cl.igstPaise,
        });

        await tx.insert(stockMovements).values({
          itemType: 'finished',
          itemId: cl.productId,
          movementType: 'sale',
          qty: (-cl.qty).toFixed(4),
          unit: 'packet',
          ratePaise: cl.pricePaise,
          sourceType: 'invoice',
          sourceId: inv.id,
          notes: `Sold via ${inv.invoiceNo} to ${customer.name}`,
          createdBy: userId,
        });
      }

      await tx
        .update(orders)
        .set({ status: 'invoiced', updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      return inv;
    });

    res.status(201).json({ invoice: createdInvoice });
  } catch (error: any) {
    console.error('Error generating invoice:', error);
    res.status(400).json({ error: error.message || 'Failed to generate invoice' });
  }
});

router.post('/:id/dispatch', requireAuth, requireRole(['owner', 'admin']), async (req: AuthRequest, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const { dispatchDate, vehicleNo, notes } = req.body;
    const userId = req.dbUser!.id;

    const dispatch = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!inv) throw new Error('Invoice not found');
      if (inv.status === 'cancelled') throw new Error('Cannot dispatch a cancelled invoice');

      const [d] = await tx
        .insert(dispatches)
        .values({
          invoiceId,
          dispatchDate: dispatchDate || new Date().toISOString().slice(0, 10),
          vehicleNo: vehicleNo || null,
          notes: notes || null,
          createdBy: userId,
        })
        .returning();

      if (inv.orderId) {
        await tx
          .update(orders)
          .set({ status: 'dispatched', updatedAt: new Date() })
          .where(eq(orders.id, inv.orderId));
      }

      return d;
    });

    res.status(201).json({ dispatch });
  } catch (error: any) {
    console.error('Error recording dispatch:', error);
    res.status(400).json({ error: error.message || 'Failed to record dispatch' });
  }
});

router.post('/:id/cancel', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const userId = req.dbUser!.id;

    const creditNote = await db.transaction(async (tx) => {
      const [orig] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');

      if (!orig) throw new Error('Invoice not found');
      if (orig.status === 'cancelled') throw new Error('Invoice is already cancelled');
      if (orig.invoiceType === 'credit_note') throw new Error('Cannot cancel a credit note');

      const origLines = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, orig.id));

      const today = new Date().toISOString().slice(0, 10);
      const fy = getIndianFinancialYear(today);
      const countRes = await tx
        .select({ value: sql<string>`COUNT(*)` })
        .from(invoices)
        .where(eq(invoices.invoiceType, 'credit_note'));
      const seq = Number(countRes[0]?.value ?? 0) + 1;
      const cnNo = `CN/${fy}/${String(seq).padStart(4, '0')}`;

      const [cn] = await tx
        .insert(invoices)
        .values({
          orderId: orig.orderId,
          invoiceNo: cnNo,
          invoiceType: 'credit_note',
          invoiceDate: today,
          customerId: orig.customerId,
          companyStateCode: orig.companyStateCode,
          placeOfSupplyStateCode: orig.placeOfSupplyStateCode,
          taxableAmountPaise: orig.taxableAmountPaise,
          cgstPaise: orig.cgstPaise,
          sgstPaise: orig.sgstPaise,
          igstPaise: orig.igstPaise,
          totalPaise: orig.totalPaise,
          status: 'active',
          createdBy: userId,
        })
        .returning();

      for (const l of origLines) {
        await tx.insert(invoiceLines).values({
          invoiceId: cn.id,
          productId: l.productId,
          qty: l.qty,
          hsnCode: l.hsnCode,
          pricePaise: l.pricePaise,
          discountPaise: l.discountPaise,
          taxablePaise: l.taxablePaise,
          gstRatePct: l.gstRatePct,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          igstPaise: l.igstPaise,
        });

        await tx.insert(stockMovements).values({
          itemType: 'finished',
          itemId: l.productId,
          movementType: 'return',
          qty: l.qty.toFixed(4),
          unit: 'packet',
          ratePaise: l.pricePaise,
          sourceType: 'credit_note',
          sourceId: cn.id,
          notes: `Stock restored on cancellation of ${orig.invoiceNo} via ${cn.invoiceNo}`,
          createdBy: userId,
        });
      }

      await tx
        .update(invoices)
        .set({ status: 'cancelled', cancelledByInvoiceId: cn.id })
        .where(eq(invoices.id, orig.id));

      return cn;
    });

    res.status(201).json({ creditNote });
  } catch (error: any) {
    console.error('Error cancelling invoice:', error);
    res.status(400).json({ error: error.message || 'Failed to cancel invoice' });
  }
});

router.post('/:id/partial-return', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const { items, restockGood, notes } = req.body as {
      items: Array<{ productId: number; returnQty: number }>;
      restockGood?: boolean;
      notes?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one return item quantity is required' });
    }

    const creditNote = await db.transaction(async (tx) => {
      const [orig] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');

      if (!orig) throw new Error('Invoice not found');
      if (orig.status === 'cancelled' || orig.invoiceType === 'credit_note') {
        throw new Error('Cannot issue partial return on a cancelled invoice or credit note');
      }

      const origLines = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, orig.id));

      const returnInputs = [];
      for (const reqItem of items) {
        const qty = Math.round(Number(reqItem.returnQty));
        if (qty <= 0) continue;
        const origLine = origLines.find((ol) => ol.productId === Number(reqItem.productId));
        if (!origLine) throw new Error(`Product #${reqItem.productId} not found on invoice`);
        if (qty > origLine.qty) {
          throw new Error(`Return qty (${qty}) exceeds invoiced qty (${origLine.qty})`);
        }
        returnInputs.push({
          productId: origLine.productId,
          qty,
          hsnCode: origLine.hsnCode,
          pricePaise: origLine.pricePaise,
          discountPaise: 0,
          gstRatePct: Number(origLine.gstRatePct),
        });
      }

      if (returnInputs.length === 0) {
        throw new Error('Specify at least one positive return quantity');
      }

      const computed = calculateGstInvoice(
        returnInputs,
        orig.placeOfSupplyStateCode,
        orig.companyStateCode
      );

      const today = new Date().toISOString().slice(0, 10);
      const fy = getIndianFinancialYear(today);
      const countRes = await tx
        .select({ value: sql<string>`COUNT(*)` })
        .from(invoices)
        .where(eq(invoices.invoiceType, 'credit_note'));
      const seq = Number(countRes[0]?.value ?? 0) + 1;
      const cnNo = `CN/${fy}/${String(seq).padStart(4, '0')}`;

      const [cn] = await tx
        .insert(invoices)
        .values({
          orderId: orig.orderId,
          invoiceNo: cnNo,
          invoiceType: 'credit_note',
          invoiceDate: today,
          customerId: orig.customerId,
          companyStateCode: orig.companyStateCode,
          placeOfSupplyStateCode: orig.placeOfSupplyStateCode,
          taxableAmountPaise: computed.taxableAmountPaise,
          cgstPaise: computed.cgstPaise,
          sgstPaise: computed.sgstPaise,
          igstPaise: computed.igstPaise,
          totalPaise: computed.totalPaise,
          status: 'active',
          createdBy: userId,
        })
        .returning();

      for (const cl of computed.lines) {
        await tx.insert(invoiceLines).values({
          invoiceId: cn.id,
          productId: cl.productId,
          qty: cl.qty,
          hsnCode: cl.hsnCode,
          pricePaise: cl.pricePaise,
          discountPaise: cl.discountPaise,
          taxablePaise: cl.taxablePaise,
          gstRatePct: cl.gstRatePct.toFixed(2),
          cgstPaise: cl.cgstPaise,
          sgstPaise: cl.sgstPaise,
          igstPaise: cl.igstPaise,
        });

        // If goods are resalable, credit finished goods ledger as 'return'; if spoiled, record note without inflating sellable finished stock (or log +return then -damage for full audit trail)
        await tx.insert(stockMovements).values({
          itemType: 'finished',
          itemId: cl.productId,
          movementType: 'return',
          qty: cl.qty.toFixed(4),
          unit: 'packet',
          ratePaise: cl.pricePaise,
          sourceType: 'credit_note',
          sourceId: cn.id,
          notes: `Sales return from ${orig.invoiceNo}${notes ? ` (${notes})` : ''}`,
          createdBy: userId,
        });

        if (restockGood === false) {
          await tx.insert(stockMovements).values({
            itemType: 'finished',
            itemId: cl.productId,
            movementType: 'damage',
            qty: (-cl.qty).toFixed(4),
            unit: 'packet',
            ratePaise: cl.pricePaise,
            sourceType: 'credit_note',
            sourceId: cn.id,
            notes: `Damaged / unsalable return write-off from ${cn.invoiceNo}`,
            createdBy: userId,
          });
        }
      }

      return cn;
    });

    res.status(201).json({ creditNote });
  } catch (error: any) {
    console.error('Error creating partial sales return:', error);
    res.status(400).json({ error: error.message || 'Failed to record sales return' });
  }
});

router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    const [inv] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, inv.customerId))
      .limit(1);

    const lines = await db
      .select({
        productName: products.name,
        sku: products.sku,
        hsnCode: invoiceLines.hsnCode,
        qty: invoiceLines.qty,
        pricePaise: invoiceLines.pricePaise,
        discountPaise: invoiceLines.discountPaise,
        taxablePaise: invoiceLines.taxablePaise,
        gstRatePct: invoiceLines.gstRatePct,
        cgstPaise: invoiceLines.cgstPaise,
        sgstPaise: invoiceLines.sgstPaise,
        igstPaise: invoiceLines.igstPaise,
      })
      .from(invoiceLines)
      .innerJoin(products, eq(invoiceLines.productId, products.id))
      .where(eq(invoiceLines.invoiceId, invoiceId));

    const payRows = await db
      .select({ amountPaise: payments.amountPaise })
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId));
    const paidPaise = payRows.reduce((s, r) => s + r.amountPaise, 0);

    const pdfBuffer = await buildInvoicePdfBuffer({
      ...inv,
      customer,
      lines,
      paidPaise,
    });

    const safeFilename = inv.invoiceNo.replace(/\//g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
});

export default router;
