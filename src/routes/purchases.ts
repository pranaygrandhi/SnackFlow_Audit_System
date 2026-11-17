import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  purchaseLines,
  purchases,
  rawMaterialBatches,
  rawMaterials,
  stockMovements,
  suppliers,
} from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';

const router = Router();

router.get('/', requireAuth, requireRole(['owner', 'admin', 'accountant', 'production']), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: purchases.id,
        supplierId: purchases.supplierId,
        supplierName: suppliers.name,
        purchaseDate: purchases.purchaseDate,
        invoiceNo: purchases.invoiceNo,
        notes: purchases.notes,
        totalPaise: purchases.totalPaise,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .orderBy(desc(purchases.id));

    const lines = await db
      .select({
        id: purchaseLines.id,
        purchaseId: purchaseLines.purchaseId,
        rawMaterialId: purchaseLines.rawMaterialId,
        materialName: rawMaterials.name,
        qty: purchaseLines.qty,
        unit: purchaseLines.unit,
        ratePaise: purchaseLines.ratePaise,
        totalPaise: purchaseLines.totalPaise,
        batchNo: purchaseLines.batchNo,
        expiryDate: purchaseLines.expiryDate,
      })
      .from(purchaseLines)
      .innerJoin(rawMaterials, eq(purchaseLines.rawMaterialId, rawMaterials.id));

    const enriched = rows.map((p) => ({
      ...p,
      lines: lines.filter((l) => l.purchaseId === p.id),
    }));

    res.json({ purchases: enriched });
  } catch (error) {
    console.error('Error listing purchases:', error);
    res.status(500).json({ error: 'Failed to load purchases' });
  }
});

router.post('/', requireAuth, requireRole(['owner', 'admin', 'accountant', 'production']), async (req: AuthRequest, res) => {
  try {
    const { supplierId, purchaseDate, invoiceNo, notes, lines } = req.body as {
      supplierId: number;
      purchaseDate: string;
      invoiceNo: string;
      notes?: string;
      lines: Array<{
        rawMaterialId: number;
        qty: number;
        ratePaise: number;
        batchNo?: string;
        expiryDate?: string;
      }>;
    };

    if (!supplierId || !invoiceNo || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Supplier, invoice number, and at least one line item are required' });
    }

    const userId = req.dbUser!.id;
    const effectiveDate = purchaseDate || new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      let totalPaise = 0;
      const preparedLines: Array<{
        rawMaterialId: number;
        qty: number;
        unit: string;
        ratePaise: number;
        totalPaise: number;
        batchNo: string;
        expiryDate: string | null;
      }> = [];

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const qtyNum = Number(l.qty);
        const rateNum = Math.round(Number(l.ratePaise));
        if (qtyNum <= 0 || rateNum < 0) {
          throw new Error('Line quantity must be positive and rate non-negative');
        }
        const [mat] = await tx
          .select()
          .from(rawMaterials)
          .where(eq(rawMaterials.id, Number(l.rawMaterialId)))
          .limit(1);

        if (!mat) {
          throw new Error(`Raw material #${l.rawMaterialId} not found`);
        }

        const lineTotal = Math.round(qtyNum * rateNum);
        totalPaise += lineTotal;
        const batchNo =
          l.batchNo?.trim() ||
          `PUR-${effectiveDate.replace(/-/g, '')}-${mat.id}-${Math.floor(100 + Math.random() * 900)}`;

        preparedLines.push({
          rawMaterialId: mat.id,
          qty: qtyNum,
          unit: mat.unit,
          ratePaise: rateNum,
          totalPaise: lineTotal,
          batchNo,
          expiryDate: l.expiryDate || null,
        });
      }

      const [purchase] = await tx
        .insert(purchases)
        .values({
          supplierId: Number(supplierId),
          purchaseDate: effectiveDate,
          invoiceNo: invoiceNo.trim(),
          notes: notes || null,
          totalPaise,
          createdBy: userId,
        })
        .returning();

      for (const pl of preparedLines) {
        await tx.insert(purchaseLines).values({
          purchaseId: purchase.id,
          rawMaterialId: pl.rawMaterialId,
          qty: pl.qty.toFixed(4),
          unit: pl.unit,
          ratePaise: pl.ratePaise,
          totalPaise: pl.totalPaise,
          batchNo: pl.batchNo,
          expiryDate: pl.expiryDate,
        });

        await tx.insert(rawMaterialBatches).values({
          rawMaterialId: pl.rawMaterialId,
          purchaseId: purchase.id,
          qtyInitial: pl.qty.toFixed(4),
          qtyRemaining: pl.qty.toFixed(4),
          ratePaise: pl.ratePaise,
          batchNo: pl.batchNo,
          expiryDate: pl.expiryDate,
        });

        await tx.insert(stockMovements).values({
          itemType: 'raw',
          itemId: pl.rawMaterialId,
          movementType: 'purchase',
          qty: pl.qty.toFixed(4),
          unit: pl.unit,
          ratePaise: pl.ratePaise,
          sourceType: 'purchase',
          sourceId: purchase.id,
          batchNo: pl.batchNo,
          expiryDate: pl.expiryDate,
          notes: `Purchase Invoice ${purchase.invoiceNo}`,
          createdBy: userId,
        });
      }

      return purchase;
    });

    res.status(201).json({ purchase: created });
  } catch (error: any) {
    console.error('Error creating purchase:', error);
    res.status(400).json({ error: error.message || 'Failed to record purchase' });
  }
});

export default router;
