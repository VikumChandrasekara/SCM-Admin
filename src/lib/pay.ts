import { BILL, ROLES, dayWorked, workedHours, type Bill, type Day, type MonthTally, type Person } from './model';
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
  /** [wageUnits] × the wage rate. */
  wagePay: number;
  /** The excavator crew's bonus ladder for the month's loads. */
  bonusPay: number;
  /** මුදල් ප්‍රමාණය — everything earned this month: [wagePay] + [bonusPay]. */
  gross: number;
  /** ණය මුදල් ප්‍රමාණය — advances and food charged to them this month. */
  deductions: number;
  /** ලැබිය යුතු මුදල් ප්‍රමාණය — what is still owed to them. */
  net: number;
  /** දවසේ මුදල් ප්‍රමාණය — what the selected day earned. */
  dayEarnings: number;
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

export function payFor(
  person: Person,
  monthDays: readonly Day[],
  month: MonthTally,
  bills: readonly Bill[],
  day: Day | null,
  today: string,
): PayFigures {
  const role = ROLES[person.role];

  const workedDays = monthDays.filter(dayWorked).length;
  const leaveDays = leaveDaysFor(month.month, today, workedDays);
  const wageUnits = wageUnitsOf(person.wageBasis, month, workedDays);
  const wagePay = wageUnits * person.dailyWage;
  const bonusPay = role.tracksBonus ? bonusEarned(month.loads) : 0;
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
          ? (day?.loads ?? 0)
          : day != null && dayWorked(day)
            ? 1
            : 0;
  const dayEarnings = dayWageUnits * person.dailyWage;

  return {
    workedDays,
    leaveDays,
    dailyWage: person.dailyWage,
    wageUnits,
    wagePay,
    bonusPay,
    gross,
    deductions,
    net: gross - deductions,
    dayEarnings,
  };
}
