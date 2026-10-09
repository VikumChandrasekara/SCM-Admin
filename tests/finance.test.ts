import { describe, expect, it } from 'vitest';

import type { CrewMonth } from '../src/data/finance';
import { areaOfMachine, financeFor, stockGroupOf } from '../src/lib/finance';
import type { LandownerRate } from '../src/lib/landowner';
import { billFrom, movementFrom, type MachineType, type Movement, type Person, type Sale } from '../src/lib/model';

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

const person = (id: string, role: Person['role'], extra: Partial<Person> = {}): Person => ({
  id,
  name: id,
  username: id,
  machineId: `m-${id}`,
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
  ...extra,
});

const crewMonth = (who: Person, hours: number): CrewMonth => ({
  person: who,
  days: [],
  tally: { month: '2026-10', loads: 0, feet: 0, hours },
});

const finance = (sales: Sale[], crewMonths: CrewMonth[] = [], machineHourly = 6000) =>
  financeFor({
    month: '2026-10',
    sales,
    bills: [],
    movements: [],
    crewMonths,
    store: [],
    machineHourly,
    now,
    today: '2026-10-06',
  });

describe('machine charge in finance', () => {
  it('is the excavator hours of the month at the hourly figure, whatever was sold', () => {
    const report = finance(
      [sale('TIPR2345', {}), sale('TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 6500, amount: 13000 })],
      [crewMonth(person('op1', 'operator'), 10), crewMonth(person('op2', 'operator'), 2.5)],
    );

    expect(report.machineHours).toBe(12.5);
    expect(report.machineTotal).toBe(12.5 * 6000);
    expect(report.income).toBe(19500 + 13000);
    expect(report.ledger.filter((entry) => entry.kind === 'machine')).toHaveLength(2);
    // The old per-load figure on the bills (4000) plays no part.
    expect(report.machineTotal).not.toBe(4000 + 2 * 4000);
  });

  it('counts the loading excavator only, not the driller', () => {
    const report = finance([], [crewMonth(person('op1', 'operator'), 4), crewMonth(person('dr1', 'compressor'), 8)]);
    expect(report.machineHours).toBe(4);
    expect(report.machineTotal).toBe(24000);
  });

  it('no hours or a zero figure sends nothing and adds no ledger line', () => {
    const idle = finance([sale('ZERO2345', {})], [crewMonth(person('op1', 'operator'), 0)]);
    expect(idle.machineTotal).toBe(0);
    expect(idle.ledger.some((entry) => entry.kind === 'machine')).toBe(false);

    const free = finance([], [crewMonth(person('op1', 'operator'), 5)], 0);
    expect(free.machineTotal).toBe(0);
    expect(free.ledger.some((entry) => entry.kind === 'machine')).toBe(false);
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
    // The machine is charged by the hour worked, not by the bill: no load, no hours, no charge.
    expect(report.machineTotal).toBe(0);
  });

  it('is counted once when its load goes', () => {
    const report = finance([sale('PREP2345', { prepaid: true })]);
    expect(report.income).toBe(19500);
    expect(report.prepaidOpen.count).toBe(0);
  });
});

// ---- income and costs, by category -------------------------------------------

const ratesSetOn1st: LandownerRate[] = [
  {
    id: 'r1',
    rates: { six_nine: 500, sakka: 400, kory_dust: 300 },
    previousRates: null,
    setBy: 'a',
    setByName: 'A',
    at: new Date('2026-10-01T00:00:00Z'),
  },
];

const kinds = new Map<string, MachineType>([
  ['m-op1', 'excavator'],
  ['m-dr1', 'compressor'],
]);

/** A store movement as the panel reads it. */
const movement = (id: string, data: object): Movement =>
  movementFrom(id, { createdAt: '2026-10-03T08:00:00.000Z', unmatched: [], ...data });

/** Something drawn from the store: `[item id, name, unit, amount, price]` for each line. */
const drawn = (
  id: string,
  machineId: string | null,
  source: string | null,
  lines: [string, string, string, number, number][],
  extra: object = {},
) =>
  movement(id, {
    type: machineId && source ? 'usage' : 'use',
    machineId,
    source,
    date: '2026-10-03',
    items: lines.map(([itemId, name, unit, amount, unitPrice]) => ({ itemId, name, unit, delta: -amount, unitPrice })),
    ...extra,
  });

const monthOf = (options: Partial<Parameters<typeof financeFor>[0]> = {}) =>
  financeFor({
    month: '2026-10',
    sales: [],
    bills: [],
    movements: [],
    crewMonths: [],
    store: [],
    machineHourly: 6000,
    now,
    today: '2026-10-06',
    ...options,
  });

describe('income by material', () => {
  const sales = [
    sale('SAK12345', {}),
    sale('SAK22345', { type: 'tractor', quantity: 2, unitPrice: 6500, amount: 13000 }),
    sale('SIX12345', { material: 'six_nine', quantity: 1, amount: 6500 }),
    sale('BOLD2345', { material: 'boldas', quantity: 1, amount: 6500 }),
    sale('OLD12345', { material: null, quantity: 1, amount: 1000 }),
    // Past its day and never verified: not income.
    sale('LAPS2345', { status: 'pending', verifiedBy: null, verifiedAt: null }),
  ];

  it('adds each material up, with what the landowner is paid on it taken off', () => {
    const { byMaterial } = monthOf({ sales, landownerRates: ratesSetOn1st });
    // Biggest first; a material tied keeps the order its bills came in.
    expect(byMaterial.map((row) => row.material)).toEqual(['sakka', 'six_nine', 'boldas', null]);

    // A tipper bill is one trip, a tractor bill its loads: 1 + 2 loads at 400.
    expect(byMaterial[0]).toEqual({ material: 'sakka', count: 2, loads: 3, amount: 32500, landownerShare: 1200, gross: 31300 });
    expect(byMaterial[1]).toMatchObject({ material: 'six_nine', amount: 6500, landownerShare: 500, gross: 6000 });
    // බෝල්දාස් earns the landowner nothing, and neither does a bill with no material recorded.
    expect(byMaterial[2]).toMatchObject({ material: 'boldas', landownerShare: 0, gross: 6500 });
    expect(byMaterial[3]).toMatchObject({ material: null, landownerShare: 0, gross: 1000 });
  });

  it('adds up to the income and to what the landowner is paid', () => {
    const month = monthOf({ sales, landownerRates: ratesSetOn1st });
    expect(month.byMaterial.reduce((total, row) => total + row.amount, 0)).toBe(month.income);
    expect(month.byMaterial.reduce((total, row) => total + row.landownerShare, 0)).toBe(month.landownerTotal);
    expect(month.income).toBe(46500);
  });

  it('has nothing to show for a month with no verified sales', () => {
    expect(monthOf({ sales: [sales[5]] }).byMaterial).toEqual([]);
  });
});

describe('what the work cost', () => {
  const operator = person('op1', 'operator', { dailyWage: 1000, wageBasis: 'hour' });
  const driller = person('dr1', 'compressor', { dailyWage: 500, wageBasis: 'hour' });
  const crewMonths = [crewMonth(operator, 10), crewMonth(driller, 8)];

  const movements = [
    // The excavator's fill: 40 L of diesel and 5 L of engine oil.
    drawn('u1', 'm-op1', 'fill1', [
      ['fill-diesel', 'ඩීසල්', 'L', 40, 360],
      ['fill-engineOil', 'එන්ජින් ඔයිල්', 'L', 5, 1000],
    ]),
    // The compressor's fill, and its explosives sheet.
    drawn('u2', 'm-dr1', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 30, 360]]),
    drawn('u3', 'm-dr1', 'blast', [['blast-shells', 'වෙඩි කරල්', '', 20, 500]]),
    // A part fitted at a service, drawn by hand against the excavator.
    drawn('u4', 'm-op1', null, [['service-engineOil', 'එන්ජින් ඔයිල් ෆිල්ටර්', 'ගණන', 1, 2500]]),
    // Grease drawn by hand with no machine named.
    drawn('u5', null, null, [['abc123', 'ග්‍රීස්', 'kg', 2, 1200]]),
    // Bought, not used: reported beside, never in the expenses.
    movement('b1', {
      type: 'restock',
      machineId: null,
      items: [{ itemId: 'fill-diesel', name: 'ඩීසල්', unit: 'L', delta: 10, unitPrice: 360 }],
    }),
  ];

  const bills = [
    billFrom('w1', { category: 'water', amount: 1500, date: '2026-10-04' }),
    // Charged to the operator: already part of their pay.
    billFrom('f1', { category: 'food', amount: 500, date: '2026-10-04', operatorId: 'op1', operatorName: 'op1' }),
  ];

  const month = monthOf({ crewMonths, movements, bills, machineKinds: kinds });
  const area = (name: 'loading' | 'drilling' | 'site') => month.areas.find((entry) => entry.area === name)!;
  const lines = (name: 'loading' | 'drilling' | 'site') =>
    Object.fromEntries(area(name).lines.map((line) => [line.key, line.value]));

  it('gives the excavator its crew, its machine charge and what it used', () => {
    expect(lines('loading')).toEqual({
      wages: 10000,
      machine: 60000,
      'stock-fuel': 40 * 360 + 5 * 1000,
      'stock-parts': 2500,
    });
    expect(area('loading').total).toBe(10000 + 60000 + 19400 + 2500);
  });

  it('gives the compressor its crew, its explosives and what it used', () => {
    expect(lines('drilling')).toEqual({ wages: 4000, 'stock-fuel': 10800, 'stock-explosives': 10000 });
    expect(area('drilling').total).toBe(24800);
  });

  it('gives the site the bills nobody’s pay holds, and what was drawn with no machine', () => {
    expect(lines('site')).toEqual({ 'stock-other': 2400, 'bill-water': 1500 });
    // The food is in the operator's pay, so it is not counted twice.
    expect(area('site').total).toBe(3900);
  });

  it('counts fuel and parts as they are used, and reports what was bought beside', () => {
    expect(month.usageTotal).toBe(45100);
    expect(month.purchaseTotal).toBe(3600);
    expect(month.expenses).toBe(14000 + 1500 + 45100 + 60000);
    expect(month.profit).toBe(-month.expenses);
  });

  it('adds up: the work’s costs and the landowner’s share are the expenses', () => {
    const byWork = month.areas.reduce((total, entry) => total + entry.total, 0);
    expect(byWork + month.landownerTotal).toBe(month.expenses);

    const withSales = monthOf({
      sales: [sale('SAK12345', {})],
      landownerRates: ratesSetOn1st,
      crewMonths,
      movements,
      bills,
      machineKinds: kinds,
    });
    expect(withSales.areas.reduce((total, entry) => total + entry.total, 0) + withSales.landownerTotal).toBe(
      withSales.expenses,
    );
    expect(withSales.landownerTotal).toBe(400);
  });

  it('lists each time the store was drawn from once, not each item', () => {
    const usage = month.ledger.filter((entry) => entry.kind === 'usage');
    expect(usage).toHaveLength(5);
    expect(usage.reduce((total, entry) => total + entry.expense, 0)).toBe(month.usageTotal);
    // The restock is not an expense, so it is not a ledger line either.
    expect(month.ledger.filter((entry) => entry.expense === 3600)).toEqual([]);
  });

  it('gives a machine of no known kind, and no machine at all, to the site', () => {
    const stray = monthOf({
      movements: [drawn('u6', 'mystery', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 10, 360]])],
      machineKinds: kinds,
    });
    expect(stray.areas.find((entry) => entry.area === 'site')!.lines.map((line) => line.key)).toEqual(['stock-fuel']);
    expect(stray.areas.find((entry) => entry.area === 'loading')!.lines).toEqual([]);
  });

  it('says how many uses had no store item to draw from, as they carry no value', () => {
    const partial = monthOf({
      movements: [
        drawn('u7', 'm-op1', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 10, 360]], { unmatched: ['fill:coolant', 'fill:hydraulic'] }),
        drawn('u8', 'm-dr1', 'blast', [['blast-caps', 'කැප්', '', 4, 100]], { unmatched: ['blast:shells'] }),
      ],
      machineKinds: kinds,
    });
    expect(partial.unmatchedUsage).toBe(3);
    expect(partial.usageTotal).toBe(3600 + 400);
    expect(month.unmatchedUsage).toBe(0);
  });

  it('prices a line written without a price at the item’s price today, and says so', () => {
    const old = monthOf({
      movements: [
        movement('u9', {
          type: 'usage',
          machineId: 'm-op1',
          source: 'fill1',
          date: '2026-10-03',
          items: [{ itemId: 'fill-diesel', name: 'ඩීසල්', unit: 'L', delta: -10 }],
        }),
      ],
      store: [
        {
          id: 'fill-diesel',
          name: 'ඩීසල්',
          unit: 'L',
          quantity: 100,
          minQuantity: 10,
          unitPrice: 400,
          link: 'fill:diesel',
          note: '',
          createdAt: null,
          countedAt: null,
          updatedAt: null,
        },
      ],
      machineKinds: kinds,
    });
    const fuel = old.areas[0].lines.find((line) => line.key === 'stock-fuel')!;
    expect(fuel.value).toBe(4000);
    expect(fuel.detail).toContain('වත්මන් මිලට');
  });
});

describe('grouping what the store gives out', () => {
  it('sorts a linked item by what uses it up, and still can once the item is gone', () => {
    expect(stockGroupOf('fill-diesel', 'fill:diesel')).toBe('fuel');
    expect(stockGroupOf('fill-coolant', null)).toBe('fuel');
    expect(stockGroupOf('blast-caps', undefined)).toBe('explosives');
    expect(stockGroupOf('service-dieselFilter', null)).toBe('parts');
    // An item the store keeps for itself, with no link, is just stock.
    expect(stockGroupOf('Zx81AbCd', null)).toBe('other');
    expect(stockGroupOf('Zx81AbCd', 'service:engineOil')).toBe('parts');
  });

  it('puts a machine’s costs with the work its kind does', () => {
    expect(areaOfMachine('m-op1', kinds)).toBe('loading');
    expect(areaOfMachine('m-dr1', kinds)).toBe('drilling');
    expect(areaOfMachine('mystery', kinds)).toBe('site');
    expect(areaOfMachine(null, kinds)).toBe('site');
  });
});
