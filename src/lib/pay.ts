import { BILL, ROLES, dayOnHours, type Bill, type Day, type MonthTally, type Person } from './model';
import { bonusEarned } from './target';

/**
 * A crew member's month in money — the four purple boxes on the dashboard.
 *
 * A worked day is one the machine was started on (an ON reading in පිරවීම 1),
 * which is the same test the operator app uses to call a day recorded.
 */
export interface PayFigures {
  workedDays: number;
  dailyWage: number;
  /** Worked days × the daily wage. */
  wagePay: number;
  /** The excavator crew's bonus ladder for the month's loads. */
  bonusPay: number;
  /** The compressor crew's ආඩි × rate per foot. */
  feetPay: number;
  /** මුදල් ප්‍රමාණය — everything earned this month. */
  gross: number;
  /** ණය මුදල් ප්‍රමාණය — advances and food charged to them this month. */
  deductions: number;
  /** ලැබිය යුතු මුදල් ප්‍රමාණය — what is still owed to them. */
  net: number;
  /** දවසේ මුදල් ප්‍රමාණය — what the selected day earned. */
  dayEarnings: number;
}

export function payFor(
  person: Person,
  monthDays: readonly Day[],
  month: MonthTally,
  bills: readonly Bill[],
  day: Day | null,
): PayFigures {
  const role = ROLES[person.role];

  const workedDays = monthDays.filter((entry) => dayOnHours(entry) != null).length;
  const wagePay = workedDays * person.dailyWage;
  const bonusPay = role.tracksBonus ? bonusEarned(month.loads) : 0;
  const feetPay = role.tracksBonus ? 0 : month.feet * person.ratePerFoot;
  const gross = wagePay + bonusPay + feetPay;

  const deductions = bills
    .filter(
      (bill) =>
        bill.operatorId === person.id &&
        BILL[bill.category].deduction &&
        bill.date.startsWith(month.month),
    )
    .reduce((sum, bill) => sum + bill.amount, 0);

  const worked = day != null && dayOnHours(day) != null;
  const dayEarnings =
    (worked ? person.dailyWage : 0) +
    (role.tracksBonus ? 0 : (day?.feet ?? 0) * person.ratePerFoot);

  return {
    workedDays,
    dailyWage: person.dailyWage,
    wagePay,
    bonusPay,
    feetPay,
    gross,
    deductions,
    net: gross - deductions,
    dayEarnings,
  };
}
