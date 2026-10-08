import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { markLandownerPaid, saveLandownerRates, unmarkLandownerPaid } from '../src/data/landowner';
import {
  currentRates,
  landownerPaymentFrom,
  landownerRateFrom,
  type LandownerShare,
  type MaterialRates,
} from '../src/lib/landowner';
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
const payment = (month: string) =>
  direct(async (db) => {
    const snapshot = await getDoc(doc(db, 'landownerPayments', month));
    return snapshot.exists() ? landownerPaymentFrom(snapshot.id, snapshot.data()) : undefined;
  });
const auditLog = () =>
  direct(async (db) => (await getDocs(collection(db, 'auditLog'))).docs.map((entry) => entry.data()));

const figures = (six_nine: number, sakka: number, kory_dust: number): MaterialRates => ({ six_nine, sakka, kory_dust });

const share: LandownerShare = {
  loads: 5,
  amount: 2400,
  byMaterial: {
    six_nine: { loads: 2, amount: 1300 },
    sakka: { loads: 2, amount: 800 },
    kory_dust: { loads: 1, amount: 300 },
  },
};

/** A signature the way the pad writes one. */
const signature = `M20 100${Array.from({ length: 60 }, (_, index) => `L${20 + index * 8} ${100 + (index % 7) * 5}`).join('')}`;

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

describe('setting the landowner figures', () => {
  it('records each change as its own entry — who, when, from what to what — and logs only what moved', async () => {
    signIn('sup1');
    await saveLandownerRates(figures(500, 400, 300), null, supervisor);
    signIn('admin1');
    await saveLandownerRates(figures(800, 400, 300), figures(500, 400, 300), admin);

    const entries = (await history()).sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    expect(entries.map(({ rates, previousRates, setBy }) => ({ rates, previousRates, setBy }))).toEqual([
      { rates: figures(500, 400, 300), previousRates: null, setBy: 'sup1' },
      { rates: figures(800, 400, 300), previousRates: figures(500, 400, 300), setBy: 'admin1' },
    ]);
    // Stamped by the server, with a date and a time.
    expect(entries.every((entry) => entry.at instanceof Date && !Number.isNaN(entry.at.getTime()))).toBe(true);
    expect(currentRates(entries)).toEqual(figures(800, 400, 300));

    const log = await auditLog();
    expect(log.map((entry) => entry.summary).sort()).toEqual(
      ['6/9 රු.500 → රු.800', '6/9 රු.500 · සක්කර රු.400 · කෝරි ඩස්ට් රු.300 (පළමු වතාව)'].sort(),
    );
    expect(log.every((entry) => entry.action === 'landowner.rate' && entry.source === 'panel')).toBe(true);
  });

  it('is refused for the crew, and a past entry can be neither changed nor removed', async () => {
    signIn('op1');
    await assertFails(saveLandownerRates(figures(500, 400, 300), null, operator));
    expect(await history()).toHaveLength(0);

    const staff = signIn('sup1');
    await saveLandownerRates(figures(500, 400, 300), null, supervisor);
    const [entry] = await history();
    await assertFails(updateDoc(doc(staff, 'landownerRates', entry.id), { 'rates.sakka': 1 }));
    await assertFails(deleteDoc(doc(staff, 'landownerRates', entry.id)));
    expect(await history()).toHaveLength(1);
  });
});

describe('marking a month paid', () => {
  it('keeps the amount, who confirmed it and the signature, stamped and logged', async () => {
    signIn('sup1');
    await markLandownerPaid('2026-10', share, '  Kasun  ', signature, supervisor);

    const stored = await payment('2026-10');
    expect(stored).toMatchObject({
      month: '2026-10',
      amount: 2400,
      loads: 5,
      confirmedName: 'Kasun',
      signature,
      markedBy: 'sup1',
    });
    expect(stored?.byMaterial.six_nine).toEqual({ loads: 2, amount: 1300 });
    expect(stored?.paidAt instanceof Date).toBe(true);

    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'landowner.paid', entityId: '2026-10', source: 'panel' });
    expect(entry.summary).toBe('2026-10 · රු.2400 · ලෝඩ් 5 · තහවුරු කළේ Kasun');
  });

  it('is once for a month, needs a name and a drawn signature, and is not for the crew', async () => {
    signIn('sup1');
    await markLandownerPaid('2026-10', share, 'Kasun', signature, supervisor);
    // A second mark would overwrite the first, so it is refused.
    await assertFails(markLandownerPaid('2026-10', share, 'Other', signature, supervisor));
    expect((await payment('2026-10'))?.confirmedName).toBe('Kasun');

    await assertFails(markLandownerPaid('2026-09', share, '', signature, supervisor));
    await assertFails(markLandownerPaid('2026-09', share, 'Kasun', '', supervisor));
    await assertFails(markLandownerPaid('2026-09', share, 'Kasun', 'M1 1<script>', supervisor));
    await assertFails(markLandownerPaid('october', share, 'Kasun', signature, supervisor));
    expect(await payment('2026-09')).toBeUndefined();

    signIn('op1');
    await assertFails(markLandownerPaid('2026-09', share, 'Kasun', signature, operator));
  });

  it('can be taken back by the admin only, and the log keeps what it said', async () => {
    const staff = signIn('sup1');
    await markLandownerPaid('2026-10', share, 'Kasun', signature, supervisor);
    const marked = (await payment('2026-10'))!;

    await assertFails(updateDoc(doc(staff, 'landownerPayments', '2026-10'), { amount: 1 }));
    await assertFails(unmarkLandownerPaid(marked, supervisor));
    expect(await payment('2026-10')).toBeDefined();

    signIn('admin1');
    await unmarkLandownerPaid(marked, admin);
    expect(await payment('2026-10')).toBeUndefined();
    const log = await auditLog();
    expect(log.map((entry) => entry.action).sort()).toEqual(['landowner.paid', 'landowner.unpaid']);
    expect(log.find((entry) => entry.action === 'landowner.unpaid')?.summary).toBe(
      '2026-10 · රු.2400 ගෙවූ බව ඉවත් කළා (තහවුරු කළේ Kasun)',
    );
  });
});
