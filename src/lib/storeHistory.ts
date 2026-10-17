import type { Movement } from './model';

/** One line of an item's history: what changed, and what the count was before and after. */
export interface HistoryRow {
  movement: Movement;
  /** How much the item's count moved — negative when it was used or taken out. */
  delta: number;
  /** The count before this change, or null when it cannot be told. */
  before: number | null;
  /** The count after this change, or null when it cannot be told. */
  after: number | null;
}

/** Counts are kept to a thousandth, so 0.1 + 0.2 reads 0.3. */
const tidy = (value: number) => Math.round(value * 1000) / 1000;

/** How much [movement] moved [itemId] by — a movement can carry several items. */
export function deltaFor(movement: Movement, itemId: string): number {
  return movement.items.filter((line) => line.itemId === itemId).reduce((total, line) => total + line.delta, 0);
}

/**
 * An item's changes, newest first, each with the count before and after it.
 *
 * Every change to a count is in the log, so the count after the newest one is
 * what the item holds now, and each older one is that less the changes since.
 * [skipped] is the sum of the changes on the pages before this one (0 on the
 * first); null when that is not known, which leaves the counts blank rather
 * than wrong.
 */
export function historyRows(
  movements: readonly Movement[],
  itemId: string,
  current: number,
  skipped: number | null,
): HistoryRow[] {
  let newer = 0;
  return movements.map((movement) => {
    const delta = deltaFor(movement, itemId);
    const after = skipped == null ? null : tidy(current - skipped - newer);
    newer += delta;
    return { movement, delta, after, before: after == null ? null : tidy(after - delta) };
  });
}

/** The sum of every change on a page — what the next page, further back, has to skip. */
export function pageDelta(movements: readonly Movement[], itemId: string): number {
  return tidy(movements.reduce((total, movement) => total + deltaFor(movement, itemId), 0));
}
