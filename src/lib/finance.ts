import type { CrewMonth } from '../data/finance';
import { dateKey, monthBounds, quantity } from './format';
import { landownerChargeOf, paysLandowner, saleLoads, type LandownerRate } from './landowner';
import {
  BILL,
  SALE_MATERIAL,
  SALE_TYPE,
  saleNumber,
  nameOf,
  awaitsPrepaidLoad,
  isSaleIncome,
  saleStatus,
  sourceLabel,
  type Bill,
  type BillCategory,
  type MachineType,
  type Movement,
  type Payment,
  type Person,
  type RoleId,
  type Sale,
  type SaleMaterial,
  type SaleType,
  type StockLink,
  type StoreItem,
} from './model';
import { payFor, type PayFigures } from './pay';

/**
 * A month's money, as the admin's finance page lays it out.
 *
 * Income is verified sales only, and is shown by material. Expenses are what
 * the work cost, each counted once and grouped by the work it was for:
 *
 *   - loading (the excavator): its crew's pay, what the machine is charged for
 *     each hour it worked, and the fuel, oil and parts it used;
 *   - drilling and blasting (the compressor): its crew's pay, the explosives,
 *     and the fuel, oil and parts it used;
 *   - the site in general: bills that are nobody's pay (water, other, food
 *     charged to nobody) and anything drawn from the store with no machine;
 *   - the landowner, for each load of 6/9, සක්කර or කෝරි ඩස්ට් sold — taken
 *     off each material before its profit is shown.
 *
 * Crew pay counts in full — advances and food charged to a crew member are
 * part of it, paid early, so they are not counted again as bills.
 *
 * Fuel, oil, explosives and parts count in the month they were *used*, at what
 * they cost when they were drawn from the store. The store cannot say which
 * work a purchase was for, but a use always names its machine — so this is the
 * only way to give each kind of work its own cost. What was bought is reported
 * beside the total, not in it.
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
  /** Food paid for them and taken off their pay. */
  food: number;
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

/** The work an expense was for. */
export type WorkArea = 'loading' | 'drilling' | 'site';

export const WORK_AREAS: readonly WorkArea[] = ['loading', 'drilling', 'site'];

export const WORK_AREA_LABEL: Record<WorkArea, { label: string; detail: string }> = {
  loading: { label: 'ලෝඩ් කිරීම', detail: 'එක්ස්කවේටර්' },
  drilling: { label: 'විදීම සහ පුපුරවීම', detail: 'කම්පසර්' },
  site: { label: 'අඩවි පොදු', detail: 'බිල්පත් සහ යන්ත්‍රයක් නැති භාවිතය' },
};

/** What a store item was used for, as the page groups it. */
export type StockGroup = 'fuel' | 'explosives' | 'parts' | 'other';

export const STOCK_GROUPS: readonly StockGroup[] = ['fuel', 'explosives', 'parts', 'other'];

export const STOCK_GROUP_LABEL: Record<StockGroup, string> = {
  fuel: 'ඩීසල් සහ ඔයිල්',
  explosives: 'වෙඩි බඩු',
  parts: 'කොටස් සහ ෆිල්ටර්',
  other: 'වෙනත් ගබඩා භාවිතය',
};

/**
 * Which group a store item belongs to. A linked item lives at a fixed id (see
 * linkDocId), so it still groups after the item itself has been deleted.
 */
export function stockGroupOf(itemId: string, link: StockLink | null | undefined): StockGroup {
  const key = link ?? itemId.replace('-', ':');
  if (key.startsWith('fill:')) return 'fuel';
  if (key.startsWith('blast:')) return 'explosives';
  if (key.startsWith('service:')) return 'parts';
  return 'other';
}

/** The work a machine's costs belong to. A machine of no known kind, and no machine at all, is the site's. */
export function areaOfMachine(machineId: string | null, kinds: ReadonlyMap<string, MachineType>): WorkArea {
  const kind = machineId ? kinds.get(machineId) : undefined;
  return kind === 'excavator' ? 'loading' : kind === 'compressor' ? 'drilling' : 'site';
}

/** The work a crew member's pay belongs to. */
function areaOfRole(role: RoleId): WorkArea {
  return role === 'operator' ? 'loading' : role === 'compressor' ? 'drilling' : 'site';
}

/** One line of what a kind of work cost. */
export interface ExpenseLine {
  key: string;
  label: string;
  value: number;
  detail: string;
}

export interface AreaCosts {
  area: WorkArea;
  lines: ExpenseLine[];
  total: number;
}

/** One material's verified sales, and what is left of them after the landowner. */
export interface MaterialRow {
  /** Null on a sale from before the material was recorded. */
  material: SaleMaterial | null;
  count: number;
  /** Loads the bills count for — a tipper bill is one trip, a tractor bill its loads. */
  loads: number;
  amount: number;
  /** What the landowner is paid on these loads; nothing for a material that earns no share. */
  landownerShare: number;
  /** [amount] less [landownerShare] — before the work it took to get them out. */
  gross: number;
}

export type LedgerKind = 'sale' | 'payment' | 'machine' | 'landowner' | 'bill' | 'usage' | 'salary';

export interface LedgerEntry {
  date: string;
  kind: LedgerKind;
  description: string;
  income: number;
  expense: number;
}

export interface Finance {
  income: number;
  incomeByType: Record<SaleType, SalesTotal>;
  /** Income by material, biggest first, each with the landowner's share taken off. */
  byMaterial: MaterialRow[];
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
  /** Bills that are nobody's pay, by category. */
  siteBills: Record<BillCategory, number>;
  siteBillTotal: number;
  /**
   * What was bought for the store this month — reported beside the total, not
   * in it: that stock counts when it is used, see [usageTotal].
   */
  purchases: StockRow[];
  purchaseTotal: number;
  /** What the work cost, by the work it was for. Adds up to the expenses less the landowner's share. */
  areas: AreaCosts[];
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
  machineHourly,
  landownerRates = [],
  machineKinds = new Map(),
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
  /** Rupees charged for each hour the excavator worked — one figure, applied to every month. */
  machineHourly: number;
  /** Every setting of the landowner's per-load figure — each sale is worked out at the one in force when it was written. */
  landownerRates?: readonly LandownerRate[];
  /**
   * What kind of machine each machine is, by number — what decides which work
   * a use of fuel or parts belongs to. A machine left out is the site's.
   */
  machineKinds?: ReadonlyMap<string, MachineType>;
  now: number;
  /** `yyyy-MM-dd` — only feeds payFor's leaveDays, which this report never shows. */
  today: string;
}): Finance {
  const ledger: LedgerEntry[] = [];

  // ---- income ----
  const incomeByType: Record<SaleType, SalesTotal> = { tipper: noSales(), tractor: noSales() };
  const pending = noSales();
  const cancelled = noSales();
  const prepaidOpen = noSales();
  let landownerLoads = 0;
  let landownerTotal = 0;
  const materials = new Map<SaleMaterial | null, MaterialRow>();
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
        description: `${sale.prepaid ? 'කලින් ගෙවූ · ' : ''}${SALE_TYPE[sale.type].label} ${quantity(
          sale.quantity,
          SALE_TYPE[sale.type].unit,
        )} · ${sale.customerName || 'පාරිභෝගිකයා'} · බිල් ${saleNumber(sale)}`,
        income: sale.amount,
        expense: 0,
      });

      // The landowner's share goes with the income, in the month it was paid,
      // at the figure that was set when the bill was written.
      const share = landownerChargeOf(sale, landownerRates);
      if (paysLandowner(sale)) landownerLoads += saleLoads(sale);
      landownerTotal += share;

      const row = materials.get(sale.material) ?? {
        material: sale.material,
        count: 0,
        loads: 0,
        amount: 0,
        landownerShare: 0,
        gross: 0,
      };
      row.count += 1;
      row.loads += saleLoads(sale);
      row.amount += sale.amount;
      row.landownerShare += share;
      materials.set(sale.material, row);
      if (share > 0) {
        ledger.push({
          date: sale.date,
          kind: 'landowner',
          description: `ඉඩම් හිමියාට · ලෝඩ් ${quantity(saleLoads(sale))} · ${sale.material ? SALE_MATERIAL[sale.material] : ''} · බිල් ${saleNumber(sale)}`,
          income: 0,
          expense: share,
        });
      }
    } else if (status === 'pending') {
      addSale(pending, sale);
    } else {
      addSale(cancelled, sale);
    }
  }
  const income = incomeByType.tipper.amount + incomeByType.tractor.amount;

  const creditPayments = { count: 0, amount: 0 };
  for (const payment of payments) {
    if (!payment.date.startsWith(month)) continue;
    creditPayments.count += 1;
    creditPayments.amount += payment.amount;
    ledger.push({
      date: payment.date,
      kind: 'payment',
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
      pay: payFor(person, days, tally, bills, null, today),
      advances: sum(theirs.filter((bill) => bill.category === 'advance').map((bill) => bill.amount)),
      food: sum(theirs.filter((bill) => bill.category === 'food').map((bill) => bill.amount)),
    };
  });
  const salaryTotal = sum(salaries.map((row) => row.pay.gross));
  const monthEnd = monthBounds(month).to;

  // ---- the machine ----
  // Charged for the hours the loading excavator worked, whatever was sold.
  let machineHours = 0;
  let machineTotal = 0;
  for (const { person, tally } of crewMonths) {
    if (person.role !== 'operator' || !(tally.hours > 0)) continue;
    const charge = tally.hours * machineHourly;
    machineHours += tally.hours;
    machineTotal += charge;
    if (charge > 0) {
      ledger.push({
        date: monthEnd,
        kind: 'machine',
        description: `යන්ත්‍රයට · පැය ${quantity(tally.hours)} · ${nameOf(person)}`,
        income: 0,
        expense: charge,
      });
    }
  }
  for (const row of salaries) {
    ledger.push({
      date: monthEnd,
      kind: 'salary',
      description: `${nameOf(row.person)} — වැටුප් ශේෂය (ඇඩ්වාන්ස් සහ කෑම අඩු කළ පසු)`,
      income: 0,
      expense: row.pay.net,
    });
  }

  // ---- bills ----
  const paidCrew = new Set(crewMonths.map(({ person }) => person.id));
  const siteBills: Record<BillCategory, number> = { advance: 0, food: 0, water: 0, other: 0 };
  for (const bill of bills) {
    ledger.push({
      date: bill.date,
      kind: 'bill',
      description: [BILL[bill.category].label, bill.operatorName, bill.note].filter(Boolean).join(' · '),
      income: 0,
      expense: bill.amount,
    });
    // Charged to someone on this month's pay: counted there, in full.
    const partOfPay = BILL[bill.category].deduction && bill.operatorId != null && paidCrew.has(bill.operatorId);
    if (!partOfPay) siteBills[bill.category] += bill.amount;
  }
  const siteBillTotal = sum(Object.values(siteBills));

  // ---- the store ----
  const priceNow = new Map(store.map((item) => [item.id, item.unitPrice]));
  const linkOf = new Map(store.map((item) => [item.id, item.link]));
  const purchases = new Map<string, StockRow>();
  const usageByMachine = new Map<string, StockRow>();
  const usageByItem = new Map<string, StockRow>();
  /** What was used, by the work it was for and what kind of thing it was. */
  const usedByArea = new Map<WorkArea, Map<StockGroup, { value: number; estimated: boolean }>>();
  let unmatchedUsage = 0;

  for (const movement of movements) {
    const bought = movement.type === 'create' || movement.type === 'restock';
    const used = movement.type === 'usage' || movement.type === 'use';
    if (!bought && !used) continue;
    if (used) unmatchedUsage += movement.unmatched.length;

    const area = areaOfMachine(movement.machineId, machineKinds);
    const drawn: string[] = [];
    let drawnValue = 0;

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
        const groups = usedByArea.get(area) ?? new Map<StockGroup, { value: number; estimated: boolean }>();
        const total = groups.get(group) ?? { value: 0, estimated: false };
        total.value += value;
        total.estimated ||= estimated;
        groups.set(group, total);
        usedByArea.set(area, groups);

        drawn.push(`${line.name} ${quantity(amount, line.unit)}`);
        drawnValue += value;
      }
    }

    // One entry for each time the store was drawn down, not for each item.
    if (drawn.length > 0) {
      ledger.push({
        date: movement.date ?? (movement.createdAt ? dateKey(movement.createdAt) : monthEnd),
        kind: 'usage',
        description: [movement.machineId ?? 'අතින්', movement.source ? sourceLabel(movement.source) : '', drawn.join(', ')]
          .filter(Boolean)
          .join(' · '),
        income: 0,
        expense: drawnValue,
      });
    }
  }

  const purchaseRows = [...purchases.values()].sort(byValue);
  const purchaseTotal = sum(purchaseRows.map((row) => row.value));
  const usageItems = [...usageByItem.values()].sort(byValue);
  const usageTotal = sum(usageItems.map((row) => row.value));

  // ---- what each kind of work cost ----
  const wages = new Map<WorkArea, { value: number; people: number; days: number }>();
  for (const row of salaries) {
    const area = areaOfRole(row.person.role);
    const entry = wages.get(area) ?? { value: 0, people: 0, days: 0 };
    entry.value += row.pay.gross;
    entry.people += 1;
    entry.days += row.pay.workedDays;
    wages.set(area, entry);
  }

  const areas: AreaCosts[] = WORK_AREAS.map((area) => {
    const lines: ExpenseLine[] = [];
    const add = (line: ExpenseLine) => {
      if (line.value > 0) lines.push(line);
    };

    const paid = wages.get(area);
    if (paid) {
      add({
        key: 'wages',
        label: 'කණ්ඩායම් වැටුප්',
        value: paid.value,
        detail: `${paid.people} දෙනෙක් · වැඩ කළ දින ${paid.days} — ඇඩ්වාන්ස් සහ කෑම ඇතුළුව`,
      });
    }
    if (area === 'loading') {
      add({
        key: 'machine',
        label: 'යන්ත්‍රයට කපන ගණන',
        value: machineTotal,
        detail: `එක්ස්කවේටර් වැඩ කළ පැය ${quantity(machineHours)}`,
      });
    }
    for (const group of STOCK_GROUPS) {
      const used = usedByArea.get(area)?.get(group);
      if (!used) continue;
      add({
        key: `stock-${group}`,
        label: STOCK_GROUP_LABEL[group],
        value: used.value,
        detail: used.estimated ? 'භාවිත කළ දවසේ මිලට — සමහර සටහන් වත්මන් මිලට' : 'භාවිත කළ දවසේ මිලට',
      });
    }
    if (area === 'site') {
      for (const category of Object.keys(siteBills) as BillCategory[]) {
        add({
          key: `bill-${category}`,
          label: `${BILL[category].label} බිල්පත්`,
          value: siteBills[category],
          detail: BILL[category].deduction ? 'කිසිවෙකුගේ පඩියට අය නොකළ' : 'අඩවි වියදම්',
        });
      }
    }
    return { area, lines, total: sum(lines.map((line) => line.value)) };
  });

  // Fuel, explosives and parts count as they are used; what was bought is
  // reported beside — see the note at the top.
  const expenses = salaryTotal + siteBillTotal + usageTotal + machineTotal + landownerTotal;
  const byMaterial = [...materials.values()]
    .map((row) => ({ ...row, gross: row.amount - row.landownerShare }))
    .sort((a, b) => b.amount - a.amount);
  const order: Record<LedgerKind, number> = {
    sale: 0,
    payment: 1,
    landowner: 2,
    machine: 3,
    bill: 4,
    usage: 5,
    salary: 6,
  };
  ledger.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  return {
    income,
    incomeByType,
    byMaterial,
    pending,
    cancelled,
    creditPayments,
    prepaidOpen,
    salaries,
    salaryTotal,
    siteBills,
    siteBillTotal,
    purchases: purchaseRows,
    purchaseTotal,
    areas,
    unmatchedUsage,
    machineHours,
    machineTotal,
    landownerLoads,
    landownerTotal,
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
  foodTotal: number;
  /** What is still owed to the crew once advances and food are taken off. */
  netTotal: number;
  workedDays: number;
  /** Gross pay per worked day, or null when nobody worked. */
  perWorkedDay: number | null;
  highest: SalaryRow | null;
  lowest: SalaryRow | null;
  /** Anyone whose advances and food come to more than their pay. */
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
    foodTotal: sum(salaries.map((row) => row.food)),
    netTotal: sum(salaries.map((row) => row.pay.net)),
    workedDays,
    perWorkedDay: workedDays > 0 ? gross / workedDays : null,
    highest: byGross[0] ?? null,
    lowest: byGross[byGross.length - 1] ?? null,
    negative: salaries.filter((row) => row.pay.net < 0),
  };
}
