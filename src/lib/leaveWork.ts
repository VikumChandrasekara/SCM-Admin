import { dayOffHours, dayOnHours, type Day } from './model';

// Marking a leave day as worked, with the ON meter the crew read off the dash.
// The operator app does the same sums when a morning's ON is entered
// (FirestoreRepository.saveFilling): the day before is closed at the new
// reading and the month's hours grow by what that day worked. Done here for a
// day entered after the fact, where the day after may already have its own ON.

/** What an ON reading for a day has to sit between: the readings either side of it. */
export interface ReadingBounds {
  /** The highest reading on any earlier day, or null when there is none. */
  floor: number | null;
  /** The lowest ON reading on any later day, or null when there is none. */
  ceiling: number | null;
}

/** The readings [days] hold either side of [date] — [days] may be any mix of days. */
export function readingBounds(days: readonly Day[], date: string): ReadingBounds {
  let floor: number | null = null;
  let ceiling: number | null = null;
  for (const day of days) {
    if (day.date < date) {
      const reading = dayOffHours(day) ?? dayOnHours(day);
      if (reading != null && (floor == null || reading > floor)) floor = reading;
    } else if (day.date > date) {
      const reading = dayOnHours(day);
      if (reading != null && (ceiling == null || reading < ceiling)) ceiling = reading;
    }
  }
  return { floor, ceiling };
}

const shown = (value: number) => (Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1));

/**
 * Why [reading] cannot be the ON meter for the day, or null when it can. An
 * hour meter only ever counts up, so a reading outside its neighbours is a
 * typo rather than a different day — the operator app refuses it the same way.
 */
export function readingError(reading: number, { floor, ceiling }: ReadingBounds): string | null {
  if (!Number.isFinite(reading) || reading < 0) return 'මීටර් අගය ඍණ විය නොහැක';
  if (floor != null && reading < floor) return `ON මීටරය පෙර දවසක අගයට (${shown(floor)}) වඩා අඩු විය නොහැක`;
  if (ceiling != null && reading > ceiling) return `ON මීටරය පසු දවසක අගයට (${shown(ceiling)}) වඩා වැඩි විය නොහැක`;
  return null;
}

/** A day that the new reading settles: its closing meter, and the hours that adds to its month. */
export interface Closing {
  /** The day's closing meter — the next day's ON. */
  closingHours: number;
  /** What the day worked; added to its month only when above zero. */
  worked: number;
}

export interface LeaveWorkPlan {
  /** The day before, closed at the new reading — what the next morning's ON would have done. */
  closePrevious: Closing | null;
  /** The day itself, closed at the next day's ON when that was entered first. */
  closeThis: Closing | null;
  /** The machine's meter, when the new reading is the highest it has seen. */
  totalHours: number | null;
}

/**
 * What entering [reading] as the ON for a day writes besides the day itself.
 * [previous] and [next] are the calendar days either side of it, if they have
 * any record; [machineHours] is the meter as the machine holds it.
 */
export function leaveWorkPlan(
  reading: number,
  previous: Day | null,
  next: Day | null,
  machineHours: number,
): LeaveWorkPlan {
  const previousOn = previous ? dayOnHours(previous) : null;
  const nextOn = next ? dayOnHours(next) : null;
  return {
    // Already closed, or never opened — left alone, as the app leaves it.
    closePrevious:
      previous && previousOn != null && previous.closingHours == null
        ? { closingHours: reading, worked: reading - previousOn }
        : null,
    closeThis: nextOn != null ? { closingHours: nextOn, worked: nextOn - reading } : null,
    totalHours: reading > machineHours ? reading : null,
  };
}
