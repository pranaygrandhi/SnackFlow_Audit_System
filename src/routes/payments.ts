import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { customers, invoices, payments } from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';

const router = Router();

router.get('/', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
        invoiceNo: invoices.invoiceNo,
        customerId: payments.customerId,
        customerName: customers.name,
        amountPaise: payments.amountPaise,
        paymentDate: payments.paymentDate,
        mode: payments.mode,
        referenceNo: payments.referenceNo,
        notes: payments.notes,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(customers, eq(payments.customerId, customers.id))
      .orderBy(desc(payments.id));

    res.json({ payments: rows });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

router.post('/', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req: AuthRequest, res) => {
  try {
    const { invoiceId, amountPaise, paymentDate, mode, referenceNo, notes } = req.body;
    const amount = Math.round(Number(amountPaise));
    if (!invoiceId || amount <= 0) {
      return res.status(400).json({ error: 'Valid invoiceId and positive amountPaise are required' });
    }

    const userId = req.dbUser!.id;
    const created = await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, Number(invoiceId)))
        .limit(1);

      if (!inv) throw new Error('Invoice not found');
      if (inv.status === 'cancelled' || inv.invoiceType === 'credit_note') {
        throw new Error('Cannot record payment against a cancelled invoice or credit note');
      }

      const existingPays = await tx
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, inv.id));
      const paidSoFar = existingPays.reduce((s, p) => s + p.amountPaise, 0);
      const remaining = inv.totalPaise - paidSoFar;

      if (amount > remaining) {
        throw new Error(
          `Payment ₹${(amount / 100).toFixed(2)} exceeds remaining balance ₹${(remaining / 100).toFixed(2)}`
        );
      }

      const [pay] = await tx
        .insert(payments)
        .values({
          invoiceId: inv.id,
          customerId: inv.customerId,
          amountPaise: amount,
          paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
          mode: mode || 'upi',
          referenceNo: referenceNo || null,
          notes: notes || null,
          createdBy: userId,
        })
        .returning();

      return pay;
    });

    res.status(201).json({ payment: created });
  } catch (error: any) {
    console.error('Error recording payment:', error);
    res.status(400).json({ error: error.message || 'Failed to record payment' });
  }
});

export default router;
