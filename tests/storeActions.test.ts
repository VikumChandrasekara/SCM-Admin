import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeStock, createItem, deleteItem, updateItem } from '../src/data/store';
import { LINK_OPTIONS, linkDocId, storeItemFrom, type Person, type StoreItem } from '../src/lib/model';

// The panel's own `db`, swapped for a connection that goes through
// firestore.rules in the emulator as whoever is signed in.
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
  direct(async (db) => (await getDocs(collection(db, path))).docs.map((entry) => entry.data()));

async function itemAt(id: string): Promise<StoreItem> {
  const raw = await data(`store/${id}`);
  if (!raw) throw new Error(`no store item ${id}`);
  return storeItemFrom(id, raw);
}

/** The one item in the store, as the page reads it. */
async function onlyItem(): Promise<StoreItem> {
  const docs = await direct(async (db) => (await getDocs(collection(db, 'store'))).docs);
  expect(docs).toHaveLength(1);
  return storeItemFrom(docs[0].id, docs[0].data());
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
  });
});

const details = {
  name: 'Item',
  unit: 'ගණන',
  minQuantity: 2,
  unitPrice: 150,
  piecesPerKg: null,
  note: '',
};

describe('every store item can be added, edited, counted and removed', () => {
  it('an item with no link, by the admin', async () => {
    signIn('admin1');
    await createItem({ ...details, name: 'Grease', quantity: 5, link: null }, admin);
    const item = await onlyItem();
    expect(item).toMatchObject({ name: 'Grease', quantity: 5, link: null });

    await updateItem(item, { ...details, name: 'Grease 2', unit: 'kg', minQuantity: 0, unitPrice: 0 }, admin);
    expect((await itemAt(item.id)).name).toBe('Grease 2');

    await changeStock(await itemAt(item.id), 'restock', 2.5, 'delivery', admin);
    expect((await itemAt(item.id)).quantity).toBe(7.5);
    // Taken down below what is on the shelf is still allowed, and shows as negative.
    await changeStock(await itemAt(item.id), 'use', 20, '', admin);
    expect((await itemAt(item.id)).quantity).toBe(-12.5);
    await changeStock(await itemAt(item.id), 'adjust', 0, '', admin);
    expect((await itemAt(item.id)).quantity).toBe(0);
    await changeStock(await itemAt(item.id), 'restock', 1, '', admin);

    await deleteItem(await itemAt(item.id), admin);
    expect(await data(`store/${item.id}`)).toBeUndefined();
    expect((await all('storeMovements')).map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['create', 'restock', 'use', 'adjust', 'delete']),
    );
  });

  it.each(LINK_OPTIONS.map((option) => [option.link, option] as const))(
    'the linked item %s, by the admin',
    async (link, option) => {
      signIn('admin1');
      const piecesPerKg = link === 'blast:shells' ? 8 : null;
      await createItem({ ...details, name: option.label, unit: option.unit, quantity: 5, link, piecesPerKg }, admin);
      const id = linkDocId(link);
      const item = await itemAt(id);
      expect(item.link).toBe(link);

      await updateItem(
        item,
        { ...details, name: `${option.label} ✎`, unit: option.unit, minQuantity: 1, unitPrice: 99, piecesPerKg: item.piecesPerKg },
        admin,
      );
      await changeStock(await itemAt(id), 'restock', 3, '', admin);
      await changeStock(await itemAt(id), 'use', 100, '', admin);
      await changeStock(await itemAt(id), 'adjust', 4, '', admin);
      expect((await itemAt(id)).quantity).toBe(4);

      await deleteItem(await itemAt(id), admin);
      expect(await data(`store/${id}`)).toBeUndefined();
      // And it can be added again afterwards.
      await createItem({ ...details, name: option.label, unit: option.unit, quantity: 1, link }, admin);
      expect((await itemAt(id)).quantity).toBe(1);
    },
  );

  it('a supervisor can count and change stock, and edit or remove items too', async () => {
    signIn('sup1');
    await createItem({ ...details, name: 'Rope', quantity: 3, link: null }, supervisor);
    const item = await onlyItem();
    await changeStock(item, 'restock', 1, '', supervisor);
    await changeStock(await itemAt(item.id), 'use', 10, '', supervisor);
    await changeStock(await itemAt(item.id), 'adjust', 6, '', supervisor);
    await updateItem(await itemAt(item.id), { ...details, name: 'Rope 2' }, supervisor);
    await deleteItem(await itemAt(item.id), supervisor);
    expect(await data(`store/${item.id}`)).toBeUndefined();
  });

  it('works on a decimal count, a zero count and a long note', async () => {
    signIn('admin1');
    await createItem({ ...details, name: 'Diesel drum', unit: 'L', quantity: 0, link: null, note: 'x'.repeat(2000) }, admin);
    const { id } = await onlyItem();
    await changeStock(await itemAt(id), 'restock', 0.1, '', admin);
    await changeStock(await itemAt(id), 'restock', 0.2, '', admin);
    expect((await itemAt(id)).quantity).toBeCloseTo(0.3, 10);
    await updateItem(await itemAt(id), { ...details, name: 'Diesel drum', unit: 'L', minQuantity: 0.5, unitPrice: 372.5 }, admin);
    expect((await itemAt(id)).unitPrice).toBe(372.5);
  });
});

describe('items bought and used straight away', () => {
  it.each([
    ['the admin', 'admin1', admin],
    ['a supervisor', 'sup1', supervisor],
  ] as const)('are added, priced and removed by %s', async (_who, uid, by) => {
    signIn(uid);
    await createItem({ ...details, name: 'Petrol', unit: 'L', quantity: 0, minQuantity: 0, unitPrice: 0, link: null, direct: true }, by);
    const item = await onlyItem();
    expect(item).toMatchObject({ name: 'Petrol', direct: true, quantity: 0, link: null });

    await updateItem(item, { ...details, name: 'Petrol', unit: 'L', minQuantity: 0, unitPrice: 365 }, by);
    const priced = await itemAt(item.id);
    expect(priced.unitPrice).toBe(365);
    // Editing does not take it off the section.
    expect(priced.direct).toBe(true);

    await deleteItem(await itemAt(item.id), by);
    expect(await data(`store/${item.id}`)).toBeUndefined();
  });

  it('a crew-drawn fluid is marked direct without losing its link', async () => {
    signIn('admin1');
    await createItem({ ...details, name: 'ඩීසල්', unit: 'L', quantity: 0, link: 'fill:diesel', direct: true }, admin);
    expect(await itemAt('fill-diesel')).toMatchObject({ link: 'fill:diesel', direct: true });
  });
});

describe('one item’s history', () => {
  it('every change to a count names its item, so the item’s own changes can be asked for', async () => {
    signIn('admin1');
    await createItem({ ...details, name: 'Rope', quantity: 5, link: null }, admin);
    const item = await onlyItem();
    await createItem({ ...details, name: 'Wire', quantity: 9, link: null }, admin);
    await changeStock(await itemAt(item.id), 'use', 2, 'ගේට්ටුව', admin);
    await changeStock(await itemAt(item.id), 'restock', 10, '', admin);

    const ofRope = await direct(async (db) =>
      (
        await getDocs(query(collection(db, 'storeMovements'), where('itemIds', 'array-contains', item.id), orderBy('createdAt', 'desc')))
      ).docs.map((entry) => entry.data()),
    );
    // Its opening count and the two changes — not the wire's.
    expect(ofRope.map((entry) => entry.type).sort()).toEqual(['create', 'restock', 'use']);
    expect(ofRope.every((entry) => entry.itemIds.includes(item.id))).toBe(true);
    expect(ofRope.reduce((total, entry) => total + entry.items[0].delta, 0)).toBe(5 - 2 + 10);
  });
});
