import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { linkStoreItem } from '../src/data/store';
import { LINK_OPTIONS, storeItemFrom, type Person, type StockLink } from '../src/lib/model';
import type { LinkPlan } from '../src/lib/storeLink';

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
  sakkaLoadWage: 0,
  boldasLoadWage: 0,
  c1LoadWage: 0,
});
const admin = person('admin1', 'admin');
const supervisor = person('sup1', 'supervisor');
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

const all = (name: string) =>
  direct(async (db) => (await getDocs(collection(db, name))).docs.map((entry) => ({ id: entry.id, ...entry.data() })));

const counted = Timestamp.fromDate(new Date('2026-10-01T06:00:00Z'));

/** An item set up by hand, with nothing linked — as a store is before this. */
async function loose(id: string, fields: object = {}) {
  await direct((db) =>
    setDoc(doc(db, 'store', id), {
      name: 'ඩීසල්',
      unit: 'L',
      quantity: 120,
      minQuantity: 40,
      unitPrice: 355,
      piecesPerKg: null,
      link: null,
      note: 'ටැංකිය',
      createdAt: Timestamp.fromDate(new Date('2026-09-01T06:00:00Z')),
      countedAt: counted,
      ...fields,
    }),
  );
  const snapshot = await data(`store/${id}`);
  return storeItemFrom(id, snapshot!);
}

const planFor = (link: StockLink, adopt: LinkPlan['adopt'] = null): LinkPlan => ({
  option: LINK_OPTIONS.find((option) => option.link === link)!,
  adopt,
});

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
  });
});

describe('tying an existing item to what the crews use', () => {
  it('moves it to the id its link needs, count and all', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');

    expect(await linkStoreItem(planFor('fill:diesel', old), admin)).toBe('adopted');

    expect(await data('store/fill-diesel')).toMatchObject({
      name: 'ඩීසල්',
      unit: 'L',
      quantity: 120,
      minQuantity: 40,
      unitPrice: 355,
      note: 'ටැංකිය',
      link: 'fill:diesel',
      updatedBy: 'admin1',
    });
    // The shelf was counted when it was; usage before then is already in it.
    expect((await data('store/fill-diesel'))!.countedAt.toMillis()).toBe(counted.toMillis());
    expect(await data('store/hand-made-1')).toBeUndefined();
  });

  it('puts the old item in the recycle bin, where it can be got back', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');
    await linkStoreItem(planFor('fill:diesel', old), admin);

    const bin = await data('recycleBin/store__hand-made-1');
    expect(bin).toMatchObject({ kind: 'store', docId: 'hand-made-1', label: 'ඩීසල්', deletedBy: 'admin1' });
    expect(bin!.data).toMatchObject({ name: 'ඩීසල්', quantity: 120, link: null });
  });

  it('is told in the audit log and not as stock coming or going', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');
    await linkStoreItem(planFor('fill:diesel', old), admin);

    const audit = await all('auditLog');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'store.link',
      entityType: 'store',
      entityId: 'fill-diesel',
      entityLabel: 'ඩීසල්',
      createdBy: 'admin1',
    });
    expect(String((audit[0] as { summary?: string }).summary)).toContain('120 L');
    // The count did not change, so the stock log has nothing to say.
    expect(await all('storeMovements')).toEqual([]);
  });

  it('makes a new one, at 0, for a use that has nothing to take over', async () => {
    signIn('admin1');

    expect(await linkStoreItem(planFor('blast:bits'), admin)).toBe('created');

    expect(await data('store/blast-bits')).toMatchObject({
      name: 'බිට්',
      unit: 'ගණන',
      quantity: 0,
      minQuantity: 0,
      unitPrice: 0,
      link: 'blast:bits',
      countedAt: null,
    });
    expect((await all('auditLog'))[0]).toMatchObject({ action: 'store.link', entityId: 'blast-bits' });
    expect(await all('storeMovements')).toEqual([]);
    expect(await all('recycleBin')).toEqual([]);
  });

  it('makes a new one when the item it meant to take over has gone', async () => {
    signIn('admin1');
    const gone = { ...(await loose('hand-made-1')), id: 'no-such-item' };

    expect(await linkStoreItem(planFor('fill:diesel', gone), admin)).toBe('created');
    expect((await data('store/fill-diesel'))!.quantity).toBe(0);
    // And the one that is there is not touched.
    expect(await data('store/hand-made-1')).toBeDefined();
  });

  it('does not take an item that has been linked since the panel last looked', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');
    await direct((db) => setDoc(doc(db, 'store', 'hand-made-1'), { link: 'fill:coolant' }, { merge: true }));

    expect(await linkStoreItem(planFor('fill:diesel', old), admin)).toBe('created');
    expect(await data('store/hand-made-1')).toMatchObject({ link: 'fill:coolant' });
  });

  it('writes nothing when the use already has its item', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');
    await direct((db) =>
      setDoc(doc(db, 'store', 'fill-diesel'), {
        name: 'ඩීසල්',
        unit: 'L',
        quantity: 800,
        minQuantity: 0,
        unitPrice: 355,
        link: 'fill:diesel',
        note: '',
      }),
    );

    expect(await linkStoreItem(planFor('fill:diesel', old), admin)).toBe('present');

    expect((await data('store/fill-diesel'))!.quantity).toBe(800);
    expect(await data('store/hand-made-1')).toBeDefined();
    expect(await all('auditLog')).toEqual([]);
    expect(await all('recycleBin')).toEqual([]);
  });

  it('happens once when two sessions open the panel together', async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');

    const results = await Promise.all([
      linkStoreItem(planFor('fill:diesel', old), admin),
      linkStoreItem(planFor('fill:diesel', old), admin),
    ]);

    expect([...results].sort()).toEqual(['adopted', 'present']);
    expect((await data('store/fill-diesel'))!.quantity).toBe(120);
    expect(await all('recycleBin')).toHaveLength(1);
    expect(await all('auditLog')).toHaveLength(1);
  });

  it('is open to a supervisor as well, and to no one else', async () => {
    signIn('sup1');
    const old = await loose('hand-made-1');
    expect(await linkStoreItem(planFor('fill:diesel', old), supervisor)).toBe('adopted');

    signIn('comp1');
    await expect(linkStoreItem(planFor('blast:caps'), driller)).rejects.toThrow();
    expect(await data('store/blast-caps')).toBeUndefined();
  });
});

describe('what the crews use after that', () => {
  it("comes off the item with no one setting anything up — as the driller's own app posts it", async () => {
    signIn('admin1');
    const old = await loose('hand-made-1');
    await linkStoreItem(planFor('fill:diesel', old), admin);
    await linkStoreItem(planFor('blast:bits'), admin);

    // The operator app's whole posting for a sheet, as one batch, as the driller.
    const db = env.authenticatedContext('comp1').firestore() as unknown as Firestore;
    const batch = writeBatch(db);
    batch.set(doc(db, 'storeMovements', 'use_cp1_2026-10-13_fill1'), {
      type: 'usage',
      items: [{ itemId: 'fill-diesel', name: 'ඩීසල්', unit: 'L', delta: -40 }],
      unmatched: [],
      machineId: 'cp1',
      date: '2026-10-13',
      source: 'fill1',
      note: '',
      createdBy: 'comp1',
      createdByName: '',
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'store', 'fill-diesel'), {
      quantity: increment(-40),
      updatedAt: serverTimestamp(),
      updatedBy: 'comp1',
    });
    await assertSucceeds(batch.commit());
    expect((await data('store/fill-diesel'))!.quantity).toBe(80);

    // And an item made at 0 is drawn down just the same, below nothing.
    const sizes = writeBatch(db);
    sizes.set(doc(db, 'storeMovements', 'use_cp1_2026-10-13_blastSizes'), {
      type: 'usage',
      items: [{ itemId: 'blast-bits', name: 'බිට්', unit: 'ගණන', delta: -8 }],
      unmatched: [],
      machineId: 'cp1',
      date: '2026-10-13',
      source: 'blastSizes',
      note: '',
      createdBy: 'comp1',
      createdByName: '',
      createdAt: serverTimestamp(),
    });
    sizes.update(doc(db, 'store', 'blast-bits'), {
      quantity: increment(-8),
      updatedAt: serverTimestamp(),
      updatedBy: 'comp1',
    });
    await assertSucceeds(sizes.commit());
    expect((await data('store/blast-bits'))!.quantity).toBe(-8);
  });

  it('cannot be got round by a crew member making the item themselves', async () => {
    const db = env.authenticatedContext('comp1').firestore() as unknown as Firestore;
    await assertFails(
      setDoc(doc(db, 'store', 'fill-diesel'), {
        name: 'ඩීසල්',
        unit: 'L',
        quantity: 0,
        minQuantity: 0,
        unitPrice: 0,
        link: 'fill:diesel',
        note: '',
      }),
    );
  });
});
