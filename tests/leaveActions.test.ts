import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { markLeaveWorked } from '../src/data/machines';
import type { Person } from '../src/lib/model';

// The panel's own `db`, swapped for a connection that goes through
// firestore.rules in the emulator as whoever is signed in — so what is run
// here is the code the admin panel runs, held to the rules a real client is.
const session = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../src/db', () => ({
  get db() {
    return session.db;
  },
}));

const rulesPath =
  process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));

let env: RulesTestEnvironment;

const person = (id: string, role: Person['role'], machineId = ''): Person => ({
  id,
  name: id,
  username: id,
  machineId,
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
});
const admin = person('admin1', 'admin');
const supervisor = person('sup1', 'supervisor');
/** The crew member whose leave day is being marked. */
const crew = person('op1', 'operator', 'ex1');

function signIn(uid: string) {
  session.db = env.authenticatedContext(uid).firestore();
}

// The panel's write queue times itself with `window`, which node does not have.
vi.stubGlobal('window', globalThis);

/** Reads and writes straight to the database, past the rules. */
async function direct<T>(work: (db: Firestore) => Promise<T>): Promise<T> {
  // withSecurityRulesDisabled hands nothing back, so the result is carried out.
  let result!: T;
  await env.withSecurityRulesDisabled(async (context) => {
    result = await work(context.firestore() as unknown as Firestore);
  });
  return result;
}

const data = (path: string) =>
  direct(async (db) => {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? snapshot.data() : undefined;
  });

const auditLog = () =>
  direct(async (db) => (await getDocs(collection(db, 'auditLog'))).docs.map((entry) => entry.data()));

/** A day the crew started: ON in slot 1, OK'd, and closed by the next morning's ON when [closing] is given. */
const workedDay = (date: string, on: number, closing?: number) =>
  direct((db) =>
    setDoc(doc(db, 'machines', 'ex1', 'days', date), {
      date,
      fillings: { '1': { onHours: on, offHours: null, amounts: { diesel: 40 }, lockedAt: `${date}T07:00:00.000Z` } },
      ...(closing == null ? {} : { closingHours: closing }),
    }),
  );

const month = (key: string, hours: number) =>
  direct((db) => setDoc(doc(db, 'machines', 'ex1', 'months', key), { month: key, hours }));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scm',
    firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await direct(async (db) => {
    await setDoc(doc(db, 'operators', 'admin1'), { name: 'Pivithuru', role: 'admin', machineId: '' });
    await setDoc(doc(db, 'operators', 'sup1'), { name: 'Nimal', role: 'supervisor', machineId: '' });
    await setDoc(doc(db, 'operators', 'op1'), { name: 'Kamal', role: 'operator', machineId: 'ex1' });
    await setDoc(doc(db, 'machines', 'ex1'), { totalHours: 6716, serviceDueAt: {} });
  });
});

describe('marking a leave day worked, with its ON meter', () => {
  it('enters the ON, closes the day before and this one, and adds both days’ hours to the month', async () => {
    await workedDay('2026-10-03', 6700);
    await workedDay('2026-10-05', 6716);
    await month('2026-10', 100);
    signIn('sup1');

    await markLeaveWorked(crew, '2026-10-04', supervisor, 6708);

    expect(await data('machines/ex1/days/2026-10-04')).toMatchObject({
      date: '2026-10-04',
      fillings: { '1': { onHours: 6708 } },
      closingHours: 6716,
    });
    expect(await data('machines/ex1/days/2026-10-03')).toMatchObject({ closingHours: 6708 });
    // 6700 → 6708 and 6708 → 6716: eight hours each.
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 116 });
    // The meter is already past it: an earlier day never winds it back.
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6716 });

    const [entry, ...rest] = await auditLog();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'leave.workday', entityId: 'op1', createdBy: 'sup1' });
    expect(entry.summary).toContain('ON');
  });

  it('moves the machine’s meter up when the day is the newest', async () => {
    await workedDay('2026-10-05', 6716);
    await month('2026-10', 100);
    signIn('admin1');

    await markLeaveWorked(crew, '2026-10-06', admin, 6720);

    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6720 });
    expect(await data('machines/ex1/days/2026-10-05')).toMatchObject({ closingHours: 6720 });
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 104 });
    // Nothing after it to close it yet — the next morning's ON will.
    expect((await data('machines/ex1/days/2026-10-06'))?.closingHours).toBeUndefined();
  });

  it('puts the day before’s hours in its own month across a month end', async () => {
    await workedDay('2026-10-31', 6700);
    await month('2026-10', 100);
    signIn('sup1');

    await markLeaveWorked(crew, '2026-11-01', supervisor, 6708);

    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 108 });
    expect(await data('machines/ex1/months/2026-11')).toBeUndefined();
  });

  it('refuses a reading its neighbours rule out, and writes nothing', async () => {
    await workedDay('2026-10-03', 6700, 6710);
    await workedDay('2026-10-05', 6716);
    await month('2026-10', 100);
    signIn('sup1');

    await expect(markLeaveWorked(crew, '2026-10-04', supervisor, 6705)).rejects.toThrow('6710');
    await expect(markLeaveWorked(crew, '2026-10-04', supervisor, 6720)).rejects.toThrow('6716');
    await expect(markLeaveWorked(crew, '2026-10-04', supervisor, -1)).rejects.toThrow();

    expect(await data('machines/ex1/days/2026-10-04')).toBeUndefined();
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 100 });
    expect(await auditLog()).toEqual([]);
  });

  it('refuses a day already worked, so a repeat never adds the hours twice', async () => {
    await workedDay('2026-10-03', 6700);
    await month('2026-10', 100);
    signIn('sup1');

    await markLeaveWorked(crew, '2026-10-04', supervisor, 6708);
    await expect(markLeaveWorked(crew, '2026-10-04', supervisor, 6708)).rejects.toThrow('දැනටමත්');
    await expect(markLeaveWorked(crew, '2026-10-04', supervisor)).rejects.toThrow('දැනටමත්');

    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 108 });
    expect(await auditLog()).toHaveLength(1);
  });
});

describe('marking a leave day worked, without a meter', () => {
  it('only marks the day, and leaves the meter and the month’s hours alone', async () => {
    await workedDay('2026-10-03', 6700);
    await month('2026-10', 100);
    signIn('sup1');

    await markLeaveWorked(crew, '2026-10-04', supervisor);

    expect(await data('machines/ex1/days/2026-10-04')).toEqual({ date: '2026-10-04', workedManually: true });
    expect((await data('machines/ex1/days/2026-10-03'))?.closingHours).toBeUndefined();
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 100 });
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6716 });
    expect(await auditLog()).toHaveLength(1);
  });
});
