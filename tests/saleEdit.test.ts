import { describe, expect, it } from 'vitest';

import type { Sale } from '../src/lib/model';
import { saleDeleteSummary, saleEditFields, saleEditSummary, type SaleEdit } from '../src/lib/saleEdit';

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  code: 'USES935W',
  material: 'sakka',
  paymentType: 'cash',
  prepaid: false,
  customerKey: 'vimal',
  machineCharge: 4000,
  number: 2,
  type: 'tractor',
  quantity: 2,
  unitPrice: 6500,
  amount: 13000,
  customerName: 'vimal',
  customerPhone: '0763232323',
  vehicleNo: 'WP CSS 2233',
  note: '',
  date: '2026-10-03',
  status: 'verified',
  createdBy: 'u1',
  createdByName: '',
  createdAt: new Date('2026-10-03T05:03:00Z'),
  verifiedBy: 'u1',
  verifiedByName: '',
  verifiedAt: new Date('2026-10-03T06:00:00Z'),
  cancelledAt: null,
  ...overrides,
});

/** The bill as it stands, as an edit — what the form starts from. */
const asEdit = (from: Sale): SaleEdit => ({
  quantity: from.quantity,
  customerName: from.customerName,
  customerPhone: from.customerPhone,
  vehicleNo: from.vehicleNo,
  material: from.material ?? 'sakka',
  paymentType: from.paymentType,
  note: from.note,
});

describe('editing a sale', () => {
  it('works the sum at the price the bill was written at, not today’s', () => {
    const before = sale();
    const fields = saleEditFields(before, { ...asEdit(before), quantity: 3 });
    expect(fields.quantity).toBe(3);
    expect(fields.amount).toBe(19500);
  });

  it('keeps a fractional quantity exact', () => {
    const before = sale({ type: 'tipper', quantity: 3, amount: 19500 });
    expect(saleEditFields(before, { ...asEdit(before), quantity: 2.5 }).amount).toBe(16250);
  });

  it('trims and re-keys the customer, and upper-cases the vehicle', () => {
    const fields = saleEditFields(sale(), {
      ...asEdit(sale()),
      customerName: '  Nimal Perera ',
      vehicleNo: ' wp lk-1234 ',
      customerPhone: ' 0711234567 ',
      note: ' gate 2 ',
    });
    expect(fields.customerName).toBe('Nimal Perera');
    expect(fields.customerKey).toBe('nimal perera');
    expect(fields.vehicleNo).toBe('WP LK-1234');
    expect(fields.customerPhone).toBe('0711234567');
    expect(fields.note).toBe('gate 2');
  });

  it('keeps a prepaid bill cash, whatever the form says', () => {
    const before = sale({ prepaid: true });
    expect(saleEditFields(before, { ...asEdit(before), paymentType: 'credit' }).paymentType).toBe('cash');
    expect(saleEditFields(sale(), { ...asEdit(sale()), paymentType: 'credit' }).paymentType).toBe('credit');
  });

  it('writes only what the rules allow an admin to change', () => {
    expect(Object.keys(saleEditFields(sale(), asEdit(sale()))).sort()).toEqual(
      [
        'amount',
        'customerKey',
        'customerName',
        'customerPhone',
        'material',
        'note',
        'paymentType',
        'quantity',
        'vehicleNo',
      ].sort(),
    );
  });
});

describe('what an edit says in the audit log', () => {
  it('is nothing when nothing moved — so a repeat after a dropped line is not logged twice', () => {
    const before = sale();
    expect(saleEditSummary(before, saleEditFields(before, asEdit(before)))).toBeNull();
  });

  it('is nothing when the form only re-trims what was already there', () => {
    const before = sale();
    const edit = { ...asEdit(before), customerName: ' vimal ', vehicleNo: 'wp css 2233' };
    expect(saleEditSummary(before, saleEditFields(before, edit))).toBeNull();
  });

  it('names each field that moved, before → after', () => {
    const before = sale();
    const edit: SaleEdit = { ...asEdit(before), quantity: 3, customerName: 'Nimal', paymentType: 'credit' };
    const summary = saleEditSummary(before, saleEditFields(before, edit)) ?? '';
    expect(summary).toContain('ප්‍රමාණය: 2 → 3');
    expect(summary).toContain('මුදල: රු.13000 → රු.19500');
    expect(summary).toContain('පාරිභෝගිකයා: vimal → Nimal');
    expect(summary).toContain('ගෙවීම: මුදල් → නයට');
    expect(summary).not.toContain('වාහනය');
  });

  it('shows a missing value as a dash, as the bills page does', () => {
    const before = sale({ customerPhone: '' });
    const summary = saleEditSummary(before, saleEditFields(before, { ...asEdit(before), customerPhone: '0711234567' }));
    expect(summary).toBe('දුරකථනය: — → 0711234567');
  });
});

describe('what a deletion says in the audit log', () => {
  it('keeps the whole bill — its code, sum, customer and number — since nothing else will', () => {
    const summary = saleDeleteSummary(sale());
    expect(summary).toContain('USES935W');
    expect(summary).toContain('2 ');
    expect(summary).toContain('vimal');
    expect(summary).toContain('WP CSS 2233');
    expect(summary).toContain('2026-10-03');
    expect(summary).toContain('බිල් අංකය 002');
  });

  it('skips what the bill never had', () => {
    const summary = saleDeleteSummary(sale({ vehicleNo: '', material: null, prepaid: false }));
    expect(summary).not.toContain('WP CSS');
    expect(summary).not.toContain('කලින් ගෙවූ');
    expect(summary).not.toContain('null');
  });

  it('marks a prepaid bill', () => {
    expect(saleDeleteSummary(sale({ prepaid: true }))).toContain('කලින් ගෙවූ');
  });
});
