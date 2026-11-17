import { Router } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bomLines, customers, priceLists, products, rawMaterials, suppliers } from '../db/schema.ts';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { getStockBalancesMap } from '../services/stockService.ts';

const router = Router();

router.get('/customers', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(customers).orderBy(asc(customers.name));
    res.json({ customers: rows });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.post('/customers', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { name, type, gstin, stateCode, stateName, address, phone } = req.body;
    if (!name || !address || !stateCode) {
      return res.status(400).json({ error: 'Name, state code, and address are required' });
    }
    const [created] = await db
      .insert(customers)
      .values({
        name,
        type: type || 'retailer',
        gstin: gstin || null,
        stateCode: String(stateCode),
        stateName: stateName || (stateCode === '33' ? 'Tamil Nadu' : 'Other State'),
        address,
        phone: phone || null,
      })
      .returning();
    res.status(201).json({ customer: created });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.put('/customers/:id', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, type, gstin, stateCode, stateName, address, phone } = req.body;
    const [updated] = await db
      .update(customers)
      .set({
        name,
        type,
        gstin: gstin || null,
        stateCode: String(stateCode),
        stateName,
        address,
        phone: phone || null,
      })
      .where(eq(customers.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    res.json({ customer: updated });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

router.get('/products', requireAuth, async (req, res) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const allProducts = await db.select().from(products).orderBy(asc(products.id));
    const finishedBalances = await getStockBalancesMap('finished');
    const customPrices = await db.select().from(priceLists).orderBy(desc(priceLists.id));

    const enriched = allProducts.map((p) => {
      let effectivePricePaise = p.sellingPricePaise;
      if (customerId) {
        const match = customPrices.find(
          (pl) => pl.productId === p.id && pl.customerId === customerId
        );
        if (match) effectivePricePaise = match.pricePaise;
      }
      return {
        ...p,
        effectivePricePaise,
        stockOnHand: finishedBalances.get(p.id) ?? 0,
      };
    });

    res.json({ products: enriched });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.post('/products', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { sku, name, packSizeG, hsnCode, sellingPricePaise, gstRatePct, batchOutputQty } = req.body;
    if (!sku || !name || !hsnCode || !sellingPricePaise) {
      return res.status(400).json({ error: 'SKU, name, HSN code, and selling price are required' });
    }
    const [created] = await db
      .insert(products)
      .values({
        sku: String(sku).trim().toUpperCase(),
        name: String(name).trim(),
        packSizeG: Math.max(1, Math.round(Number(packSizeG || 200))),
        hsnCode: String(hsnCode).trim(),
        sellingPricePaise: Math.max(1, Math.round(Number(sellingPricePaise))),
        gstRatePct: Number(gstRatePct ?? 5).toFixed(2),
        batchOutputQty: Math.max(1, Math.round(Number(batchOutputQty || 200))),
        isActive: true,
      })
      .returning();
    res.status(201).json({ product: created });
  } catch (error: any) {
    console.error('Error creating product:', error);
    res.status(400).json({ error: error.message || 'Failed to create product' });
  }
});

router.put('/products/:id', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, packSizeG, hsnCode, sellingPricePaise, gstRatePct, batchOutputQty, isActive } = req.body;
    const [updated] = await db
      .update(products)
      .set({
        name,
        packSizeG: Math.round(Number(packSizeG)),
        hsnCode,
        sellingPricePaise: Math.round(Number(sellingPricePaise)),
        gstRatePct: Number(gstRatePct).toFixed(2),
        batchOutputQty: Math.round(Number(batchOutputQty)),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      })
      .where(eq(products.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: updated });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.get('/raw-materials', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(rawMaterials).orderBy(asc(rawMaterials.id));
    const balances = await getStockBalancesMap('raw');
    const enriched = rows.map((m) => ({
      ...m,
      stockOnHand: balances.get(m.id) ?? 0,
    }));
    res.json({ rawMaterials: enriched });
  } catch (error) {
    console.error('Error fetching raw materials:', error);
    res.status(500).json({ error: 'Failed to fetch raw materials' });
  }
});

router.post('/raw-materials', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { name, unit, reorderLevel, defaultRatePaise, materialCategory } = req.body;
    if (!name || !unit) {
      return res.status(400).json({ error: 'Material name and unit are required' });
    }
    const [created] = await db
      .insert(rawMaterials)
      .values({
        name: String(name).trim(),
        unit: String(unit).trim(),
        reorderLevel: Number(reorderLevel || 10).toFixed(4),
        defaultRatePaise: Math.max(0, Math.round(Number(defaultRatePaise || 0))),
        materialCategory: materialCategory || 'ingredient',
      })
      .returning();
    res.status(201).json({ rawMaterial: created });
  } catch (error) {
    console.error('Error creating raw material:', error);
    res.status(500).json({ error: 'Failed to create raw material' });
  }
});

router.get('/suppliers', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
    res.json({ suppliers: rows });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

router.post('/suppliers', requireAuth, requireRole(['owner', 'admin', 'accountant']), async (req, res) => {
  try {
    const { name, gstin, stateCode, address, phone } = req.body;
    if (!name || !address) {
      return res.status(400).json({ error: 'Supplier name and address are required' });
    }
    const [created] = await db
      .insert(suppliers)
      .values({
        name,
        gstin: gstin || null,
        stateCode: stateCode || '33',
        address,
        phone: phone || null,
      })
      .returning();
    res.status(201).json({ supplier: created });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

router.get('/bom/:productId', requireAuth, async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    const lines = await db
      .select({
        id: bomLines.id,
        productId: bomLines.productId,
        rawMaterialId: bomLines.rawMaterialId,
        qtyPerBatch: bomLines.qtyPerBatch,
        unit: bomLines.unit,
        materialName: rawMaterials.name,
        materialCategory: rawMaterials.materialCategory,
        defaultRatePaise: rawMaterials.defaultRatePaise,
      })
      .from(bomLines)
      .innerJoin(rawMaterials, eq(bomLines.rawMaterialId, rawMaterials.id))
      .where(eq(bomLines.productId, productId))
      .orderBy(asc(bomLines.id));

    const balances = await getStockBalancesMap('raw');
    const enriched = lines.map((l) => ({
      ...l,
      stockOnHand: balances.get(l.rawMaterialId) ?? 0,
    }));

    res.json({ bomLines: enriched });
  } catch (error) {
    console.error('Error fetching BOM:', error);
    res.status(500).json({ error: 'Failed to fetch BOM lines' });
  }
});

router.put('/bom/:productId', requireAuth, requireRole(['owner', 'admin', 'production']), async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    const { lines } = req.body as {
      lines: Array<{ rawMaterialId: number; qtyPerBatch: number }>;
    };
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'At least one BOM material line is required' });
    }

    await db.transaction(async (tx) => {
      await tx.delete(bomLines).where(eq(bomLines.productId, productId));
      for (const l of lines) {
        const [mat] = await tx
          .select()
          .from(rawMaterials)
          .where(eq(rawMaterials.id, Number(l.rawMaterialId)))
          .limit(1);
        if (!mat) throw new Error(`Raw material #${l.rawMaterialId} not found`);

        await tx.insert(bomLines).values({
          productId,
          rawMaterialId: mat.id,
          qtyPerBatch: Number(l.qtyPerBatch).toFixed(4),
          unit: mat.unit,
        });
      }
    });

    res.json({ updated: true });
  } catch (error: any) {
    console.error('Error saving BOM:', error);
    res.status(400).json({ error: error.message || 'Failed to update BOM' });
  }
});

router.get('/price-lists', requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: priceLists.id,
        productId: priceLists.productId,
        productName: products.name,
        sku: products.sku,
        basePricePaise: products.sellingPricePaise,
        customerId: priceLists.customerId,
        pricePaise: priceLists.pricePaise,
        effectiveFrom: priceLists.effectiveFrom,
      })
      .from(priceLists)
      .innerJoin(products, eq(priceLists.productId, products.id))
      .orderBy(desc(priceLists.id));

    const allCustomers = await db.select().from(customers);
    const custMap = new Map(allCustomers.map((c) => [c.id, c.name]));

    res.json({
      priceLists: rows.map((r) => ({
        ...r,
        customerName: r.customerId ? custMap.get(r.customerId) || 'Unknown' : 'Default (All)',
      })),
    });
  } catch (error) {
    console.error('Error loading price lists:', error);
    res.status(500).json({ error: 'Failed to load price lists' });
  }
});

router.post('/price-lists', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { productId, customerId, pricePaise, effectiveFrom } = req.body;
    if (!productId || !pricePaise) {
      return res.status(400).json({ error: 'Product and price are required' });
    }
    const [created] = await db
      .insert(priceLists)
      .values({
        productId: Number(productId),
        customerId: customerId ? Number(customerId) : null,
        pricePaise: Math.max(1, Math.round(Number(pricePaise))),
        effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
      })
      .returning();
    res.status(201).json({ priceList: created });
  } catch (error) {
    console.error('Error saving price list:', error);
    res.status(500).json({ error: 'Failed to save price list' });
  }
});

router.delete('/price-lists/:id', requireAuth, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(priceLists).where(eq(priceLists.id, id));
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting price list:', error);
    res.status(500).json({ error: 'Failed to delete price list' });
  }
});

export default router;
