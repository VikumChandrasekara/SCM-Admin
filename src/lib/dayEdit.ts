import { addDays, hours } from './format';
import { leaveWorkPlan, readingBounds, readingError, type Closing } from './leaveWork';
import {
  FILL_ITEMS,
  FILL_LABEL,
  INSPECTION_LABEL,
  dayOffHours,
  dayOnHours,
  type Day,
  type FillItem,
  type InspectionItem,
  type RoleSpec,
} from './model';

/**
 * Putting a recorded day right, from the history page.
 *
 * A day is more than the figures on it: the OFF meter is the next morning's
 * ON, the month keeps the hours each day worked, the machine keeps the last
 * reading, and an OK'd පිරවීම has already drawn its fuel from the store. So
 * an edit is planned here first — what else moves with it, and whether it can
 * be done at all — and only then written (see data/dayEdit.ts).
 */

/** What the edit form holds for one day. */
export interface DayEdit {
  onHours: number | null;
  offHours: number | null;
  /** ලෝඩ් or අඩි, whichever the crew member is measured in. */
  tally: number;
  /** Amounts by slot, for the slots the day has. */
  fillings: Record<number, Partial<Record<FillItem, number>>>;
  /** A mark per item; null for none. */
  inspection: Partial<Record<InspectionItem, boolean | null>>;
}

/** The form as it starts: the day as it stands. */
export function draftOf(day: Day, field: 'loads' | 'feet', role: RoleSpec): DayEdit {
  return {
    onHours: dayOnHours(day),
    offHours: dayOffHours(day),
    tally: day[field],
    fillings: Object.fromEntries(day.fillings.map((filling) => [filling.slot, { ...filling.amounts }])),
    inspection: Object.fromEntries(role.inspectionItems.map((item) => [item, day.inspection[item] ?? null])),
  };
}

// ---- the meters ---------------------------------------------------------------

/** Everything the days around one day tell the plan. */
export interface MeterContext {
  day: Day;
  /** The calendar day before and after, when they have a record. */
  previous: Day | null;
  next: Day | null;
  /** Every day on record near this one — the readings its own has to sit between. */
  around: readonly Day[];
  /** The machine's hour meter as it stands. */
  machineHours: number;
}

export interface MeterPlan {
  /** Where the ON goes — the slot it already sits in, or 1 when the day has none. */
  setOn: { slot: number; value: number } | null;
  /** The day's own closing meter. */
  setClosing: number | null;
  /** The day before, closed at the new ON. */
  closePrevious: { date: string; closingHours: number } | null;
  /** How much each month's hours move by, and only the months that move. */
  monthHours: Map<string, number>;
  /** The machine's meter, when it should move. */
  totalHours: number | null;
}

export type Planned<T> = { plan: T; error?: undefined } | { plan?: undefined; error: string };

const monthOf = (date: string) => date.slice(0, 7);

/** What a closed day adds to its month: the hours it worked, never below nothing. */
function contribution(on: number | null, off: number | null): number {
  return on != null && off != null && off > on ? off - on : 0;
}

const nothing = (): MeterPlan => ({
  setOn: null,
  setClosing: null,
  closePrevious: null,
  monthHours: new Map(),
  totalHours: null,
});

function addHours(plan: MeterPlan, date: string, delta: number): void {
  if (delta === 0) return;
  const month = monthOf(date);
  plan.monthHours.set(month, (plan.monthHours.get(month) ?? 0) + delta);
}

/** Meters read to a tenth, so hours are kept to a thousandth and a month that nets out to nothing does not move. */
function tidy(plan: MeterPlan): MeterPlan {
  for (const [month, delta] of plan.monthHours) {
    const rounded = Math.round(delta * 1000) / 1000;
    if (rounded === 0) plan.monthHours.delete(month);
    else plan.monthHours.set(month, rounded);
  }
  return plan;
}

const finite = (value: number) => Number.isFinite(value) && value >= 0;

/**
 * What moving the day's meters to [newOn] and [newOff] writes besides the day.
 *
 * - A day with no ON gains one the way a leave day marked worked does: the day
 *   before is closed at it, and the day itself is closed at the next ON.
 * - A day's ON moved: the day before, if that ON is what closed it, moves
 *   with it, and both days' hours change in their months.
 * - The OFF is the next morning's ON whenever there is one, so it is only
 *   changed on a day that has no later ON.
 *
 * A reading outside the ones either side of it is refused: an hour meter only
 * counts up.
 */
export function planMeters(
  { day, previous, next, around, machineHours }: MeterContext,
  newOn: number | null,
  newOff: number | null,
): Planned<MeterPlan> {
  const oldOn = dayOnHours(day);
  const oldOff = dayOffHours(day);
  const onChanged = newOn !== oldOn;
  const offChanged = newOff !== oldOff;
  const plan = nothing();
  if (!onChanged && !offChanged) return { plan };

  const nextOn = next ? dayOnHours(next) : null;
  const bounds = readingBounds(around, day.date);

  if (onChanged) {
    if (newOn == null) return { error: 'ON මීටරය ඉවත් කළ නොහැක' };
    const refused = readingError(newOn, bounds);
    if (refused) return { error: refused };
  }

  if (offChanged) {
    if (nextOn != null) {
      return { error: 'OFF මීටරය පසු දවසේ ON මීටරයයි — එය වෙනස් කිරීමට පසු දවස සංස්කරණය කරන්න' };
    }
    if (newOff == null) return { error: 'OFF මීටරය ඉවත් කළ නොහැක' };
    if (!finite(newOff)) return { error: 'මීටර් අගය ඍණ විය නොහැක' };
    const on = newOn ?? oldOn;
    if (on == null) return { error: 'OFF මීටරයට ON මීටරයක් අවශ්‍යයි' };
    if (newOff < on) return { error: 'OFF මීටරය ON මීටරයට වඩා අඩු විය නොහැක' };
    if (bounds.ceiling != null && newOff > bounds.ceiling) {
      return { error: `OFF මීටරය පසු දවසක අගයට (${hours(bounds.ceiling)}) වඩා වැඩි විය නොහැක` };
    }
  }

  // The meter the machine holds follows the day's last reading — but only
  // upward, unless this was the machine's last reading and was wrong.
  const finish = (top: number | null, oldTop: number | null) => {
    if (top == null) return;
    const later = around.some((other) => other.date > day.date && dayOnHours(other) != null);
    if (!later && oldTop != null && machineHours === oldTop && top !== machineHours) plan.totalHours = top;
    else if (top > machineHours) plan.totalHours = top;
  };

  // A day with no ON yet: the same sums as a leave day marked worked.
  if (oldOn == null) {
    const leave = leaveWorkPlan(newOn!, previous, next, machineHours);
    plan.setOn = { slot: 1, value: newOn! };
    if (leave.closeThis) plan.setClosing = leave.closeThis.closingHours;
    const add = (date: string, closing: Closing | null) =>
      closing && addHours(plan, date, closing.worked > 0 ? closing.worked : 0);
    if (leave.closePrevious && previous) {
      plan.closePrevious = { date: previous.date, closingHours: leave.closePrevious.closingHours };
      add(previous.date, leave.closePrevious);
    }
    add(day.date, leave.closeThis);
    plan.totalHours = leave.totalHours;
    return { plan: tidy(plan) };
  }

  const off = offChanged ? newOff : oldOff;
  if (onChanged) {
    plan.setOn = { slot: day.fillings.find((filling) => filling.onHours != null)?.slot ?? 1, value: newOn! };
    const previousOn = previous ? dayOnHours(previous) : null;
    if (previous && previousOn != null && previous.closingHours === oldOn) {
      plan.closePrevious = { date: previous.date, closingHours: newOn! };
      addHours(plan, previous.date, contribution(previousOn, newOn) - contribution(previousOn, oldOn));
    }
  }
  if (offChanged) plan.setClosing = newOff;
  addHours(plan, day.date, contribution(newOn, off) - contribution(oldOn, oldOff));
  finish(off ?? newOn, oldOff ?? oldOn);
  return { plan: tidy(plan) };
}

// ---- the rest of the day --------------------------------------------------------

export interface FillChange {
  slot: number;
  item: FillItem;
  before: number;
  after: number;
  /** An OK'd slot — already drawn from the store. */
  locked: boolean;
}

/** Every amount the form changes, in slot order. Slots the day does not have are ignored. */
export function fillChanges(day: Day, edit: DayEdit): FillChange[] {
  const changes: FillChange[] = [];
  for (const filling of day.fillings) {
    const amounts = edit.fillings[filling.slot];
    if (!amounts) continue;
    for (const item of FILL_ITEMS) {
      if (!(item in amounts) && !(item in filling.amounts)) continue;
      const before = filling.amounts[item] ?? 0;
      const after = amounts[item] ?? 0;
      if (before !== after) changes.push({ slot: filling.slot, item, before, after, locked: filling.lockedAt != null });
    }
  }
  return changes;
}

/** Why the form cannot be saved as it is, or null. */
export function editError(edit: DayEdit): string | null {
  if (edit.onHours != null && !finite(edit.onHours)) return 'මීටර් අගය ඍණ විය නොහැක';
  if (!finite(edit.tally)) return 'ලෝඩ් / අඩි ඍණ විය නොහැක';
  for (const amounts of Object.values(edit.fillings)) {
    for (const value of Object.values(amounts)) {
      if (value != null && !finite(value)) return 'පිරවීම් ප්‍රමාණ ඍණ විය නොහැක';
    }
  }
  return null;
}

const markWord = (mark: boolean | null | undefined) => (mark === true ? '✓' : mark === false ? '✗' : '—');
const reading = (value: number | null) => (value == null ? '—' : hours(value));

/** What the edit changes, in the audit log's words — empty when it changes nothing. */
export function editLines(day: Day, edit: DayEdit, field: 'loads' | 'feet'): string[] {
  const lines: string[] = [];
  if (edit.onHours !== dayOnHours(day)) lines.push(`ON ${reading(dayOnHours(day))} → ${reading(edit.onHours)}`);
  if (edit.offHours !== dayOffHours(day)) lines.push(`OFF ${reading(dayOffHours(day))} → ${reading(edit.offHours)}`);
  if (edit.tally !== day[field]) {
    lines.push(`${field === 'loads' ? 'ලෝඩ්' : 'අඩි'} ${hours(day[field])} → ${hours(edit.tally)}`);
  }
  for (const change of fillChanges(day, edit)) {
    lines.push(`${FILL_LABEL[change.item]} (පිරවීම ${change.slot}) ${hours(change.before)} → ${hours(change.after)} L`);
  }
  for (const [item, mark] of Object.entries(edit.inspection) as [InspectionItem, boolean | null][]) {
    const before = day.inspection[item] ?? null;
    if (mark !== before) lines.push(`${INSPECTION_LABEL[item]} ${markWord(before)} → ${markWord(mark)}`);
  }
  return lines;
}

/** The days either side of [date], from a window of days around it. */
export function neighboursOf(around: readonly Day[], date: string): { previous: Day | null; next: Day | null } {
  const find = (target: string) => around.find((day) => day.date === target) ?? null;
  return { previous: find(addDays(date, -1)), next: find(addDays(date, 1)) };
}
