export const COMPANY_INFO = {
  name: 'Kaveri Crunch Heritage Foods Pvt. Ltd.',
  gstin: '33AAACK8821D1Z9',
  stateCode: '33',
  stateName: 'Tamil Nadu',
  address: 'Plot 14, SIDCO Industrial Estate, Thuvakudi, Tiruchirappalli - 620015, Tamil Nadu',
  phone: '+91 431 250 1842',
  email: 'accounts@kavericrunch.in',
};

export interface GstLineInput {
  productId: number;
  qty: number;
  hsnCode: string;
  pricePaise: number;
  discountPaise: number;
  gstRatePct: number;
}

export interface GstLineComputed extends GstLineInput {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

export interface GstInvoiceComputed {
  isIntraState: boolean;
  companyStateCode: string;
  placeOfSupplyStateCode: string;
  taxableAmountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  lines: GstLineComputed[];
}

export function calculateGstInvoice(
  lines: GstLineInput[],
  placeOfSupplyStateCode: string,
  companyStateCode: string = COMPANY_INFO.stateCode
): GstInvoiceComputed {
  const isIntraState = placeOfSupplyStateCode === companyStateCode;

  let taxableAmountPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  const computedLines: GstLineComputed[] = lines.map((line) => {
    const grossPaise = Math.round(line.qty * line.pricePaise);
    const taxable = Math.max(0, grossPaise - (line.discountPaise || 0));
    const totalTax = Math.round((taxable * line.gstRatePct) / 100);

    let lineCgst = 0;
    let lineSgst = 0;
    let lineIgst = 0;

    if (isIntraState) {
      lineCgst = Math.floor(totalTax / 2);
      lineSgst = totalTax - lineCgst;
    } else {
      lineIgst = totalTax;
    }

    taxableAmountPaise += taxable;
    cgstPaise += lineCgst;
    sgstPaise += lineSgst;
    igstPaise += lineIgst;

    return {
      ...line,
      taxablePaise: taxable,
      cgstPaise: lineCgst,
      sgstPaise: lineSgst,
      igstPaise: lineIgst,
      lineTotalPaise: taxable + lineCgst + lineSgst + lineIgst,
    };
  });

  const totalPaise = taxableAmountPaise + cgstPaise + sgstPaise + igstPaise;

  return {
    isIntraState,
    companyStateCode,
    placeOfSupplyStateCode,
    taxableAmountPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise,
    lines: computedLines,
  };
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function getIndianFinancialYear(dateStr: string): string {
  const d = new Date(dateStr || new Date().toISOString().slice(0, 10));
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  if (month >= 4) {
    return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
  }
  return `${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
}
