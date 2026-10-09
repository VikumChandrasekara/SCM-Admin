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
import { addDays, hours, monthBounds } from '../lib/format';
import { leaveWorkPlan, readingBounds, readingError } from '../lib/leaveWork';
import {
  MACHINE_ID_PATTERN,
  assignSummary,
  cleanDetails,
  detailsError,
  machineDiff,
  machineFitsRole,
  newMachineSummary,
} from '../lib/machines';
import {
  MACHINE_TYPE,
  ROLES,
  SERVICE,
  WAGE_BASIS_LABEL,
  dayFrom,
  dayWorked,
  machineTypeForRole,
  monthFrom,
  nameOf,
  serviceNextLabel,
  type Day,
  type Machine,
  type MachineDetails,
  type Person,
  type ServiceTask,
  type StoreItem,
  type WageBasis,
} from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

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
 * Puts the meter reading a service next falls due at where staff say. A
 * machine whose 10,000 hour service was never set up has nothing to count down
 * to until this is done; and a machine whose last service was at some other
 * reading than the cycle assumes is put right the same way.
 */
export async function setServiceDue(machine: Machine, task: ServiceTask, dueAt: number, by: Person): Promise<void> {
  if (!Number.isFinite(dueAt) || dueAt < 0) throw new Error('මීටර් පැය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.');
  const before = machine.serviceDueAt[task];
  if (before === dueAt) return;

  const batch = writeBatch(db);
  batch.update(doc(db, 'machines', machine.id), { [`serviceDueAt.${task}`]: dueAt });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'service.set',
      'machine',
      machine.id,
      machine.id,
      `${SERVICE[task].short}: ${serviceNextLabel(task)} ${before == null ? '—' : hours(before)} → ${hours(dueAt)}`,
      by,
    ),
  );
  await commit(batch);
}

// ---- the machine registry ------------------------------------------------------

/**
 * A machine's first record: its details, the meter it counts from, and — for
 * the parts its crew service — each one due an interval on from that meter.
 * Shared with the account form, which sets a machine up when its first
 * crew member is put on it.
 */
export function newMachineRecord(details: MachineDetails, meterHours: number) {
  const crewRole = ROLES[MACHINE_TYPE[details.type].role];
  return {
    ...cleanDetails(details),
    totalHours: meterHours,
    serviceDueAt: Object.fromEntries(crewRole.serviceTasks.map((task) => [task, meterHours + SERVICE[task].interval])),
  };
}

/**
 * Sets up a machine. In a transaction that looks first: a number already
 * taken is refused, because writing over it would reset that machine's hour
 * meter (the rules cannot tell the two apart — to them it is a staff update).
 */
export async function createMachine(
  id: string,
  details: MachineDetails,
  meterHours: number,
  by: Person,
): Promise<void> {
  const number = id.trim();
  if (!MACHINE_ID_PATTERN.test(number)) {
    throw new Error('යන්ත්‍ර අංකය අකුරු, ඉලක්කම්, - සහ _ පමණක් විය යුතුය (උදා: excavator-01).');
  }
  if (!Number.isFinite(meterHours) || meterHours < 0) throw new Error('මීටර් පැය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.');
  const problem = detailsError(details);
  if (problem) throw new Error(problem);

  const ref = doc(db, 'machines', number);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new Error(`${number} යන්ත්‍ර අංකය දැනටමත් භාවිතා වේ.`);
    tx.set(ref, newMachineRecord(details, meterHours));
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('machine.create', 'machine', number, number, newMachineSummary(details, meterHours), by),
    );
  });
}

/**
 * Puts a machine's details right. Its kind is fixed once it has one — the
 * rules insist, as its crew, its service parts and its history were all set
 * up for that kind — and a machine whose kind is still open takes the kind of
 * the [crew] already on it.
 */
export async function updateMachine(
  machine: Machine,
  details: MachineDetails,
  crew: readonly Person[],
  by: Person,
): Promise<void> {
  const problem = detailsError(details);
  if (problem) throw new Error(problem);
  if (machine.type && details.type !== machine.type) {
    throw new Error('යන්ත්‍රයක වර්ගය එක් වරක් තෝරා පසු වෙනස් කළ නොහැක.');
  }
  if (crew.some((person) => machineTypeForRole(person.role) !== details.type)) {
    throw new Error(`මෙම යන්ත්‍රයේ ඇත්තේ ${MACHINE_TYPE[details.type].label} නොවන කණ්ඩායමකි.`);
  }

  const summary = machineDiff(machine, details);
  if (summary === 'වෙනසක් නැත') return;

  const batch = writeBatch(db);
  batch.update(doc(db, 'machines', machine.id), { ...cleanDetails(details) });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.update', 'machine', machine.id, machine.id, summary, by),
  );
  await commit(batch);
}

/**
 * Puts a crew member on [machine]. Only a machine in use, and of their kind;
 * the hours they work from here on go to it, while the ones already worked
 * stay with the machine they were worked on.
 */
export async function assignMachine(
  person: Person,
  machine: Machine,
  people: readonly Person[],
  by: Person,
): Promise<void> {
  if (!ROLES[person.role].isCrew) throw new Error('යන්ත්‍රයකට යෙදිය හැක්කේ කණ්ඩායම් සාමාජිකයෙකු පමණි.');
  if (person.machineId === machine.id) return;
  if (!machine.active) throw new Error(`${machine.id} දැනට ක්‍රියාත්මක නොවේ.`);
  if (!machineFitsRole(machine, person.role, people)) {
    throw new Error(`${ROLES[person.role].label} කෙනෙකුට මෙම යන්ත්‍රයට යෙදිය නොහැක.`);
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'operators', person.id), { machineId: machine.id });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.assign', 'operator', person.id, nameOf(person), assignSummary(person.machineId, machine.id), by),
  );
  await commit(batch);
}

/** Every month a machine has a record for — the hours it worked in each, as they were closed. */
export function useMachineMonths(machineId: string | null) {
  return useLiveQuery(
    machineId ? `machine-months:${machineId}` : null,
    () => collection(db, 'machines', machineId ?? '-', 'months'),
    (snapshot) => monthFrom(snapshot.id, snapshot.data()),
  );
}

/** A machine's days in [month] (`yyyy-MM`), for the hours each worked. */
export function useMachineDays(machineId: string | null, month: string) {
  const { from, to } = monthBounds(month);
  return useLiveQuery(
    machineId ? `machine-days:${machineId}:${month}` : null,
    () =>
      query(
        collection(db, 'machines', machineId ?? '-', 'days'),
        where('date', '>=', from),
        where('date', '<=', to),
      ),
    (snapshot) => dayFrom(snapshot.id, snapshot.data()),
  );
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
