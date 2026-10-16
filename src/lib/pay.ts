import { drillerLoads, operatorLoads, type DrillerLoads } from './loads';
import {
  BILL,
  ROLES,
  dayWorked,
  paidPerLoad,
  workedHours,
  type Bill,
  type Day,
  type MonthTally,
  type Person,
  type Sale,
} from './model';
import { bonusEarned, leaveDaysFor } from './target';

/**
 * A crew member's month in money — the purple boxes on the dashboard.
 *
 * A worked day is one the machine was started on (an ON reading in පිරවීම 1),
 * which is the same test the operator app uses to call a day recorded.
 * ලැබිය යුතු මුදල (`net`) and නිවාඩු ගත් දින ගණන (`leaveDays`) are worked out
 * here rather than stored anywhere, exactly as the operator app does — see
 * OperatorProfile.receivableFor and TargetProgress.leaveDays there.
 */
export interface PayFigures {
  workedDays: number;
  /** නිවාඩු ගත් දින ගණන — calendar days elapsed less days worked. */
  leaveDays: number;
  dailyWage: number;
  /** What the wage counts this month: worked days, machine hours, feet or loads, per the person's basis. */
  wageUnits: number;
  /** [wageUnits] × the wage rate — for a driller paid per load, see [loadPay]. */
  wagePay: number;
  /** A driller paid per load: the month's loads from the sales bills and what each rate comes to. Null for anyone else. */
  loadPay: LoadPay | null;
  /** The bonus ladder for the month: the excavator crew's loads, or the drillers' loads of 6/9 alone. */
  bonusPay: number;
  /** The loads [bonusPay] is counted on, or null for someone with no bonus. */
  bonusLoads: number | null;
  /** මුදල් ප්‍රමාණය — everything earned this month: [wagePay] + [bonusPay]. */
  gross: number;
  /** ණය මුදල් ප්‍රමාණය — the advances charged to them this month. */
  deductions: number;
  /** ලැබිය යුතු මුදල් ප්‍රමාණය — what is still owed to them. */
  net: number;
  /** දවසේ මුදල් ප්‍රමාණය — what the selected day earned. */
  dayEarnings: number;
}

/** One kind of load a driller is paid for, each at a rate of its own. */
export interface LoadPayLine {
  /** What the loads are called: 6/9, සක්කර, බෝල්දාස් or C1. */
  label: string;
  loads: number;
  /** Rupees for each of them. */
  rate: number;
  pay: number;
}

/**
 * What a driller paid per load earns. Loads of 6/9 are paid at the wage rate;
 * සක්කර, බෝල්දාස් and C1 each at a rate of their own. Loads of anything else
 * (කෝරි ඩස්ට්, an old bill with no material) are not paid.
 */
export interface LoadPay {
  /** Always in the order 6/9, සක්කර, බෝල්දාස්, C1. */
  lines: LoadPayLine[];
  /** Every kind of load together. */
  loads: number;
  pay: number;
}

function loadPayOf(person: Person, loads: DrillerLoads): LoadPay {
  const line = (label: string, count: number, rate: number): LoadPayLine => ({
    label,
    loads: count,
    rate,
    pay: count * rate,
  });
  const lines = [
    line('6/9', loads.sixNine, person.dailyWage),
    line('සක්කර', loads.sakka, person.sakkaLoadWage),
    line('බෝල්දාස්', loads.boldas, person.boldasLoadWage),
    line('C1', loads.c1, person.c1LoadWage),
  ];
  return {
    lines,
    loads: lines.reduce((sum, entry) => sum + entry.loads, 0),
    pay: lines.reduce((sum, entry) => sum + entry.pay, 0),
  };
}

/** [wageBasis]'s count for the month: worked days, machine hours, feet or loads. */
function wageUnitsOf(basis: Person['wageBasis'], month: MonthTally, workedDays: number): number {
  switch (basis) {
    case 'hour':
      return month.hours;
    case 'foot':
      return month.feet;
    case 'load':
      return month.loads;
    case 'day':
      return workedDays;
    case 'month':
      return 1;
  }
}

/**
 * [sales] are the month's sales bills. An operator's and a driller's loads and
 * bonus come from the bills that name them, not from any tally typed in: what
 * the yard sold is what their work came to. Without them neither has loads yet.
 */
export function payFor(
  person: Person,
  monthDays: readonly Day[],
  month: MonthTally,
  bills: readonly Bill[],
  day: Day | null,
  today: string,
  sales: readonly Sale[] = [],
  now = Date.now(),
): PayFigures {
  const role = ROLES[person.role];

  const workedDays = monthDays.filter(dayWorked).length;
  const leaveDays = leaveDaysFor(month.month, today, workedDays);

  // The loads of the bills that name this person — nobody types them in. An
  // operator's are all of them, a driller's are split by material.
  const tally: MonthTally = role.tracksBonus
    ? { ...month, loads: operatorLoads(sales, person.id, month.month, now) }
    : month;
  const monthLoads =
    role.bonusOnSixNine || paidPerLoad(person) ? drillerLoads(sales, month.month, now, person.id) : null;
  const loadPay = monthLoads && paidPerLoad(person) ? loadPayOf(person, monthLoads) : null;
  const wageUnits = loadPay ? loadPay.loads : wageUnitsOf(person.wageBasis, tally, workedDays);
  const wagePay = loadPay ? loadPay.pay : wageUnits * person.dailyWage;

  const bonusLoads = role.tracksBonus ? tally.loads : role.bonusOnSixNine && monthLoads ? monthLoads.sixNine : null;
  const bonusPay = bonusLoads == null ? 0 : bonusEarned(bonusLoads);
  const gross = wagePay + bonusPay;

  const deductions = bills
    .filter(
      (bill) =>
        bill.operatorId === person.id &&
        BILL[bill.category].deduction &&
        bill.date.startsWith(month.month),
    )
    .reduce((sum, bill) => sum + bill.amount, 0);

  const dayWageUnits =
    person.wageBasis === 'hour'
      ? day
        ? (workedHours(day) ?? 0)
        : 0
      : person.wageBasis === 'foot'
        ? (day?.feet ?? 0)
        : person.wageBasis === 'load'
          ? role.tracksBonus && day
            ? operatorLoads(sales, person.id, day.date, now)
            : 0
          : day != null && dayWorked(day)
            ? 1
            : 0;
  const dayLoadPay =
    paidPerLoad(person) && day ? loadPayOf(person, drillerLoads(sales, day.date, now, person.id)) : null;
  const dayEarnings = paidPerLoad(person)
    ? (dayLoadPay?.pay ?? 0)
    : dayWageUnits * person.dailyWage;

  return {
    workedDays,
    leaveDays,
    dailyWage: person.dailyWage,
    wageUnits,
    wagePay,
    loadPay,
    bonusPay,
    bonusLoads,
    gross,
    deductions,
    net: gross - deductions,
    dayEarnings,
  };
}
