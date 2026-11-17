import { Router } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { products, rawMaterialBatches, rawMaterials, stockMovements, users } from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import { getStockBalancesMap } from '../services/stockService.ts';

const router = Router();

router.get('/balances', requireAuth, async (_req, res) => {
  try {
    const rawMats = await db.select().from(rawMaterials).orderBy(asc(rawMaterials.id));
    const finishedProds = await db.select().from(products).orderBy(asc(products.id));

    const rawBalances = await getStockBalancesMap('raw');
    const finishedBalances = await getStockBalancesMap('finished');

    const rawSummary = rawMats.map((m) => {
      const balance = rawBalances.get(m.id) ?? 0;
      const reorder = Number(m.reorderLevel);
      return {
        ...m,
        balance,
        isLowStock: balance <= reorder,
      };
    });

    const finishedSummary = finishedProds.map((p) => ({
      ...p,
      balance: finishedBalances.get(p.id) ?? 0,
    }));

    res.json({ rawMaterials: rawSummary, finishedGoods: finishedSummary });
  } catch (error) {
    console.error('Error loading stock balances:', error);
    res.status(500).json({ error: 'Failed to load stock balances' });
  }
});

router.get('/ledger', requireAuth, async (req, res) => {
  try {
    const itemType = req.query.itemType as string | undefined;
    const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
    const movementType = req.query.movementType as string | undefined;

    const allMovements = await db
      .select({
        id: stockMovements.id,
        itemType: stockMovements.itemType,
        itemId: stockMovements.itemId,
        movementType: stockMovements.movementType,
        qty: stockMovements.qty,
        unit: stockMovements.unit,
        ratePaise: stockMovements.ratePaise,
        sourceType: stockMovements.sourceType,
        sourceId: stockMovements.sourceId,
        batchNo: stockMovements.batchNo,
        expiryDate: stockMovements.expiryDate,
        notes: stockMovements.notes,
        createdAt: stockMovements.createdAt,
        createdByName: users.name,
      })
      .from(stockMovements)
      .innerJoin(users, eq(stockMovements.createdBy, users.id))
      .orderBy(desc(stockMovements.id));

    const rawMats = await db.select().from(rawMaterials);
    const prods = await db.select().from(products);
    const rawMap = new Map(rawMats.map((r) => [r.id, r.name]));
    const prodMap = new Map(prods.map((p) => [p.id, p.name]));

    const filtered = allMovements
      .filter((m) => {
        if (itemType && m.itemType !== itemType) return false;
        if (itemId && m.itemId !== itemId) return false;
        if (movementType && m.movementType !== movementType) return false;
        return true;
      })
      .map((m) => ({
        ...m,
        itemName:
          m.itemType === 'raw'
            ? rawMap.get(m.itemId) || `Material #${m.itemId}`
            : prodMap.get(m.itemId) || `Product #${m.itemId}`,
      }));

    res.json({ ledger: filtered });
  } catch (error) {
    console.error('Error loading stock ledger:', error);
    res.status(500).json({ error: 'Failed to load stock ledger' });
  }
});

router.get('/batches', requireAuth, async (_req, res) => {
  try {
    const batches = await db
      .select({
        id: rawMaterialBatches.id,
        rawMaterialId: rawMaterialBatches.rawMaterialId,
        materialName: rawMaterials.name,
        unit: rawMaterials.unit,
        purchaseId: rawMaterialBatches.purchaseId,
        qtyInitial: rawMaterialBatches.qtyInitial,
        qtyRemaining: rawMaterialBatches.qtyRemaining,
        ratePaise: rawMaterialBatches.ratePaise,
        batchNo: rawMaterialBatches.batchNo,
        expiryDate: rawMaterialBatches.expiryDate,
        receivedAt: rawMaterialBatches.receivedAt,
      })
      .from(rawMaterialBatches)
      .innerJoin(rawMaterials, eq(rawMaterialBatches.rawMaterialId, rawMaterials.id))
      .orderBy(asc(rawMaterialBatches.receivedAt), asc(rawMaterialBatches.id));

    res.json({ batches });
  } catch (error) {
    console.error('Error loading batches:', error);
    res.status(500).json({ error: 'Failed to load FIFO batches' });
  }
});

router.post('/adjustments', requireAuth, requireRole(['owner', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { itemType, itemId, qty, movementType, notes } = req.body as {
      itemType: 'raw' | 'finished';
      itemId: number;
      qty: number;
      movementType: 'adjustment' | 'damage';
      notes: string;
    };

    const qtyNum = Number(qty);
    if (!itemType || !itemId || Number.isNaN(qtyNum) || qtyNum === 0) {
      return res.status(400).json({ error: 'Valid itemType, itemId, and non-zero qty are required' });
    }

    const userId = req.dbUser!.id;
    let unit = 'packet';
    let ratePaise = 0;

    if (itemType === 'raw') {
      const [m] = await db.select().from(rawMaterials).where(eq(rawMaterials.id, Number(itemId)));
      if (!m) return res.status(404).json({ error: 'Raw material not found' });
      unit = m.unit;
      ratePaise = m.defaultRatePaise;
    } else {
      const [p] = await db.select().from(products).where(eq(products.id, Number(itemId)));
      if (!p) return res.status(404).json({ error: 'Product not found' });
      ratePaise = p.sellingPricePaise;
    }

    const [created] = await db
      .insert(stockMovements)
      .values({
        itemType,
        itemId: Number(itemId),
        movementType: movementType || 'adjustment',
        qty: qtyNum.toFixed(4),
        unit,
        ratePaise,
        sourceType: 'adjustment',
        sourceId: 0,
        notes: notes || 'Manual stock adjustment',
        createdBy: userId,
      })
      .returning();

    res.status(201).json({ movement: created });
  } catch (error) {
    console.error('Error recording adjustment:', error);
    res.status(500).json({ error: 'Failed to record stock adjustment' });
  }
});

export default router;
