import {
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../db';
import {
  SERVICE,
  dayFrom,
  nameOf,
  type Day,
  type Machine,
  type Person,
  type ServiceTask,
  type StoreItem,
} from '../lib/model';
import { commit } from './commit';

export function dayRef(machineId: string, date: string) {
  return doc(db, 'machines', machineId, 'days', date);
}

export function monthRef(machineId: string, month: string) {
  return doc(db, 'machines', machineId, 'months', month);
}

/** Days between [from] and [to] inclusive, newest first. */
export async function fetchDays(machineId: string, from: string, to: string): Promise<Day[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'machines', machineId, 'days'),
      where('date', '>=', from),
      where('date', '<=', to),
      orderBy('date', 'desc'),
    ),
  );
  return snapshot.docs.map((entry) => dayFrom(entry.id, entry.data()));
}

/**
 * Sets a day's ලෝඩ් or ආඩි and moves the month by the difference — the same
 * write the supervisor console makes, so re-entering a total corrects the
 * month instead of double-counting it.
 *
 * A transaction, reading the day on the server. A batch could be sent twice
 * after a reload on a weak line and move the month twice; a transaction
 * tried again finds the day already set and moves the month by nothing.
 */
export async function saveTally(
  machineId: string,
  date: string,
  field: 'loads' | 'feet',
  value: number,
): Promise<void> {
  const ref = dayRef(machineId, date);
  const month = date.slice(0, 7);

  await runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data()?.[field];
    const previous = typeof current === 'number' ? current : 0;
    tx.set(ref, { date, [field]: value }, { merge: true });
    if (value !== previous) {
      tx.set(monthRef(machineId, month), { month, [field]: increment(value - previous) }, { merge: true });
    }
  });
}

/**
 * A part has just been changed: its next change falls one interval out and,
 * when the store stocks that part, one comes off the shelf in the same write.
 */
export async function resetService(
  machine: Machine,
  task: ServiceTask,
  part: StoreItem | null,
  person: Person,
  by: Person,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'machines', machine.id), {
    [`serviceDueAt.${task}`]: machine.totalHours + SERVICE[task].interval,
  });

  if (part) {
    batch.update(doc(db, 'store', part.id), {
      quantity: increment(-1),
      updatedAt: serverTimestamp(),
      updatedBy: by.id,
    });
    batch.set(doc(collection(db, 'storeMovements')), {
      type: 'use',
      items: [{ itemId: part.id, name: part.name, unit: part.unit, delta: -1, unitPrice: part.unitPrice }],
      unmatched: [],
      machineId: machine.id,
      operatorName: nameOf(person),
      note: `${SERVICE[task].short} මාරු කිරීම · ${machine.id} · ${nameOf(person)}`,
      createdBy: by.id,
      createdByName: nameOf(by),
      createdAt: serverTimestamp(),
    });
  }

  await commit(batch);
}

/** The three තොරතුරු figures — the only fields a supervisor may write. */
export async function saveFigures(
  personId: string,
  figures: { leaveDays: number; advanceAmount: number; bonusTotal: number },
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'operators', personId), figures);
  await commit(batch);
}
