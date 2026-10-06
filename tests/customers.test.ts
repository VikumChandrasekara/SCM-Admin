import { describe, expect, it } from 'vitest';

import { customerAccounts } from '../src/lib/customers';
import type { Payment, Sale } from '../src/lib/model';

const sale = (name: string, amount: number, overrides: Partial<Sale> = {}): Sale => ({
  code: `C${name}${amount}`,
  material: 'sakka',
  paymentType: 'credit',
  customerKey: name.trim().toLowerCase(),
  machineCharge: 4000,
  number: 1,
  type: 'tipper',
  quantity: 1,
  unitPrice: amount,
  amount,
  customerName: name,
  customerPhone: '',
  vehicleNo: '',
  note: '',
  date: '2026-10-02',
  status: 'verified',
  createdBy: 'u1',
  createdByName: '',
  createdAt: new Date('2026-10-02T06:00:00Z'),
  verifiedBy: 'u1',
  verifiedByName: '',
  verifiedAt: new Date('2026-10-02T07:00:00Z'),
  cancelledAt: null,
  ...overrides,
});

const payment = (customerKey: string, amount: number): Payment => ({
  id: `p${amount}`,
  customerKey,
  customerName: customerKey,
  amount,
  date: '2026-10-03',
  note: '',
  createdByName: '',
  createdAt: null,
});

const now = new Date('2026-10-05T00:00:00Z').getTime();

describe('customerAccounts', () => {
  it('owes credit sales less payments, owing most first', () => {
    const accounts = customerAccounts(
      [sale('Kamal', 13000), sale('kamal ', 6500), sale('Nimal', 1000)],
      [payment('kamal', 5000)],
      now,
    );
    expect(accounts[0]).toMatchObject({ customerKey: 'kamal', credit: 19500, paid: 5000, outstanding: 14500 });
    expect(accounts[1]).toMatchObject({ customerKey: 'nimal', outstanding: 1000 });
  });

  it('leaves out cash sales and cancelled credit sales', () => {
    const accounts = customerAccounts(
      [sale('Kamal', 6500, { paymentType: 'cash' }), sale('Nimal', 6500, { status: 'cancelled' })],
      [],
      now,
    );
    expect(accounts).toEqual([]);
  });

  it('an unverified credit sale past its day is cancelled, so not owed', () => {
    const accounts = customerAccounts(
      [sale('Kamal', 6500, { status: 'pending', createdAt: new Date('2026-10-01T00:00:00Z') })],
      [],
      now,
    );
    expect(accounts).toEqual([]);
  });
});
