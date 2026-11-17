import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { rawMaterialBatches, stockMovements } from '../db/schema.ts';

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getStockBalancesMap(
  itemType: 'raw' | 'finished',
  executor: DbExecutor = db
): Promise<Map<number, number>> {
  const rows = await executor
    .select({
      itemId: stockMovements.itemId,
      balance: sql<string>`COALESCE(SUM(${stockMovements.qty}), 0)`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.itemType, itemType))
    .groupBy(stockMovements.itemId);

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.itemId, Number(Number(r.balance).toFixed(4)));
  }
  return map;
}

export async function getSingleItemBalance(
  itemType: 'raw' | 'finished',
  itemId: number,
  executor: DbExecutor = db
): Promise<number> {
  const rows = await executor
    .select({
      balance: sql<string>`COALESCE(SUM(${stockMovements.qty}), 0)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.itemType, itemType),
        eq(stockMovements.itemId, itemId)
      )
    );

  return Number(Number(rows[0]?.balance ?? 0).toFixed(4));
}

export interface FifoAllocation {
  batchId: number;
  batchNo: string;
  qty: number;
  ratePaise: number;
  costPaise: number;
}

export async function consumeFifoBatches(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rawMaterialId: number,
  qtyNeeded: number
): Promise<{ totalCostPaise: number; weightedAvgRatePaise: number; allocations: FifoAllocation[] }> {
  if (qtyNeeded <= 0) {
    return { totalCostPaise: 0, weightedAvgRatePaise: 0, allocations: [] };
  }

  // Row-level lock via FOR UPDATE inside ACID PostgreSQL transaction
  const batches = await tx
    .select()
    .from(rawMaterialBatches)
    .where(
      and(
        eq(rawMaterialBatches.rawMaterialId, rawMaterialId),
        gt(rawMaterialBatches.qtyRemaining, '0')
      )
    )
    .orderBy(asc(rawMaterialBatches.receivedAt), asc(rawMaterialBatches.id))
    .for('update');

  let remainingToConsume = qtyNeeded;
  let totalCostPaise = 0;
  const allocations: FifoAllocation[] = [];

  for (const batch of batches) {
    if (remainingToConsume <= 0.00001) break;
    const avail = Number(batch.qtyRemaining);
    if (avail <= 0) continue;

    const take = Math.min(avail, remainingToConsume);
    const newRemaining = Number((avail - take).toFixed(4));
    const costPaise = Math.round(take * batch.ratePaise);

    await tx
      .update(rawMaterialBatches)
      .set({ qtyRemaining: newRemaining.toFixed(4) })
      .where(eq(rawMaterialBatches.id, batch.id));

    allocations.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      qty: Number(take.toFixed(4)),
      ratePaise: batch.ratePaise,
      costPaise,
    });

    totalCostPaise += costPaise;
    remainingToConsume = Number((remainingToConsume - take).toFixed(4));
  }

  if (remainingToConsume > 0.0001) {
    throw new Error(
      `Insufficient FIFO batch stock for raw material #${rawMaterialId}. Short by ${remainingToConsume.toFixed(4)} units.`
    );
  }

  const weightedAvgRatePaise = Math.round(totalCostPaise / qtyNeeded);
  return { totalCostPaise, weightedAvgRatePaise, allocations };
}
