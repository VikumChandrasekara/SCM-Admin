import type { CrewMonth } from '../data/finance';
import { dateKey, money, monthBounds, quantity } from './format';
import { landownerChargeOf, paysLandowner, saleLoads, type LandownerRate } from './landowner';
import { drillerLoads, operatorLoads } from './loads';
import {
  BILL,
  DEFAULT_SHELLS_PER_KG,
  RATE_BASIS_LABEL,
  ROLES,
  SALE_MATERIAL,
  SALE_TYPE,
  saleNumber,
  nameOf,
  awaitsPrepaidLoad,
  isSaleIncome,
  piecesPerKgOf,
  saleStatus,
  sourceLabel,
  type Bill,
  type BillCategory,
  type Machine,
  type Movement,
  type Payment,
  type Person,
  type RateBasis,
  type Sale,
  type SaleMaterial,
  type SaleType,
  type StockLink,
  type StoreItem,
} from './model';
import { payFor, type PayFigures } from './pay';
import { DEFAULT_ROYALTY_RATES, monthRoyaltyOf, type MonthRoyalty, type RoyaltyRates } from './royalty';

/**
 * A month's money, as the admin's finance page lays it out.
 *
 * Income is verified sales only, and is shown by material: 6/9, බෝල්දාස්, C1,
 * සක්කර and කෝරි ඩස්ට්.
 *
 * Expenses are what the work cost, each counted once and listed by what it was
 * spent on — see {@link ExpenseCategory}:
 *
 *   - from the store, at what it cost when it was drawn: diesel, oil, the
 *     shells (කරල්), the other explosives, and parts;
 *   - crew pay (පඩි), and the food (කෑම) bills, which are the site's own cost
 *     and not taken out of anyone's pay;
 *   - what the machine is charged for each hour it worked;
 *   - the landowner (බදු හිමියා), for each load of 6/9, සක්කර or කෝරි ඩස්ට්;
 *   - the රාජ භාගය, worked out from the gel and ammonia the drillers signed off
 *     (see royalty.ts) — the royalty bills entered are what was paid, reported
 *     beside it rather than counted again;
 *   - the bills: repairs, the water / electricity bill, loan instalments and
 *     the rest.
 *
 * Crew pay counts in full — advances charged to a crew member are part of it,
 * paid early, so they are not counted again as bills. Food is not: it is its
 * own expense, whoever it was bought for.
 *
 * Fuel, oil, explosives and parts count in the month they were *used*, at what
 * they cost when they were drawn from the store. What was bought is reported
 * beside the total, not in it.
 *
 * What each material cost is then worked out by load (see {@link Allocation}):
 * the diesel is shared by every load that left, whatever it was made of, and
 * everything else by the loads of the main materials alone. සක්කර and කෝරි
 * ඩස්ට් therefore carry diesel only.
 */

export interface SalesTotal {
  count: number;
  quantity: number;
  amount: number;
}

export interface SalaryRow {
  person: Person;
  pay: PayFigures;
  /** Advances paid out during the month — part of the pay, paid early. */
  advances: number;
}

/** A priced line of stock: bought, or used. */
export interface StockRow {
  key: string;
  label: string;
  unit: string;
  quantity: number;
  value: number;
  /** Priced at today's price, the line having been written without one. */
  estimated: boolean;
}

/** What a store item was used for, as the page groups it. */
export type StockGroup = 'diesel' | 'oil' | 'shells' | 'explosives' | 'parts' | 'storeOther';

export const STOCK_GROUPS: readonly StockGroup[] = ['diesel', 'oil', 'shells', 'explosives', 'parts', 'storeOther'];

/**
 * Which group a store item belongs to. A linked item lives at a fixed id (see
 * linkDocId), so it still groups after the item itself has been deleted.
 *
 * Diesel is told apart from every other fluid a පිරවීම draws, and the shells
 * (වෙඩි කරල්) from the rest of what a blast uses.
 */
export function stockGroupOf(itemId: string, link: StockLink | null | undefined): StockGroup {
  const key = link ?? itemId.replace('-', ':');
  if (key === 'fill:diesel') return 'diesel';
  if (key.startsWith('fill:')) return 'oil';
  if (key === 'blast:shells') return 'shells';
  if (key.startsWith('blast:')) return 'explosives';
  if (key.startsWith('service:')) return 'parts';
  return 'storeOther';
}

/** What a rupee of expense was spent on. */
export type ExpenseCategory =
  | StockGroup
  | 'wages'
  | 'food'
  | 'machine'
  | 'landowner'
  | 'royalty'
  | 'repair'
  | 'utilities'
  | 'loan'
  | 'other';

/** In the order the page lists them. */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'diesel',
  'oil',
  'shells',
  'explosives',
  'parts',
  'wages',
  'food',
  'machine',
  'landowner',
  'royalty',
  'repair',
  'utilities',
  'loan',
  'other',
  'storeOther',
];

export const EXPENSE_LABEL: Record<ExpenseCategory, { label: string; detail: string }> = {
  diesel: { label: 'ඩීසල්', detail: 'පිරවීම් වලින් භාවිත කළ — ලෝඩ් සියල්ලටම බෙදේ' },
  oil: { label: 'ඔයිල් සහ කූලන්ට්', detail: 'එන්ජින්, හයිඩ්‍රොලික්, කම්පසර් ඔයිල් සහ කූලන්ට්' },
  shells: { label: 'කරල්', detail: 'වෙඩි කරල් — ගබඩාවෙන් භාවිත කළ' },
  explosives: { label: 'වෙඩි බඩු — අනෙක්', detail: 'කැප්, වෙඩි නූල්, ඇමෝනියා, යාරමීලා, වෙඩි කුඩු, ඩීසල් මිශ්‍ර, බිට්, කටු' },
  parts: { label: 'කොටස් සහ සර්විස්', detail: 'ෆිල්ටර් සහ සර්විස් කොටස්' },
  wages: { label: 'පඩි', detail: 'කණ්ඩායම් වැටුප් — ඇඩ්වාන්ස් ඇතුළුව' },
  food: { label: 'කෑම', detail: 'කෑම බිල්පත්' },
  machine: { label: 'යන්ත්‍රයට පැයකට', detail: 'එක්ස්කවේටර් වැඩ කළ පැය × පැයක ගාස්තුව' },
  landowner: { label: 'බදු හිමියා', detail: 'ලෝඩ් එකකට ගාස්තුව' },
  royalty: { label: 'රාජ භාගය', detail: 'ජෙල් සහ ඇමෝනියා භාවිතයෙන් ගණනය කළ' },
  repair: { label: 'අලුත්වැඩියා', detail: 'බිල්පත් වලින්' },
  utilities: { label: 'වතුර / විදුලි බිල', detail: 'බිල්පත් වලින්' },
  loan: { label: 'ණය වාරික', detail: 'බිල්පත් වලින්' },
  other: { label: 'වෙනත්', detail: 'වෙනත් බිල්පත්' },
  storeOther: { label: 'වෙනත් ගබඩා භාවිතය', detail: 'යන්ත්‍රයක් නැතිව හෝ සම්බන්ධ නොකළ අයිතම' },
};

/** What each kind of bill is, as an expense. */
const EXPENSE_OF_BILL: Record<BillCategory, ExpenseCategory> = {
  // An advance is pay, paid early. One charged to someone on this month's pay is
  // already inside it; any other still counts, as pay.
  advance: 'wages',
  food: 'food',
  royalty: 'royalty',
  repair: 'repair',
  water: 'utilities',
  loan: 'loan',
  other: 'other',
};

/**
 * Spent on every load that left, whatever it was made of. Every other expense
 * is carried by the loads of the main materials alone.
 */
export const SHARED_CATEGORIES: readonly ExpenseCategory[] = ['diesel'];

/** The materials the work of getting them out is spent on. */
export const MAIN_MATERIALS = ['six_nine', 'boldas', 'c1'] as const satisfies readonly SaleMaterial[];

/** The materials that carry diesel only. */
export const SIDE_MATERIALS = ['sakka', 'kory_dust'] as const satisfies readonly SaleMaterial[];

export function isMainMaterial(material: SaleMaterial | null): boolean {
  return material != null && (MAIN_MATERIALS as readonly string[]).includes(material);
}

/** One line of what the month cost. */
export interface ExpenseRow {
  key: ExpenseCategory;
  label: string;
  detail: string;
  value: number;
  /** Shared by every load, rather than by the main materials' loads alone. */
  shared: boolean;
}

/** One material's verified sales, and what they cost. */
export interface MaterialRow {
  /** Null on a sale from before the material was recorded. */
  material: SaleMaterial | null;
  count: number;
  /** Loads the bills count for — a tipper bill is one trip, a tractor bill its loads. */
  loads: number;
  amount: number;
  /** The diesel's share: [Allocation.sharedPerLoad] for each load. */
  dieselShare: number;
  /** Everything else's share: [Allocation.otherPerMainLoad] for each load — nothing for a side material. */
  otherShare: number;
  /** [dieselShare] and [otherShare] together. */
  cost: number;
  /** [amount] less [cost]. */
  profit: number;
  /** Null when no load of this material left. */
  incomePerLoad: number | null;
  costPerLoad: number | null;
  profitPerLoad: number | null;
}

/** The month's රාජ භාගය, and the royalty bills entered against it. */
export interface RoyaltyReport extends MonthRoyalty {
  /**
   * Royalty bills entered this month — what was paid. Not an expense of its
   * own: the royalty above is what the month counts.
   */
  paid: number;
}

/** How the month's expenses were shared out over the loads that left. */
export interface Allocation {
  /** Expenses shared by every load. */
  sharedTotal: number;
  /** Every other expense. */
  otherTotal: number;
  /** Loads of every material, and of the main ones alone. */
  allLoads: number;
  mainLoads: number;
  /** Null when no load left, so there is nothing to share it over. */
  sharedPerLoad: number | null;
  otherPerMainLoad: number | null;
  /** What could be given to no material because no load of the right kind left. */
  unallocated: number;
}

export type LedgerKind = 'sale' | 'payment' | 'machine' | 'landowner' | 'royalty' | 'bill' | 'usage' | 'salary';

export interface LedgerEntry {
  date: string;
  kind: LedgerKind;
  /** What the expense was spent on; null for income. */
  category: ExpenseCategory | null;
  description: string;
  income: number;
  expense: number;
}

export interface Finance {
  income: number;
  incomeByType: Record<SaleType, SalesTotal>;
  /** Income by material — the main ones first, then the side ones — each with what it cost. */
  byMaterial: MaterialRow[];
  allocation: Allocation;
  pending: SalesTotal;
  cancelled: SalesTotal;
  /**
   * Cash received against credit accounts this month. Not part of [income]:
   * a credit sale is already counted there when it is verified.
   */
  creditPayments: { count: number; amount: number };
  /** Prepaid bills whose load has not gone yet — already part of [income]. */
  prepaidOpen: SalesTotal;

  salaries: SalaryRow[];
  salaryTotal: number;
  /**
   * What was bought for the store this month — reported beside the total, not
   * in it: that stock counts when it is used, see [usageTotal].
   */
  purchases: StockRow[];
  purchaseTotal: number;
  /** Every expense, a line for each category that cost anything. Adds up to [expenses]. */
  expenseRows: ExpenseRow[];
  /**
   * Uses recorded this month that had no store item to draw from — or whose
   * shelf had been counted since. They carry no value, so the figures above
   * may be low by that much.
   */
  unmatchedUsage: number;
  /** Hours the loading excavator crews worked this month. */
  machineHours: number;
  /** What those hours sent to the machine. */
  machineTotal: number;
  /** Loads of 6/9, සක්කර and කෝරි ඩස්ට් the verified sales count for the landowner. */
  landownerLoads: number;
  /** What those loads sent to the landowner. */
  landownerTotal: number;
  royalty: RoyaltyReport;

  usageByMachine: StockRow[];
  usageByItem: StockRow[];
  usageTotal: number;

  expenses: number;
  profit: number;
  /** Every entry behind the totals, oldest first. */
  ledger: LedgerEntry[];
}

const noSales = (): SalesTotal => ({ count: 0, quantity: 0, amount: 0 });

function addSale(total: SalesTotal, sale: Sale): void {
  total.count += 1;
  total.quantity += sale.quantity;
  total.amount += sale.amount;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Adds [amount] of [line] to the row under [key], making it if need be. */
function addStock(
  rows: Map<string, StockRow>,
  key: string,
  label: string,
  unit: string,
  amount: number,
  value: number,
  estimated: boolean,
): void {
  const row = rows.get(key) ?? { key, label, unit, quantity: 0, value: 0, estimated: false };
  row.quantity += amount;
  row.value += value;
  row.estimated ||= estimated;
  // Rows that mix units (one machine, many items) show no quantity.
  if (row.unit !== unit) row.unit = '';
  rows.set(key, row);
}

const byValue = (a: StockRow, b: StockRow) => b.value - a.value;

export function financeFor({
  month,
  sales,
  bills,
  movements,
  crewMonths,
  payments = [],
  store,
  machines = new Map<string, Machine>(),
  machineHourly,
  landownerRates = [],
  royaltyRates = DEFAULT_ROYALTY_RATES,
  now,
  today,
}: {
  month: string;
  sales: readonly Sale[];
  bills: readonly Bill[];
  movements: readonly Movement[];
  crewMonths: readonly CrewMonth[];
  /** Every payment against a credit account — only this month's are counted. */
  payments?: readonly Payment[];
  store: readonly StoreItem[];
  /** Every machine, for the rate each was given. */
  machines?: ReadonlyMap<string, Machine>;
  /** What an excavator with no rate of its own is charged for each hour it worked — one figure, applied to every month. */
  machineHourly: number;
  /** Every setting of the landowner's per-load figure — each sale is worked out at the one in force at the end of its month. */
  landownerRates?: readonly LandownerRate[];
  /** What the රාජ භාගය is worked out at — see royalty.ts. */
  royaltyRates?: RoyaltyRates;
  now: number;
  /** `yyyy-MM-dd` — only feeds payFor's leaveDays, which this report never shows. */
  today: string;
}): Finance {
  const ledger: LedgerEntry[] = [];

  /** What each category cost, and a line of words for those that say more than their name. */
  const totals = new Map<ExpenseCategory, number>();
  const details = new Map<ExpenseCategory, string>();
  const spend = (category: ExpenseCategory, value: number) =>
    totals.set(category, (totals.get(category) ?? 0) + value);

  // ---- income ----
  const incomeByType: Record<SaleType, SalesTotal> = { tipper: noSales(), tractor: noSales() };
  const pending = noSales();
  const cancelled = noSales();
  const prepaidOpen = noSales();
  let landownerLoads = 0;
  let landownerTotal = 0;
  const materials = new Map<SaleMaterial | null, { count: number; loads: number; amount: number }>();
  for (const sale of sales) {
    const status = saleStatus(sale, now);
    // A prepaid bill is income from the day it was paid, in that month, so a
    // closed month's figures never move when the load goes later.
    if (isSaleIncome(sale, now)) {
      addSale(incomeByType[sale.type], sale);
      if (awaitsPrepaidLoad(sale, now)) addSale(prepaidOpen, sale);
      ledger.push({
        date: sale.date,
        kind: 'sale',
        category: null,
        description: `${sale.prepaid ? 'කලින් ගෙවූ · ' : ''}${SALE_TYPE[sale.type].label} ${quantity(
          sale.quantity,
          SALE_TYPE[sale.type].unit,
        )} · ${sale.customerName || 'පාරිභෝගිකයා'} · බිල් ${saleNumber(sale)}`,
        income: sale.amount,
        expense: 0,
      });

      // The landowner's share goes with the expenses, in the month it was paid,
      // at the figure in force at the end of that month.
      const share = landownerChargeOf(sale, landownerRates);
      if (paysLandowner(sale)) landownerLoads += saleLoads(sale);
      landownerTotal += share;
      if (share > 0) {
        ledger.push({
          date: sale.date,
          kind: 'landowner',
          category: 'landowner',
          description: `බදු හිමියාට · ලෝඩ් ${quantity(saleLoads(sale))} · ${sale.material ? SALE_MATERIAL[sale.material] : ''} · බිල් ${saleNumber(sale)}`,
          income: 0,
          expense: share,
        });
      }

      const row = materials.get(sale.material) ?? { count: 0, loads: 0, amount: 0 };
      row.count += 1;
      row.loads += saleLoads(sale);
      row.amount += sale.amount;
      materials.set(sale.material, row);
    } else if (status === 'pending') {
      addSale(pending, sale);
    } else {
      addSale(cancelled, sale);
    }
  }
  const income = incomeByType.tipper.amount + incomeByType.tractor.amount;
  spend('landowner', landownerTotal);
  details.set(
    'landowner',
    `6/9, සක්කර, කෝරි ඩස්ට් ලෝඩ් ${quantity(landownerLoads)} — මාසය අවසන් වන විට ඇති ගාස්තුවෙන්`,
  );

  const creditPayments = { count: 0, amount: 0 };
  for (const payment of payments) {
    if (!payment.date.startsWith(month)) continue;
    creditPayments.count += 1;
    creditPayments.amount += payment.amount;
    ledger.push({
      date: payment.date,
      kind: 'payment',
      category: null,
      description: `ණය ගෙවීම · ${payment.customerName || 'පාරිභෝගිකයා'}${payment.note ? ` · ${payment.note}` : ''}`,
      income: payment.amount,
      expense: 0,
    });
  }

  // ---- crew pay ----
  const salaries: SalaryRow[] = crewMonths.map(({ person, days, tally }) => {
    const theirs = bills.filter((bill) => bill.operatorId === person.id);
    return {
      person,
      pay: payFor(person, days, tally, bills, null, today, sales, now),
      advances: sum(theirs.filter((bill) => bill.category === 'advance').map((bill) => bill.amount)),
    };
  });
  const salaryTotal = sum(salaries.map((row) => row.pay.gross));
  const monthEnd = monthBounds(month).to;

  // Food is not taken from anyone's pay: its bills are counted once, below, as food.
  spend('wages', salaryTotal);
  details.set(
    'wages',
    `${salaries.length} දෙනෙක් · වැඩ කළ දින ${sum(salaries.map((row) => row.pay.workedDays))} — ඇඩ්වාන්ස් ඇතුළුව`,
  );

  // ---- the machine ----
  // Each machine is charged at the rate it was given — per hour its crew worked,
  // per load it moved or per foot it drilled — whatever was sold. A machine that
  // was never given one is, for an excavator, charged by the hour at the figure in
  // the sales settings, as every excavator was before machines had a rate.
  let machineHours = 0;
  let machineLoads = 0;
  let machineFeet = 0;
  let machineTotal = 0;
  for (const { person, tally } of crewMonths) {
    const machine = machines.get(person.machineId);
    const own = machine?.rate != null;
    const rate = own ? (machine?.rate ?? 0) : person.role === 'operator' ? machineHourly : 0;
    const basis: RateBasis = own ? (machine?.rateBasis ?? 'hour') : 'hour';
    if (!own && person.role !== 'operator') continue;
    // Loads are those of the bills that name the person, never a typed-in tally.
    const loadsOf = () => {
      if (ROLES[person.role].tracksBonus) return operatorLoads(sales, person.id, month, now, false);
      const own = drillerLoads(sales, month, now, person.id);
      return own.sixNine + own.sakka + own.boldas + own.c1 + own.other;
    };
    const counted = basis === 'hour' ? tally.hours : basis === 'load' ? loadsOf() : tally.feet;
    if (!(counted > 0)) continue;

    const charge = counted * rate;
    if (basis === 'hour') machineHours += counted;
    else if (basis === 'load') machineLoads += counted;
    else machineFeet += counted;
    machineTotal += charge;
    if (charge > 0) {
      ledger.push({
        date: monthEnd,
        kind: 'machine',
        category: 'machine',
        description: `යන්ත්‍රයට · ${RATE_BASIS_LABEL[basis].unit} ${quantity(counted)} · ${nameOf(person)}`,
        income: 0,
        expense: charge,
      });
    }
  }
  spend('machine', machineTotal);
  details.set(
    'machine',
    [
      machineHours > 0 || (machineLoads === 0 && machineFeet === 0) ? `එක්ස්කවේටර් වැඩ කළ පැය ${quantity(machineHours)}` : '',
      machineLoads > 0 ? `ලෝඩ් ${quantity(machineLoads)}` : '',
      machineFeet > 0 ? `අඩි ${quantity(machineFeet)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  for (const row of salaries) {
    ledger.push({
      date: monthEnd,
      kind: 'salary',
      category: 'wages',
      description: `${nameOf(row.person)} — වැටුප් ශේෂය (ඇඩ්වාන්ස් අඩු කළ පසු)`,
      income: 0,
      expense: row.pay.net,
    });
  }

  // ---- bills ----
  const paidCrew = new Set(crewMonths.map(({ person }) => person.id));
  let royaltyPaid = 0;
  for (const bill of bills) {
    const category = EXPENSE_OF_BILL[bill.category];
    // The royalty is worked out from the explosives used (below), so a bill for
    // it is what was paid against that — listed, but not counted a second time.
    if (bill.category === 'royalty') {
      royaltyPaid += bill.amount;
      ledger.push({
        date: bill.date,
        kind: 'bill',
        category,
        description: [
          BILL.royalty.label,
          bill.operatorName,
          bill.note,
          `ගෙවූ රු. ${money(bill.amount)} — ගණනය කළ රාජ භාගයට ඇතුළත්, නැවත ගණන් නොගනී`,
        ]
          .filter(Boolean)
          .join(' · '),
        income: 0,
        expense: 0,
      });
      continue;
    }
    ledger.push({
      date: bill.date,
      kind: 'bill',
      category,
      description: [BILL[bill.category].label, bill.operatorName, bill.note].filter(Boolean).join(' · '),
      income: 0,
      expense: bill.amount,
    });
    // Charged to someone on this month's pay: counted there, in full.
    const partOfPay = BILL[bill.category].deduction && bill.operatorId != null && paidCrew.has(bill.operatorId);
    if (!partOfPay) spend(category, bill.amount);
  }

  // ---- the royalty ----
  // Worked out from what the drillers signed off, not from the store: it is owed
  // on the rock brought down whether or not a store item was there to draw from.
  const shellsPerKg = piecesPerKgOf(store.find((item) => item.link === 'blast:shells')) ?? DEFAULT_SHELLS_PER_KG;
  const royalty = monthRoyaltyOf(crewMonths, shellsPerKg, royaltyRates);
  spend('royalty', royalty.royalty);
  if (royalty.days.length > 0) {
    details.set(
      'royalty',
      `ජෙල් ${quantity(royalty.gelKg)} kg + ඇමෝනියා ${quantity(royalty.ammoniaKg)} kg = ${quantity(royalty.kg)} kg ` +
        `× ${quantity(royaltyRates.cubesPerKg)} × රු. ${money(royaltyRates.cubeValue)} × ${quantity(royaltyRates.percent)}%` +
        (royaltyPaid > 0 ? ` · ගෙවූ බිල්පත් රු. ${money(royaltyPaid)}` : ''),
    );
  }
  for (const day of royalty.days) {
    ledger.push({
      date: day.date,
      kind: 'royalty',
      category: 'royalty',
      description:
        `${day.machineId} · ජෙල් කරල් ${quantity(day.shells)} (${quantity(day.gelKg)} kg)` +
        ` + ඇමෝනියා ${quantity(day.ammoniaKg)} kg = ${quantity(day.kg)} kg`,
      income: 0,
      expense: day.royalty,
    });
  }

  // ---- the store ----
  const priceNow = new Map(store.map((item) => [item.id, item.unitPrice]));
  const linkOf = new Map(store.map((item) => [item.id, item.link]));
  const purchases = new Map<string, StockRow>();
  const usageByMachine = new Map<string, StockRow>();
  const usageByItem = new Map<string, StockRow>();
  /** What was used, by the kind of thing it was. */
  const usedByGroup = new Map<StockGroup, { value: number; estimated: boolean }>();
  let unmatchedUsage = 0;

  for (const movement of movements) {
    const bought = movement.type === 'create' || movement.type === 'restock';
    const used = movement.type === 'usage' || movement.type === 'use';
    if (!bought && !used) continue;
    if (used) unmatchedUsage += movement.unmatched.length;

    /** What this one drawing took, by the kind of thing it was. */
    const drawn = new Map<StockGroup, { names: string[]; value: number }>();

    for (const line of movement.items) {
      const price = line.unitPrice ?? priceNow.get(line.itemId) ?? 0;
      const estimated = line.unitPrice == null;

      if (bought && line.delta > 0) {
        addStock(purchases, line.itemId, line.name, line.unit, line.delta, line.delta * price, estimated);
      } else if (used && line.delta < 0) {
        const amount = -line.delta;
        const value = amount * price;
        const machine = movement.machineId ?? '';
        addStock(
          usageByMachine,
          machine,
          machine || 'අතින් (යන්ත්‍රයක් නැත)',
          line.unit,
          amount,
          value,
          estimated,
        );
        addStock(usageByItem, line.itemId, line.name, line.unit, amount, value, estimated);

        const group = stockGroupOf(line.itemId, linkOf.get(line.itemId));
        const total = usedByGroup.get(group) ?? { value: 0, estimated: false };
        total.value += value;
        total.estimated ||= estimated;
        usedByGroup.set(group, total);

        const taken = drawn.get(group) ?? { names: [], value: 0 };
        taken.names.push(`${line.name} ${quantity(amount, line.unit)}`);
        taken.value += value;
        drawn.set(group, taken);
      }
    }

    // One entry for each kind of thing each time the store was drawn down, so
    // a category's entries add up to what it cost.
    for (const [group, taken] of drawn) {
      ledger.push({
        date: movement.date ?? (movement.createdAt ? dateKey(movement.createdAt) : monthEnd),
        kind: 'usage',
        category: group,
        description: [movement.machineId ?? 'අතින්', movement.source ? sourceLabel(movement.source) : '', taken.names.join(', ')]
          .filter(Boolean)
          .join(' · '),
        income: 0,
        expense: taken.value,
      });
    }
  }

  const purchaseRows = [...purchases.values()].sort(byValue);
  const purchaseTotal = sum(purchaseRows.map((row) => row.value));
  const usageItems = [...usageByItem.values()].sort(byValue);
  const usageTotal = sum(usageItems.map((row) => row.value));

  for (const group of STOCK_GROUPS) {
    const used = usedByGroup.get(group);
    if (!used) continue;
    spend(group, used.value);
    details.set(
      group,
      used.estimated
        ? `${EXPENSE_LABEL[group].detail} · භාවිත කළ දවසේ මිලට — සමහර සටහන් වත්මන් මිලට`
        : `${EXPENSE_LABEL[group].detail} · භාවිත කළ දවසේ මිලට`,
    );
  }

  // ---- what each kind of thing cost ----
  // Fuel, explosives and parts count as they are used; what was bought is
  // reported beside — see the note at the top.
  const expenseRows: ExpenseRow[] = EXPENSE_CATEGORIES.flatMap((key) => {
    const value = totals.get(key) ?? 0;
    return value === 0
      ? []
      : [
          {
            key,
            label: EXPENSE_LABEL[key].label,
            detail: details.get(key) ?? EXPENSE_LABEL[key].detail,
            value,
            shared: SHARED_CATEGORIES.includes(key),
          },
        ];
  });
  const expenses = sum(expenseRows.map((row) => row.value));

  // ---- what each material cost ----
  const sharedTotal = sum(expenseRows.filter((row) => row.shared).map((row) => row.value));
  const otherTotal = expenses - sharedTotal;
  const allLoads = sum([...materials.values()].map((row) => row.loads));
  const mainLoads = sum(
    [...materials].filter(([material]) => isMainMaterial(material)).map(([, row]) => row.loads),
  );
  const sharedPerLoad = allLoads > 0 ? sharedTotal / allLoads : null;
  const otherPerMainLoad = mainLoads > 0 ? otherTotal / mainLoads : null;
  const allocation: Allocation = {
    sharedTotal,
    otherTotal,
    allLoads,
    mainLoads,
    sharedPerLoad,
    otherPerMainLoad,
    unallocated: (sharedPerLoad == null ? sharedTotal : 0) + (otherPerMainLoad == null ? otherTotal : 0),
  };

  const order: (SaleMaterial | null)[] = [...MAIN_MATERIALS, ...SIDE_MATERIALS, null];
  const byMaterial: MaterialRow[] = order.flatMap((material) => {
    const row = materials.get(material);
    if (!row) return [];
    const dieselShare = row.loads * (sharedPerLoad ?? 0);
    const otherShare = isMainMaterial(material) ? row.loads * (otherPerMainLoad ?? 0) : 0;
    const cost = dieselShare + otherShare;
    const profit = row.amount - cost;
    const perLoad = (value: number) => (row.loads > 0 ? value / row.loads : null);
    return [
      {
        material,
        count: row.count,
        loads: row.loads,
        amount: row.amount,
        dieselShare,
        otherShare,
        cost,
        profit,
        incomePerLoad: perLoad(row.amount),
        costPerLoad: perLoad(cost),
        profitPerLoad: perLoad(profit),
      },
    ];
  });

  const ledgerOrder: Record<LedgerKind, number> = {
    sale: 0,
    payment: 1,
    landowner: 2,
    machine: 3,
    royalty: 4,
    bill: 5,
    usage: 6,
    salary: 7,
  };
  ledger.sort((a, b) => a.date.localeCompare(b.date) || ledgerOrder[a.kind] - ledgerOrder[b.kind]);

  return {
    income,
    incomeByType,
    byMaterial,
    allocation,
    pending,
    cancelled,
    creditPayments,
    prepaidOpen,
    salaries,
    salaryTotal,
    purchases: purchaseRows,
    purchaseTotal,
    expenseRows,
    unmatchedUsage,
    machineHours,
    machineTotal,
    landownerLoads,
    landownerTotal,
    royalty: { ...royalty, paid: royaltyPaid },
    usageByMachine: [...usageByMachine.values()].sort(byValue),
    usageByItem: usageItems,
    usageTotal,
    expenses,
    profit: income - expenses,
    ledger,
  };
}

export interface CrewSummary {
  /** Gross pay per machine, biggest first. */
  byMachine: { key: string; label: string; value: number }[];
  bonusTotal: number;
  advanceTotal: number;
  /** What is still owed to the crew once advances are taken off. */
  netTotal: number;
  workedDays: number;
  /** Gross pay per worked day, or null when nobody worked. */
  perWorkedDay: number | null;
  highest: SalaryRow | null;
  lowest: SalaryRow | null;
  /** Anyone whose advances come to more than their pay. */
  negative: SalaryRow[];
}

export function crewSummaryFor(salaries: readonly SalaryRow[]): CrewSummary {
  const machines = new Map<string, { key: string; label: string; value: number }>();
  for (const row of salaries) {
    const key = row.person.machineId || '';
    const entry = machines.get(key) ?? { key, label: key || 'යන්ත්‍රයක් නැත', value: 0 };
    entry.value += row.pay.gross;
    machines.set(key, entry);
  }

  const workedDays = sum(salaries.map((row) => row.pay.workedDays));
  const gross = sum(salaries.map((row) => row.pay.gross));
  const byGross = [...salaries].sort((a, b) => b.pay.gross - a.pay.gross);

  return {
    byMachine: [...machines.values()].sort((a, b) => b.value - a.value),
    bonusTotal: sum(salaries.map((row) => row.pay.bonusPay)),
    advanceTotal: sum(salaries.map((row) => row.advances)),
    netTotal: sum(salaries.map((row) => row.pay.net)),
    workedDays,
    perWorkedDay: workedDays > 0 ? gross / workedDays : null,
    highest: byGross[0] ?? null,
    lowest: byGross[byGross.length - 1] ?? null,
    negative: salaries.filter((row) => row.pay.net < 0),
  };
}
