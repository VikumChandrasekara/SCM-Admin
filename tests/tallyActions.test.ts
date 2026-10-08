import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveTally } from '../src/data/machines';
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
/** An excavator operator, tallied in loads. */
const operator = person('op1', 'operator', 'ex1');
/** A compressor driller, tallied in feet. */
const driller = person('comp1', 'compressor', 'cp1');

function signIn(uid: string) {
  session.db = env.authenticatedContext(uid).firestore();
}

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
    await setDoc(doc(db, 'operators', 'comp1'), { name: 'Ruwan', role: 'compressor', machineId: 'cp1' });
    await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-10-05'), { date: '2026-10-05', loads: 12 });
    await setDoc(doc(db, 'machines', 'ex1', 'months', '2026-10'), { month: '2026-10', loads: 100 });
    await setDoc(doc(db, 'machines', 'cp1', 'days', '2026-10-05'), { date: '2026-10-05', feet: 40 });
    await setDoc(doc(db, 'machines', 'cp1', 'months', '2026-10'), { month: '2026-10', feet: 400 });
  });
});

describe("a crew member's ලෝඩ් and අඩි", () => {
  it('are raised and lowered by the admin, the month following by the difference', async () => {
    signIn('admin1');

    await saveTally('ex1', '2026-10-05', 'loads', 13, operator, admin);
    expect(await data('machines/ex1/days/2026-10-05')).toMatchObject({ loads: 13 });
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 101 });

    await saveTally('ex1', '2026-10-05', 'loads', 9, operator, admin);
    expect(await data('machines/ex1/days/2026-10-05')).toMatchObject({ loads: 9 });
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 97 });

    // Part-feet are real: a hole is not always drilled to a round number.
    await saveTally('cp1', '2026-10-05', 'feet', 41.5, driller, admin);
    expect(await data('machines/cp1/days/2026-10-05')).toMatchObject({ feet: 41.5 });
    expect(await data('machines/cp1/months/2026-10')).toMatchObject({ feet: 401.5 });

    const entries = await auditLog();
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.action === 'tally.set' && entry.createdBy === 'admin1')).toBe(true);
  });

  it('are the supervisor’s to change as well, and never the crew’s own', async () => {
    signIn('sup1');
    await saveTally('ex1', '2026-10-05', 'loads', 20, operator, supervisor);
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 108 });

    signIn('op1');
    await expect(saveTally('ex1', '2026-10-05', 'loads', 99, operator, operator)).rejects.toThrow();
    signIn('comp1');
    await expect(saveTally('cp1', '2026-10-05', 'feet', 99, driller, driller)).rejects.toThrow();

    expect(await data('machines/ex1/days/2026-10-05')).toMatchObject({ loads: 20 });
    expect(await data('machines/cp1/days/2026-10-05')).toMatchObject({ feet: 40 });
  });

  it('count a day the crew never opened, from nothing', async () => {
    signIn('admin1');
    await saveTally('ex1', '2026-10-06', 'loads', 1, operator, admin);
    expect(await data('machines/ex1/days/2026-10-06')).toMatchObject({ date: '2026-10-06', loads: 1 });
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 101 });

    // The same figure again moves nothing and is not logged twice.
    await saveTally('ex1', '2026-10-06', 'loads', 1, operator, admin);
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 101 });
    expect(await auditLog()).toHaveLength(1);
  });
});
