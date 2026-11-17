import { count, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  bomLines,
  customers,
  priceLists,
  products,
  rawMaterialBatches,
  rawMaterials,
  stockMovements,
  suppliers,
} from '../db/schema.ts';

export async function ensureBenchmarkSeed(userId: number, forceReset = false): Promise<{ seeded: boolean }> {
  if (!forceReset) {
    const existing = await db.select({ value: count() }).from(products);
    if (Number(existing[0]?.value ?? 0) > 0) {
      return { seeded: false };
    }
  }

  await db.transaction(async (tx) => {
    if (forceReset) {
      await tx.execute(sql`
        TRUNCATE TABLE
          production_run_audit_log,
          production_run_issues,
          production_runs,
          payments,
          dispatches,
          invoice_lines,
          invoices,
          order_lines,
          orders,
          stock_movements,
          raw_material_batches,
          purchase_lines,
          purchases,
          price_lists,
          bom_lines,
          products,
          raw_materials,
          suppliers,
          customers
        RESTART IDENTITY CASCADE
      `);
    }

    // Double check inside tx in case of concurrent initial calls
    const checkCount = await tx.select({ value: count() }).from(products);
    if (Number(checkCount[0]?.value ?? 0) > 0) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    // 1. Customers (Tamil Nadu Retailer + Karnataka Distributor + Madurai Retailer)
    const insertedCustomers = await tx
      .insert(customers)
      .values([
        {
          name: 'Kaveri Supermart (TN Retailer)',
          type: 'retailer',
          gstin: '33AABCK1234F1Z5',
          stateCode: '33',
          stateName: 'Tamil Nadu',
          address: '42 Thillai Nagar Main Rd, Tiruchirappalli - 620018',
          phone: '+91 98424 11220',
        },
        {
          name: 'Deccan Agro Foods (KA Distributor B)',
          type: 'distributor',
          gstin: '29AABCD5678G1Z2',
          stateCode: '29',
          stateName: 'Karnataka',
          address: '108 100ft Road, Indiranagar, Bengaluru - 560038',
          phone: '+91 98450 88771',
        },
        {
          name: 'Sri Murugan Agencies (TN)',
          type: 'retailer',
          gstin: '33AADCM9012H1Z8',
          stateCode: '33',
          stateName: 'Tamil Nadu',
          address: '18 West Tower Street, Madurai - 625001',
          phone: '+91 94431 55009',
        },
      ])
      .returning();

    // 2. Suppliers
    await tx.insert(suppliers).values([
      {
        name: 'Trichy Cauvery Agro Mills',
        gstin: '33AAACT4321K1Z1',
        stateCode: '33',
        address: '112 Gandhi Market Grain Mandi, Tiruchirappalli - 620008',
        phone: '+91 431 270 4412',
      },
      {
        name: 'Kovai FlexiPack & Cartons',
        gstin: '33AAACK8765M1Z4',
        stateCode: '33',
        address: 'Plot 88 Avinashi Industrial Corridor, Coimbatore - 641014',
        phone: '+91 422 259 3310',
      },
    ]);

    // 3. Raw Materials (exact Section 5 Benchmark rates & units)
    const insertedMaterials = await tx
      .insert(rawMaterials)
      .values([
        {
          name: 'Rice & Urad Flour',
          unit: 'kg',
          reorderLevel: '30.0000',
          defaultRatePaise: 4200, // ₹42/kg
          materialCategory: 'ingredient',
        },
        {
          name: 'Cooking Oil',
          unit: 'litre',
          reorderLevel: '15.0000',
          defaultRatePaise: 14000, // ₹140/L
          materialCategory: 'ingredient',
        },
        {
          name: 'Salt & Spice Mix',
          unit: 'kg',
          reorderLevel: '3.0000',
          defaultRatePaise: 20000, // ₹200/kg
          materialCategory: 'ingredient',
        },
        {
          name: '200g Pouch',
          unit: 'piece',
          reorderLevel: '150.0000',
          defaultRatePaise: 250, // ₹2.50/pc
          materialCategory: 'pouch',
        },
        {
          name: 'Carton (20 pkt)',
          unit: 'piece',
          reorderLevel: '10.0000',
          defaultRatePaise: 1500, // ₹15/pc
          materialCategory: 'carton',
        },
      ])
      .returning();

    const [flour, oil, spice, pouch, carton] = insertedMaterials;

    // 4. Finished Products
    const insertedProducts = await tx
      .insert(products)
      .values([
        {
          sku: 'MUR-200',
          name: 'Murukku 200g',
          packSizeG: 200,
          hsnCode: '21069099',
          sellingPricePaise: 5000, // ₹50/pkt
          gstRatePct: '5.00',
          batchOutputQty: 200,
          isActive: true,
        },
        {
          sku: 'RIB-200',
          name: 'Ribbon Pakoda 200g',
          packSizeG: 200,
          hsnCode: '21069099',
          sellingPricePaise: 5500, // ₹55/pkt
          gstRatePct: '5.00',
          batchOutputQty: 200,
          isActive: true,
        },
        {
          sku: 'KAR-200',
          name: 'Kara Sev 200g',
          packSizeG: 200,
          hsnCode: '21069099',
          sellingPricePaise: 5200, // ₹52/pkt
          gstRatePct: '5.00',
          batchOutputQty: 200,
          isActive: true,
        },
      ])
      .returning();

    const [murukku, ribbon, karasev] = insertedProducts;

    // 5. BOM Lines (1 batch = 200 packets)
    await tx.insert(bomLines).values([
      // Murukku 200g (exact Section 5 Benchmark BOM)
      { productId: murukku.id, rawMaterialId: flour.id, qtyPerBatch: '40.0000', unit: 'kg' },
      { productId: murukku.id, rawMaterialId: oil.id, qtyPerBatch: '10.0000', unit: 'litre' },
      { productId: murukku.id, rawMaterialId: spice.id, qtyPerBatch: '1.2000', unit: 'kg' },
      { productId: murukku.id, rawMaterialId: pouch.id, qtyPerBatch: '200.0000', unit: 'piece' },
      { productId: murukku.id, rawMaterialId: carton.id, qtyPerBatch: '10.0000', unit: 'piece' },

      // Ribbon Pakoda 200g
      { productId: ribbon.id, rawMaterialId: flour.id, qtyPerBatch: '38.0000', unit: 'kg' },
      { productId: ribbon.id, rawMaterialId: oil.id, qtyPerBatch: '11.0000', unit: 'litre' },
      { productId: ribbon.id, rawMaterialId: spice.id, qtyPerBatch: '1.5000', unit: 'kg' },
      { productId: ribbon.id, rawMaterialId: pouch.id, qtyPerBatch: '200.0000', unit: 'piece' },
      { productId: ribbon.id, rawMaterialId: carton.id, qtyPerBatch: '10.0000', unit: 'piece' },

      // Kara Sev 200g
      { productId: karasev.id, rawMaterialId: flour.id, qtyPerBatch: '36.0000', unit: 'kg' },
      { productId: karasev.id, rawMaterialId: oil.id, qtyPerBatch: '10.0000', unit: 'litre' },
      { productId: karasev.id, rawMaterialId: spice.id, qtyPerBatch: '1.8000', unit: 'kg' },
      { productId: karasev.id, rawMaterialId: pouch.id, qtyPerBatch: '200.0000', unit: 'piece' },
      { productId: karasev.id, rawMaterialId: carton.id, qtyPerBatch: '10.0000', unit: 'piece' },
    ]);

    // 6. Default Price Lists
    await tx.insert(priceLists).values([
      { productId: murukku.id, customerId: null, pricePaise: 5000, effectiveFrom: today },
      { productId: ribbon.id, customerId: null, pricePaise: 5500, effectiveFrom: today },
      { productId: karasev.id, customerId: null, pricePaise: 5200, effectiveFrom: today },
      { productId: murukku.id, customerId: insertedCustomers[0].id, pricePaise: 5000, effectiveFrom: today },
    ]);

    // 7. Opening Raw Material Batches (FIFO Queue)
    const openTime = new Date(Date.now() - 86400000 * 7); // 7 days ago so new purchases sort strictly after opening stock
    await tx.insert(rawMaterialBatches).values([
      {
        rawMaterialId: flour.id,
        purchaseId: null,
        qtyInitial: '100.0000',
        qtyRemaining: '100.0000',
        ratePaise: 4200,
        batchNo: 'OPEN-FLOUR-01',
        expiryDate: '2027-05-01',
        receivedAt: openTime,
      },
      {
        rawMaterialId: oil.id,
        purchaseId: null,
        qtyInitial: '30.0000',
        qtyRemaining: '30.0000',
        ratePaise: 14000,
        batchNo: 'OPEN-OIL-01',
        expiryDate: '2027-06-01',
        receivedAt: openTime,
      },
      {
        rawMaterialId: spice.id,
        purchaseId: null,
        qtyInitial: '5.0000',
        qtyRemaining: '5.0000',
        ratePaise: 20000,
        batchNo: 'OPEN-SPICE-01',
        expiryDate: '2027-08-01',
        receivedAt: openTime,
      },
      {
        rawMaterialId: pouch.id,
        purchaseId: null,
        qtyInitial: '500.0000',
        qtyRemaining: '500.0000',
        ratePaise: 250,
        batchNo: 'OPEN-POUCH-01',
        expiryDate: null,
        receivedAt: openTime,
      },
      {
        rawMaterialId: carton.id,
        purchaseId: null,
        qtyInitial: '30.0000',
        qtyRemaining: '30.0000',
        ratePaise: 1500,
        batchNo: 'OPEN-CARTON-01',
        expiryDate: null,
        receivedAt: openTime,
      },
    ]);

    // 8. Opening Stock Movements (Ledger-based truth)
    await tx.insert(stockMovements).values([
      {
        itemType: 'raw',
        itemId: flour.id,
        movementType: 'purchase',
        qty: '100.0000',
        unit: 'kg',
        ratePaise: 4200,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-FLOUR-01',
        expiryDate: '2027-05-01',
        notes: 'Opening stock balance (Benchmark Section 5)',
        createdBy: userId,
      },
      {
        itemType: 'raw',
        itemId: oil.id,
        movementType: 'purchase',
        qty: '30.0000',
        unit: 'litre',
        ratePaise: 14000,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-OIL-01',
        expiryDate: '2027-06-01',
        notes: 'Opening stock balance (Benchmark Section 5)',
        createdBy: userId,
      },
      {
        itemType: 'raw',
        itemId: spice.id,
        movementType: 'purchase',
        qty: '5.0000',
        unit: 'kg',
        ratePaise: 20000,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-SPICE-01',
        expiryDate: '2027-08-01',
        notes: 'Opening stock balance (Benchmark Section 5)',
        createdBy: userId,
      },
      {
        itemType: 'raw',
        itemId: pouch.id,
        movementType: 'purchase',
        qty: '500.0000',
        unit: 'piece',
        ratePaise: 250,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-POUCH-01',
        expiryDate: null,
        notes: 'Opening stock balance (Benchmark Section 5)',
        createdBy: userId,
      },
      {
        itemType: 'raw',
        itemId: carton.id,
        movementType: 'purchase',
        qty: '30.0000',
        unit: 'piece',
        ratePaise: 1500,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-CARTON-01',
        expiryDate: null,
        notes: 'Opening stock balance (Benchmark Section 5)',
        createdBy: userId,
      },
      {
        itemType: 'finished',
        itemId: murukku.id,
        movementType: 'production_in',
        qty: '50.0000',
        unit: 'packet',
        ratePaise: 3000,
        sourceType: 'opening',
        sourceId: 0,
        batchNo: 'OPEN-FG-MUR-01',
        expiryDate: '2027-02-01',
        notes: 'Opening finished goods balance (50 packets Murukku 200g)',
        createdBy: userId,
      },
    ]);
  });

  return { seeded: true };
}
