import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
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

function onReadingOf(data: DocumentData | undefined): number | null {
  const reading = data?.fillings?.['1']?.onHours;
  return typeof reading === 'number' ? reading : null;
}

/** The OFF of a day is the next morning's ON, once that has been recorded. */
function offReadingOf(data: DocumentData | undefined): number | null {
  const closing = data?.closingHours;
  return typeof closing === 'number' ? closing : onReadingOf(data);
}

/** Mirrors FillingRules.validateLeaveWorkDay in the operator app. */
function leaveWorkDayProblem(
  on: number,
  off: number,
  floor: number | null,
  ceiling: number | null,
): string | null {
  if (on < 0) return 'ON මීටරය ඍණ විය නොහැක';
  if (off <= on) return 'OFF මීටරය ON ට වඩා වැඩි විය යුතුයි';
  if (floor !== null && on < floor) return `ON මීටරය පෙර දවසේ අගයට (${floor}) වඩා අඩු විය නොහැක`;
  if (ceiling !== null && off > ceiling) return `OFF මීටරය ඊළඟ දවසේ ON අගයට (${ceiling}) වඩා වැඩි විය නොහැක`;
  return null;
}

/**
 * Records a past day that was worked but never entered, with its ON and OFF
 * readings, which takes it out of the leave count. The OFF is stored as the
 * day's closing reading, the same as the operator app does once the next
 * morning's ON arrives, so the day cannot be closed a second time.
 *
 * The month gains OFF − ON. The hour meter is moved only when [date] is the
 * newest day, so an older date cannot wind it back.
 */
export async function saveLeaveWorkDay(
  person: Person,
  date: string,
  onHours: number,
  offHours: number,
  by: Person,
): Promise<void> {
  const machineId = person.machineId;
  const days = collection(db, 'machines', machineId, 'days');
  const ref = dayRef(machineId, date);

  const [current, earlier, later] = await Promise.all([
    getDoc(ref),
    getDocs(query(days, where('date', '<', date), orderBy('date', 'desc'), limit(1))),
    getDocs(query(days, where('date', '>', date), orderBy('date', 'asc'), limit(1))),
  ]);

  if (onReadingOf(current.data()) !== null) throw new Error('මේ දිනය දැනටමත් වැඩ කළ දිනයක්');

  const problem = leaveWorkDayProblem(
    onHours,
    offHours,
    earlier.empty ? null : offReadingOf(earlier.docs[0].data()),
    later.empty ? null : onReadingOf(later.docs[0].data()),
  );
  if (problem) throw new Error(problem);

  const month = date.slice(0, 7);
  const batch = writeBatch(db);
  batch.set(
    ref,
    {
      date,
      closingHours: offHours,
      fillings: {
        '1': { onHours, amounts: {}, lockedAt: new Date().toISOString(), syncedAt: serverTimestamp() },
      },
    },
    { merge: true },
  );
  batch.set(monthRef(machineId, month), { month, hours: increment(offHours - onHours) }, { merge: true });
  if (later.empty) batch.set(doc(db, 'machines', machineId), { totalHours: offHours }, { merge: true });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'leave.workday',
      'operator',
      person.id,
      nameOf(person),
      `${date}: ON ${onHours} → OFF ${offHours}`,
      by,
    ),
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
