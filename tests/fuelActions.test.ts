import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { addFuelRecord, deleteFuelRecord, updateFuelRecord } from '../src/data/fuel';
import { createItem } from '../src/data/store';
import { fuelRecordFrom, storeItemFrom, type FuelRecord, type Person, type StoreItem } from '../src/lib/model';

const session = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../src/db', () => ({
  get db() {
    return session.db;
  },
}));
vi.mock('../src/firebase', () => ({
  emailFor: (username: string) => `${username}@scm-operators.local`,
  provisioningAuth: () => {
    throw new Error('no login in these tests');
  },
  usingEmulators: true,
}));
vi.stubGlobal('window', globalThis);

const rulesPath =
  process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));

let env: RulesTestEnvironment;

const person = (id: string, role: Person['role']): Person => ({
  id,
  name: id,
  username: id,
  machineId: '',
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
  sakkaLoadWage: 0,
  boldasLoadWage: 0,
  c1LoadWage: 0,
});
const admin = person('admin1', 'admin');
const supervisor = person('sup1', 'supervisor');

function signIn(uid: string) {
  session.db = env.authenticatedContext(uid).firestore();
}

async function direct<T>(work: (db: Firestore) => Promise<T>): Promise<T> {
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
  direct(async (db) => (await getDocs(collection(db, path))).docs.map((entry) => ({ id: entry.id, ...entry.data() })));

const itemAt = async (id: string): Promise<StoreItem> => storeItemFrom(id, (await data(`store/${id}`))!);

async function records(itemId: string): Promise<FuelRecord[]> {
  return direct(async (db) =>
    (
      await getDocs(query(collection(db, 'fuelRecords'), where('itemId', '==', itemId), orderBy('at', 'desc')))
    ).docs.map((entry) => fuelRecordFrom(entry.id, entry.data())),
  );
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

let petrol: StoreItem;

beforeEach(async () => {
  await env.clearFirestore();
  await direct(async (db) => {
    await setDoc(doc(db, 'operators', 'admin1'), { name: 'Pivithuru', role: 'admin', machineId: '' });
    await setDoc(doc(db, 'operators', 'sup1'), { name: 'Nimal', role: 'supervisor', machineId: '' });
    await setDoc(doc(db, 'operators', 'op1'), { name: 'Kamal', role: 'operator', machineId: 'ex1' });
  });
  signIn('admin1');
  await createItem(
    { name: 'Petrol', unit: 'L', minQuantity: 0, unitPrice: 380, piecesPerKg: null, note: '', quantity: 0, link: null, direct: true },
    admin,
  );
  const [created] = await all('store');
  petrol = await itemAt(created.id);
});

const at = (day: number, hour = 9) => new Date(2026, 9, day, hour, 30);

describe('fuel and oil records', () => {
  it.each([
    ['the admin', 'admin1', admin],
    ['a supervisor', 'sup1', supervisor],
  ] as const)('are added, put right and removed by %s, and the item’s totals follow', async (_who, uid, by) => {
    signIn(uid);
    await addFuelRecord(petrol, { quantity: 10, unitPrice: 380, at: at(4), note: 'generator' }, by);
    await addFuelRecord(petrol, { quantity: 2.5, unitPrice: 400, at: at(5), note: '' }, by);

    expect(await itemAt(petrol.id)).toMatchObject({ usedQuantity: 12.5, usedAmount: 3800 + 1000 });
    const [newest, oldest] = await records(petrol.id);
    expect(newest).toMatchObject({ quantity: 2.5, amount: 1000, date: '2026-10-05', itemName: 'Petrol', createdBy: uid });
    expect(oldest).toMatchObject({ quantity: 10, amount: 3800, note: 'generator' });

    // Put right: more, at another price, another day — the totals move by the difference.
    await updateFuelRecord(oldest, { quantity: 12, unitPrice: 390, at: at(3), note: 'generator, 2 drums' }, by);
    expect(await itemAt(petrol.id)).toMatchObject({ usedQuantity: 14.5, usedAmount: 12 * 390 + 1000 });
    expect((await records(petrol.id)).map((entry) => entry.date)).toEqual(['2026-10-05', '2026-10-03']);

    await deleteFuelRecord(newest, by);
    expect(await itemAt(petrol.id)).toMatchObject({ usedQuantity: 12, usedAmount: 12 * 390 });
    expect(await records(petrol.id)).toHaveLength(1);

    const audit = (await all('auditLog')).map((entry) => (entry as { action?: string }).action);
    expect(audit).toEqual(expect.arrayContaining(['store.fuelAdd', 'store.fuelUpdate', 'store.fuelDelete']));
  });

  it('a repeat of a removal finds it gone and changes nothing', async () => {
    await addFuelRecord(petrol, { quantity: 5, unitPrice: 380, at: at(4), note: '' }, admin);
    const [record] = await records(petrol.id);
    await deleteFuelRecord(record, admin);
    await deleteFuelRecord(record, admin);
    expect(await itemAt(petrol.id)).toMatchObject({ usedQuantity: 0, usedAmount: 0 });
  });

  it('keep their expense when the item is removed', async () => {
    await addFuelRecord(petrol, { quantity: 5, unitPrice: 380, at: at(4), note: '' }, admin);
    await direct((db) => deleteDoc(doc(db, 'store', petrol.id)));
    const [record] = await records(petrol.id);
    expect(record).toMatchObject({ itemName: 'Petrol', amount: 1900 });
    // And can still be removed, with no item to take it off.
    await deleteFuelRecord(record, admin);
    expect(await records(petrol.id)).toEqual([]);
  });

  it('come newest first, whatever order they were written in', async () => {
    for (const day of [8, 2, 20, 11]) {
      await addFuelRecord(petrol, { quantity: day, unitPrice: 1, at: at(day), note: '' }, admin);
    }
    expect((await records(petrol.id)).map((entry) => entry.quantity)).toEqual([20, 11, 8, 2]);
  });

  it('are the supervisors’ and admin’s to keep — and nobody else’s', async () => {
    const good = {
      itemId: petrol.id,
      itemName: 'Petrol',
      unit: 'L',
      quantity: 4,
      unitPrice: 380,
      amount: 1520,
      at: Timestamp.fromDate(at(4)),
      date: '2026-10-04',
      note: '',
      createdAt: serverTimestamp(),
      createdBy: 'sup1',
      createdByName: 'sup1',
    };
    const as = (uid: string) => env.authenticatedContext(uid).firestore();

    await assertSucceeds(setDoc(doc(as('sup1'), 'fuelRecords', 'ok1'), good));
    await assertFails(setDoc(doc(as('op1'), 'fuelRecords', 'no1'), { ...good, createdBy: 'op1' }));
    await assertFails(getDocs(collection(as('op1'), 'fuelRecords')));
    await assertSucceeds(getDocs(collection(as('admin1'), 'fuelRecords')));
  });

  it('must add up and be well formed', async () => {
    const as = env.authenticatedContext('admin1').firestore();
    const good = {
      itemId: petrol.id,
      itemName: 'Petrol',
      unit: 'L',
      quantity: 4,
      unitPrice: 380,
      amount: 1520,
      at: Timestamp.fromDate(at(4)),
      date: '2026-10-04',
      note: '',
      createdAt: serverTimestamp(),
      createdBy: 'admin1',
      createdByName: 'admin1',
    };
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad1'), { ...good, amount: 1000 }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad2'), { ...good, quantity: 0, amount: 0 }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad3'), { ...good, unitPrice: -1, amount: -4 }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad4'), { ...good, date: 'yesterday' }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad5'), { ...good, at: '2026-10-04' }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad6'), { ...good, note: 'x'.repeat(501) }));
    await assertFails(setDoc(doc(as, 'fuelRecords', 'bad7'), { ...good, createdBy: 'sup1' }));
    await assertSucceeds(setDoc(doc(as, 'fuelRecords', 'good1'), good));
  });
});
