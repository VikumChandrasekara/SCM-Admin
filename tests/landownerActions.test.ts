import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveLandownerRate } from '../src/data/landowner';
import { currentRate, landownerRateFrom } from '../src/lib/landowner';
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

// The panel's write queue times itself with `window`, which node does not have.
vi.stubGlobal('window', globalThis);

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
const operator = person('op1', 'operator', 'ex1');

function signIn(uid: string) {
  session.db = env.authenticatedContext(uid).firestore();
  return session.db as Firestore;
}

/** Reads straight from the database, past the rules. */
async function direct<T>(work: (db: Firestore) => Promise<T>): Promise<T> {
  // withSecurityRulesDisabled hands nothing back, so the result is carried out.
  let result!: T;
  await env.withSecurityRulesDisabled(async (context) => {
    result = await work(context.firestore() as unknown as Firestore);
  });
  return result;
}

const history = () =>
  direct(async (db) =>
    (await getDocs(collection(db, 'landownerRates'))).docs.map((entry) => landownerRateFrom(entry.id, entry.data())),
  );
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
  });
});

describe('setting the landowner figure', () => {
  it('records each change as its own entry — who, when, from what to what — and logs it', async () => {
    signIn('sup1');
    await saveLandownerRate(500, null, supervisor);
    signIn('admin1');
    await saveLandownerRate(800, 500, admin);

    const entries = (await history()).sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    expect(entries.map(({ rate, previousRate, setBy, setByName }) => ({ rate, previousRate, setBy, setByName }))).toEqual([
      { rate: 500, previousRate: null, setBy: 'sup1', setByName: 'sup1' },
      { rate: 800, previousRate: 500, setBy: 'admin1', setByName: 'admin1' },
    ]);
    // Stamped by the server, with a date and a time.
    expect(entries.every((entry) => entry.at instanceof Date && !Number.isNaN(entry.at.getTime()))).toBe(true);
    expect(currentRate(entries)).toBe(800);

    const log = await auditLog();
    expect(log).toHaveLength(2);
    expect(log.map((entry) => entry.summary).sort()).toEqual(
      ['ලෝඩ් එකකට රු.500 (පළමු වතාව)', 'ලෝඩ් එකකට රු.500 → රු.800'].sort(),
    );
    expect(log.every((entry) => entry.action === 'landowner.rate' && entry.source === 'panel')).toBe(true);
  });

  it('is refused for the crew, and a past entry can be neither changed nor removed', async () => {
    signIn('op1');
    await assertFails(saveLandownerRate(500, null, operator));
    expect(await history()).toHaveLength(0);

    const staff = signIn('sup1');
    await saveLandownerRate(500, null, supervisor);
    const [entry] = await history();
    await assertFails(updateDoc(doc(staff, 'landownerRates', entry.id), { rate: 1 }));
    await assertFails(deleteDoc(doc(staff, 'landownerRates', entry.id)));
    expect(await history()).toHaveLength(1);
  });
});
