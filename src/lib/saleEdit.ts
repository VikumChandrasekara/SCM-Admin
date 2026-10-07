import { money } from './format';
import {
  PAYMENT_TYPE_LABEL,
  SALE_MATERIAL,
  SALE_STATUS,
  SALE_TYPE,
  customerKeyOf,
  saleNumber,
  type PaymentType,
  type Sale,
  type SaleMaterial,
} from './model';

/**
 * What the admin may change on a bill: how many, who it was for, what it was
 * made of, how it was paid and the notes. Never the price it was written at,
 * its number, its date or its status — firestore.rules refuses those too.
 */
export interface SaleEdit {
  quantity: number;
  customerName: string;
  customerPhone: string;
  vehicleNo: string;
  material: SaleMaterial;
  paymentType: PaymentType;
  note: string;
}

/** The fields written for [edit] on [sale]; the sum is worked at the price the bill was written at. */
export function saleEditFields(sale: Sale, edit: SaleEdit) {
  const customerName = edit.customerName.trim();
  return {
    quantity: edit.quantity,
    amount: edit.quantity * sale.unitPrice,
    customerName,
    customerKey: customerKeyOf(customerName),
    customerPhone: edit.customerPhone.trim(),
    vehicleNo: edit.vehicleNo.trim().toUpperCase(),
    material: edit.material,
    // A prepaid bill is paid there and then, so never on credit.
    paymentType: sale.prepaid ? ('cash' as const) : edit.paymentType,
    note: edit.note.trim(),
  };
}

/**
 * The audit line for an edit — `before → after` for each field that moved —
 * or null when [fields] would leave the bill as it is.
 */
export function saleEditSummary(sale: Sale, fields: ReturnType<typeof saleEditFields>): string | null {
  const dash = (value: string) => value || '—';
  const lines: string[] = [];
  if (fields.quantity !== sale.quantity) {
    lines.push(`ප්‍රමාණය: ${sale.quantity} → ${fields.quantity} ${SALE_TYPE[sale.type].unit}`);
  }
  if (fields.amount !== sale.amount) lines.push(`මුදල: රු.${sale.amount} → රු.${fields.amount}`);
  if (fields.customerName !== sale.customerName) {
    lines.push(`පාරිභෝගිකයා: ${dash(sale.customerName)} → ${dash(fields.customerName)}`);
  }
  if (fields.customerPhone !== sale.customerPhone) {
    lines.push(`දුරකථනය: ${dash(sale.customerPhone)} → ${dash(fields.customerPhone)}`);
  }
  if (fields.vehicleNo !== sale.vehicleNo) {
    lines.push(`වාහනය: ${dash(sale.vehicleNo)} → ${dash(fields.vehicleNo)}`);
  }
  if (fields.material !== sale.material) {
    lines.push(
      `ද්‍රව්‍යය: ${sale.material ? SALE_MATERIAL[sale.material] : '—'} → ${SALE_MATERIAL[fields.material]}`,
    );
  }
  if (fields.paymentType !== sale.paymentType) {
    lines.push(`ගෙවීම: ${PAYMENT_TYPE_LABEL[sale.paymentType]} → ${PAYMENT_TYPE_LABEL[fields.paymentType]}`);
  }
  if (fields.note !== sale.note) lines.push(`සටහන: ${dash(sale.note)} → ${dash(fields.note)}`);
  return lines.length > 0 ? lines.join(' · ') : null;
}

/**
 * The audit line for a deletion: all of what the bill said, since the bill
 * itself is gone — enough to write it out again.
 */
export function saleDeleteSummary(sale: Sale): string {
  return [
    sale.code,
    SALE_TYPE[sale.type].label,
    `${sale.quantity} ${SALE_TYPE[sale.type].unit} × රු.${money(sale.unitPrice)} = රු.${money(sale.amount)}`,
    sale.customerName || '—',
    sale.vehicleNo || null,
    sale.material ? SALE_MATERIAL[sale.material] : null,
    PAYMENT_TYPE_LABEL[sale.paymentType],
    sale.prepaid ? 'කලින් ගෙවූ' : null,
    SALE_STATUS[sale.status],
    sale.date,
    `බිල් අංකය ${saleNumber(sale)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
