import { describe, expect, it } from 'vitest';

import { loadAnalysis } from '../src/lib/loads';
import type { Sale } from '../src/lib/model';

const now = new Date('2026-10-25T12:00:00Z').getTime();

const sale = (code: string, overrides: Partial<Sale> = {}): Sale => ({
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
  date: '2026-10-20',
  status: 'verified',
  createdBy: 'u1',
  createdByName: '',
  createdAt: new Date('2026-10-20T06:00:00Z'),
  verifiedBy: 'u1',
  verifiedByName: '',
  verifiedAt: new Date('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  ...overrides,
});

const tractor = { type: 'tractor' as const, quantity: 2, amount: 13000 };

describe('the loads that have gone', () => {
  const sales = [
    sale('SAK12345'),
    sale('SAK22345', { quantity: 2, amount: 13000 }),
    sale('SAK32345', tractor),
    sale('SIX12345', { material: 'six_nine' }),
    sale('SIX22345', { ...tractor, material: 'six_nine' }),
    sale('DUST2345', { material: 'kory_dust', quantity: 4, amount: 26000 }),
    sale('BOLD2345', { material: 'boldas' }),
    // An old bill with no material still went.
    sale('OLDX2345', { material: null }),
  ];

  it('counts each verified bill under its material, by tipper and tractor', () => {
    const { rows, total } = loadAnalysis(sales, now);
    const row = (kind: string) => rows.find((entry) => entry.kind === kind)!;

    expect(row('sakka')).toMatchObject({ bills: 3, tipperLoads: 2, cubes: 5, tractorLoads: 2, loads: 4, amount: 19500 + 13000 + 13000 });
    expect(row('six_nine')).toMatchObject({ bills: 2, tipperLoads: 1, cubes: 3, tractorLoads: 2, loads: 3 });
    expect(row('kory_dust')).toMatchObject({ bills: 1, tipperLoads: 1, cubes: 4, loads: 1 });
    expect(row('boldas')).toMatchObject({ bills: 1, loads: 1 });
    expect(row('unknown')).toMatchObject({ bills: 1, loads: 1 });
    expect(total).toMatchObject({ bills: 8, loads: 4 + 3 + 1 + 1 + 1, tractorLoads: 4 });
  });

  it('lists every material in order, and bills with none only when there are some', () => {
    expect(loadAnalysis(sales, now).rows.map((row) => row.kind)).toEqual([
      'six_nine',
      'sakka',
      'kory_dust',
      'boldas',
      'unknown',
    ]);
    const without = loadAnalysis([sale('SAK12345')], now);
    expect(without.rows.map((row) => row.kind)).toEqual(['six_nine', 'sakka', 'kory_dust', 'boldas']);
    expect(without.rows[0]).toMatchObject({ bills: 0, loads: 0 });
  });

  it('does not count a load that has not gone: waiting, prepaid, lapsed or cancelled', () => {
    const analysis = loadAnalysis(
      [
        sale('GONE2345'),
        // Written an hour ago, not yet scanned.
        sale('WAIT2345', { status: 'pending', verifiedAt: null, createdAt: new Date(now - 60 * 60 * 1000) }),
        sale('WAIT3345', { ...tractor, status: 'pending', verifiedAt: null, createdAt: new Date(now - 60 * 60 * 1000) }),
        // Paid in advance, its load still to come.
        sale('PREP2345', { status: 'pending', prepaid: true, verifiedAt: null }),
        // Past its day unverified, and one cancelled outright.
        sale('LAPS2345', { status: 'pending', verifiedAt: null, createdAt: new Date(now - 30 * 60 * 60 * 1000) }),
        sale('CANC2345', { status: 'cancelled' }),
      ],
      now,
    );

    expect(analysis.total).toMatchObject({ bills: 1, loads: 1 });
    expect(analysis.pending).toEqual({ bills: 2, loads: 1 + 2 });
    expect(analysis.prepaidOpen).toEqual({ bills: 1, loads: 1 });
  });

  it('is all zero for a month with no bills', () => {
    const analysis = loadAnalysis([], now);
    expect(analysis.total).toMatchObject({ bills: 0, loads: 0, amount: 0 });
    expect(analysis.pending).toEqual({ bills: 0, loads: 0 });
  });
});
