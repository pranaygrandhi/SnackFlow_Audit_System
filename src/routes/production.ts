import { Router } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  productionRunAuditLog,
  productionRunIssues,
  productionRuns,
  products,
  rawMaterials,
  stockMovements,
  users,
} from '../db/schema.ts';
import { AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import { consumeFifoBatches, getStockBalancesMap } from '../services/stockService.ts';
import { buildProductionCostSheetPdfBuffer } from '../utils/pdfBuilder.ts';

const router = Router();
const VARIANCE_TOLERANCE_PCT = 3;

router.get('/runs', requireAuth, requireRole(['owner', 'admin', 'production', 'accountant']), async (_req, res) => {
  try {
    const runs = await db
      .select({
        id: productionRuns.id,
        runNo: productionRuns.runNo,
        productId: productionRuns.productId,
        productName: products.name,
        sku: products.sku,
        sellingPricePaise: products.sellingPricePaise,
        runDate: productionRuns.runDate,
        batchSize: productionRuns.batchSize,
        expectedOutput: productionRuns.expectedOutput,
        actualOutput: productionRuns.actualOutput,
        damagedUnits: productionRuns.damagedUnits,
        cartonsUsed: productionRuns.cartonsUsed,
        labourCostPaise: productionRuns.labourCostPaise,
        overheadCostPaise: productionRuns.overheadCostPaise,
        totalCostPaise: productionRuns.totalCostPaise,
        costPerPacketPaise: productionRuns.costPerPacketPaise,
        yieldVariancePct: productionRuns.yieldVariancePct,
        yieldFlagged: productionRuns.yieldFlagged,
        status: productionRuns.status,
        notes: productionRuns.notes,
        postedAt: productionRuns.postedAt,
        createdAt: productionRuns.createdAt,
        createdByName: users.name,
      })
      .from(productionRuns)
      .innerJoin(products, eq(productionRuns.productId, products.id))
      .innerJoin(users, eq(productionRuns.createdBy, users.id))
      .orderBy(desc(productionRuns.id));

    const issues = await db
      .select({
        id: productionRunIssues.id,
        productionRunId: productionRunIssues.productionRunId,
        rawMaterialId: productionRunIssues.rawMaterialId,
        materialName: rawMaterials.name,
        materialCategory: rawMaterials.materialCategory,
        plannedQty: productionRunIssues.plannedQty,
        actualQty: productionRunIssues.actualQty,
        unit: productionRunIssues.unit,
        fifoCostPaise: productionRunIssues.fifoCostPaise,
        variancePct: productionRunIssues.variancePct,
        flagged: productionRunIssues.flagged,
      })
      .from(productionRunIssues)
      .innerJoin(rawMaterials, eq(productionRunIssues.rawMaterialId, rawMaterials.id))
      .orderBy(asc(productionRunIssues.id));

    const auditLogs = await db
      .select({
        id: productionRunAuditLog.id,
        productionRunId: productionRunAuditLog.productionRunId,
        changedByName: users.name,
        changedAt: productionRunAuditLog.changedAt,
        reason: productionRunAuditLog.reason,
        oldValues: productionRunAuditLog.oldValues,
        newValues: productionRunAuditLog.newValues,
      })
      .from(productionRunAuditLog)
      .innerJoin(users, eq(productionRunAuditLog.changedBy, users.id))
      .orderBy(desc(productionRunAuditLog.id));

    const enriched = runs.map((r) => ({
      ...r,
      issues: issues.filter((i) => i.productionRunId === r.id),
      auditLogs: auditLogs.filter((a) => a.productionRunId === r.id),
    }));

    res.json({ runs: enriched });
  } catch (error) {
    console.error('Error fetching production runs:', error);
    res.status(500).json({ error: 'Failed to load production runs' });
  }
});

interface IssueInput {
  rawMaterialId: number;
  plannedQty: number;
  actualQty: number;
  unit: string;
}

function computeVariancePct(actual: number, planned: number): number {
  if (planned === 0) return 0;
  return Number((((actual - planned) / planned) * 100).toFixed(2));
}

async function postRunInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  runId: number,
  userId: number
) {
  const [run] = await tx
    .select()
    .from(productionRuns)
    .where(eq(productionRuns.id, runId))
    .for('update');

  if (!run) throw new Error('Production run not found');
  if (run.status === 'posted') throw new Error('Production run is already posted');

  const [product] = await tx
    .select()
    .from(products)
    .where(eq(products.id, run.productId))
    .limit(1);

  if (!product) throw new Error('Product not found');

  const issues = await tx
    .select({
      id: productionRunIssues.id,
      rawMaterialId: productionRunIssues.rawMaterialId,
      plannedQty: productionRunIssues.plannedQty,
      actualQty: productionRunIssues.actualQty,
      unit: productionRunIssues.unit,
      materialName: rawMaterials.name,
      materialCategory: rawMaterials.materialCategory,
    })
    .from(productionRunIssues)
    .innerJoin(rawMaterials, eq(productionRunIssues.rawMaterialId, rawMaterials.id))
    .where(eq(productionRunIssues.productionRunId, runId));

  // Verify ledger balances before consuming
  const rawBalances = await getStockBalancesMap('raw', tx);
  const pouchExtraNeed = new Map<number, number>();
  if (run.damagedUnits > 0) {
    const pouchLine = issues.find((i) => i.materialCategory === 'pouch');
    if (pouchLine) {
      pouchExtraNeed.set(pouchLine.rawMaterialId, run.damagedUnits);
    }
  }

  for (const iss of issues) {
    const totalNeed = Number(iss.actualQty) + (pouchExtraNeed.get(iss.rawMaterialId) ?? 0);
    const onHand = rawBalances.get(iss.rawMaterialId) ?? 0;
    if (onHand + 0.0001 < totalNeed) {
      throw new Error(
        `Insufficient stock for ${iss.materialName}: need ${totalNeed} ${iss.unit}, available ${onHand} ${iss.unit}`
      );
    }
  }

  let totalMaterialCostPaise = 0;
  let cartonsUsed = run.cartonsUsed;

  for (const iss of issues) {
    const actualQtyNum = Number(iss.actualQty);
    const plannedQtyNum = Number(iss.plannedQty);

    if (iss.materialCategory === 'carton') {
      cartonsUsed = Math.round(actualQtyNum);
    }

    const fifo = await consumeFifoBatches(tx, iss.rawMaterialId, actualQtyNum);
    totalMaterialCostPaise += fifo.totalCostPaise;

    const variancePct = computeVariancePct(actualQtyNum, plannedQtyNum);
    const flagged = Math.abs(variancePct) > VARIANCE_TOLERANCE_PCT;

    await tx
      .update(productionRunIssues)
      .set({
        fifoCostPaise: fifo.totalCostPaise,
        variancePct: variancePct.toFixed(2),
        flagged,
      })
      .where(eq(productionRunIssues.id, iss.id));

    for (const alloc of fifo.allocations) {
      await tx.insert(stockMovements).values({
        itemType: 'raw',
        itemId: iss.rawMaterialId,
        movementType: 'issue',
        qty: (-alloc.qty).toFixed(4),
        unit: iss.unit,
        ratePaise: alloc.ratePaise,
        sourceType: 'production_run',
        sourceId: run.id,
        batchNo: alloc.batchNo,
        notes: `Issued to ${run.runNo} (${product.name})`,
        createdBy: userId,
      });
    }

    // Handle damaged pouches on the pouch material
    if (iss.materialCategory === 'pouch' && run.damagedUnits > 0) {
      const dmgFifo = await consumeFifoBatches(tx, iss.rawMaterialId, run.damagedUnits);
      totalMaterialCostPaise += dmgFifo.totalCostPaise;

      for (const alloc of dmgFifo.allocations) {
        await tx.insert(stockMovements).values({
          itemType: 'raw',
          itemId: iss.rawMaterialId,
          movementType: 'damage',
          qty: (-alloc.qty).toFixed(4),
          unit: iss.unit,
          ratePaise: alloc.ratePaise,
          sourceType: 'production_run',
          sourceId: run.id,
          batchNo: alloc.batchNo,
          notes: `Damaged pouches in ${run.runNo}`,
          createdBy: userId,
        });
      }
    }
  }

  const expectedOut = Number(run.expectedOutput);
  const actualOut = Number(run.actualOutput);
  const yieldVariancePct = computeVariancePct(actualOut, expectedOut);
  const yieldFlagged = Math.abs(yieldVariancePct) > VARIANCE_TOLERANCE_PCT;

  const totalCostPaise = totalMaterialCostPaise + run.labourCostPaise + run.overheadCostPaise;
  const costPerPacketPaise = actualOut > 0 ? Math.round(totalCostPaise / actualOut) : 0;

  // Insert positive finished goods movement
  await tx.insert(stockMovements).values({
    itemType: 'finished',
    itemId: run.productId,
    movementType: 'production_in',
    qty: actualOut.toFixed(4),
    unit: 'packet',
    ratePaise: costPerPacketPaise,
    sourceType: 'production_run',
    sourceId: run.id,
    batchNo: run.runNo,
    notes: `Production output from ${run.runNo}`,
    createdBy: userId,
  });

  const [posted] = await tx
    .update(productionRuns)
    .set({
      cartonsUsed,
      totalCostPaise,
      costPerPacketPaise,
      yieldVariancePct: yieldVariancePct.toFixed(2),
      yieldFlagged,
      status: 'posted',
      postedBy: userId,
      postedAt: new Date(),
    })
    .where(eq(productionRuns.id, run.id))
    .returning();

  return posted;
}

router.post('/runs', requireAuth, requireRole(['owner', 'admin', 'production']), async (req: AuthRequest, res) => {
  try {
    const {
      productId,
      runDate,
      batchSize,
      expectedOutput,
      actualOutput,
      damagedUnits,
      cartonsUsed,
      labourCostPaise,
      overheadCostPaise,
      notes,
      postImmediately,
      issues,
    } = req.body as {
      productId: number;
      runDate?: string;
      batchSize: number;
      expectedOutput: number;
      actualOutput: number;
      damagedUnits?: number;
      cartonsUsed?: number;
      labourCostPaise?: number;
      overheadCostPaise?: number;
      notes?: string;
      postImmediately?: boolean;
      issues: IssueInput[];
    };

    if (!productId || !batchSize || !Array.isArray(issues) || issues.length === 0) {
      return res.status(400).json({ error: 'Product, batch size, and BOM issue lines are required' });
    }

    const userId = req.dbUser!.id;
    const effectiveDate = runDate || new Date().toISOString().slice(0, 10);
    const runNo = `PR-${effectiveDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await db.transaction(async (tx) => {
      const expectedNum = Number(expectedOutput);
      const actualNum = Number(actualOutput);
      const yieldVariancePct = computeVariancePct(actualNum, expectedNum);
      const yieldFlagged = Math.abs(yieldVariancePct) > VARIANCE_TOLERANCE_PCT;

      const [run] = await tx
        .insert(productionRuns)
        .values({
          runNo,
          productId: Number(productId),
          runDate: effectiveDate,
          batchSize: Number(batchSize).toFixed(4),
          expectedOutput: expectedNum.toFixed(4),
          actualOutput: actualNum.toFixed(4),
          damagedUnits: Math.max(0, Math.round(Number(damagedUnits || 0))),
          cartonsUsed: Math.max(0, Math.round(Number(cartonsUsed || 0))),
          labourCostPaise: Math.max(0, Math.round(Number(labourCostPaise || 0))),
          overheadCostPaise: Math.max(0, Math.round(Number(overheadCostPaise || 0))),
          yieldVariancePct: yieldVariancePct.toFixed(2),
          yieldFlagged,
          status: 'draft',
          notes: notes || null,
          createdBy: userId,
        })
        .returning();

      for (const iss of issues) {
        const plannedNum = Number(iss.plannedQty);
        const actualIssNum = Number(iss.actualQty);
        const vPct = computeVariancePct(actualIssNum, plannedNum);

        await tx.insert(productionRunIssues).values({
          productionRunId: run.id,
          rawMaterialId: Number(iss.rawMaterialId),
          plannedQty: plannedNum.toFixed(4),
          actualQty: actualIssNum.toFixed(4),
          unit: iss.unit,
          fifoCostPaise: 0,
          variancePct: vPct.toFixed(2),
          flagged: Math.abs(vPct) > VARIANCE_TOLERANCE_PCT,
        });
      }

      if (postImmediately) {
        return await postRunInTx(tx, run.id, userId);
      }
      return run;
    });

    res.status(201).json({ run: result });
  } catch (error: any) {
    console.error('Error creating production run:', error);
    res.status(400).json({ error: error.message || 'Failed to create production run' });
  }
});

router.post('/runs/:id/post', requireAuth, requireRole(['owner', 'admin', 'production']), async (req: AuthRequest, res) => {
  try {
    const runId = Number(req.params.id);
    const userId = req.dbUser!.id;
    const posted = await db.transaction(async (tx) => {
      return await postRunInTx(tx, runId, userId);
    });
    res.json({ run: posted });
  } catch (error: any) {
    console.error('Error posting production run:', error);
    res.status(400).json({ error: error.message || 'Failed to post production run' });
  }
});

router.put('/runs/:id', requireAuth, requireRole(['owner', 'admin', 'production']), async (req: AuthRequest, res) => {
  try {
    const runId = Number(req.params.id);
    const user = req.dbUser!;
    const {
      actualOutput,
      damagedUnits,
      cartonsUsed,
      labourCostPaise,
      overheadCostPaise,
      notes,
      reason,
      issues,
    } = req.body;

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionRuns)
        .where(eq(productionRuns.id, runId))
        .for('update');

      if (!existing) throw new Error('Production run not found');

      if (existing.status === 'posted') {
        if (user.role !== 'owner' && user.role !== 'admin') {
          throw new Error('Posted production runs can only be edited via Owner/Admin override');
        }
        if (!reason || String(reason).trim().length < 4) {
          throw new Error('An audit reason (min 4 chars) is mandatory when overriding a posted production run');
        }

        const newLabour = labourCostPaise !== undefined ? Math.round(Number(labourCostPaise)) : existing.labourCostPaise;
        const newOverhead = overheadCostPaise !== undefined ? Math.round(Number(overheadCostPaise)) : existing.overheadCostPaise;
        const oldDirect = existing.labourCostPaise + existing.overheadCostPaise;
        const newDirect = newLabour + newOverhead;
        const materialCost = existing.totalCostPaise - oldDirect;
        const newTotal = materialCost + newDirect;
        const outQty = Number(existing.actualOutput);
        const newCpp = outQty > 0 ? Math.round(newTotal / outQty) : 0;

        await tx.insert(productionRunAuditLog).values({
          productionRunId: runId,
          changedBy: user.id,
          reason: String(reason).trim(),
          oldValues: {
            labourCostPaise: existing.labourCostPaise,
            overheadCostPaise: existing.overheadCostPaise,
            totalCostPaise: existing.totalCostPaise,
            costPerPacketPaise: existing.costPerPacketPaise,
            notes: existing.notes,
          },
          newValues: {
            labourCostPaise: newLabour,
            overheadCostPaise: newOverhead,
            totalCostPaise: newTotal,
            costPerPacketPaise: newCpp,
            notes: notes ?? existing.notes,
          },
        });

        const [saved] = await tx
          .update(productionRuns)
          .set({
            labourCostPaise: newLabour,
            overheadCostPaise: newOverhead,
            totalCostPaise: newTotal,
            costPerPacketPaise: newCpp,
            notes: notes ?? existing.notes,
          })
          .where(eq(productionRuns.id, runId))
          .returning();

        return saved;
      }

      // Draft edit: free
      const nextActualOut = actualOutput !== undefined ? Number(actualOutput) : Number(existing.actualOutput);
      const expectedNum = Number(existing.expectedOutput);
      const yieldVariancePct = computeVariancePct(nextActualOut, expectedNum);

      const [saved] = await tx
        .update(productionRuns)
        .set({
          actualOutput: nextActualOut.toFixed(4),
          damagedUnits: damagedUnits !== undefined ? Math.round(Number(damagedUnits)) : existing.damagedUnits,
          cartonsUsed: cartonsUsed !== undefined ? Math.round(Number(cartonsUsed)) : existing.cartonsUsed,
          labourCostPaise: labourCostPaise !== undefined ? Math.round(Number(labourCostPaise)) : existing.labourCostPaise,
          overheadCostPaise: overheadCostPaise !== undefined ? Math.round(Number(overheadCostPaise)) : existing.overheadCostPaise,
          yieldVariancePct: yieldVariancePct.toFixed(2),
          yieldFlagged: Math.abs(yieldVariancePct) > VARIANCE_TOLERANCE_PCT,
          notes: notes !== undefined ? notes : existing.notes,
        })
        .where(eq(productionRuns.id, runId))
        .returning();

      if (Array.isArray(issues)) {
        for (const iss of issues) {
          const vPct = computeVariancePct(Number(iss.actualQty), Number(iss.plannedQty));
          await tx
            .update(productionRunIssues)
            .set({
              actualQty: Number(iss.actualQty).toFixed(4),
              variancePct: vPct.toFixed(2),
              flagged: Math.abs(vPct) > VARIANCE_TOLERANCE_PCT,
            })
            .where(eq(productionRunIssues.id, Number(iss.id)));
        }
      }

      return saved;
    });

    res.json({ run: updated });
  } catch (error: any) {
    console.error('Error updating production run:', error);
    res.status(400).json({ error: error.message || 'Failed to update production run' });
  }
});

router.get('/runs/:id/pdf', requireAuth, requireRole(['owner', 'admin', 'production', 'accountant']), async (req, res) => {
  try {
    const runId = Number(req.params.id);
    const [run] = await db
      .select({
        id: productionRuns.id,
        runNo: productionRuns.runNo,
        runDate: productionRuns.runDate,
        productName: products.name,
        sku: products.sku,
        sellingPricePaise: products.sellingPricePaise,
        batchSize: productionRuns.batchSize,
        expectedOutput: productionRuns.expectedOutput,
        actualOutput: productionRuns.actualOutput,
        damagedUnits: productionRuns.damagedUnits,
        yieldVariancePct: productionRuns.yieldVariancePct,
        yieldFlagged: productionRuns.yieldFlagged,
        labourCostPaise: productionRuns.labourCostPaise,
        overheadCostPaise: productionRuns.overheadCostPaise,
        totalCostPaise: productionRuns.totalCostPaise,
        costPerPacketPaise: productionRuns.costPerPacketPaise,
        status: productionRuns.status,
      })
      .from(productionRuns)
      .innerJoin(products, eq(productionRuns.productId, products.id))
      .where(eq(productionRuns.id, runId))
      .limit(1);

    if (!run) return res.status(404).json({ error: 'Production run not found' });

    const issues = await db
      .select({
        materialName: rawMaterials.name,
        plannedQty: productionRunIssues.plannedQty,
        actualQty: productionRunIssues.actualQty,
        unit: productionRunIssues.unit,
        fifoCostPaise: productionRunIssues.fifoCostPaise,
        variancePct: productionRunIssues.variancePct,
        flagged: productionRunIssues.flagged,
      })
      .from(productionRunIssues)
      .innerJoin(rawMaterials, eq(productionRunIssues.rawMaterialId, rawMaterials.id))
      .where(eq(productionRunIssues.productionRunId, runId))
      .orderBy(asc(productionRunIssues.id));

    const pdf = await buildProductionCostSheetPdfBuffer({ ...run, issues });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${run.runNo}-cost-sheet.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error('Error generating production cost sheet PDF:', error);
    res.status(500).json({ error: 'Failed to generate cost sheet PDF' });
  }
});

export default router;
