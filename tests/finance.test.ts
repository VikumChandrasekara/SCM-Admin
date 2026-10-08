import { describe, expect, it } from 'vitest';

import type { CrewMonth } from '../src/data/finance';
import { financeFor } from '../src/lib/finance';
import type { Person, Sale } from '../src/lib/model';

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

const person = (id: string, role: Person['role']): Person => ({
  id,
  name: id,
  username: id,
  machineId: `m-${id}`,
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
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
