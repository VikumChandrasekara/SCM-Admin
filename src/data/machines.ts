import {
  collection,
  doc,
  getDoc,
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
  WAGE_BASIS_LABEL,
  dayFrom,
  nameOf,
  type Day,
  type Machine,
  type Person,
  type ServiceTask,
  type StoreItem,
  type WageBasis,
} from '../lib/model';
import { auditEntry } from './audit';
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
 * Sets a day's ලෝඩ් or අඩි and moves the month by the difference — the same
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
  person: Person,
  by: Person,
): Promise<void> {
  const ref = dayRef(machineId, date);
  const month = date.slice(0, 7);
  const label = field === 'loads' ? 'ලෝඩ්' : 'අඩි';

  await runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data()?.[field];
    const previous = typeof current === 'number' ? current : 0;
    tx.set(ref, { date, [field]: value }, { merge: true });
    if (value !== previous) {
      tx.set(monthRef(machineId, month), { month, [field]: increment(value - previous) }, { merge: true });
      tx.set(
        doc(collection(db, 'auditLog')),
        auditEntry(
          'tally.set',
          'operator',
          person.id,
          nameOf(person),
          `${label} ${date}: ${previous} → ${value}`,
          by,
        ),
      );
    }
  });
}

/**
 * Marks a past day as worked when it was never entered. It leaves the leave
 * count and counts toward a day-basis wage, with no meter reading and no hours,
 * so the hour meter and the month's hours are left alone.
 */
export async function markLeaveWorked(person: Person, date: string, by: Person): Promise<void> {
  const machineId = person.machineId;
  const ref = dayRef(machineId, date);
  const data = (await getDoc(ref)).data();
  const worked = typeof data?.fillings?.['1']?.onHours === 'number' || data?.workedManually === true;
  if (worked) throw new Error('මේ දිනය දැනටමත් වැඩ කළ දිනයක්');

  const batch = writeBatch(db);
  batch.set(ref, { date, workedManually: true }, { merge: true });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('leave.workday', 'operator', person.id, nameOf(person), `${date} · වැඩ කළ දිනයක් ලෙස සටහන් කළා`, by),
  );
  await commit(batch);
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

  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'service.reset',
      'machine',
      machine.id,
      machine.id,
      `${SERVICE[task].short} — ${nameOf(person)}${part ? ` · ගබඩාවෙන් ${part.name} 1ක් අඩු කළා` : ''}`,
      by,
    ),
  );

  await commit(batch);
}

/**
 * The advance and the wage rate — the only fields a supervisor may write.
 * Leave and ලැබිය යුතු මුදල are never written at all; both are worked out
 * from the month's records (see payFor) wherever they are shown.
 */
export async function saveFigures(
  person: Person,
  figures: {
    advanceAmount: number;
    dailyWage: number;
    wageBasis: WageBasis;
  },
  by: Person,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'operators', person.id), figures);

  const lines: string[] = [];
  if (figures.advanceAmount !== person.advanceAmount) {
    lines.push(`ඇඩ්වාන්ස්: රු.${person.advanceAmount} → රු.${figures.advanceAmount}`);
  }
  if (figures.dailyWage !== person.dailyWage || figures.wageBasis !== person.wageBasis) {
    lines.push(
      `පඩිය: රු.${person.dailyWage} (${WAGE_BASIS_LABEL[person.wageBasis].per}) → රු.${figures.dailyWage} (${WAGE_BASIS_LABEL[figures.wageBasis].per})`,
    );
  }
  if (lines.length > 0) {
    batch.set(
      doc(collection(db, 'auditLog')),
      auditEntry('figures.set', 'operator', person.id, nameOf(person), lines.join(' · '), by),
    );
  }

  await commit(batch);
}
