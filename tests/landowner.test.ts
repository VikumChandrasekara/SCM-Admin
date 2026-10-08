import { describe, expect, it } from 'vitest';

import { financeFor } from '../src/lib/finance';
import {
  currentRates,
  landownerChargeOf,
  landownerPaymentFrom,
  landownerRateFrom,
  landownerShare,
  newestFirst,
  paysLandowner,
  rateAt,
  saleLoads,
  type LandownerRate,
  type MaterialRates,
} from '../src/lib/landowner';
import type { Sale } from '../src/lib/model';
import { isSignature, signaturePath } from '../src/lib/signature';

const at = (iso: string) => new Date(iso);

const figures = (six_nine: number, sakka: number, kory_dust: number): MaterialRates => ({ six_nine, sakka, kory_dust });

const setting = (
  id: string,
  rates: MaterialRates,
  when: string | null,
  previousRates: MaterialRates | null = null,
): LandownerRate => ({ id, rates, previousRates, setBy: 'sup1', setByName: 'Nimal', at: when ? at(when) : null });

/** From 1 October 6/9 500, සක්කර 400, කෝරි ඩස්ට් 300; from 15 October 6/9 800, the others as they were; from 1 November all 700. */
const history = [
  setting('c', figures(700, 700, 700), '2026-11-01T08:00:00Z', figures(800, 400, 300)),
  setting('a', figures(500, 400, 300), '2026-10-01T08:00:00Z'),
  setting('b', figures(800, 400, 300), '2026-10-15T08:00:00Z', figures(500, 400, 300)),
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

describe('the landowner figures over time', () => {
  it('are the newest setting now, and nothing before one is ever set', () => {
    expect(currentRates(history)).toEqual(figures(700, 700, 700));
    expect(currentRates([])).toEqual(figures(0, 0, 0));
    expect(newestFirst(history).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('a moment takes the figure for its material in force then, the first for any earlier moment', () => {
    expect(rateAt(history, at('2026-10-10T00:00:00Z'), 'six_nine')).toBe(500);
    expect(rateAt(history, at('2026-10-15T08:00:00Z'), 'six_nine')).toBe(800);
    expect(rateAt(history, at('2026-10-31T23:00:00Z'), 'sakka')).toBe(400);
    expect(rateAt(history, at('2026-12-01T00:00:00Z'), 'kory_dust')).toBe(700);
    expect(rateAt(history, at('2026-01-01T00:00:00Z'), 'sakka')).toBe(400);
    expect(rateAt([], at('2026-10-10T00:00:00Z'), 'sakka')).toBe(0);
  });

  it('an entry the server has not stamped yet counts as the newest, in force from now', () => {
    const past = [setting('a', figures(500, 400, 300), '2020-01-01T00:00:00Z')];
    const fresh = [...past, setting('d', figures(900, 900, 900), null, figures(500, 400, 300))];
    expect(currentRates(fresh)).toEqual(figures(900, 900, 900));
    expect(rateAt(fresh, at('2021-06-01T00:00:00Z'), 'sakka')).toBe(400);
    expect(rateAt(fresh, new Date(Date.now() + 1000), 'sakka')).toBe(900);
  });

  it('reads an entry from when there was one figure for every material', () => {
    const old = landownerRateFrom('x', { rate: 600, previousRate: 500, setBy: 'a', setByName: 'A' });
    expect(old.rates).toEqual(figures(600, 600, 600));
    expect(old.previousRates).toEqual(figures(500, 500, 500));
    expect(landownerRateFrom('y', { rates: { six_nine: 1, sakka: 2, kory_dust: 3 } }).previousRates).toBeNull();
  });
});

describe('what a sale sends to the landowner', () => {
  it('6/9, සක්කර and කෝරි ඩස්ට් only — not බෝල්දාස්, nor a bill with no material', () => {
    for (const material of ['six_nine', 'sakka', 'kory_dust'] as const) {
      expect(paysLandowner({ material })).toBe(true);
    }
    expect(paysLandowner({ material: 'boldas' })).toBe(false);
    expect(paysLandowner({ material: null })).toBe(false);
    expect(landownerChargeOf(sale('BOLD2345', { material: 'boldas' }), history)).toBe(0);
  });

  it('is its material’s own figure, a tipper bill as one load and a tractor bill as its load count', () => {
    expect(saleLoads({ type: 'tipper', quantity: 3 })).toBe(1);
    expect(saleLoads({ type: 'tractor', quantity: 2 })).toBe(2);
    expect(landownerChargeOf(sale('SAKK2345'), history)).toBe(400);
    expect(landownerChargeOf(sale('SIXN2345', { material: 'six_nine' }), history)).toBe(800);
    expect(landownerChargeOf(sale('TRAC2345', { type: 'tractor', quantity: 2, material: 'kory_dust' }), history)).toBe(600);
  });

  it('is worked out at the figure in force when the bill was written, not today’s', () => {
    expect(landownerChargeOf(sale('EARL2345', { material: 'six_nine', createdAt: at('2026-10-05T06:00:00Z') }), history)).toBe(500);
    expect(landownerChargeOf(sale('LATE2345', { material: 'six_nine' }), history)).toBe(800);
  });

  it('with no figure ever set sends nothing', () => {
    expect(landownerChargeOf(sale('NONE2345'), [])).toBe(0);
  });
});

describe('the month’s share, worked out from the bills', () => {
  const now = at('2026-10-25T12:00:00Z').getTime();
  const sales = [
    sale('SIX12345', { material: 'six_nine' }),
    sale('SIX22345', { material: 'six_nine', createdAt: at('2026-10-05T06:00:00Z') }),
    sale('SAK12345', { type: 'tractor', quantity: 2 }),
    sale('DUST2345', { material: 'kory_dust' }),
    sale('BOLD2345', { material: 'boldas' }),
    // Not verified yet: not income, so nothing is owed on it.
    sale('PEND2345', { status: 'pending', verifiedAt: null, createdAt: new Date(now - 60 * 60 * 1000) }),
  ];

  it('adds up loads and money by material, each bill at its own figure', () => {
    const share = landownerShare(sales, history, now);
    expect(share.byMaterial.six_nine).toEqual({ loads: 2, amount: 800 + 500 });
    expect(share.byMaterial.sakka).toEqual({ loads: 2, amount: 2 * 400 });
    expect(share.byMaterial.kory_dust).toEqual({ loads: 1, amount: 300 });
    expect(share.loads).toBe(5);
    expect(share.amount).toBe(1300 + 800 + 300);
  });

  it('is nothing for a month with no such bills or no figures', () => {
    expect(landownerShare([], history, now)).toMatchObject({ loads: 0, amount: 0 });
    expect(landownerShare(sales, [], now).amount).toBe(0);
  });

  it('is what finance takes off as the landowner’s expense', () => {
    const finance = financeFor({
      month: '2026-10',
      sales,
      bills: [],
      movements: [],
      crewMonths: [],
      store: [],
      machineHourly: 6000,
      landownerRates: history,
      now,
      today: '2026-10-25',
    });
    expect(finance.landownerLoads).toBe(5);
    expect(finance.landownerTotal).toBe(landownerShare(sales, history, now).amount);
    expect(finance.expenses).toBe(finance.landownerTotal);
    expect(finance.ledger.filter((entry) => entry.kind === 'landowner')).toHaveLength(4);
  });

  it('a figure changed later leaves a bill already written at its old one', () => {
    const early = [sale('EARL2345', { material: 'six_nine', createdAt: at('2026-10-05T06:00:00Z') })];
    const before = landownerShare(early, [setting('a', figures(500, 400, 300), '2026-10-01T08:00:00Z')], now);
    const after = landownerShare(
      early,
      [setting('a', figures(500, 400, 300), '2026-10-01T08:00:00Z'), setting('b', figures(900, 400, 300), '2026-10-20T08:00:00Z')],
      now,
    );
    expect(before.amount).toBe(500);
    expect(after.amount).toBe(500);
  });
});

describe('a payment as it is stored', () => {
  it('reads back the amount, who confirmed it and the signature', () => {
    const payment = landownerPaymentFrom('2026-10', {
      amount: 2400,
      loads: 5,
      byMaterial: { six_nine: { loads: 2, amount: 1300 } },
      confirmedName: 'Kasun',
      signature: 'M1 2L3 4',
      markedBy: 'sup1',
      markedByName: 'Nimal',
    });
    expect(payment).toMatchObject({ month: '2026-10', amount: 2400, loads: 5, confirmedName: 'Kasun', markedByName: 'Nimal' });
    expect(payment.byMaterial.six_nine).toEqual({ loads: 2, amount: 1300 });
    expect(payment.byMaterial.sakka).toEqual({ loads: 0, amount: 0 });
    expect(payment.paidAt).toBeNull();
  });
});

describe('a signature', () => {
  it('is drawn as a path, a tap leaves a dot, and anything off the page is held to it', () => {
    expect(
      signaturePath([
        [
          [10.4, 20.6],
          [30, 40],
        ],
        [[100, 100]],
      ]),
    ).toBe('M10 21L30 40M100 100L100 100');
    expect(signaturePath([[[-5, 999]]])).toBe('M0 200L0 200');
    expect(signaturePath([])).toBe('');
  });

  it('is accepted only in the shape the rules take, and only when something was drawn', () => {
    expect(isSignature('M10 21L30 40M100 100L100 100')).toBe(true);
    expect(isSignature('')).toBe(false);
    expect(isSignature('M10 21L30')).toBe(false);
    expect(isSignature('M10 21 <script>')).toBe(false);
    expect(isSignature(`M1 1${'L2 2'.repeat(6000)}`)).toBe(false);
  });
});
