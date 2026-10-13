import {
  doc,
  getDoc,
  increment,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import {
  BLAST_ITEMS,
  BLAST_SIZES_SOURCE,
  FILL_ITEMS,
  SIZED_ITEMS,
  linkDocId,
  nameOf,
  sizeLines,
  storeItemFrom,
  usageInStoreUnit,
  type Day,
  type MovementLine,
  type Person,
  type StockLink,
} from './model';

/**
 * Drawing the store down as the crews record what they used.
 *
 * The operator app posts each locked පිරවීම slot and වෙඩි බඩු sheet the moment
 * it is OK'd. This is the same posting, run from the panel as a backstop for
 * anything that did not make it — an app that was offline with nothing
 * cached, or one from before the store existed.
 *
 * Every posting lands at a fixed id, and firestore.rules refuses a second
 * write to it, so the two can never both draw the same fill down.
 */

export function usageId(machineId: string, date: string, source: string): string {
  return `use_${machineId}_${date}_${source}`;
}

/** What one locked slot or sheet drew from the store. */
export interface Usage {
  /** `fill1`, `fill2`, `fill3`, `blast` or `blastSizes` (the sheet's බිට් and කටු). */
  source: string;
  lockedAt: Date;
  amounts: Partial<Record<StockLink, number>>;
}

export function usagesOf(day: Day): Usage[] {
  const usages: Usage[] = [];

  for (const filling of day.fillings) {
    if (!filling.lockedAt) continue;
    const amounts: Partial<Record<StockLink, number>> = {};
    for (const item of FILL_ITEMS) {
      const amount = filling.amounts[item];
      if (amount && amount > 0) amounts[`fill:${item}`] = amount;
    }
    if (Object.keys(amounts).length > 0) {
      usages.push({ source: `fill${filling.slot}`, lockedAt: filling.lockedAt, amounts });
    }
  }

  if (day.blasting.lockedAt) {
    const amounts: Partial<Record<StockLink, number>> = {};
    for (const item of BLAST_ITEMS) {
      const amount = day.blasting.amounts[item];
      if (amount && amount > 0) amounts[`blast:${item}`] = amount;
    }
    if (Object.keys(amounts).length > 0) {
      usages.push({ source: 'blast', lockedAt: day.blasting.lockedAt, amounts });
    }

    // බිට් and කටු are drawn in several sizes but held on the shelf as one
    // count, so every size of a kind comes off the same item. Posted on their
    // own so an app that only posted the rest can be topped up, and the two
    // can never draw the same thing twice.
    const sized: Partial<Record<StockLink, number>> = {};
    for (const item of SIZED_ITEMS) {
      const total = sizeLines(day.blasting.sizes[item]).reduce((sum, [, count]) => sum + count, 0);
      if (total > 0) sized[`blast:${item}`] = total;
    }
    if (Object.keys(sized).length > 0) {
      usages.push({ source: BLAST_SIZES_SOURCE, lockedAt: day.blasting.lockedAt, amounts: sized });
    }
  }

  return usages;
}

export type PostResult = 'posted' | 'already';

/**
 * Posts [usage] unless it has been posted already.
 *
 * An item whose shelf was counted after the fill already reflects it, so it
 * is recorded as unmatched rather than drawn down a second time.
 */
export async function postUsage(
  db: Firestore,
  args: {
    machineId: string;
    date: string;
    usage: Usage;
    person: Person | null;
    by: { uid: string; name: string };
  },
): Promise<PostResult> {
  const { machineId, date, usage, person, by } = args;
  const ref = doc(db, 'storeMovements', usageId(machineId, date, usage.source));
  if ((await getDoc(ref)).exists()) return 'already';

  const lines: MovementLine[] = [];
  const unmatched: string[] = [];
  for (const [link, amount] of Object.entries(usage.amounts) as [StockLink, number][]) {
    const snapshot = await getDoc(doc(db, 'store', linkDocId(link)));
    const item = snapshot.exists() ? storeItemFrom(snapshot.id, snapshot.data()) : null;
    if (!item || (item.countedAt && item.countedAt > usage.lockedAt)) {
      unmatched.push(link);
      continue;
    }
    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      delta: -usageInStoreUnit(link, item.unit, amount),
      unitPrice: item.unitPrice,
    });
  }

  const batch = writeBatch(db);
  batch.set(ref, {
    type: 'usage',
    items: lines,
    unmatched,
    machineId,
    date,
    source: usage.source,
    operatorId: person?.id ?? null,
    operatorName: person ? nameOf(person) : null,
    note: '',
    createdBy: by.uid,
    createdByName: by.name,
    createdAt: serverTimestamp(),
  });
  for (const line of lines) {
    batch.update(doc(db, 'store', line.itemId), {
      quantity: increment(line.delta),
      updatedAt: serverTimestamp(),
      updatedBy: by.uid,
    });
  }
  await batch.commit();
  return 'posted';
}
