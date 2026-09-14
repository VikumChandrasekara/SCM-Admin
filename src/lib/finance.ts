import type { CrewMonth } from '../data/finance';
import { dateKey, monthBounds, quantity } from './format';
import {
  BILL,
  MOVEMENT_LABEL,
  SALE_TYPE,
  saleNumber,
  nameOf,
  saleStatus,
  type Bill,
  type BillCategory,
  type Movement,
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
 *   - store purchases — new stock and restocks, at what it cost then.
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

export type LedgerKind = 'sale' | 'bill' | 'purchase' | 'salary';

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

  salaries: SalaryRow[];
  salaryTotal: number;
  /** Bills that are nobody's pay, by category. */
  siteBills: Record<BillCategory, number>;
  siteBillTotal: number;
  purchases: StockRow[];
  purchaseTotal: number;

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
  store,
  now,
}: {
  month: string;
  sales: readonly Sale[];
  bills: readonly Bill[];
  movements: readonly Movement[];
  crewMonths: readonly CrewMonth[];
  store: readonly StoreItem[];
  now: number;
}): Finance {
  const ledger: LedgerEntry[] = [];

  // ---- income ----
  const incomeByType: Record<SaleType, SalesTotal> = { cube: noSales(), tractor: noSales() };
  const pending = noSales();
  const cancelled = noSales();
  for (const sale of sales) {
    const status = saleStatus(sale, now);
    if (status === 'verified') {
      addSale(incomeByType[sale.type], sale);
      ledger.push({
        date: sale.date,
        kind: 'sale',
        description: `${SALE_TYPE[sale.type].label} ${quantity(sale.quantity)} · ${
          sale.customerName || 'පාරිභෝගිකයා'
        } · බිල් ${saleNumber(sale)}`,
        income: sale.amount,
        expense: 0,
      });
    } else if (status === 'pending') {
      addSale(pending, sale);
    } else {
      addSale(cancelled, sale);
    }
  }
  const income = incomeByType.cube.amount + incomeByType.tractor.amount;

  // ---- crew pay ----
  const salaries: SalaryRow[] = crewMonths.map(({ person, days, tally }) => {
    const theirs = bills.filter((bill) => bill.operatorId === person.id);
    return {
      person,
      pay: payFor(person, days, tally, bills, null),
      advances: sum(theirs.filter((bill) => bill.category === 'advance').map((bill) => bill.amount)),
      food: sum(theirs.filter((bill) => bill.category === 'food').map((bill) => bill.amount)),
    };
  });
  const salaryTotal = sum(salaries.map((row) => row.pay.gross));
  const monthEnd = monthBounds(month).to;
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

  const expenses = salaryTotal + siteBillTotal + purchaseTotal;
  const order: Record<LedgerKind, number> = { sale: 0, bill: 1, purchase: 2, salary: 3 };
  ledger.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  return {
    income,
    incomeByType,
    pending,
    cancelled,
    salaries,
    salaryTotal,
    siteBills,
    siteBillTotal,
    purchases: purchaseRows,
    purchaseTotal,
    usageByMachine: [...usageByMachine.values()].sort(byValue),
    usageByItem: usageItems,
    usageTotal: sum(usageItems.map((row) => row.value)),
    expenses,
    profit: income - expenses,
    ledger,
  };
}
