import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteBill } from '../src/data/bills';
import { purgeExpiredBin, restoreEntry } from '../src/data/recycle';
import { deleteSale } from '../src/data/sales';
import { deleteItem } from '../src/data/store';
import { removeAccount } from '../src/data/users';
import { billFrom, type Person, type StoreItem } from '../src/lib/model';
import { binEntryFrom, binId } from '../src/lib/recycle';

// The panel's own `db`, swapped for a connection that goes through
// firestore.rules in the emulator as whoever is signed in — so what is run
// here is the code the admin panel runs, held to the rules a real client is.
const session = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../src/db', () => ({
  get db() {
    return session.db;
  },
}));
// Accounts sign in to Auth elsewhere; none of that is under test here.
vi.mock('../src/firebase', () => ({
  emailFor: (username: string) => `${username}@scm-operators.local`,
  provisioningAuth: () => {
    throw new Error('no login in these tests');
  },
  usingEmulators: true,
}));
// The panel's write queue times itself with `window`, which node does not have.
vi.stubGlobal('window', globalThis);

const rulesPath =
  process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));

let env: RulesTestEnvironment;

const person = (id: string, role: Person['role'], overrides: Partial<Person> = {}): Person => ({
  id,
  name: id,
  username: id,
  machineId: '',
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
  ...overrides,
});
const admin = person('admin1', 'admin');
const supervisor = person('sup1', 'supervisor');

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

const all = (path: string) =>
  direct(async (db) => (await getDocs(collection(db, path))).docs.map((entry) => entry.data()));

/** The bin entry for what was deleted, as the page reads it. */
async function binned(kind: 'bill' | 'sale' | 'store' | 'operator', docId: string) {
  const raw = await data(`recycleBin/${binId(kind, docId)}`);
  if (!raw) throw new Error(`nothing binned for ${kind} ${docId}`);
  return binEntryFrom(binId(kind, docId), raw);
}

const codeOf = (number: number) => `BLK${'ABCDE'[number - 1]}2345`;

const sale = (number: number) => ({
  code: codeOf(number),
  type: 'tipper',
  quantity: 3,
  unitPrice: 6500,
  amount: 19500,
  customerName: 'Silva',
  customerKey: 'silva',
  material: 'sakka',
  paymentType: 'cash',
  machineCharge: 4000,
  customerPhone: '',
  vehicleNo: 'WP 1234',
  note: '',
  date: '2026-09-13',
  number,
  status: 'verified',
  createdBy: 'sup1',
  createdByName: 'sup1',
  createdAt: Timestamp.now(),
  verifiedBy: 'sup1',
  verifiedByName: 'sup1',
  verifiedAt: Timestamp.now(),
});

/** Bills 1…[count] of September, written the way the apps write them. */
function seedBills(count: number, by = 'sup1') {
  return direct(async (db) => {
    for (let number = 1; number <= count; number++) {
      await setDoc(doc(db, 'sales', codeOf(number)), { ...sale(number), createdBy: by });
      await setDoc(doc(db, 'saleIndex', `2026-09-${number}`), { code: codeOf(number) });
    }
    await setDoc(doc(db, 'saleCounters', '2026-09'), { last: count, lastCode: codeOf(count) });
  });
}

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
    await setDoc(doc(db, 'operators', 'op1'), {
      name: 'Kamal',
      role: 'operator',
      machineId: 'ex1',
      advanceAmount: 10000,
    });
  });
});

describe('a deleted bill', () => {
  const advance = {
    category: 'advance',
    amount: 3000,
    date: '2026-10-05',
    note: 'monthly',
    operatorId: 'op1',
    operatorName: 'Kamal',
    createdBy: 'sup1',
    createdByName: 'sup1',
    createdAt: Timestamp.now(),
  };
  const crew = new Map([['op1', person('op1', 'operator', { machineId: 'ex1', advanceAmount: 10000 })]]);

  it('goes to the bin whole, takes the advance off, and comes back with it', async () => {
    await direct((db) => setDoc(doc(db, 'bills', 'b1'), advance));
    signIn('admin1');

    await deleteBill(billFrom('b1', advance), crew, admin);
    expect(await data('bills/b1')).toBeUndefined();
    expect((await data('recycleBin/bill__b1'))?.data).toEqual(advance);
    expect(await data('operators/op1')).toMatchObject({ advanceAmount: 7000 });

    await restoreEntry(await binned('bill', 'b1'), admin);
    expect(await data('bills/b1')).toEqual(advance);
    expect(await data('recycleBin/bill__b1')).toBeUndefined();
    expect(await data('operators/op1')).toMatchObject({ advanceAmount: 10000 });

    const actions = (await all('auditLog')).map((entry) => entry.action).sort();
    expect(actions).toEqual(['bill.delete', 'bill.restore']);
  });

  it('is put back by the admin, or by the supervisor who wrote it — never twice, and not over another with its id', async () => {
    await direct((db) => setDoc(doc(db, 'bills', 'b1'), advance));
    signIn('sup1');
    // A supervisor deletes their own bill — and takes it back, advance and all.
    await deleteBill(billFrom('b1', advance), crew, supervisor);
    const entry = await binned('bill', 'b1');
    expect(await data('operators/op1')).toMatchObject({ advanceAmount: 7000 });
    await restoreEntry(entry, supervisor);
    expect(await data('bills/b1')).toEqual(advance);
    expect(await data('operators/op1')).toMatchObject({ advanceAmount: 10000 });
    await expect(restoreEntry(entry, supervisor)).rejects.toThrow('දැනටමත්');

    // A bill someone else wrote is the admin's to take back, not the supervisor's.
    const others = { ...advance, createdBy: 'admin1' };
    await direct((db) => setDoc(doc(db, 'bills', 'b3'), others));
    signIn('admin1');
    await deleteBill(billFrom('b3', others), crew, admin);
    const theirs = await binned('bill', 'b3');
    signIn('sup1');
    await expect(restoreEntry(theirs, supervisor)).rejects.toThrow();
    expect(await data('bills/b3')).toBeUndefined();
    signIn('admin1');
    await restoreEntry(theirs, admin);
    expect(await data('bills/b3')).toEqual(others);
    expect(await data('operators/op1')).toMatchObject({ advanceAmount: 10000 });

    // Something else has taken the id since: the entry is kept, not forced over it.
    await direct((db) => setDoc(doc(db, 'bills', 'b2'), { ...advance, note: 'other' }));
    signIn('sup1');
    await deleteBill(billFrom('b2', advance), crew, supervisor);
    await direct((db) => setDoc(doc(db, 'bills', 'b2'), { ...advance, note: 'new one' }));
    signIn('admin1');
    await expect(restoreEntry(await binned('bill', 'b2'), admin)).rejects.toThrow('වෙනත් වාර්තාවක්');
    expect(await data('bills/b2')).toMatchObject({ note: 'new one' });
  });
});

describe('what the phone wrote', () => {
  // The Flutter app writes every number as a double — 500.0, where the panel
  // writes 500 — and the rules compare the bin's copy with the original field
  // for field. Seeded here through the emulator's REST API, which keeps a
  // double a double.
  async function writeLikeThePhone(path: string, fields: Record<string, unknown>) {
    const encode = (value: unknown): object => {
      if (value === null) return { nullValue: null };
      if (typeof value === 'number') return { doubleValue: value };
      if (typeof value === 'boolean') return { booleanValue: value };
      if (value instanceof Date) return { timestampValue: value.toISOString() };
      return { stringValue: String(value) };
    };
    const body = { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) };
    const response = await fetch(
      `http://127.0.0.1:8080/v1/projects/demo-scm/databases/(default)/documents/${path}`,
      { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    if (!response.ok) throw new Error(`seeding ${path}: ${response.status} ${await response.text()}`);
  }

  it('a bill with doubles goes to the bin and comes back as it was', async () => {
    const fields = {
      category: 'food',
      amount: 500,
      date: '2026-10-05',
      note: 'lunch',
      operatorId: null,
      operatorName: null,
      createdByName: 'sup1',
      createdBy: 'sup1',
      createdAt: new Date('2026-10-05T06:00:00Z'),
      updatedAt: new Date('2026-10-05T06:00:00Z'),
    };
    await writeLikeThePhone('bills/phone1', fields);
    signIn('sup1');

    await deleteBill(billFrom('phone1', fields), new Map(), supervisor);
    expect(await data('bills/phone1')).toBeUndefined();
    expect(await data('recycleBin/bill__phone1')).toBeDefined();

    await restoreEntry(await binned('bill', 'phone1'), supervisor);
    expect(await data('bills/phone1')).toMatchObject({ category: 'food', amount: 500, note: 'lunch' });
    expect(await data('recycleBin/bill__phone1')).toBeUndefined();
  });

  it('a store item with doubles does too', async () => {
    const fields = {
      name: 'Grease',
      unit: 'kg',
      quantity: 10,
      minQuantity: 2,
      unitPrice: 1200,
      updatedAt: new Date('2026-10-05T06:00:00Z'),
      updatedBy: 'sup1',
    };
    await writeLikeThePhone('store/phone-item', fields);
    signIn('sup1');

    const item = { id: 'phone-item', name: 'Grease', unit: 'kg', quantity: 10, unitPrice: 1200 } as StoreItem;
    await deleteItem(item, supervisor);
    expect(await data('store/phone-item')).toBeUndefined();

    await restoreEntry(await binned('store', 'phone-item'), supervisor);
    expect(await data('store/phone-item')).toMatchObject({ name: 'Grease', quantity: 10 });
  });
});

describe('a deleted sale', () => {
  it('goes to the bin whole and comes back with its invoice number', async () => {
    await seedBills(3, 'admin1');
    signIn('admin1');

    expect(await deleteSale(codeOf(3), admin)).toBe(3);
    expect(await data(`sales/${codeOf(3)}`)).toBeUndefined();
    expect((await binned('sale', codeOf(3))).data).toMatchObject({ number: 3, amount: 19500 });
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: codeOf(2) });

    // A bill the admin wrote is not the supervisor's to put back.
    signIn('sup1');
    await expect(restoreEntry(await binned('sale', codeOf(3)), supervisor)).rejects.toThrow();
    expect(await data(`sales/${codeOf(3)}`)).toBeUndefined();

    signIn('admin1');
    await restoreEntry(await binned('sale', codeOf(3)), admin);
    expect(await data(`sales/${codeOf(3)}`)).toMatchObject({ number: 3, status: 'verified', amount: 19500 });
    expect(await data('saleIndex/2026-09-3')).toEqual({ code: codeOf(3) });
    expect(await data('saleCounters/2026-09')).toEqual({ last: 3, lastCode: codeOf(3) });
    expect(await data(`recycleBin/${binId('sale', codeOf(3))}`)).toBeUndefined();
  });

  it('a supervisor takes back a bill they wrote, number and all', async () => {
    await seedBills(2, 'sup1');
    signIn('sup1');

    expect(await deleteSale(codeOf(2), supervisor)).toBe(2);
    await restoreEntry(await binned('sale', codeOf(2)), supervisor);

    expect(await data(`sales/${codeOf(2)}`)).toMatchObject({ number: 2, createdBy: 'sup1' });
    expect(await data('saleIndex/2026-09-2')).toEqual({ code: codeOf(2) });
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: codeOf(2) });
  });

  it('a bill from the middle comes back to its own empty number, the count untouched', async () => {
    await seedBills(3);
    signIn('admin1');

    await deleteSale(codeOf(2), admin);
    await restoreEntry(await binned('sale', codeOf(2)), admin);

    expect(await data(`sales/${codeOf(2)}`)).toMatchObject({ number: 2 });
    expect(await data('saleIndex/2026-09-2')).toEqual({ code: codeOf(2) });
    expect(await data('saleCounters/2026-09')).toEqual({ last: 3, lastCode: codeOf(3) });
  });

  it('waits for the bills before it, and for nobody else to have its number', async () => {
    await seedBills(3);
    signIn('admin1');
    // Newest first, so the count winds back to 1.
    await deleteSale(codeOf(3), admin);
    await deleteSale(codeOf(2), admin);
    expect(await data('saleCounters/2026-09')).toMatchObject({ last: 1 });

    await expect(restoreEntry(await binned('sale', codeOf(3)), admin)).rejects.toThrow('002');
    expect(await data(`sales/${codeOf(3)}`)).toBeUndefined();

    await restoreEntry(await binned('sale', codeOf(2)), admin);
    await restoreEntry(await binned('sale', codeOf(3)), admin);
    expect(await data('saleCounters/2026-09')).toEqual({ last: 3, lastCode: codeOf(3) });

    // A number handed to a new bill while this one was in the bin is not taken back.
    await deleteSale(codeOf(3), admin);
    await direct(async (db) => {
      await setDoc(doc(db, 'sales', 'NEWA2345'), { ...sale(3), code: 'NEWA2345' });
      await setDoc(doc(db, 'saleIndex', '2026-09-3'), { code: 'NEWA2345' });
      await setDoc(doc(db, 'saleCounters', '2026-09'), { last: 3, lastCode: 'NEWA2345' });
    });
    await expect(restoreEntry(await binned('sale', codeOf(3)), admin)).rejects.toThrow('වෙනත් බිල්පතකට');
    expect(await data(`sales/${codeOf(3)}`)).toBeUndefined();
  });
});

describe('a deleted store item', () => {
  const grease = {
    name: 'Grease',
    unit: 'kg',
    quantity: 10,
    minQuantity: 2,
    unitPrice: 1200,
    link: null,
    note: '',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    updatedBy: 'admin1',
  };
  const item = { id: 'i1', name: 'Grease', unit: 'kg', quantity: 10, unitPrice: 1200 } as StoreItem;

  it('goes to the bin with its count, and comes back with it, both in the count log', async () => {
    await direct((db) => setDoc(doc(db, 'store', 'i1'), grease));
    signIn('sup1');

    await deleteItem(item, supervisor);
    expect(await data('store/i1')).toBeUndefined();
    expect((await data('recycleBin/store__i1'))?.data).toEqual(grease);

    // A supervisor takes back the item they deleted.
    await restoreEntry(await binned('store', 'i1'), supervisor);
    expect(await data('store/i1')).toEqual(grease);
    expect(await data('recycleBin/store__i1')).toBeUndefined();

    const log = (await all('storeMovements')).map((entry) => [entry.type, entry.items[0].delta]);
    expect(log).toContainEqual(['delete', -10]);
    expect(log).toContainEqual(['create', 10]);
  });
});

describe('a removed account', () => {
  const ruwan = {
    name: 'Ruwan',
    username: 'ruwan',
    role: 'compressor',
    machineId: 'cp1',
    advanceAmount: 0,
    dailyWage: 250,
    wageBasis: 'foot',
  };

  it('keeps its record in the bin, and comes back with its access', async () => {
    await direct((db) => setDoc(doc(db, 'operators', 'u2'), ruwan));
    signIn('admin1');

    await removeAccount(person('u2', 'compressor', { name: 'Ruwan', username: 'ruwan', machineId: 'cp1' }), null, admin);
    expect(await data('operators/u2')).toBeUndefined();
    expect((await data('recycleBin/operator__u2'))?.data).toEqual(ruwan);

    // Accounts are the admin's too.
    signIn('sup1');
    await expect(restoreEntry(await binned('operator', 'u2'), supervisor)).rejects.toThrow();
    expect(await data('operators/u2')).toBeUndefined();

    signIn('admin1');
    await restoreEntry(await binned('operator', 'u2'), admin);
    expect(await data('operators/u2')).toEqual(ruwan);
    expect(await data('recycleBin/operator__u2')).toBeUndefined();
  });
});

describe('the 30 days', () => {
  const entry = (docId: string, purgeAt: Date) => ({
    kind: 'bill',
    docId,
    data: { category: 'food', amount: 500, date: '2026-09-01', note: '', createdBy: 'sup1' },
    label: 'කෑම · රු.500',
    summary: '2026-09-01',
    deletedBy: 'admin1',
    deletedByName: 'admin1',
    deletedAt: Timestamp.fromMillis(purgeAt.getTime() - 30 * 24 * 3_600_000),
    purgeAt: Timestamp.fromDate(purgeAt),
  });

  it('purges what has run out, and nothing that has not', async () => {
    await direct(async (db) => {
      await setDoc(doc(db, 'recycleBin', 'bill__old'), entry('old', new Date(Date.now() - 60_000)));
      await setDoc(doc(db, 'recycleBin', 'bill__fresh'), entry('fresh', new Date(Date.now() + 10 * 24 * 3_600_000)));
    });
    signIn('admin1');

    expect(await purgeExpiredBin()).toBe(1);
    expect(await data('recycleBin/bill__old')).toBeUndefined();
    expect(await data('recycleBin/bill__fresh')).toBeDefined();
    expect(await purgeExpiredBin()).toBe(0);
  });

  it('is nobody else’s to purge, or to read', async () => {
    await direct((db) => setDoc(doc(db, 'recycleBin', 'bill__old'), entry('old', new Date(Date.now() - 60_000))));
    signIn('sup1');

    await expect(purgeExpiredBin()).rejects.toThrow();
    expect(await data('recycleBin/bill__old')).toBeDefined();
  });
});
