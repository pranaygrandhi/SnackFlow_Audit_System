import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. Users & RBAC (Linked via Firebase Auth UID)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull().default('owner'), // salesman | admin | production | accountant | owner
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Customers (Retailers & Distributors with State Code for CGST/SGST vs IGST)
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('retailer'), // retailer | distributor
  gstin: text('gstin'),
  stateCode: text('state_code').notNull().default('33'), // 33 = Tamil Nadu
  stateName: text('state_name').notNull().default('Tamil Nadu'),
  address: text('address').notNull(),
  phone: text('phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Finished Products
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  packSizeG: integer('pack_size_g').notNull(),
  hsnCode: text('hsn_code').notNull(),
  sellingPricePaise: integer('selling_price_paise').notNull(),
  gstRatePct: numeric('gst_rate_pct', { precision: 5, scale: 2 }).notNull().default('5.00'),
  batchOutputQty: integer('batch_output_qty').notNull().default(200),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Raw Materials
export const rawMaterials = pgTable('raw_materials', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  unit: text('unit').notNull(), // kg | litre | piece | g
  reorderLevel: numeric('reorder_level', { precision: 15, scale: 4 }).notNull().default('10.0000'),
  defaultRatePaise: integer('default_rate_paise').notNull().default(0),
  materialCategory: text('material_category').notNull().default('ingredient'), // ingredient | pouch | carton
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Bill of Materials (BOM Lines per 1 standard batch)
export const bomLines = pgTable('bom_lines', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .references(() => products.id, { onDelete: 'cascade' })
    .notNull(),
  rawMaterialId: integer('raw_material_id')
    .references(() => rawMaterials.id, { onDelete: 'restrict' })
    .notNull(),
  qtyPerBatch: numeric('qty_per_batch', { precision: 15, scale: 4 }).notNull(),
  unit: text('unit').notNull(),
});

// 6. Customer / Default Price Lists
export const priceLists = pgTable('price_lists', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .references(() => products.id, { onDelete: 'cascade' })
    .notNull(),
  customerId: integer('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  pricePaise: integer('price_paise').notNull(),
  effectiveFrom: text('effective_from').notNull(), // YYYY-MM-DD
});

// 7. Suppliers
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  gstin: text('gstin'),
  stateCode: text('state_code').notNull().default('33'),
  address: text('address').notNull(),
  phone: text('phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 8. Purchases & Purchase Lines
export const purchases = pgTable('purchases', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id')
    .references(() => suppliers.id, { onDelete: 'restrict' })
    .notNull(),
  purchaseDate: text('purchase_date').notNull(), // YYYY-MM-DD
  invoiceNo: text('invoice_no').notNull(),
  notes: text('notes'),
  totalPaise: integer('total_paise').notNull().default(0),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const purchaseLines = pgTable('purchase_lines', {
  id: serial('id').primaryKey(),
  purchaseId: integer('purchase_id')
    .references(() => purchases.id, { onDelete: 'cascade' })
    .notNull(),
  rawMaterialId: integer('raw_material_id')
    .references(() => rawMaterials.id, { onDelete: 'restrict' })
    .notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  unit: text('unit').notNull(),
  ratePaise: integer('rate_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  batchNo: text('batch_no').notNull(),
  expiryDate: text('expiry_date'),
});

// 9. Raw Material Batches (FIFO Costing Queue)
export const rawMaterialBatches = pgTable('raw_material_batches', {
  id: serial('id').primaryKey(),
  rawMaterialId: integer('raw_material_id')
    .references(() => rawMaterials.id, { onDelete: 'restrict' })
    .notNull(),
  purchaseId: integer('purchase_id').references(() => purchases.id, { onDelete: 'set null' }),
  qtyInitial: numeric('qty_initial', { precision: 15, scale: 4 }).notNull(),
  qtyRemaining: numeric('qty_remaining', { precision: 15, scale: 4 }).notNull(),
  ratePaise: integer('rate_paise').notNull(),
  batchNo: text('batch_no').notNull(),
  expiryDate: text('expiry_date'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
});

// 10. Ledger-Based Stock Movements (Closing balance ALWAYS computed as SUM(qty))
export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  itemType: text('item_type').notNull(), // raw | finished
  itemId: integer('item_id').notNull(),
  movementType: text('movement_type').notNull(), // purchase | issue | production_in | sale | adjustment | return | damage
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(), // positive = in, negative = out
  unit: text('unit').notNull(),
  ratePaise: integer('rate_paise').notNull().default(0),
  sourceType: text('source_type').notNull(), // opening | purchase | production_run | invoice | credit_note | adjustment
  sourceId: integer('source_id').notNull().default(0),
  batchNo: text('batch_no'),
  expiryDate: text('expiry_date'),
  notes: text('notes'),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 11. Orders & Order Lines
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNo: text('order_no').notNull().unique(),
  salesmanId: integer('salesman_id')
    .references(() => users.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  orderDate: text('order_date').notNull(), // YYYY-MM-DD
  status: text('status').notNull().default('submitted'), // draft | submitted | approved | rejected | invoiced | dispatched
  notes: text('notes'),
  clientOfflineId: text('client_offline_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orderLines = pgTable('order_lines', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  qty: integer('qty').notNull(),
  pricePaise: integer('price_paise').notNull(),
  discountPaise: integer('discount_paise').notNull().default(0),
});

// 12. Invoices & Invoice Lines (GST-compliant + Credit Notes)
export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').references(() => orders.id),
  invoiceNo: text('invoice_no').notNull().unique(),
  invoiceType: text('invoice_type').notNull().default('tax_invoice'), // tax_invoice | credit_note
  invoiceDate: text('invoice_date').notNull(), // YYYY-MM-DD
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  companyStateCode: text('company_state_code').notNull().default('33'),
  placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
  taxableAmountPaise: integer('taxable_amount_paise').notNull(),
  cgstPaise: integer('cgst_paise').notNull().default(0),
  sgstPaise: integer('sgst_paise').notNull().default(0),
  igstPaise: integer('igst_paise').notNull().default(0),
  totalPaise: integer('total_paise').notNull(),
  status: text('status').notNull().default('active'), // active | cancelled
  cancelledByInvoiceId: integer('cancelled_by_invoice_id'),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .references(() => invoices.id, { onDelete: 'cascade' })
    .notNull(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  qty: integer('qty').notNull(),
  hsnCode: text('hsn_code').notNull(),
  pricePaise: integer('price_paise').notNull(),
  discountPaise: integer('discount_paise').notNull().default(0),
  taxablePaise: integer('taxable_paise').notNull(),
  gstRatePct: numeric('gst_rate_pct', { precision: 5, scale: 2 }).notNull(),
  cgstPaise: integer('cgst_paise').notNull().default(0),
  sgstPaise: integer('sgst_paise').notNull().default(0),
  igstPaise: integer('igst_paise').notNull().default(0),
});

// 13. Dispatches
export const dispatches = pgTable('dispatches', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .references(() => invoices.id)
    .notNull(),
  dispatchDate: text('dispatch_date').notNull(), // YYYY-MM-DD
  vehicleNo: text('vehicle_no'),
  notes: text('notes'),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 14. Payments
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .references(() => invoices.id)
    .notNull(),
  customerId: integer('customer_id')
    .references(() => customers.id)
    .notNull(),
  amountPaise: integer('amount_paise').notNull(),
  paymentDate: text('payment_date').notNull(), // YYYY-MM-DD
  mode: text('mode').notNull().default('upi'), // cash | bank | upi
  referenceNo: text('reference_no'),
  notes: text('notes'),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. Production Runs, Issues & Audit Log
export const productionRuns = pgTable('production_runs', {
  id: serial('id').primaryKey(),
  runNo: text('run_no').notNull().unique(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  runDate: text('run_date').notNull(), // YYYY-MM-DD
  batchSize: numeric('batch_size', { precision: 15, scale: 4 }).notNull(),
  expectedOutput: numeric('expected_output', { precision: 15, scale: 4 }).notNull(),
  actualOutput: numeric('actual_output', { precision: 15, scale: 4 }).notNull(),
  damagedUnits: integer('damaged_units').notNull().default(0),
  cartonsUsed: integer('cartons_used').notNull().default(0),
  labourCostPaise: integer('labour_cost_paise').notNull().default(0),
  overheadCostPaise: integer('overhead_cost_paise').notNull().default(0),
  totalCostPaise: integer('total_cost_paise').notNull().default(0),
  costPerPacketPaise: integer('cost_per_packet_paise').notNull().default(0),
  yieldVariancePct: numeric('yield_variance_pct', { precision: 8, scale: 2 }).notNull().default('0.00'),
  yieldFlagged: boolean('yield_flagged').notNull().default(false),
  status: text('status').notNull().default('draft'), // draft | posted
  notes: text('notes'),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  postedBy: integer('posted_by').references(() => users.id),
  postedAt: timestamp('posted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productionRunIssues = pgTable('production_run_issues', {
  id: serial('id').primaryKey(),
  productionRunId: integer('production_run_id')
    .references(() => productionRuns.id, { onDelete: 'cascade' })
    .notNull(),
  rawMaterialId: integer('raw_material_id')
    .references(() => rawMaterials.id)
    .notNull(),
  plannedQty: numeric('planned_qty', { precision: 15, scale: 4 }).notNull(),
  actualQty: numeric('actual_qty', { precision: 15, scale: 4 }).notNull(),
  unit: text('unit').notNull(),
  fifoCostPaise: integer('fifo_cost_paise').notNull().default(0),
  variancePct: numeric('variance_pct', { precision: 8, scale: 2 }).notNull().default('0.00'),
  flagged: boolean('flagged').notNull().default(false),
});

export const productionRunAuditLog = pgTable('production_run_audit_log', {
  id: serial('id').primaryKey(),
  productionRunId: integer('production_run_id')
    .references(() => productionRuns.id, { onDelete: 'cascade' })
    .notNull(),
  changedBy: integer('changed_by')
    .references(() => users.id)
    .notNull(),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
  reason: text('reason').notNull(),
  oldValues: jsonb('old_values').notNull(),
  newValues: jsonb('new_values').notNull(),
});

// Relations
export const productsRelations = relations(products, ({ many }) => ({
  bomLines: many(bomLines),
}));

export const bomLinesRelations = relations(bomLines, ({ one }) => ({
  product: one(products, { fields: [bomLines.productId], references: [products.id] }),
  rawMaterial: one(rawMaterials, { fields: [bomLines.rawMaterialId], references: [rawMaterials.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  salesman: one(users, { fields: [orders.salesmanId], references: [users.id] }),
  lines: many(orderLines),
}));

export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderLines.productId], references: [products.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  lines: many(invoiceLines),
  payments: many(payments),
  dispatches: many(dispatches),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  product: one(products, { fields: [invoiceLines.productId], references: [products.id] }),
}));

export const productionRunsRelations = relations(productionRuns, ({ one, many }) => ({
  product: one(products, { fields: [productionRuns.productId], references: [products.id] }),
  issues: many(productionRunIssues),
  auditLogs: many(productionRunAuditLog),
}));

export const productionRunIssuesRelations = relations(productionRunIssues, ({ one }) => ({
  run: one(productionRuns, { fields: [productionRunIssues.productionRunId], references: [productionRuns.id] }),
  rawMaterial: one(rawMaterials, { fields: [productionRunIssues.rawMaterialId], references: [rawMaterials.id] }),
}));
