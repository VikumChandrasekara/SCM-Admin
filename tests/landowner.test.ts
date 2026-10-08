import { describe, expect, it } from 'vitest';

import { financeFor } from '../src/lib/finance';
import {
  currentRate,
  landownerChargeOf,
  newestFirst,
  paysLandowner,
  rateAt,
  saleLoads,
  type LandownerRate,
} from '../src/lib/landowner';
import type { Sale } from '../src/lib/model';

const at = (iso: string) => new Date(iso);

const setting = (id: string, rate: number, when: string | null, previousRate: number | null = null): LandownerRate => ({
  id,
  rate,
  previousRate,
  setBy: 'sup1',
  setByName: 'Nimal',
  at: when ? at(when) : null,
});

/** 500 from 1 October, 800 from 15 October, 700 from 1 November. */
const history = [
  setting('c', 700, '2026-11-01T08:00:00Z', 800),
  setting('a', 500, '2026-10-01T08:00:00Z'),
  setting('b', 800, '2026-10-15T08:00:00Z', 500),
];

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
  createdAt: at('2026-10-20T06:00:00Z'),
  verifiedBy: 'u1',
  verifiedByName: '',
  verifiedAt: at('2026-10-20T07:00:00Z'),
  cancelledAt: null,
  ...overrides,
});

describe('the landowner figure over time', () => {
  it('is the newest setting now, and nothing before one is ever set', () => {
    expect(currentRate(history)).toBe(700);
    expect(currentRate([])).toBe(0);
    expect(newestFirst(history).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('a moment takes the setting in force then, the first for any earlier moment', () => {
    expect(rateAt(history, at('2026-10-10T00:00:00Z'))).toBe(500);
    expect(rateAt(history, at('2026-10-15T08:00:00Z'))).toBe(800);
    expect(rateAt(history, at('2026-10-31T23:00:00Z'))).toBe(800);
    expect(rateAt(history, at('2026-12-01T00:00:00Z'))).toBe(700);
    expect(rateAt(history, at('2026-01-01T00:00:00Z'))).toBe(500);
    expect(rateAt([], at('2026-10-10T00:00:00Z'))).toBe(0);
  });

  it('an entry the server has not stamped yet counts as the newest, in force from now', () => {
    const past = [setting('a', 500, '2020-01-01T00:00:00Z')];
    const fresh = [...past, setting('d', 900, null, 500)];
    expect(currentRate(fresh)).toBe(900);
    expect(rateAt(fresh, at('2021-06-01T00:00:00Z'))).toBe(500);
    expect(rateAt(fresh, new Date(Date.now() + 1000))).toBe(900);
  });
});

describe('what a sale sends to the landowner', () => {
  it('6/9, සක්කර and කෝරි දූවිලි only — not බෝල්දාස්', () => {
    for (const material of ['six_nine', 'sakka', 'kory_dust'] as const) {
      expect(paysLandowner({ material })).toBe(true);
    }
    expect(paysLandowner({ material: 'boldas' })).toBe(false);
    expect(landownerChargeOf(sale('BOLD2345', { material: 'boldas' }), history)).toBe(0);
  });

  it('a tipper bill is one load, a tractor bill its load count', () => {
    expect(saleLoads({ type: 'tipper', quantity: 3 })).toBe(1);
    expect(saleLoads({ type: 'tractor', quantity: 2 })).toBe(2);
    expect(landownerChargeOf(sale('TIPR2345'), history)).toBe(800);
    expect(landownerChargeOf(sale('TRAC2345', { type: 'tractor', quantity: 2 }), history)).toBe(1600);
  });

  it('is worked out at the figure in force when the bill was written, not today’s', () => {
    expect(landownerChargeOf(sale('EARL2345', { createdAt: at('2026-10-05T06:00:00Z') }), history)).toBe(500);
    expect(landownerChargeOf(sale('LATE2345', { createdAt: at('2026-10-20T06:00:00Z') }), history)).toBe(800);
  });

  it('with no figure ever set sends nothing', () => {
    expect(landownerChargeOf(sale('NONE2345'), [])).toBe(0);
  });
});

describe('the landowner in finance', () => {
  const now = at('2026-10-25T12:00:00Z').getTime();
  const report = (sales: Sale[], landownerRates: LandownerRate[] = history) =>
    financeFor({
      month: '2026-10',
      sales,
      bills: [],
      movements: [],
      crewMonths: [],
      store: [],
      machineHourly: 6000,
      landownerRates,
      now,
      today: '2026-10-25',
    });

  it('is an expense for verified loads of the three materials, each at its own bill’s figure', () => {
    const finance = report([
      sale('EARL2345', { createdAt: at('2026-10-05T06:00:00Z'), date: '2026-10-05' }),
      sale('LATE2345', { type: 'tractor', quantity: 2, material: 'six_nine' }),
      sale('DUST2345', { material: 'kory_dust' }),
      // No share on this material.
      sale('BOLD2345', { material: 'boldas' }),
      // Not verified yet: not income, so nothing goes to the landowner.
      sale('PEND2345', { status: 'pending', verifiedAt: null, createdAt: new Date(now - 60 * 60 * 1000) }),
    ]);

    expect(finance.landownerLoads).toBe(1 + 2 + 1);
    expect(finance.landownerTotal).toBe(500 + 2 * 800 + 800);
    expect(finance.expenses).toBe(finance.landownerTotal);
    expect(finance.profit).toBe(finance.income - finance.landownerTotal);
    expect(finance.ledger.filter((entry) => entry.kind === 'landowner')).toHaveLength(3);
  });

  it('changing the figure later leaves a bill already written at its old one', () => {
    const sales = [sale('EARL2345', { createdAt: at('2026-10-05T06:00:00Z'), date: '2026-10-05' })];
    const before = report(sales, [setting('a', 500, '2026-10-01T08:00:00Z')]);
    const after = report(sales, [
      setting('a', 500, '2026-10-01T08:00:00Z'),
      setting('b', 900, '2026-10-20T08:00:00Z', 500),
    ]);
    expect(before.landownerTotal).toBe(500);
    expect(after.landownerTotal).toBe(500);
  });

  it('with no figure set adds no ledger line', () => {
    const finance = report([sale('NONE2345')], []);
    expect(finance.landownerTotal).toBe(0);
    expect(finance.ledger.some((entry) => entry.kind === 'landowner')).toBe(false);
  });
});
