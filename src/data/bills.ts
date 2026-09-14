import {
  collection,
  doc,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Transaction,
} from 'firebase/firestore';

import { db } from '../db';
import { monthBounds } from '../lib/format';
import { billFrom, nameOf, type Bill, type BillCategory, type Person } from '../lib/model';
import { useLiveQuery } from './live';

/** Every bill dated inside `yyyy-MM`, newest first. */
export function useMonthBills(month: string) {
  const { from, to } = monthBounds(month);
  return useLiveQuery(
    `bills:${month}`,
    // A range and an order on the same field need no composite index.
    () =>
      query(
        collection(db, 'bills'),
        where('date', '>=', from),
        where('date', '<=', to),
        orderBy('date', 'desc'),
      ),
    (snapshot) => billFrom(snapshot.id, snapshot.data()),
  );
}

export interface BillInput {
  category: BillCategory;
  amount: number;
  date: string;
  note: string;
  person: Person | null;
}

/**
 * An advance is also added to the crew member's own ඇඩ්වාන්ස් ගණන, which is
 * the figure their app shows them — so creating, changing or deleting an
 * advance bill moves that figure by the same amount.
 */
function advanceDeltas(before: Bill | null, after: BillInput | null): Map<string, number> {
  const deltas = new Map<string, number>();
  const add = (id: string, amount: number) => deltas.set(id, (deltas.get(id) ?? 0) + amount);
  if (before?.category === 'advance' && before.operatorId) add(before.operatorId, -before.amount);
  if (after?.category === 'advance' && after.person) add(after.person.id, after.amount);
  return deltas;
}

function moveAdvances(
  tx: Transaction,
  before: Bill | null,
  after: BillInput | null,
  peopleById: Map<string, Person>,
): void {
  for (const [id, delta] of advanceDeltas(before, after)) {
    // Someone whose account has since been removed has no record to move.
    if (delta !== 0 && peopleById.has(id)) {
      tx.update(doc(db, 'operators', id), { advanceAmount: increment(delta) });
    }
  }
}

// Bills are written in transactions, not batches. A batch waits in this
// computer's queue and is sent again after a reload — and on a weak line one
// the server had already taken would then move the advance figure twice. A
// transaction is never queued, and it reads the bill on the server first, so
// trying again after a dropped connection finds the work already done. It
// does need a connection: offline, the save fails and says so.

export async function saveBill(
  input: BillInput,
  existing: Bill | null,
  by: Person,
  peopleById: Map<string, Person>,
): Promise<void> {
  // The id is chosen once, so every attempt is at the same bill.
  const ref = existing ? doc(db, 'bills', existing.id) : doc(collection(db, 'bills'));
  const fields = {
    category: input.category,
    amount: input.amount,
    date: input.date,
    note: input.note.trim(),
    operatorId: input.person?.id ?? null,
    operatorName: input.person ? nameOf(input.person) : null,
    updatedAt: serverTimestamp(),
  };

  await runTransaction(db, async (tx) => {
    const stored = await tx.get(ref);
    if (existing) {
      if (!stored.exists()) throw new Error('මෙම බිල්පත මේ අතර ඉවත් කර ඇත.');
      tx.update(ref, fields);
      // Measured from the server's copy, not the one on screen: an attempt
      // that follows one which went through moves the advance by nothing.
      moveAdvances(tx, billFrom(stored.id, stored.data()), input, peopleById);
    } else {
      if (stored.exists()) return; // an earlier attempt saved it already
      tx.set(ref, {
        ...fields,
        createdBy: by.id,
        createdByName: nameOf(by),
        createdAt: serverTimestamp(),
      });
      moveAdvances(tx, null, input, peopleById);
    }
  });
}

export async function deleteBill(bill: Bill, peopleById: Map<string, Person>): Promise<void> {
  const ref = doc(db, 'bills', bill.id);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(ref);
    if (!stored.exists()) return; // already gone, and its advance with it
    tx.delete(ref);
    moveAdvances(tx, billFrom(stored.id, stored.data()), null, peopleById);
  });
}
