import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { customers, orderLines, orders, products, users } from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import { getStockBalancesMap } from '../services/stockService.ts';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const allOrders = await db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        salesmanId: orders.salesmanId,
        salesmanName: users.name,
        customerId: orders.customerId,
        customerName: customers.name,
        customerType: customers.type,
        customerStateCode: customers.stateCode,
        customerStateName: customers.stateName,
        customerPhone: customers.phone,
        orderDate: orders.orderDate,
        status: orders.status,
        notes: orders.notes,
        clientOfflineId: orders.clientOfflineId,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .innerJoin(users, eq(orders.salesmanId, users.id))
      .orderBy(desc(orders.id));

    const lines = await db
      .select({
        id: orderLines.id,
        orderId: orderLines.orderId,
        productId: orderLines.productId,
        productName: products.name,
        sku: products.sku,
        hsnCode: products.hsnCode,
        gstRatePct: products.gstRatePct,
        qty: orderLines.qty,
        pricePaise: orderLines.pricePaise,
        discountPaise: orderLines.discountPaise,
      })
      .from(orderLines)
      .innerJoin(products, eq(orderLines.productId, products.id));

    const finishedBalances = await getStockBalancesMap('finished');

    const visibleOrders =
      user.role === 'salesman'
        ? allOrders.filter((o) => o.salesmanId === user.id)
        : allOrders;

    const enriched = visibleOrders.map((o) => {
      const oLines = lines
        .filter((l) => l.orderId === o.id)
        .map((l) => {
          const availableStock = finishedBalances.get(l.productId) ?? 0;
          const shortage = Math.max(0, l.qty - availableStock);
          return {
            ...l,
            availableStock,
            shortage,
            hasShortage: shortage > 0,
          };
        });

      const subtotalPaise = oLines.reduce(
        (acc, l) => acc + (l.qty * l.pricePaise - l.discountPaise),
        0
      );
      const hasAnyShortage = oLines.some((l) => l.hasShortage);

      return {
        ...o,
        lines: oLines,
        subtotalPaise,
        hasAnyShortage,
      };
    });

    res.json({ orders: enriched });
  } catch (error) {
    console.error('Error listing orders:', error);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

interface OrderPayload {
  customerId: number;
  orderDate?: string;
  notes?: string;
  status?: 'draft' | 'submitted';
  clientOfflineId?: string;
  lines: Array<{
    productId: number;
    qty: number;
    pricePaise?: number;
    discountPaise?: number;
  }>;
}

async function insertOrderTx(payload: OrderPayload, salesmanId: number) {
  if (!payload.customerId || !Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new Error('Customer and at least one product line are required');
  }

  if (payload.clientOfflineId) {
    const existing = await db
      .select()
      .from(orders)
      .where(eq(orders.clientOfflineId, payload.clientOfflineId))
      .limit(1);
    if (existing.length > 0) {
      return existing[0];
    }
  }

  const orderDate = payload.orderDate || new Date().toISOString().slice(0, 10);
  const orderNo = `ORD-${orderDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  return await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        orderNo,
        salesmanId,
        customerId: Number(payload.customerId),
        orderDate,
        status: payload.status || 'submitted',
        notes: payload.notes || null,
        clientOfflineId: payload.clientOfflineId || null,
      })
      .returning();

    for (const l of payload.lines) {
      const qty = Math.round(Number(l.qty));
      if (qty <= 0) throw new Error('Order quantity must be positive');

      const [prod] = await tx
        .select()
        .from(products)
        .where(eq(products.id, Number(l.productId)))
        .limit(1);
      if (!prod) throw new Error(`Product #${l.productId} not found`);

      await tx.insert(orderLines).values({
        orderId: order.id,
        productId: prod.id,
        qty,
        pricePaise: l.pricePaise !== undefined ? Math.round(Number(l.pricePaise)) : prod.sellingPricePaise,
        discountPaise: Math.max(0, Math.round(Number(l.discountPaise || 0))),
      });
    }

    return order;
  });
}

router.post('/', requireAuth, requireRole(['owner', 'admin', 'salesman']), async (req: AuthRequest, res) => {
  try {
    const created = await insertOrderTx(req.body, req.dbUser!.id);
    res.status(201).json({ order: created });
  } catch (error: any) {
    console.error('Error creating order:', error);
    res.status(400).json({ error: error.message || 'Failed to create order' });
  }
});

router.post('/sync', requireAuth, requireRole(['owner', 'admin', 'salesman']), async (req: AuthRequest, res) => {
  try {
    const { queue } = req.body as { queue: OrderPayload[] };
    if (!Array.isArray(queue)) {
      return res.status(400).json({ error: 'queue array is required' });
    }
    const synced = [];
    for (const item of queue) {
      const o = await insertOrderTx(item, req.dbUser!.id);
      synced.push(o);
    }
    res.json({ syncedCount: synced.length, orders: synced });
  } catch (error: any) {
    console.error('Error syncing offline orders:', error);
    res.status(400).json({ error: error.message || 'Failed to sync offline queue' });
  }
});

router.patch('/:id', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { status, notes, lines } = req.body as {
      status?: string;
      notes?: string;
      lines?: Array<{ productId: number; qty: number; pricePaise: number; discountPaise?: number }>;
    };

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!existing) throw new Error('Order not found');
      if (existing.status === 'invoiced' || existing.status === 'dispatched') {
        throw new Error('Cannot modify an already invoiced or dispatched order');
      }

      if (Array.isArray(lines) && lines.length > 0) {
        await tx.delete(orderLines).where(eq(orderLines.orderId, orderId));
        for (const l of lines) {
          await tx.insert(orderLines).values({
            orderId,
            productId: Number(l.productId),
            qty: Math.round(Number(l.qty)),
            pricePaise: Math.round(Number(l.pricePaise)),
            discountPaise: Math.round(Number(l.discountPaise || 0)),
          });
        }
      }

      const [saved] = await tx
        .update(orders)
        .set({
          status: status || existing.status,
          notes: notes !== undefined ? notes : existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      return saved;
    });

    res.json({ order: updated });
  } catch (error: any) {
    console.error('Error updating order:', error);
    res.status(400).json({ error: error.message || 'Failed to update order' });
  }
});

export default router;
