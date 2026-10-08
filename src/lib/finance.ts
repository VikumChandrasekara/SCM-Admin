import type { CrewMonth } from '../data/finance';
import { dateKey, monthBounds, quantity } from './format';
import { landownerChargeOf, paysLandowner, saleLoads, type LandownerRate } from './landowner';
import {
  BILL,
  MOVEMENT_LABEL,
  SALE_MATERIAL,
  SALE_TYPE,
  saleNumber,
  nameOf,
  awaitsPrepaidLoad,
  isSaleIncome,
  saleStatus,
  type Bill,
  type BillCategory,
  type Movement,
  type Payment,
  type Person,
  type Sale,
  type SaleType,
  type StoreItem,
} from './model';
import { payFor, type PayFigures } from './pay';

/**
 * A month's money, as the admin's finance page lays it out.
 *
 * Income is verified sales only. Expenses are what actually left the
 * business, each counted once:
 *
 *   - crew pay, in full — advances and food charged to a crew member are
 *     part of it, paid early, so they are not counted again as bills;
 *   - every other bill (water, other, food charged to nobody);
 *   - store purchases — new stock and restocks, at what it cost then;
 *   - what goes to the machine for each hour the excavator worked;
 *   - what goes to the landowner for each load of 6/9, සක්කර or කෝරි ඩස්ට් sold.
 *
 * What the machines drew out of the store is reported too, but beside the
 * total rather than in it: that fuel and those parts were paid for when
 * they were bought.
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

export type LedgerKind = 'sale' | 'payment' | 'machine' | 'landowner' | 'bill' | 'purchase' | 'salary';

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
  purchases: StockRow[];
  purchaseTotal: number;
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
  const purchases = new Map<string, StockRow>();
  const usageByMachine = new Map<string, StockRow>();
  const usageByItem = new Map<string, StockRow>();

  for (const movement of movements) {
    const bought = movement.type === 'create' || movement.type === 'restock';
    const used = movement.type === 'usage' || movement.type === 'use';
    if (!bought && !used) continue;

    for (const line of movement.items) {
      const price = line.unitPrice ?? priceNow.get(line.itemId) ?? 0;
      const estimated = line.unitPrice == null;

      if (bought && line.delta > 0) {
        const value = line.delta * price;
        addStock(purchases, line.itemId, line.name, line.unit, line.delta, value, estimated);
        ledger.push({
          date: movement.createdAt ? dateKey(movement.createdAt) : monthEnd,
          kind: 'purchase',
          description: `${MOVEMENT_LABEL[movement.type]} · ${line.name} ${quantity(line.delta, line.unit)}`,
          income: 0,
          expense: value,
        });
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
      }
    }
  }

  const purchaseRows = [...purchases.values()].sort(byValue);
  const purchaseTotal = sum(purchaseRows.map((row) => row.value));
  const usageItems = [...usageByItem.values()].sort(byValue);

  const expenses = salaryTotal + siteBillTotal + purchaseTotal + machineTotal + landownerTotal;
  const order: Record<LedgerKind, number> = {
    sale: 0,
    payment: 1,
    landowner: 2,
    machine: 3,
    bill: 4,
    purchase: 5,
    salary: 6,
  };
  ledger.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  return {
    income,
    incomeByType,
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
    machineHours,
    machineTotal,
    landownerLoads,
    landownerTotal,
    usageByMachine: [...usageByMachine.values()].sort(byValue),
    usageByItem: usageItems,
    usageTotal: sum(usageItems.map((row) => row.value)),
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
