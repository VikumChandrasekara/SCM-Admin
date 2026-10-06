import { describe, expect, it } from 'vitest';

import { financeFor } from '../src/lib/finance';
import type { Sale } from '../src/lib/model';

const now = new Date('2026-10-06T12:00:00Z').getTime();

const sale = (code: string, overrides: Partial<Sale>): Sale => ({
  code,
  material: 'sakka',
  paymentType: 'cash',
  prepaid: false,
  customerKey: 'silva',
  machineCharge: 4000,
  number: 1,
  type: 'tipper',
  quantity: 3,
  unitPrice: 6500,
  amount: 19500,
  customerName: 'Silva',
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

const finance = (sales: Sale[], machineCharge = 5000) =>
  financeFor({
    month: '2026-10',
    sales,
    bills: [],
    movements: [],
    crewMonths: [],
    store: [],
    machineCharge,
    now,
    today: '2026-10-06',
  });

describe('machine charge in finance', () => {
  it('a tipper bill is one load, a tractor bill its load count, verified sales only', () => {
    const report = finance([
      // One load whatever the cubes, at the figure it was written at.
      sale('TIPR2345', {}),
      // Written before the figure was kept: today's rate, per load.
      sale('TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 6500, amount: 13000, machineCharge: null }),
      // Not verified yet, so not income and nothing to the machine.
      sale('PEND2345', { status: 'pending', createdAt: new Date(now - 60 * 60 * 1000), verifiedAt: null }),
    ]);

    expect(report.machineLoads).toBe(3);
    expect(report.machineTotal).toBe(4000 + 2 * 5000);
    expect(report.income).toBe(19500 + 13000);
    expect(report.expenses).toBe(14000);
    expect(report.profit).toBe(32500 - 14000);
    expect(report.ledger.filter((entry) => entry.kind === 'machine')).toHaveLength(2);
  });

  it('a zero figure sends nothing and adds no ledger line', () => {
    const report = finance([sale('ZERO2345', { machineCharge: 0 })]);
    expect(report.machineTotal).toBe(0);
    expect(report.ledger.some((entry) => entry.kind === 'machine')).toBe(false);
  });
});

describe('prepaid loads in finance', () => {
  const unverified = { status: 'pending' as const, verifiedBy: null, verifiedAt: null };

  it('is income from the day it was paid, though its load has not gone and its day has run out', () => {
    const report = finance([
      // Paid four days ago, load still to come.
      sale('PREP2345', { ...unverified, prepaid: true }),
      // The same, not prepaid: lapsed after 24 hours.
      sale('LAPS2345', unverified),
    ]);

    expect(report.income).toBe(19500);
    expect(report.prepaidOpen).toEqual({ count: 1, quantity: 3, amount: 19500 });
    expect(report.cancelled.count).toBe(1);
    expect(report.pending.count).toBe(0);
    // Its machine charge goes with the income, in the month it was paid.
    expect(report.machineTotal).toBe(4000);
  });

  it('is counted once when its load goes', () => {
    const report = finance([sale('PREP2345', { prepaid: true })]);
    expect(report.income).toBe(19500);
    expect(report.prepaidOpen.count).toBe(0);
  });
});
