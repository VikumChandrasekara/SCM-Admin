import { describe, expect, it } from 'vitest';

import { leaveWorkPlan, readingBounds, readingError } from '../src/lib/leaveWork';
import { dayFrom, type Day } from '../src/lib/model';

/** A day with its ON meter, and the closing meter the next morning carried back, if any. */
const worked = (date: string, on: number, closing?: number): Day =>
  dayFrom(date, { date, fillings: { '1': { onHours: on } }, ...(closing == null ? {} : { closingHours: closing }) });

/** A day marked worked by hand — no meter. */
const manual = (date: string): Day => dayFrom(date, { date, workedManually: true });

describe('the readings a leave day’s ON sits between', () => {
  it('takes the highest earlier reading as the floor and the lowest later ON as the ceiling', () => {
    const days = [
      worked('2026-10-01', 6700, 6708),
      worked('2026-10-02', 6708, 6716.5),
      worked('2026-10-05', 6730, 6738),
      worked('2026-10-06', 6738),
    ];
    expect(readingBounds(days, '2026-10-04')).toEqual({ floor: 6716.5, ceiling: 6730 });
  });

  it('reads an earlier day by its closing meter, and falls back to its ON when it never closed', () => {
    expect(readingBounds([worked('2026-10-02', 6708, 6716)], '2026-10-04').floor).toBe(6716);
    expect(readingBounds([worked('2026-10-02', 6708)], '2026-10-04').floor).toBe(6708);
  });

  it('has no bound where there is nothing to hold it to, and ignores the day itself and hand-marked days', () => {
    expect(readingBounds([], '2026-10-04')).toEqual({ floor: null, ceiling: null });
    expect(readingBounds([manual('2026-10-03'), manual('2026-10-05')], '2026-10-04')).toEqual({
      floor: null,
      ceiling: null,
    });
    expect(readingBounds([worked('2026-10-04', 6720)], '2026-10-04')).toEqual({ floor: null, ceiling: null });
  });
});

describe('refusing an ON that cannot be right', () => {
  const bounds = { floor: 6716.5, ceiling: 6730 };

  it('lets a reading between its neighbours — or equal to one — through', () => {
    expect(readingError(6720, bounds)).toBeNull();
    expect(readingError(6716.5, bounds)).toBeNull();
    expect(readingError(6730, bounds)).toBeNull();
    expect(readingError(6720, { floor: null, ceiling: null })).toBeNull();
    expect(readingError(0, { floor: null, ceiling: null })).toBeNull();
  });

  it('refuses one below the meter the day before closed at, naming it', () => {
    expect(readingError(6700, bounds)).toContain('6716.5');
  });

  it('refuses one above the ON of a later day, naming it', () => {
    expect(readingError(6731, bounds)).toContain('6730');
  });

  it('refuses a negative or non-number reading', () => {
    expect(readingError(-1, bounds)).not.toBeNull();
    expect(readingError(Number.NaN, bounds)).not.toBeNull();
  });
});

describe('what an ON reading for a leave day settles', () => {
  it('closes the day before at the reading, with the hours it worked', () => {
    const plan = leaveWorkPlan(6716, worked('2026-10-03', 6708), null, 6708);
    expect(plan.closePrevious).toEqual({ closingHours: 6716, worked: 8 });
    expect(plan.closeThis).toBeNull();
  });

  it('leaves a day before that is already closed, never opened, or marked by hand alone', () => {
    expect(leaveWorkPlan(6716, worked('2026-10-03', 6708, 6714), null, 6716).closePrevious).toBeNull();
    expect(leaveWorkPlan(6716, null, null, 6716).closePrevious).toBeNull();
    expect(leaveWorkPlan(6716, manual('2026-10-03'), null, 6716).closePrevious).toBeNull();
  });

  it('closes the day itself at the next day’s ON when that was entered first', () => {
    const plan = leaveWorkPlan(6716, null, worked('2026-10-05', 6724), 6724);
    expect(plan.closeThis).toEqual({ closingHours: 6724, worked: 8 });
  });

  it('does not close the day at a next day that has no ON of its own', () => {
    expect(leaveWorkPlan(6716, null, manual('2026-10-05'), 6716).closeThis).toBeNull();
  });

  it('settles both sides when the day sits between two worked ones', () => {
    const plan = leaveWorkPlan(6716, worked('2026-10-03', 6708), worked('2026-10-05', 6724), 6724);
    expect(plan.closePrevious).toEqual({ closingHours: 6716, worked: 8 });
    expect(plan.closeThis).toEqual({ closingHours: 6724, worked: 8 });
  });

  it('moves the machine’s meter up to the reading, never down', () => {
    expect(leaveWorkPlan(6716, null, null, 6708).totalHours).toBe(6716);
    // A day entered after the fact, with later days already on the meter.
    expect(leaveWorkPlan(6716, null, null, 6730).totalHours).toBeNull();
    expect(leaveWorkPlan(6716, null, null, 6716).totalHours).toBeNull();
  });
});
