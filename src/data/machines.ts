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
import { addDays, hours } from '../lib/format';
import { leaveWorkPlan, readingBounds, readingError } from '../lib/leaveWork';
import {
  SERVICE,
  WAGE_BASIS_LABEL,
  dayFrom,
  dayWorked,
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

/** How far either side of a day to look for the readings its own has to sit between. */
const READING_WINDOW_DAYS = 31;

const ALREADY_WORKED = 'මේ දිනය දැනටමත් වැඩ කළ දිනයක්';

/**
 * Marks a past day as worked when it was never entered. It leaves the leave
 * count and counts toward a day-basis wage.
 *
 * Without [onHours] that is all: no meter reading and no hours, so the hour
 * meter and the month's hours are left alone. With the ON meter the crew read
 * off the dash it is entered as the day's ON, and everything a morning's ON
 * moves moves with it — see [markLeaveWorkedWithMeter].
 */
export async function markLeaveWorked(
  person: Person,
  date: string,
  by: Person,
  onHours: number | null = null,
): Promise<void> {
  if (onHours != null) return markLeaveWorkedWithMeter(person, date, by, onHours);

  const machineId = person.machineId;
  const ref = dayRef(machineId, date);
  const data = (await getDoc(ref)).data();
  if (dayWorked(dayFrom(date, data))) throw new Error(ALREADY_WORKED);

  const batch = writeBatch(db);
  batch.set(ref, { date, workedManually: true }, { merge: true });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('leave.workday', 'operator', person.id, nameOf(person), `${date} · වැඩ කළ දිනයක් ලෙස සටහන් කළා`, by),
  );
  await commit(batch);
}

/**
 * A leave day marked worked, with its ON meter. What the operator app does
 * when a morning's ON is entered, done for a day entered afterwards:
 *
 * - the day's ON goes in slot 1, where both apps read it;
 * - the day before is closed at it, and its hours join its month;
 * - the day after, if it already has an ON, closes this day at that;
 * - the machine's meter follows — but only upward, as it holds the last
 *   reading off the dash and an earlier day must not wind it back.
 *
 * A reading that does not sit between its neighbours is refused: an hour
 * meter only counts up. In a transaction, reading the days on the server —
 * an attempt that follows one which went through finds the day worked and
 * refuses rather than adding the hours twice.
 */
async function markLeaveWorkedWithMeter(person: Person, date: string, by: Person, onHours: number): Promise<void> {
  const machineId = person.machineId;
  const around = await fetchDays(
    machineId,
    addDays(date, -READING_WINDOW_DAYS),
    addDays(date, READING_WINDOW_DAYS),
  );
  const refused = readingError(onHours, readingBounds(around, date));
  if (refused) throw new Error(refused);

  const ref = dayRef(machineId, date);
  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const machineRef = doc(db, 'machines', machineId);

  await runTransaction(db, async (tx) => {
    const day = await tx.get(ref);
    const previousSnapshot = await tx.get(dayRef(machineId, previousDate));
    const nextSnapshot = await tx.get(dayRef(machineId, nextDate));
    const machine = await tx.get(machineRef);

    if (dayWorked(dayFrom(date, day.data()))) throw new Error(ALREADY_WORKED);
    const previous = previousSnapshot.exists() ? dayFrom(previousDate, previousSnapshot.data()) : null;
    const next = nextSnapshot.exists() ? dayFrom(nextDate, nextSnapshot.data()) : null;
    // The days either side are read again here, so a reading entered since
    // the check above is held to as well.
    const neighbours = [previous, next].filter((entry): entry is Day => entry != null);
    const stale = readingError(onHours, readingBounds(neighbours, date));
    if (stale) throw new Error(stale);

    const plan = leaveWorkPlan(onHours, previous, next, machine.data()?.totalHours ?? 0);

    tx.set(
      ref,
      {
        date,
        fillings: { '1': { onHours } },
        ...(plan.closeThis ? { closingHours: plan.closeThis.closingHours } : {}),
      },
      { merge: true },
    );
    if (plan.closePrevious) {
      tx.set(dayRef(machineId, previousDate), { date: previousDate, closingHours: plan.closePrevious.closingHours }, { merge: true });
    }
    // What each closed day worked, summed by month — the two days can share
    // one, and a month's document is written once.
    const addedHours = new Map<string, number>();
    for (const [closedDate, closing] of [
      [previousDate, plan.closePrevious],
      [date, plan.closeThis],
    ] as const) {
      if (closing && closing.worked > 0) {
        const month = closedDate.slice(0, 7);
        addedHours.set(month, (addedHours.get(month) ?? 0) + closing.worked);
      }
    }
    for (const [month, worked] of addedHours) {
      tx.set(monthRef(machineId, month), { month, hours: increment(worked) }, { merge: true });
    }
    if (plan.totalHours != null) tx.set(machineRef, { totalHours: plan.totalHours }, { merge: true });

    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'leave.workday',
        'operator',
        person.id,
        nameOf(person),
        `${date} · වැඩ කළ දිනයක් ලෙස සටහන් කළා · ON මීටරය ${hours(onHours)}`,
        by,
      ),
    );
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
