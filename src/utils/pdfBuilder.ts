import PDFDocument from 'pdfkit';
import { COMPANY_INFO, formatPaise } from '../services/gstService.ts';

export interface InvoicePdfData {
  invoiceNo: string;
  invoiceType: string;
  invoiceDate: string;
  status: string;
  placeOfSupplyStateCode: string;
  companyStateCode: string;
  taxableAmountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  customer: {
    name: string;
    gstin: string | null;
    stateCode: string;
    stateName: string;
    address: string;
    phone: string | null;
  };
  lines: Array<{
    productName: string;
    sku: string;
    hsnCode: string;
    qty: number;
    pricePaise: number;
    discountPaise: number;
    taxablePaise: number;
    gstRatePct: string;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  }>;
  paidPaise?: number;
}

export function buildInvoicePdfBuffer(inv: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const isCreditNote = inv.invoiceType === 'credit_note';
    const docTitle = isCreditNote ? 'GST CREDIT NOTE' : 'TAX INVOICE';

    // Header
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0F172A').text(COMPANY_INFO.name, 42, 42);
    doc.fontSize(8.5).font('Helvetica').fillColor('#475569');
    doc.text(COMPANY_INFO.address, 42, 62, { width: 310 });
    doc.text(`GSTIN: ${COMPANY_INFO.gstin}  |  State Code: ${COMPANY_INFO.stateCode} (${COMPANY_INFO.stateName})`, 42, 86);
    doc.text(`Phone: ${COMPANY_INFO.phone}  |  ${COMPANY_INFO.email}`, 42, 98);

    // Document Title Box (Right)
    doc.fontSize(14).font('Helvetica-Bold').fillColor(isCreditNote ? '#B91C1C' : '#0F172A')
      .text(docTitle, 380, 42, { align: 'right', width: 173 });
    doc.fontSize(9).font('Helvetica').fillColor('#334155')
      .text(`Invoice No: ${inv.invoiceNo}`, 380, 64, { align: 'right', width: 173 })
      .text(`Date: ${inv.invoiceDate}`, 380, 78, { align: 'right', width: 173 })
      .text(`Status: ${inv.status.toUpperCase()}`, 380, 92, { align: 'right', width: 173 });

    doc.moveTo(42, 118).lineTo(553, 118).strokeColor('#CBD5E1').lineWidth(1).stroke();

    // Bill To
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748B').text('BILL TO / RECIPIENT', 42, 128);
    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#0F172A').text(inv.customer.name, 42, 141);
    doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
      .text(inv.customer.address, 42, 156, { width: 280 })
      .text(`GSTIN: ${inv.customer.gstin || 'Unregistered'}`, 42, 182)
      .text(`Place of Supply: ${inv.customer.stateName} (Code ${inv.placeOfSupplyStateCode})`, 42, 195);

    const supplyType =
      inv.placeOfSupplyStateCode === inv.companyStateCode
        ? 'Intra-State (CGST + SGST)'
        : 'Inter-State (IGST)';
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0F172A')
      .text(`Supply Classification:`, 360, 141, { align: 'right', width: 193 });
    doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
      .text(supplyType, 360, 155, { align: 'right', width: 193 });

    // Line Items Table Header
    let y = 222;
    doc.rect(42, y, 511, 22).fill('#F1F5F9');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
    doc.text('#', 48, y + 7, { width: 18 });
    doc.text('Product Description', 68, y + 7, { width: 145 });
    doc.text('HSN', 216, y + 7, { width: 52 });
    doc.text('Qty', 270, y + 7, { width: 38, align: 'right' });
    doc.text('Rate', 312, y + 7, { width: 54, align: 'right' });
    doc.text('Taxable', 370, y + 7, { width: 65, align: 'right' });
    doc.text('GST %', 438, y + 7, { width: 38, align: 'right' });
    doc.text('Line Total', 480, y + 7, { width: 67, align: 'right' });

    y += 24;
    doc.font('Helvetica').fontSize(8.5).fillColor('#0F172A');

    inv.lines.forEach((line, idx) => {
      const lineTotal = line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise;
      doc.text(String(idx + 1), 48, y + 5, { width: 18 });
      doc.text(`${line.productName} (${line.sku})`, 68, y + 5, { width: 145 });
      doc.text(line.hsnCode, 216, y + 5, { width: 52 });
      doc.text(String(line.qty), 270, y + 5, { width: 38, align: 'right' });
      doc.text(formatPaise(line.pricePaise), 312, y + 5, { width: 54, align: 'right' });
      doc.text(formatPaise(line.taxablePaise), 370, y + 5, { width: 65, align: 'right' });
      doc.text(`${Number(line.gstRatePct).toFixed(1)}%`, 438, y + 5, { width: 38, align: 'right' });
      doc.text(formatPaise(lineTotal), 480, y + 5, { width: 67, align: 'right' });

      y += 22;
      doc.moveTo(42, y).lineTo(553, y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    });

    // Totals Block
    y += 14;
    const summaryX = 340;
    const valW = 105;

    const addSummaryRow = (label: string, val: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor('#0F172A');
      doc.text(label, summaryX, y, { width: 105 });
      doc.text(val, summaryX + 108, y, { width: valW, align: 'right' });
      y += bold ? 18 : 15;
    };

    addSummaryRow('Taxable Value:', formatPaise(inv.taxableAmountPaise));
    if (inv.cgstPaise > 0 || inv.sgstPaise > 0) {
      addSummaryRow('CGST (2.5%):', formatPaise(inv.cgstPaise));
      addSummaryRow('SGST (2.5%):', formatPaise(inv.sgstPaise));
    }
    if (inv.igstPaise > 0) {
      addSummaryRow('IGST (5.0%):', formatPaise(inv.igstPaise));
    }
    doc.moveTo(summaryX, y).lineTo(553, y).strokeColor('#94A3B8').lineWidth(0.8).stroke();
    y += 6;
    addSummaryRow(isCreditNote ? 'Credit Total:' : 'Invoice Total:', formatPaise(inv.totalPaise), true);

    if (typeof inv.paidPaise === 'number' && !isCreditNote) {
      addSummaryRow('Amount Paid:', formatPaise(inv.paidPaise));
      addSummaryRow('Balance Due:', formatPaise(Math.max(0, inv.totalPaise - inv.paidPaise)), true);
    }

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('#64748B')
      .text('Certified that the particulars given above are true and correct. Subject to Tiruchirappalli Jurisdiction.', 42, 745)
      .text(`For ${COMPANY_INFO.name} — Authorised Signatory`, 42, 760);

    doc.end();
  });
}

export function buildTabularReportPdf(
  title: string,
  subtitle: string,
  headers: string[],
  rows: string[][]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A').text(COMPANY_INFO.name, 36, 36);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#334155').text(title, 36, 56);
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748B').text(subtitle, 36, 72);

    const usableWidth = 770;
    const colW = Math.floor(usableWidth / headers.length);
    let y = 96;

    const drawHeader = () => {
      doc.rect(36, y, usableWidth, 20).fill('#F1F5F9');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#1E293B');
      headers.forEach((h, i) => {
        doc.text(h, 40 + i * colW, y + 6, { width: colW - 6, ellipsis: true });
      });
      y += 22;
    };

    drawHeader();

    doc.font('Helvetica').fontSize(7.5).fillColor('#0F172A');
    for (const row of rows) {
      if (y > 530) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 36 });
        y = 36;
        drawHeader();
        doc.font('Helvetica').fontSize(7.5).fillColor('#0F172A');
      }
      row.forEach((cell, i) => {
        doc.text(String(cell ?? ''), 40 + i * colW, y + 4, { width: colW - 6, ellipsis: true });
      });
      y += 18;
      doc.moveTo(36, y).lineTo(36 + usableWidth, y).strokeColor('#E2E8F0').lineWidth(0.4).stroke();
    }

    doc.end();
  });
}

export interface ProductionCostSheetData {
  runNo: string;
  runDate: string;
  productName: string;
  sku: string;
  sellingPricePaise: number;
  batchSize: string;
  expectedOutput: string;
  actualOutput: string;
  damagedUnits: number;
  yieldVariancePct: string;
  yieldFlagged: boolean;
  labourCostPaise: number;
  overheadCostPaise: number;
  totalCostPaise: number;
  costPerPacketPaise: number;
  status: string;
  issues: Array<{
    materialName: string;
    plannedQty: string;
    actualQty: string;
    unit: string;
    fifoCostPaise: number;
    variancePct: string;
    flagged: boolean;
  }>;
}

export function buildProductionCostSheetPdfBuffer(run: ProductionCostSheetData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(15).font('Helvetica-Bold').fillColor('#0F172A').text(COMPANY_INFO.name, 42, 42);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#334155').text(`PRODUCTION BATCH COST SHEET · ${run.runNo}`, 42, 64);
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748B')
      .text(`Date: ${run.runDate}  |  Product: ${run.productName} (${run.sku})  |  Status: ${run.status.toUpperCase()}`, 42, 82);

    doc.moveTo(42, 102).lineTo(553, 102).strokeColor('#CBD5E1').lineWidth(1).stroke();

    // Yield KPI block
    let y = 114;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0F172A')
      .text(`Batch Size: ${run.batchSize}`, 42, y)
      .text(`Expected Output: ${run.expectedOutput} pkts`, 175, y)
      .text(`Actual Good Output: ${run.actualOutput} pkts`, 340, y);
    y += 16;
    doc.fontSize(9).font('Helvetica').fillColor('#334155')
      .text(`Damaged Pouches: ${run.damagedUnits}`, 42, y)
      .text(`Yield Variance: ${run.yieldVariancePct}% ${run.yieldFlagged ? '(FLAGGED >3%)' : '(Within Tol.)'}`, 175, y);

    // Issues Table
    y += 28;
    doc.rect(42, y, 511, 22).fill('#F1F5F9');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155');
    doc.text('Material / Packaging', 48, y + 7, { width: 175 });
    doc.text('Planned', 228, y + 7, { width: 65, align: 'right' });
    doc.text('Actual', 298, y + 7, { width: 65, align: 'right' });
    doc.text('Variance', 368, y + 7, { width: 70, align: 'right' });
    doc.text('FIFO Cost', 445, y + 7, { width: 100, align: 'right' });

    y += 24;
    let totalMaterialPaise = 0;
    doc.font('Helvetica').fontSize(8.5).fillColor('#0F172A');
    for (const iss of run.issues) {
      totalMaterialPaise += iss.fifoCostPaise;
      doc.text(iss.materialName, 48, y + 5, { width: 175 });
      doc.text(`${iss.plannedQty} ${iss.unit}`, 228, y + 5, { width: 65, align: 'right' });
      doc.text(`${iss.actualQty} ${iss.unit}`, 298, y + 5, { width: 65, align: 'right' });
      doc.text(`${iss.variancePct}%${iss.flagged ? ' *' : ''}`, 368, y + 5, { width: 70, align: 'right' });
      doc.text(formatPaise(iss.fifoCostPaise), 445, y + 5, { width: 100, align: 'right' });
      y += 21;
      doc.moveTo(42, y).lineTo(553, y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    }

    y += 16;
    const labelX = 320;
    const valX = 445;
    const row = (lbl: string, val: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor('#0F172A');
      doc.text(lbl, labelX, y, { width: 120 });
      doc.text(val, valX, y, { width: 100, align: 'right' });
      y += bold ? 18 : 15;
    };

    const damageAllowance = Math.max(0, run.totalCostPaise - totalMaterialPaise - run.labourCostPaise - run.overheadCostPaise);
    row('Issued Material (FIFO):', formatPaise(totalMaterialPaise));
    if (damageAllowance > 0) {
      row('Damaged Pouch Cost:', formatPaise(damageAllowance));
    }
    row('Direct Labour:', formatPaise(run.labourCostPaise));
    row('Overheads (Gas/Power):', formatPaise(run.overheadCostPaise));
    doc.moveTo(labelX, y).lineTo(553, y).strokeColor('#94A3B8').lineWidth(0.8).stroke();
    y += 6;
    row('Total Run Cost:', formatPaise(run.totalCostPaise), true);
    row('Cost per Packet:', formatPaise(run.costPerPacketPaise), true);

    const marginPct =
      run.sellingPricePaise > 0
        ? (((run.sellingPricePaise - run.costPerPacketPaise) / run.sellingPricePaise) * 100).toFixed(1)
        : '0.0';
    row('Selling Price / Margin:', `${formatPaise(run.sellingPricePaise)} (${marginPct}%)`);

    doc.end();
  });
}
