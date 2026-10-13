import { describe, expect, it } from 'vitest';

import type { CrewMonth } from '../src/data/finance';
import { financeFor, stockGroupOf } from '../src/lib/finance';
import type { LandownerRate } from '../src/lib/landowner';
import { billFrom, dayFrom, movementFrom, type Movement, type Person, type Sale, type StoreItem } from '../src/lib/model';
import { DEFAULT_ROYALTY_RATES } from '../src/lib/royalty';

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
  otherLoadWage: 0,
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

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** What each expense came to, by category. */
const byCategory = (month: ReturnType<typeof monthOf>) =>
  Object.fromEntries(month.expenseRows.map((row) => [row.key, row.value]));

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

  it('adds each material up — the main ones first, then the side ones', () => {
    const { byMaterial } = monthOf({ sales });
    expect(byMaterial.map((row) => row.material)).toEqual(['six_nine', 'boldas', 'sakka', null]);

    // A tipper bill is one trip, a tractor bill its loads: 1 + 2 loads.
    expect(byMaterial[2]).toMatchObject({ material: 'sakka', count: 2, loads: 3, amount: 32500 });
    expect(byMaterial[0]).toMatchObject({ material: 'six_nine', count: 1, loads: 1, amount: 6500 });
    expect(byMaterial[1]).toMatchObject({ material: 'boldas', amount: 6500 });
    expect(byMaterial[3]).toMatchObject({ material: null, amount: 1000 });
  });

  it('adds up to the income', () => {
    const month = monthOf({ sales });
    expect(sum(month.byMaterial.map((row) => row.amount))).toBe(month.income);
    expect(month.income).toBe(46500);
  });

  it('has nothing to show for a month with no verified sales', () => {
    expect(monthOf({ sales: [sales[5]] }).byMaterial).toEqual([]);
  });

  it('counts C1 as a material of its own, which earns the landowner nothing', () => {
    const month = monthOf({
      sales: [sale('CONE2345', { material: 'c1', quantity: 2, amount: 13000 })],
      landownerRates: ratesSetOn1st,
    });
    expect(month.byMaterial).toHaveLength(1);
    expect(month.byMaterial[0]).toMatchObject({ material: 'c1', loads: 1, amount: 13000 });
    expect(month.landownerTotal).toBe(0);
  });

  it('sends the landowner his share of 6/9, සක්කර and කෝරි ඩස්ට් as an expense of his own', () => {
    const month = monthOf({ sales, landownerRates: ratesSetOn1st });
    // 3 loads of සක්කර at 400, 1 load of 6/9 at 500; බෝල්දාස් and a bill with no material earn nothing.
    expect(month.landownerTotal).toBe(1700);
    expect(month.landownerLoads).toBe(4);
    expect(byCategory(month)).toEqual({ landowner: 1700 });
    // One line for each bill that sent him a share: two සක්කර bills and the 6/9.
    expect(month.ledger.filter((entry) => entry.category === 'landowner')).toHaveLength(3);
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

  const month = monthOf({ crewMonths, movements, bills });

  it('lists each cost on a line of its own, in the order the page shows them', () => {
    expect(byCategory(month)).toEqual({
      // 40 L and 30 L at 360.
      diesel: 70 * 360,
      oil: 5 * 1000,
      shells: 20 * 500,
      parts: 2500,
      // Both crews' pay, less the food charged to it.
      wages: 14000 - 500,
      food: 500,
      machine: 60000,
      utilities: 1500,
      storeOther: 2 * 1200,
    });
    expect(month.expenseRows.map((row) => row.key)).toEqual([
      'diesel',
      'oil',
      'shells',
      'parts',
      'wages',
      'food',
      'machine',
      'utilities',
      'storeOther',
    ]);
  });

  it('tells the food apart from the pay it was charged to, and counts it once', () => {
    const rows = byCategory(month);
    expect(rows.food).toBe(500);
    expect(rows.wages + rows.food).toBe(month.salaryTotal);
    // Only the diesel is shared by every load.
    expect(month.expenseRows.filter((row) => row.shared).map((row) => row.key)).toEqual(['diesel']);
  });

  it('counts fuel and parts as they are used, and reports what was bought beside', () => {
    expect(month.usageTotal).toBe(45100);
    expect(month.purchaseTotal).toBe(3600);
    expect(month.expenses).toBe(14000 + 1500 + 45100 + 60000);
    expect(month.profit).toBe(-month.expenses);
  });

  it('adds up: the lines are the expenses, and each line is its own ledger entries', () => {
    expect(sum(month.expenseRows.map((row) => row.value))).toBe(month.expenses);
    expect(sum(month.ledger.map((entry) => entry.expense))).toBeCloseTo(month.expenses);
    for (const row of month.expenseRows) {
      const entries = month.ledger.filter((entry) => entry.category === row.key);
      expect(sum(entries.map((entry) => entry.expense)), row.key).toBeCloseTo(row.value);
    }

    const withSales = monthOf({
      sales: [sale('SAK12345', {})],
      landownerRates: ratesSetOn1st,
      crewMonths,
      movements,
      bills,
    });
    expect(withSales.landownerTotal).toBe(400);
    expect(sum(withSales.expenseRows.map((row) => row.value))).toBe(withSales.expenses);
    expect(withSales.expenses).toBe(month.expenses + 400);
  });

  it('lists each kind of thing drawn from the store on a line of its own each time', () => {
    const usage = month.ledger.filter((entry) => entry.kind === 'usage');
    // The first fill drew diesel and oil, so it is two lines; the rest are one each.
    expect(usage).toHaveLength(6);
    expect(usage.reduce((total, entry) => total + entry.expense, 0)).toBe(month.usageTotal);
    // The restock is not an expense, so it is not a ledger line either.
    expect(month.ledger.filter((entry) => entry.expense === 3600)).toEqual([]);
  });

  it('counts a machine nobody knows, and no machine at all, all the same', () => {
    const stray = monthOf({
      movements: [
        drawn('u6', 'mystery', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 10, 360]]),
        drawn('u7', null, null, [['fill-diesel', 'ඩීසල්', 'L', 5, 360]]),
      ],
    });
    expect(byCategory(stray)).toEqual({ diesel: 15 * 360 });
  });

  it('says how many uses had no store item to draw from, as they carry no value', () => {
    const partial = monthOf({
      movements: [
        drawn('u8', 'm-op1', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 10, 360]], { unmatched: ['fill:coolant', 'fill:hydraulic'] }),
        drawn('u9', 'm-dr1', 'blast', [['blast-caps', 'කැප්', '', 4, 100]], { unmatched: ['blast:shells'] }),
      ],
    });
    expect(partial.unmatchedUsage).toBe(3);
    expect(partial.usageTotal).toBe(3600 + 400);
    // The caps are not the shells: they are the other explosives.
    expect(byCategory(partial)).toEqual({ diesel: 3600, explosives: 400 });
    expect(month.unmatchedUsage).toBe(0);
  });

  it('prices a line written without a price at the item’s price today, and says so', () => {
    const old = monthOf({
      movements: [
        movement('u10', {
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
          piecesPerKg: null,
          link: 'fill:diesel',
          note: '',
          createdAt: null,
          countedAt: null,
          updatedAt: null,
        },
      ],
    });
    const fuel = old.expenseRows.find((row) => row.key === 'diesel')!;
    expect(fuel.value).toBe(4000);
    expect(fuel.detail).toContain('වත්මන් මිලට');
  });
});

describe('bills as expenses', () => {
  it('lists each kind of bill as the expense it is', () => {
    const month = monthOf({
      bills: [
        billFrom('p1', { category: 'repair', amount: 8000, date: '2026-10-06' }),
        billFrom('l1', { category: 'loan', amount: 25000, date: '2026-10-07' }),
        billFrom('w1', { category: 'water', amount: 1500, date: '2026-10-04' }),
        billFrom('o1', { category: 'other', amount: 700, date: '2026-10-04' }),
        // Food nobody's pay holds is still food.
        billFrom('f2', { category: 'food', amount: 900, date: '2026-10-04' }),
        // An advance to someone not on this month's pay is still pay.
        billFrom('a1', { category: 'advance', amount: 2000, date: '2026-10-04', operatorId: 'gone', operatorName: 'gone' }),
      ],
    });
    expect(byCategory(month)).toEqual({
      repair: 8000,
      loan: 25000,
      utilities: 1500,
      other: 700,
      food: 900,
      wages: 2000,
    });
  });

  it('knows every category the app and the rules write', () => {
    for (const category of ['advance', 'food', 'royalty', 'repair', 'water', 'loan', 'other']) {
      expect(billFrom('x', { category, amount: 1, date: '2026-10-01' }).category).toBe(category);
    }
    // Anything else is read as the rest.
    expect(billFrom('x', { category: 'nonsense', amount: 1, date: '2026-10-01' }).category).toBe('other');
  });
});

describe('what each material cost', () => {
  // 8 loads: 6/9 one trip, බෝල්දාස් two tractor loads, C1 one trip, සක්කර one
  // trip, කෝරි ඩස්ට් three tractor loads. The main materials have 4 of them.
  const sales = [
    sale('SIX12345', { material: 'six_nine' }),
    sale('BOLD2345', { material: 'boldas', type: 'tractor', quantity: 2, amount: 13000 }),
    sale('CONE2345', { material: 'c1' }),
    sale('SAK12345', { material: 'sakka' }),
    sale('DUST2345', { material: 'kory_dust', type: 'tractor', quantity: 3, amount: 19500 }),
  ];
  // 100 L of diesel at 360, and 48,000 of other costs.
  const movements = [drawn('d1', 'm-op1', 'fill1', [['fill-diesel', 'ඩීසල්', 'L', 100, 360]])];
  const bills = [
    billFrom('l1', { category: 'loan', amount: 40000, date: '2026-10-05' }),
    billFrom('p1', { category: 'repair', amount: 8000, date: '2026-10-06' }),
  ];
  const month = monthOf({ sales, movements, bills });
  const row = (material: string | null) => month.byMaterial.find((entry) => entry.material === material)!;

  it('shares the diesel over every load, and everything else over the main materials’ loads alone', () => {
    expect(month.allocation).toMatchObject({
      sharedTotal: 36000,
      otherTotal: 48000,
      allLoads: 8,
      mainLoads: 4,
      sharedPerLoad: 4500,
      otherPerMainLoad: 12000,
      unallocated: 0,
    });
    expect(row('six_nine')).toMatchObject({ loads: 1, dieselShare: 4500, otherShare: 12000, cost: 16500, profit: 3000 });
    expect(row('boldas')).toMatchObject({ loads: 2, dieselShare: 9000, otherShare: 24000, cost: 33000, profit: 13000 - 33000 });
    expect(row('c1')).toMatchObject({ loads: 1, dieselShare: 4500, otherShare: 12000, cost: 16500, profit: 3000 });
  });

  it('gives සක්කර and කෝරි ඩස්ට් the diesel only', () => {
    expect(row('sakka')).toMatchObject({ loads: 1, dieselShare: 4500, otherShare: 0, cost: 4500, profit: 15000 });
    expect(row('kory_dust')).toMatchObject({ loads: 3, dieselShare: 13500, otherShare: 0, cost: 13500, profit: 6000 });
  });

  it('works out a load’s income, cost and profit — the cost is the least it must sell for', () => {
    expect(row('six_nine')).toMatchObject({ incomePerLoad: 19500, costPerLoad: 16500, profitPerLoad: 3000 });
    expect(row('boldas')).toMatchObject({ incomePerLoad: 6500, costPerLoad: 16500, profitPerLoad: -10000 });
    expect(row('kory_dust')).toMatchObject({ costPerLoad: 4500, profitPerLoad: 2000 });
  });

  it('lists the main materials, then the side ones', () => {
    expect(month.byMaterial.map((entry) => entry.material)).toEqual(['six_nine', 'boldas', 'c1', 'sakka', 'kory_dust']);
  });

  it('adds up: what the materials made is the month’s profit', () => {
    expect(sum(month.byMaterial.map((entry) => entry.cost))).toBeCloseTo(month.expenses);
    expect(sum(month.byMaterial.map((entry) => entry.profit))).toBeCloseTo(month.profit);
    expect(month.profit).toBe(91000 - 84000);
  });

  it('says what could not be shared when no load of the right kind left', () => {
    const sideOnly = monthOf({ sales: [sale('SAK12345', { material: 'sakka' })], bills, movements });
    expect(sideOnly.allocation.mainLoads).toBe(0);
    expect(sideOnly.allocation.otherPerMainLoad).toBeNull();
    // The repairs and the loan have no main load to go on; the diesel goes on සක්කර.
    expect(sideOnly.allocation.unallocated).toBe(48000);
    expect(sideOnly.byMaterial[0]).toMatchObject({ dieselShare: 36000, otherShare: 0 });
    expect(sum(sideOnly.byMaterial.map((entry) => entry.profit)) - sideOnly.allocation.unallocated).toBeCloseTo(
      sideOnly.profit,
    );

    const nothingSold = monthOf({ bills, movements });
    expect(nothingSold.byMaterial).toEqual([]);
    expect(nothingSold.allocation.unallocated).toBe(nothingSold.expenses);
  });

  it('gives a bill with no material its load of the diesel and none of the rest', () => {
    const old = monthOf({ sales: [...sales, sale('OLD12345', { material: null })], movements, bills });
    expect(old.allocation.allLoads).toBe(9);
    expect(old.allocation.mainLoads).toBe(4);
    expect(old.byMaterial.at(-1)).toMatchObject({ material: null, dieselShare: 4000, otherShare: 0 });
  });
});

describe('grouping what the store gives out', () => {
  it('sorts a linked item by what uses it up, and still can once the item is gone', () => {
    expect(stockGroupOf('fill-diesel', 'fill:diesel')).toBe('diesel');
    expect(stockGroupOf('fill-engineOil', 'fill:engineOil')).toBe('oil');
    expect(stockGroupOf('fill-coolant', null)).toBe('oil');
    expect(stockGroupOf('blast-shells', null)).toBe('shells');
    expect(stockGroupOf('blast-caps', undefined)).toBe('explosives');
    expect(stockGroupOf('service-dieselFilter', null)).toBe('parts');
    // An item the store keeps for itself, with no link, is just stock.
    expect(stockGroupOf('Zx81AbCd', null)).toBe('storeOther');
    expect(stockGroupOf('Zx81AbCd', 'service:engineOil')).toBe('parts');
  });
});

describe('the royalty', () => {
  const driller = person('dr1', 'compressor');
  const lockedAt = '2026-10-03T10:00:00.000Z';

  /** A day with a වෙඩි බඩු sheet, OK'd unless said otherwise. */
  const sheetDay = (date: string, amounts: object, locked: string | null = lockedAt) =>
    dayFrom(date, { blasting: { amounts, lockedAt: locked } });
  const withDays = (days: ReturnType<typeof sheetDay>[], who: Person = driller): CrewMonth => ({
    ...crewMonth(who, 0),
    days,
  });
  const shellsItem = (piecesPerKg: number | null): StoreItem => ({
    id: 'blast-shells',
    name: 'වෙඩි කරල්',
    unit: 'ගණන',
    quantity: 100,
    minQuantity: 10,
    unitPrice: 450,
    piecesPerKg,
    link: 'blast:shells',
    note: '',
    createdAt: null,
    countedAt: null,
    updatedAt: null,
  });

  // 15 kg of gel is 120 කරල්; with 75 kg of ammonia that is one delivery's worth.
  const delivery = sheetDay('2026-10-03', { shells: 120, ammonia: 75 });

  it('is (gel kg + ammonia kg) × 3.5 × 700 × 18%', () => {
    const month = monthOf({ crewMonths: [withDays([delivery])] });
    expect(month.royalty).toMatchObject({
      shells: 120,
      gelKg: 15,
      ammoniaKg: 75,
      kg: 90,
      cubes: 315,
      worth: 220500,
      royalty: 39690,
    });
    expect(byCategory(month)).toEqual({ royalty: 39690 });
    expect(month.expenses).toBe(39690);
  });

  it('starts at 3.5 cubes a kilo, රු. 700 a cube and 18%', () => {
    expect(DEFAULT_ROYALTY_RATES).toEqual({ cubesPerKg: 3.5, cubeValue: 700, percent: 18 });
  });

  it('turns කරල් into kilos at the shells item’s own figure, and at 8 to the kilo without one', () => {
    const crewMonths = [withDays([sheetDay('2026-10-03', { shells: 120 })])];
    // 120 කරල් at 10 to the kilo is 12 kg of gel.
    expect(monthOf({ crewMonths, store: [shellsItem(10)] }).royalty.gelKg).toBe(12);
    // The item has no figure, or there is no item at all: 120 ÷ 8.
    expect(monthOf({ crewMonths, store: [shellsItem(null)] }).royalty.gelKg).toBe(15);
    expect(monthOf({ crewMonths }).royalty.gelKg).toBe(15);
  });

  it('is worked out at the rates staff set', () => {
    const month = monthOf({
      crewMonths: [withDays([delivery])],
      royaltyRates: { cubesPerKg: 4, cubeValue: 1000, percent: 10 },
    });
    // 90 kg × 4 × 1000 × 10%
    expect(month.royalty.royalty).toBe(36000);
  });

  it('counts the gel and the ammonia only — not the caps, the wire or the rest', () => {
    const month = monthOf({
      crewMonths: [withDays([sheetDay('2026-10-03', { caps: 190, blastingWire: 262, yaramila: 40, blastPowder: 10 })])],
    });
    expect(month.royalty.royalty).toBe(0);
    expect(month.royalty.days).toEqual([]);
    expect(month.expenseRows).toEqual([]);
  });

  it('counts a sheet once it is OK’d, not while it is still a draft', () => {
    const month = monthOf({
      crewMonths: [withDays([delivery, sheetDay('2026-10-04', { shells: 80, ammonia: 50 }, null)])],
    });
    expect(month.royalty.days.map((day) => day.date)).toEqual(['2026-10-03']);
    expect(month.royalty.royalty).toBe(39690);
  });

  it('counts a machine’s sheet once, however many crew share it', () => {
    const twin = person('dr2', 'compressor', { machineId: driller.machineId });
    const month = monthOf({ crewMonths: [withDays([delivery]), withDays([delivery], twin)] });
    expect(month.royalty.days).toHaveLength(1);
    expect(month.royalty.royalty).toBe(39690);
  });

  it('ignores the sheet of anyone who is not a driller', () => {
    const month = monthOf({ crewMonths: [withDays([delivery], person('op1', 'operator'))] });
    expect(month.royalty.royalty).toBe(0);
  });

  it('adds up over the days, and the ledger has a line for each that adds up to it', () => {
    const month = monthOf({
      crewMonths: [
        withDays([delivery, sheetDay('2026-10-10', { shells: 60, ammonia: 30 }), sheetDay('2026-10-12', { ammonia: 10 })]),
      ],
    });
    // (15 + 75) + (7.5 + 30) + 10 = 137.5 kg
    expect(month.royalty.kg).toBe(137.5);
    expect(month.royalty.royalty).toBeCloseTo(60637.5);
    const entries = month.ledger.filter((entry) => entry.kind === 'royalty');
    expect(entries.map((entry) => entry.date)).toEqual(['2026-10-03', '2026-10-10', '2026-10-12']);
    expect(sum(entries.map((entry) => entry.expense))).toBeCloseTo(month.royalty.royalty);
    expect(byCategory(month).royalty).toBeCloseTo(month.royalty.royalty);
  });

  it('does not count a royalty bill a second time — it is what was paid against the figure', () => {
    const month = monthOf({
      crewMonths: [withDays([delivery])],
      bills: [billFrom('r1', { category: 'royalty', amount: 30000, date: '2026-10-05' })],
    });
    expect(byCategory(month)).toEqual({ royalty: 39690 });
    expect(month.royalty.paid).toBe(30000);
    // Still listed, but carrying no expense, so the entries behind royalty still add up to it.
    const entries = month.ledger.filter((entry) => entry.category === 'royalty');
    expect(entries).toHaveLength(2);
    expect(sum(entries.map((entry) => entry.expense))).toBe(39690);
    expect(month.expenseRows.find((row) => row.key === 'royalty')!.detail).toContain('ගෙවූ බිල්පත්');
  });

  it('shows a royalty bill with nothing yet worked out as paid, and costs nothing', () => {
    const month = monthOf({ bills: [billFrom('r1', { category: 'royalty', amount: 30000, date: '2026-10-05' })] });
    expect(month.royalty.paid).toBe(30000);
    expect(month.royalty.royalty).toBe(0);
    expect(month.expenses).toBe(0);
  });
});
