import { describe, expect, it } from 'vitest';

import { financeFor } from '../src/lib/finance';
import { fuelRecordFrom, movementFrom, type FuelRecord, type StoreItem } from '../src/lib/model';

const now = new Date('2026-10-06T12:00:00Z').getTime();

const item = (id: string, overrides: Partial<StoreItem> = {}): StoreItem => ({
  id,
  name: id,
  unit: 'L',
  quantity: 0,
  minQuantity: 0,
  unitPrice: 0,
  piecesPerKg: null,
  link: null,
  note: '',
  direct: true,
  usedQuantity: 0,
  usedAmount: 0,
  createdAt: null,
  countedAt: null,
  updatedAt: null,
  ...overrides,
});

const record = (id: string, itemId: string, itemName: string, quantity: number, unitPrice: number, extra: object = {}): FuelRecord =>
  fuelRecordFrom(id, {
    itemId,
    itemName,
    unit: 'L',
    quantity,
    unitPrice,
    amount: quantity * unitPrice,
    date: '2026-10-04',
    note: '',
    createdBy: 'admin1',
    createdByName: 'admin1',
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

const byCategory = (month: ReturnType<typeof monthOf>) => Object.fromEntries(month.expenseRows.map((row) => [row.key, row.value]));

describe('fuel and oil bought and used straight away', () => {
  const store = [
    item('fill-diesel', { link: 'fill:diesel', name: 'ඩීසල්' }),
    item('fill-engineOil', { link: 'fill:engineOil', name: 'එන්ජින් ඔයිල්' }),
    item('petrol1', { name: 'පෙට්‍රල්' }),
  ];
  const fuelRecords = [
    record('r1', 'fill-diesel', 'ඩීසල්', 100, 372),
    record('r2', 'fill-engineOil', 'එන්ජින් ඔයිල්', 8, 1500),
    record('r3', 'petrol1', 'පෙට්‍රල්', 10.5, 380, { note: 'generator' }),
  ];

  it('each record is an expense, in the category it belongs to', () => {
    const month = monthOf({ store, fuelRecords });
    expect(byCategory(month)).toEqual({ diesel: 37200, oil: 12000, fuel: 3990 });
    expect(month.expenses).toBe(37200 + 12000 + 3990);
  });

  it('is listed in the ledger, one line to a record, dated as it was written', () => {
    const month = monthOf({ store, fuelRecords });
    const lines = month.ledger.filter((entry) => entry.kind === 'usage');
    expect(lines).toHaveLength(3);
    expect(lines.map((entry) => entry.expense).sort((a, b) => a - b)).toEqual([3990, 12000, 37200]);
    const petrol = lines.find((entry) => entry.expense === 3990)!;
    expect(petrol.description).toContain('generator');
    expect(petrol.date).toBe('2026-10-04');
  });

  it('is counted once — what the crews draw of the same item is not costed again', () => {
    const fill = movementFrom('m1', {
      type: 'usage',
      items: [{ itemId: 'fill-diesel', name: 'ඩීසල්', unit: 'L', delta: -45, unitPrice: 372 }],
      machineId: 'ex1',
      date: '2026-10-05',
      source: 'fill1',
      createdBy: 'op1',
      createdByName: 'op1',
    });
    const month = monthOf({ store, fuelRecords, movements: [fill] });
    expect(byCategory(month).diesel).toBe(37200);
    expect(month.usageTotal).toBe(0);
  });

  it('still counts what is drawn from an item that is kept on a shelf', () => {
    const shelved = [item('fill-diesel', { link: 'fill:diesel', direct: false })];
    const fill = movementFrom('m1', {
      type: 'usage',
      items: [{ itemId: 'fill-diesel', name: 'ඩීසල්', unit: 'L', delta: -45, unitPrice: 372 }],
      machineId: 'ex1',
      date: '2026-10-05',
      source: 'fill1',
      createdBy: 'op1',
      createdByName: 'op1',
    });
    expect(byCategory(monthOf({ store: shelved, movements: [fill] })).diesel).toBe(45 * 372);
  });

  it('keeps an expense after its item is gone', () => {
    const month = monthOf({ store: [], fuelRecords: [record('r9', 'petrol1', 'පෙට්‍රල්', 5, 380)] });
    expect(byCategory(month)).toEqual({ fuel: 1900 });
  });
});
