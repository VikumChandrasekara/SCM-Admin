import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * firestore.rules lives in the SCM project, next to the operator app, and is
 * the only thing standing between a modified client and the data — so every
 * rule the admin panel relies on is exercised here against the emulator.
 */
const rulesPath =
  process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));

let env: RulesTestEnvironment;

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
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    const people: Record<string, object> = {
      admin1: { name: 'Pivithuru', role: 'admin', machineId: '' },
      sup1: { name: 'Nimal', role: 'supervisor', machineId: '' },
      op1: { name: 'Kamal', role: 'operator', machineId: 'ex1', advanceAmount: 0 },
      comp1: { name: 'Ruwan', role: 'compressor', machineId: 'cp1' },
      // Written before roles existed.
      legacy: { name: 'Old', machineId: 'ex2' },
    };
    for (const [id, data] of Object.entries(people)) {
      await setDoc(doc(db, 'operators', id), data);
    }
    await setDoc(doc(db, 'machines', 'ex1'), { totalHours: 100, serviceDueAt: { engineOil: 250 } });
    await setDoc(doc(db, 'machines', 'cp1'), { totalHours: 50, serviceDueAt: {} });
    await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-09-10'), {
      date: '2026-09-10',
      fillings: {
        '1': { onHours: 100, amounts: { diesel: 40 }, lockedAt: '2026-09-10T07:00:00.000Z' },
      },
    });
    await setDoc(doc(db, 'store', 'fill-diesel'), {
      name: 'Diesel',
      unit: 'L',
      quantity: 500,
      minQuantity: 100,
      unitPrice: 360,
      link: 'fill:diesel',
      note: '',
    });
    await setDoc(doc(db, 'store', 'filters'), {
      name: 'Filter',
      unit: 'pcs',
      quantity: 4,
      minQuantity: 2,
      unitPrice: 2500,
      link: null,
      note: '',
    });
    await setDoc(doc(db, 'storeMovements', 'm1'), { type: 'restock', items: [], createdBy: 'admin1' });
    await setDoc(doc(db, 'bills', 'b-sup'), {
      category: 'food',
      amount: 500,
      date: '2026-09-01',
      note: '',
      createdBy: 'sup1',
    });
    await setDoc(doc(db, 'bills', 'b-admin'), {
      category: 'water',
      amount: 1500,
      date: '2026-09-02',
      note: '',
      createdBy: 'admin1',
    });
  });
});

function as(uid: string): Firestore {
  return env.authenticatedContext(uid).firestore() as unknown as Firestore;
}

const item = (overrides: object = {}) => ({
  name: 'Grease',
  unit: 'kg',
  quantity: 10,
  minQuantity: 2,
  unitPrice: 1200,
  link: null,
  note: '',
  ...overrides,
});

const usage = (by: string, machineId = 'ex1') => ({
  type: 'usage',
  items: [{ itemId: 'fill-diesel', name: 'Diesel', unit: 'L', delta: -40 }],
  unmatched: [],
  machineId,
  date: '2026-09-10',
  source: 'fill1',
  note: '',
  createdBy: by,
  createdByName: by,
  createdAt: serverTimestamp(),
});

const bill = (by: string, overrides: object = {}) => ({
  category: 'food',
  amount: 750,
  date: '2026-09-11',
  note: '',
  operatorId: 'op1',
  operatorName: 'Kamal',
  createdBy: by,
  createdByName: by,
  createdAt: serverTimestamp(),
  ...overrides,
});

describe('accounts', () => {
  it('only the admin creates an account record', async () => {
    const record = { name: 'New', role: 'operator', machineId: 'ex3' };
    await assertSucceeds(setDoc(doc(as('admin1'), 'operators', 'new1'), record));
    await assertFails(setDoc(doc(as('sup1'), 'operators', 'new2'), record));
    await assertFails(setDoc(doc(as('op1'), 'operators', 'new3'), record));
  });

  it('an unknown role is refused', async () => {
    await assertFails(setDoc(doc(as('admin1'), 'operators', 'new1'), { name: 'X', role: 'owner' }));
  });

  it('crews read only their own record; staff read everyone', async () => {
    await assertSucceeds(getDoc(doc(as('op1'), 'operators', 'op1')));
    await assertFails(getDoc(doc(as('op1'), 'operators', 'comp1')));
    await assertFails(getDocs(collection(as('op1'), 'operators')));
    await assertSucceeds(getDocs(collection(as('sup1'), 'operators')));
    await assertSucceeds(getDocs(collection(as('admin1'), 'operators')));
  });

  it('a supervisor sets the advance and the wage, and nothing else', async () => {
    const record = doc(as('sup1'), 'operators', 'op1');
    await assertSucceeds(updateDoc(record, { advanceAmount: 5000 }));
    await assertFails(updateDoc(record, { role: 'admin' }));
    // The wage rate is theirs too — what a day, an hour, a foot or a load is
    // paid — but leave and what is owed are never written at all: both are
    // worked out from the month's records.
    await assertSucceeds(updateDoc(record, { dailyWage: 4000, wageBasis: 'hour' }));
    await assertSucceeds(updateDoc(record, { wageBasis: 'foot' }));
    await assertFails(updateDoc(record, { wageBasis: 'week' }));
    await assertFails(updateDoc(record, { leaveDays: 2 }));
    await assertFails(updateDoc(record, { receivableAmount: 100000 }));
  });

  it('a supervisor cannot set the wage of a staff record, their own included', async () => {
    await assertFails(updateDoc(doc(as('sup1'), 'operators', 'sup1'), { dailyWage: 90000, wageBasis: 'month' }));
    await assertFails(updateDoc(doc(as('sup1'), 'operators', 'admin1'), { dailyWage: 1 }));
    await assertSucceeds(updateDoc(doc(as('admin1'), 'operators', 'sup1'), { dailyWage: 90000, wageBasis: 'month' }));
  });

  it('the admin edits a record written before roles existed', async () => {
    await assertSucceeds(updateDoc(doc(as('admin1'), 'operators', 'legacy'), { dailyWage: 3500 }));
  });

  it('nobody promotes themselves', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'operators', 'op1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('sup1'), 'operators', 'sup1'), { role: 'admin' }));
  });

  it('the admin removes others but cannot lock themselves out', async () => {
    await assertSucceeds(deleteDoc(doc(as('admin1'), 'operators', 'op1')));
    await assertFails(deleteDoc(doc(as('admin1'), 'operators', 'admin1')));
    await assertFails(deleteDoc(doc(as('sup1'), 'operators', 'comp1')));
  });

  it('a login without a record reads nothing', async () => {
    await assertFails(getDoc(doc(as('ghost'), 'machines', 'ex1')));
    await assertFails(getDoc(doc(as('ghost'), 'machines', 'ex1', 'days', '2026-09-10')));
    await assertFails(getDoc(doc(as('ghost'), 'store', 'fill-diesel')));
  });
});

describe('machines and days', () => {
  it('a crew member cannot set its own loads; staff can', async () => {
    const day = { date: '2026-09-11', loads: 5 };
    await assertFails(setDoc(doc(as('op1'), 'machines', 'ex1', 'days', '2026-09-11'), day));
    await assertSucceeds(setDoc(doc(as('sup1'), 'machines', 'ex1', 'days', '2026-09-11'), day));
    await assertSucceeds(setDoc(doc(as('admin1'), 'machines', 'ex1', 'days', '2026-09-12'), day));
  });

  it('a locked slot holds even for the admin', async () => {
    await assertFails(
      setDoc(
        doc(as('admin1'), 'machines', 'ex1', 'days', '2026-09-10'),
        { fillings: { '1': { onHours: 101 } } },
        { merge: true },
      ),
    );
  });

  it('staff add the ON a locked slot was OK’d without — and only that', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const slot = { offHours: null, amounts: { diesel: 30 }, lockedAt: '2026-09-14T07:00:00.000Z' };
      // OK'd with a null ON, and OK'd with no ON key at all.
      await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-09-14'), {
        date: '2026-09-14',
        fillings: { '1': { onHours: null, ...slot } },
      });
      await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-09-15'), {
        date: '2026-09-15',
        fillings: { '1': slot },
      });
    });
    const withOn = (on: unknown, more: object = {}) => ({ fillings: { '1': { onHours: on, ...more } } });
    const day = (uid: string, date: string) => doc(as(uid), 'machines', 'ex1', 'days', date);

    // Not the crew, and not with anything else in the slot moving alongside.
    await assertFails(setDoc(day('op1', '2026-09-14'), withOn(102), { merge: true }));
    await assertFails(setDoc(day('admin1', '2026-09-14'), withOn(102, { amounts: { diesel: 99 } }), { merge: true }));
    await assertFails(setDoc(day('admin1', '2026-09-14'), withOn(102, { lockedAt: null }), { merge: true }));
    await assertFails(setDoc(day('admin1', '2026-09-14'), withOn('102'), { merge: true }));

    await assertSucceeds(setDoc(day('sup1', '2026-09-14'), withOn(102), { merge: true }));
    await assertSucceeds(setDoc(day('admin1', '2026-09-15'), withOn(102), { merge: true }));

    // Once it is there the slot is a record again, for everyone.
    await assertFails(setDoc(day('admin1', '2026-09-14'), withOn(103), { merge: true }));
    await assertFails(setDoc(day('sup1', '2026-09-15'), withOn(103), { merge: true }));
  });

  it('staff reset a service counter; crews cannot', async () => {
    await assertSucceeds(updateDoc(doc(as('sup1'), 'machines', 'ex1'), { 'serviceDueAt.engineOil': 350 }));
    await assertFails(updateDoc(doc(as('op1'), 'machines', 'ex1'), { 'serviceDueAt.engineOil': 999 }));
  });

  it("crews advance their own machine's meter and no other", async () => {
    await assertSucceeds(updateDoc(doc(as('op1'), 'machines', 'ex1'), { totalHours: 110 }));
    await assertFails(updateDoc(doc(as('op1'), 'machines', 'cp1'), { totalHours: 60 }));
  });

  it('only the admin sets up a machine', async () => {
    const machine = { totalHours: 0, serviceDueAt: {} };
    await assertSucceeds(setDoc(doc(as('admin1'), 'machines', 'ex9'), machine));
    await assertFails(setDoc(doc(as('sup1'), 'machines', 'ex8'), machine));
  });
});

describe('store', () => {
  it('crews read a linked item by id but cannot list the store', async () => {
    await assertSucceeds(getDoc(doc(as('op1'), 'store', 'fill-diesel')));
    await assertFails(getDocs(collection(as('op1'), 'store')));
    await assertSucceeds(getDocs(collection(as('sup1'), 'store')));
  });

  it('a crew member only ever draws stock down', async () => {
    const diesel = doc(as('op1'), 'store', 'fill-diesel');
    await assertSucceeds(
      updateDoc(diesel, { quantity: increment(-40), updatedAt: serverTimestamp(), updatedBy: 'op1' }),
    );
    await assertFails(updateDoc(diesel, { quantity: increment(40) }));
    await assertFails(updateDoc(diesel, { quantity: increment(-1), unitPrice: 1 }));
    await assertFails(updateDoc(diesel, { quantity: 1, countedAt: serverTimestamp() }));
  });

  it('a supervisor keeps the item list as well as the counts', async () => {
    const db = as('sup1');
    await assertSucceeds(
      updateDoc(doc(db, 'store', 'filters'), {
        quantity: 10,
        countedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: 'sup1',
      }),
    );
    await assertSucceeds(setDoc(doc(db, 'store', 'grease'), item()));
    await assertSucceeds(updateDoc(doc(db, 'store', 'filters'), { name: 'Renamed' }));
    await assertSucceeds(deleteDoc(doc(db, 'store', 'filters')));
    // The same checks on an item hold for them as for the admin.
    await assertFails(setDoc(doc(db, 'store', 'coolant'), item({ link: 'fill:coolant' })));
    await assertFails(setDoc(doc(db, 'store', 'nameless'), item({ name: '' })));
  });

  it('crews still cannot add, rename or delete items', async () => {
    const db = as('op1');
    await assertFails(setDoc(doc(db, 'store', 'grease'), item()));
    await assertFails(updateDoc(doc(db, 'store', 'filters'), { name: 'Renamed' }));
    await assertFails(deleteDoc(doc(db, 'store', 'filters')));
  });

  it('the admin adds items, and a linked one only at its own id', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'store', 'grease'), item()));
    await assertSucceeds(setDoc(doc(db, 'store', 'fill-coolant'), item({ link: 'fill:coolant' })));
    await assertFails(setDoc(doc(db, 'store', 'coolant'), item({ link: 'fill:coolant' })));
    await assertFails(setDoc(doc(db, 'store', 'fill-hydraulic'), item({ link: 'fill:diesel' })));
  });

  it('a service part links at its own id too', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'store', 'service-dieselFilter'), item({ link: 'service:dieselFilter' })));
    await assertFails(setDoc(doc(db, 'store', 'diesel-filter'), item({ link: 'service:dieselFilter' })));
    await assertFails(setDoc(doc(db, 'store', 'other-thing'), item({ link: 'other:thing' })));
  });

  it('staff take the fitted part off the shelf with the service reset', async () => {
    const db = as('sup1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'machines', 'ex1'), { 'serviceDueAt.engineOil': 350 });
    batch.update(doc(db, 'store', 'filters'), {
      quantity: increment(-1),
      updatedAt: serverTimestamp(),
      updatedBy: 'sup1',
    });
    batch.set(doc(collection(db, 'storeMovements')), {
      type: 'use',
      items: [{ itemId: 'filters', name: 'Filter', unit: 'pcs', delta: -1 }],
      unmatched: [],
      machineId: 'ex1',
      note: '',
      createdBy: 'sup1',
      createdByName: 'sup1',
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('an item needs a name, a count and non-negative levels', async () => {
    const db = as('admin1');
    await assertFails(setDoc(doc(db, 'store', 'a'), item({ name: '' })));
    await assertFails(setDoc(doc(db, 'store', 'b'), item({ minQuantity: -1 })));
    await assertFails(setDoc(doc(db, 'store', 'c'), item({ quantity: '5' })));
  });
});

describe('usage postings', () => {
  const id = 'use_ex1_2026-09-10_fill1';

  it('a crew member posts its own fill — once', async () => {
    const db = as('op1');
    await assertSucceeds(setDoc(doc(db, 'storeMovements', id), usage('op1')));
    await assertFails(setDoc(doc(db, 'storeMovements', id), usage('op1')));
  });

  it('whoever posts second is refused, admin included', async () => {
    await assertSucceeds(setDoc(doc(as('op1'), 'storeMovements', id), usage('op1')));
    await assertFails(setDoc(doc(as('admin1'), 'storeMovements', id), usage('admin1')));
  });

  it('the id has to match what the posting records', async () => {
    await assertFails(setDoc(doc(as('op1'), 'storeMovements', 'use_ex1_2026-09-10_fill2'), usage('op1')));
    await assertFails(setDoc(doc(as('admin1'), 'storeMovements', 'anything'), usage('admin1')));
  });

  it("a crew member cannot post another machine's usage, or as someone else", async () => {
    await assertFails(
      setDoc(doc(as('op1'), 'storeMovements', 'use_cp1_2026-09-10_fill1'), usage('op1', 'cp1')),
    );
    await assertFails(setDoc(doc(as('op1'), 'storeMovements', id), usage('sup1')));
  });

  it('the operator app\'s whole posting goes through as one batch', async () => {
    const db = as('op1');
    const batch = writeBatch(db);
    batch.set(doc(db, 'storeMovements', id), usage('op1'));
    batch.update(doc(db, 'store', 'fill-diesel'), {
      quantity: increment(-40),
      updatedAt: serverTimestamp(),
      updatedBy: 'op1',
    });
    await assertSucceeds(batch.commit());
  });

  it('only staff record a restock', async () => {
    const restock = (by: string) => ({
      type: 'restock',
      items: [{ itemId: 'filters', name: 'Filter', unit: 'pcs', delta: 6 }],
      unmatched: [],
      note: '',
      createdBy: by,
      createdByName: by,
      createdAt: serverTimestamp(),
    });
    await assertFails(setDoc(doc(collection(as('op1'), 'storeMovements')), restock('op1')));
    await assertSucceeds(setDoc(doc(collection(as('sup1'), 'storeMovements')), restock('sup1')));
  });

  it('the log can be read by staff only, and never rewritten', async () => {
    await assertFails(getDocs(collection(as('op1'), 'storeMovements')));
    await assertSucceeds(getDocs(collection(as('sup1'), 'storeMovements')));
    await assertFails(updateDoc(doc(as('admin1'), 'storeMovements', 'm1'), { note: 'edited' }));
    await assertFails(deleteDoc(doc(as('admin1'), 'storeMovements', 'm1')));
  });
});

describe('bills', () => {
  it('staff add bills; crews cannot even read them', async () => {
    await assertSucceeds(setDoc(doc(collection(as('sup1'), 'bills')), bill('sup1')));
    await assertSucceeds(setDoc(doc(collection(as('admin1'), 'bills')), bill('admin1')));
    await assertFails(setDoc(doc(collection(as('op1'), 'bills')), bill('op1')));
    await assertFails(getDocs(collection(as('op1'), 'bills')));
  });

  it('a bill is for a positive amount, on a real date, in a known category', async () => {
    const db = as('sup1');
    await assertFails(setDoc(doc(collection(db, 'bills')), bill('sup1', { amount: 0 })));
    await assertFails(setDoc(doc(collection(db, 'bills')), bill('sup1', { date: 'yesterday' })));
    await assertFails(setDoc(doc(collection(db, 'bills')), bill('sup1', { category: 'fuel' })));
    await assertFails(setDoc(doc(collection(db, 'bills')), bill('admin1')));
  });

  it('a supervisor corrects and deletes only their own bills', async () => {
    const db = as('sup1');
    await assertSucceeds(updateDoc(doc(db, 'bills', 'b-sup'), { amount: 600 }));
    await assertFails(updateDoc(doc(db, 'bills', 'b-admin'), { amount: 10 }));
    await assertFails(deleteDoc(doc(db, 'bills', 'b-admin')));
    await assertSucceeds(deleteDoc(doc(db, 'bills', 'b-sup')));
  });

  it('the admin corrects any bill but cannot reassign who wrote it', async () => {
    const db = as('admin1');
    await assertSucceeds(updateDoc(doc(db, 'bills', 'b-sup'), { amount: 700 }));
    await assertFails(updateDoc(doc(db, 'bills', 'b-sup'), { createdBy: 'admin1' }));
    await assertSucceeds(deleteDoc(doc(db, 'bills', 'b-sup')));
  });

  it("an advance moves the crew member's ඇඩ්වාන්ස් ගණන in the same write", async () => {
    const db = as('sup1');
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'bills')), bill('sup1', { category: 'advance', amount: 2000 }));
    batch.update(doc(db, 'operators', 'op1'), { advanceAmount: increment(2000) });
    await assertSucceeds(batch.commit());
  });
});

describe('recycle bin', () => {
  // The bill the suite seeds for the supervisor, as the server holds it.
  const seeded = { category: 'food', amount: 500, date: '2026-09-01', note: '', createdBy: 'sup1' };
  const DAY = 24 * 3_600_000;

  const entry = (overrides: object = {}) => ({
    kind: 'bill',
    docId: 'b-sup',
    data: seeded,
    label: 'කෑම · රු.500',
    summary: '2026-09-01',
    deletedBy: 'sup1',
    deletedByName: 'Nimal',
    deletedAt: serverTimestamp(),
    purgeAt: Timestamp.fromMillis(Date.now() + 30 * DAY),
    ...overrides,
  });

  /** The bill deleted and binned in one write, as the panel does it. */
  function bin(uid: string, overrides: object = {}, id = 'bill__b-sup') {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'recycleBin', id), entry({ deletedBy: uid, ...overrides }));
    batch.delete(doc(db, 'bills', 'b-sup'));
    return batch.commit();
  }

  /** The bill binned already, by the supervisor, with the rules out of the way. */
  async function binned(purgeAt = Date.now() + 30 * DAY) {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'recycleBin', 'bill__b-sup'), entry({ deletedAt: Timestamp.now(), purgeAt: Timestamp.fromMillis(purgeAt) }));
      await deleteDoc(doc(db, 'bills', 'b-sup'));
    });
  }

  it('whoever may delete may bin — in the write that deletes, and only a faithful copy', async () => {
    // Not a copy of what is being deleted, or not under its own id...
    await assertFails(bin('sup1', { data: { ...seeded, amount: 999 } }));
    await assertFails(bin('sup1', { docId: 'b-other' }));
    await assertFails(bin('sup1', {}, 'bill__elsewhere'));
    await assertFails(bin('sup1', { kind: 'sale' }));
    // ...or in another's name, or stamped by the client...
    await assertFails(bin('sup1', { deletedBy: 'admin1' }));
    await assertFails(bin('sup1', { deletedAt: Timestamp.fromMillis(Date.now()) }));
    // ...or kept for any length but about 30 days, or carrying anything extra.
    await assertFails(bin('sup1', { purgeAt: Timestamp.fromMillis(Date.now() + 2 * DAY) }));
    await assertFails(bin('sup1', { purgeAt: Timestamp.fromMillis(Date.now() + 90 * DAY) }));
    await assertFails(bin('sup1', { extra: true }));
    // A crew member cannot bin, and nothing is binned without the delete.
    await assertFails(bin('op1'));
    await assertFails(setDoc(doc(as('sup1'), 'recycleBin', 'bill__b-sup'), entry()));

    // The right copy, in the write that deletes the bill, goes through.
    await assertSucceeds(bin('sup1'));
  });

  it('is read by the admin, and by a supervisor for the sales, bills and store items — never by a crew', async () => {
    await binned();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'recycleBin', 'sale__SALE2345'), entry({ kind: 'sale', docId: 'SALE2345', data: { code: 'SALE2345' } }));
      await setDoc(doc(db, 'recycleBin', 'operator__u9'), entry({ kind: 'operator', docId: 'u9', data: { name: 'Gone' } }));
    });
    await assertSucceeds(getDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup')));
    await assertSucceeds(getDocs(collection(as('admin1'), 'recycleBin')));

    // A supervisor reads the bill, asks for their own kinds, and is refused the rest.
    await assertSucceeds(getDoc(doc(as('sup1'), 'recycleBin', 'bill__b-sup')));
    await assertSucceeds(getDoc(doc(as('sup1'), 'recycleBin', 'sale__SALE2345')));
    await assertSucceeds(
      getDocs(query(collection(as('sup1'), 'recycleBin'), where('kind', 'in', ['sale', 'bill', 'store']))),
    );
    await assertFails(getDocs(collection(as('sup1'), 'recycleBin')));
    await assertFails(getDocs(query(collection(as('sup1'), 'recycleBin'), where('kind', 'in', ['bill', 'operator']))));
    await assertFails(getDoc(doc(as('sup1'), 'recycleBin', 'operator__u9')));

    await assertFails(getDoc(doc(as('op1'), 'recycleBin', 'bill__b-sup')));
    await assertFails(updateDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup'), { label: 'changed' }));
  });

  it('is restored by the admin, exactly as binned, in the write that empties the entry', async () => {
    await binned();
    const restore = (uid: string, data: object) => {
      const db = as(uid);
      const batch = writeBatch(db);
      batch.set(doc(db, 'bills', 'b-sup'), data);
      batch.delete(doc(db, 'recycleBin', 'bill__b-sup'));
      return batch.commit();
    };

    // A crew member cannot, and nothing but the binned copy goes back.
    await assertFails(restore('op1', seeded));
    await assertFails(restore('admin1', { ...seeded, amount: 999 }));
    await assertFails(restore('sup1', { ...seeded, amount: 999 }));
    await assertFails(restore('admin1', { ...seeded, createdBy: 'admin1' }));
    // The bill is not written back without emptying the entry, nor the entry
    // emptied without the bill coming back.
    await assertFails(setDoc(doc(as('admin1'), 'bills', 'b-sup'), seeded));
    await assertFails(deleteDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup')));

    await assertSucceeds(restore('admin1', seeded));
    expect((await getDoc(doc(as('admin1'), 'bills', 'b-sup'))).data()).toEqual(seeded);
    expect((await getDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup'))).exists()).toBe(false);
  });

  it('is purged by the admin once its days are up, and not before', async () => {
    await binned();
    await assertFails(deleteDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup')));
  });

  it('is put back by a supervisor for a store item or a bill or sale they wrote — not another’s, not an account', async () => {
    const grease = { name: 'Grease', unit: 'kg', quantity: 10, minQuantity: 2, unitPrice: 1200, link: null, note: '' };
    const others = { ...seeded, createdBy: 'admin1' };
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const put = (kind: string, docId: string, data: object) =>
        setDoc(doc(db, 'recycleBin', `${kind}__${docId}`), entry({ kind, docId, data, deletedAt: Timestamp.now() }));
      await put('store', 'grease', grease);
      await put('bill', 'b-sup', seeded);
      await put('bill', 'b-admin', others);
      await put('operator', 'u9', { name: 'Gone', role: 'operator', machineId: 'ex9' });
      await deleteDoc(doc(db, 'bills', 'b-sup'));
      await deleteDoc(doc(db, 'bills', 'b-admin'));
    });
    const restore = (uid: string, collectionName: string, kind: string, id: string, data: object) => {
      const db = as(uid);
      const batch = writeBatch(db);
      batch.set(doc(db, collectionName, id), data);
      batch.delete(doc(db, 'recycleBin', `${kind}__${id}`));
      return batch.commit();
    };

    await assertFails(restore('sup1', 'bills', 'bill', 'b-admin', others));
    await assertFails(restore('sup1', 'operators', 'operator', 'u9', { name: 'Gone', role: 'operator', machineId: 'ex9' }));
    await assertFails(restore('op1', 'store', 'store', 'grease', grease));

    await assertSucceeds(restore('sup1', 'store', 'store', 'grease', grease));
    await assertSucceeds(restore('sup1', 'bills', 'bill', 'b-sup', seeded));
    await assertSucceeds(restore('admin1', 'bills', 'bill', 'b-admin', others));
  });

  it('is purged by the admin alone once its days are up', async () => {
    await binned(Date.now() - 60_000);
    await assertFails(deleteDoc(doc(as('sup1'), 'recycleBin', 'bill__b-sup')));
    await assertSucceeds(deleteDoc(doc(as('admin1'), 'recycleBin', 'bill__b-sup')));
  });

  it('lets a sale back only from the bin, past the price and count rules a fresh one meets', async () => {
    const old = {
      code: 'OLDS2345', type: 'tipper', quantity: 3, unitPrice: 5000, amount: 15000, customerName: 'Silva',
      customerKey: 'silva', material: 'sakka', paymentType: 'cash', machineCharge: 4000, customerPhone: '',
      vehicleNo: '', note: '', date: '2026-09-13', number: 1, status: 'verified', createdBy: 'admin1',
      createdByName: 'admin1', createdAt: Timestamp.fromMillis(Date.now() - 5 * DAY),
    };
    // Written fresh, a sale at a price that is not today's is refused.
    await assertFails(setDoc(doc(as('admin1'), 'sales', 'OLDS2345'), old));

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(
        doc(db, 'recycleBin', 'sale__OLDS2345'),
        entry({ kind: 'sale', docId: 'OLDS2345', data: old, deletedAt: Timestamp.now() }),
      );
    });
    const db = as('admin1');
    // Not without emptying the entry in the same write, nor for anyone else.
    await assertFails(setDoc(doc(db, 'sales', 'OLDS2345'), old));
    const staff = as('sup1');
    const byStaff = writeBatch(staff);
    byStaff.set(doc(staff, 'sales', 'OLDS2345'), old);
    byStaff.delete(doc(staff, 'recycleBin', 'sale__OLDS2345'));
    await assertFails(byStaff.commit());

    const back = writeBatch(db);
    back.set(doc(db, 'sales', 'OLDS2345'), old);
    back.delete(doc(db, 'recycleBin', 'sale__OLDS2345'));
    await assertSucceeds(back.commit());
  });
});

describe('queued writes sent twice', () => {
  // A write the server took, but whose reply never reached the phone, is sent
  // again when the connection comes back. Only the first may count.

  /** The operator app's OK on පිරවීම 1: it also closes yesterday out. */
  function fillingThatClosesYesterday(db: Firestore, stamped: boolean) {
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'machines', 'ex1', 'days', '2026-09-11'),
      {
        date: '2026-09-11',
        fillings: {
          '1': {
            onHours: 108,
            amounts: { diesel: 30 },
            lockedAt: '2026-09-11T07:00:00.000Z',
            ...(stamped ? { syncedAt: serverTimestamp() } : {}),
          },
        },
      },
      { merge: true },
    );
    batch.set(doc(db, 'machines', 'ex1', 'days', '2026-09-10'), { date: '2026-09-10', closingHours: 108 }, { merge: true });
    batch.set(doc(db, 'machines', 'ex1', 'months', '2026-09'), { month: '2026-09', hours: increment(8) }, { merge: true });
    batch.set(doc(db, 'machines', 'ex1'), { totalHours: 108 }, { merge: true });
    return batch.commit();
  }

  async function monthHours(): Promise<unknown> {
    let hours: unknown;
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      hours = (await getDoc(doc(db, 'machines', 'ex1', 'months', '2026-09'))).data()?.hours;
    });
    return hours;
  }

  it("a filling's repeat is refused, so yesterday's hours reach the month once", async () => {
    const db = as('op1');
    await assertSucceeds(fillingThatClosesYesterday(db, true));
    await assertFails(fillingThatClosesYesterday(db, true));
    expect(await monthHours()).toBe(8);
  });

  it('the server stamp is what does it: without one the repeat would count', async () => {
    const db = as('op1');
    await assertSucceeds(fillingThatClosesYesterday(db, false));
    await assertSucceeds(fillingThatClosesYesterday(db, false));
    expect(await monthHours()).toBe(16);
  });

  it('a store change carries a new log entry, so its repeat is refused', async () => {
    const db = as('sup1');
    const movement = doc(collection(db, 'storeMovements'));
    const restock = () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'store', 'fill-diesel'), {
        quantity: increment(50),
        updatedAt: serverTimestamp(),
        updatedBy: 'sup1',
      });
      batch.set(movement, { type: 'restock', items: [], createdBy: 'sup1', createdAt: serverTimestamp() });
      return batch.commit();
    };
    await assertSucceeds(restock());
    await assertFails(restock());
  });
});

describe('sales', () => {
  async function setPrices(prices: object = { tipperPrice: 19500, cubePrice: 6500, tractorPrice: 6500 }) {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'settings', 'sales'), prices);
    });
  }

  const sale = (by: string, code: string, overrides: object = {}) => ({
    code,
    // A full tipper: three cubes at 6,500, the 19,500 the admin set.
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
    vehicleNo: '',
    note: '',
    date: '2026-09-13',
    number: 1,
    status: 'pending',
    createdBy: by,
    createdByName: '',
    createdAt: serverTimestamp(),
    ...overrides,
  });

  /**
   * A new sale the way the apps write it: together with the month's count
   * and the index that lets its invoice number be typed in to find it.
   */
  function addSale(db: Firestore, code: string, data: ReturnType<typeof sale>, month = '2026-09') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'sales', code), data);
    batch.set(doc(db, 'saleCounters', month), { last: data.number, lastCode: code });
    batch.set(doc(db, 'saleIndex', `${month}-${data.number}`), { code });
    return batch.commit();
  }

  /** A sale written straight into the database, [hoursAgo] old. */
  async function seedSale(code: string, hoursAgo: number, status = 'pending', overrides: object = {}) {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'sales', code), {
        ...sale('sup1', code, { status, ...overrides }),
        createdAt: Timestamp.fromMillis(Date.now() - hoursAgo * 3_600_000),
      });
    });
  }

  const verify = (uid: string) => ({
    status: 'verified',
    verifiedBy: uid,
    verifiedByName: uid,
    verifiedAt: serverTimestamp(),
  });

  it('staff set the prices, and never to nothing', async () => {
    const prices = { tipperPrice: 21000, cubePrice: 7000, tractorPrice: 5000 };
    await assertSucceeds(setDoc(doc(as('admin1'), 'settings', 'sales'), prices));
    await assertSucceeds(setDoc(doc(as('sup1'), 'settings', 'sales'), prices));
    await assertFails(setDoc(doc(as('op1'), 'settings', 'sales'), prices));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'sales'), { ...prices, cubePrice: 0 }));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'sales'), { ...prices, tractorPrice: 0 }));
    // All three go together: a tipper sale is priced from the cube, a
    // tractor sale from its own.
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'sales'), { tipperPrice: 21000, cubePrice: 7000 }));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'sales'), { tipperPrice: 21000, tractorPrice: 5000 }));
    await assertSucceeds(getDoc(doc(as('op1'), 'settings', 'sales')));
  });

  it("a sale carries the machine's per-load figure as set — 4,000 until then", async () => {
    await assertFails(addSale(as('sup1'), 'MCHN2345', sale('sup1', 'MCHN2345', { machineCharge: 0 })));
    await assertSucceeds(addSale(as('sup1'), 'MCHN2345', sale('sup1', 'MCHN2345')));

    const prices = { tipperPrice: 19500, cubePrice: 6500, tractorPrice: 6500 };
    await assertFails(setDoc(doc(as('sup1'), 'settings', 'sales'), { ...prices, machineCharge: -1 }));
    await assertSucceeds(setDoc(doc(as('sup1'), 'settings', 'sales'), { ...prices, machineCharge: 3500 }));
    await assertFails(
      addSale(as('sup1'), 'MCHN2346', sale('sup1', 'MCHN2346', { number: 2 })),
    );
    await assertSucceeds(
      addSale(as('sup1'), 'MCHN2346', sale('sup1', 'MCHN2346', { number: 2, machineCharge: 3500 })),
    );
  });

  it('with no prices set, sales are written at the defaults', async () => {
    // 6,500 a cube — a third of 19,500 — and 6,500 a tractor load.
    await assertSucceeds(addSale(as('sup1'), 'CUBE2345', sale('sup1', 'CUBE2345')));
    await assertSucceeds(
      addSale(
        as('sup1'),
        'TRAC2345',
        sale('sup1', 'TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 6500, amount: 13000, number: 2 }),
      ),
    );
    await assertFails(
      addSale(
        as('sup1'),
        'TRAC2346',
        sale('sup1', 'TRAC2346', { type: 'tractor', quantity: 2, unitPrice: 5000, amount: 10000, number: 3 }),
      ),
    );
  });

  it('a settings document from before tipper loads were counted in cubes reads as the defaults', async () => {
    await setPrices({ cubePrice: 8500, tractorPrice: 4500 });
    await assertSucceeds(addSale(as('sup1'), 'CUBE2345', sale('sup1', 'CUBE2345')));
    await assertFails(
      addSale(
        as('sup1'),
        'TRAC2345',
        sale('sup1', 'TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 4500, amount: 9000, number: 2 }),
      ),
    );
  });

  it('staff and the excavator crew add a sale priced from the settings; the compressor crew cannot', async () => {
    await setPrices({ tipperPrice: 21000, cubePrice: 7000, tractorPrice: 5000 });
    // A tipper by the cube: three at 7,000.
    await assertSucceeds(
      addSale(as('sup1'), 'CUBE2345', sale('sup1', 'CUBE2345', { unitPrice: 7000, amount: 21000 })),
    );
    // A tractor by the load, at its own price.
    await assertSucceeds(
      addSale(
        as('admin1'),
        'TRAC2345',
        sale('admin1', 'TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 5000, amount: 10000, number: 2 }),
      ),
    );
    // Not the cube's price, nor the defaults'.
    await assertFails(
      addSale(
        as('sup1'),
        'TRAC2346',
        sale('sup1', 'TRAC2346', { type: 'tractor', quantity: 2, unitPrice: 7000, amount: 14000, number: 3 }),
      ),
    );
    await assertFails(addSale(as('sup1'), 'DFLT2345', sale('sup1', 'DFLT2345', { number: 3 })));
    // The excavator crew load the trucks, so they bill them too — as
    // themselves, never as someone else.
    await assertFails(
      addSale(as('op1'), 'CREW2345', sale('sup1', 'CREW2345', { unitPrice: 7000, amount: 21000, number: 3 })),
    );
    await assertSucceeds(
      addSale(as('op1'), 'CREW2345', sale('op1', 'CREW2345', { unitPrice: 7000, amount: 21000, number: 3 })),
    );
    await assertFails(
      addSale(as('comp1'), 'COMP2345', sale('comp1', 'COMP2345', { unitPrice: 7000, amount: 21000, number: 4 })),
    );
  });

  it('a 2.5-cube tipper is priced the same way, whole and fractional numbers mixing', async () => {
    await setPrices();
    // 2.5 is stored as a double and 6500 as an integer; the sum has to hold
    // across the two, as it does when the operator app writes it.
    await assertSucceeds(
      addSale(as('sup1'), 'HALF2345', sale('sup1', 'HALF2345', { quantity: 2.5, unitPrice: 6500, amount: 16250 })),
    );
  });

  it('the price and the sum have to be the settings\' own', async () => {
    await setPrices();
    const db = as('sup1');
    // The tipper's own price, not the cube price every sale is written at.
    await assertFails(addSale(db, 'WHOLE234', sale('sup1', 'WHOLE234', { unitPrice: 19500, amount: 58500 })));
    await assertFails(addSale(db, 'CHEAP234', sale('sup1', 'CHEAP234', { unitPrice: 5000, amount: 15000 })));
    await assertFails(addSale(db, 'WRNGSUM2', sale('sup1', 'WRNGSUM2', { amount: 20000 })));
    await assertFails(addSale(db, 'ZERO2345', sale('sup1', 'ZERO2345', { quantity: 0, amount: 0 })));
    // The id is the code on the bill, in the bill's alphabet.
    await assertFails(addSale(db, 'THRX2345', sale('sup1', 'CUBE2345')));
    await assertFails(addSale(db, 'cube0001', sale('sup1', 'cube0001')));
    // Born pending, and dated by the server.
    await assertFails(addSale(db, 'VRFD2345', sale('sup1', 'VRFD2345', { status: 'verified' })));
  });

  it("each month's bills are numbered from 001 — none skipped, none used twice", async () => {
    await setPrices();
    const db = as('sup1');
    // The count moves with the sale, or neither is written.
    await assertFails(setDoc(doc(db, 'sales', 'ALNE2345'), sale('sup1', 'ALNE2345')));
    await assertFails(setDoc(doc(db, 'saleCounters', '2026-09'), { last: 1, lastCode: 'ALNE2345' }));
    // The month starts at 1, not wherever a client would like it to.
    await assertFails(addSale(db, 'FRST2345', sale('sup1', 'FRST2345', { number: 5 })));
    await assertSucceeds(addSale(db, 'FRST2345', sale('sup1', 'FRST2345')));
    // Neither repeated nor skipped.
    await assertFails(addSale(db, 'SAME2345', sale('sup1', 'SAME2345', { number: 1 })));
    await assertFails(addSale(db, 'SKPX2345', sale('sup1', 'SKPX2345', { number: 3 })));
    await assertSucceeds(addSale(db, 'NEXT2345', sale('sup1', 'NEXT2345', { number: 2 })));
    // A count moved on its own, pinned to a sale already written.
    await assertFails(setDoc(doc(db, 'saleCounters', '2026-09'), { last: 3, lastCode: 'NEXT2345' }));
    // A new month starts again at 1 — and a sale is counted in its own month.
    await assertSucceeds(addSale(db, 'NXMN2345', sale('sup1', 'NXMN2345', { date: '2026-10-01' }), '2026-10'));
    await assertFails(addSale(db, 'WRNG2345', sale('sup1', 'WRNG2345', { number: 2 }), '2026-10'));
    // Whoever sells reads the count, as the transaction does; the compressor
    // crew have no need.
    await assertSucceeds(getDoc(doc(db, 'saleCounters', '2026-09')));
    await assertSucceeds(getDoc(doc(as('op1'), 'saleCounters', '2026-09')));
    await assertFails(getDoc(doc(as('comp1'), 'saleCounters', '2026-09')));
  });

  it("a bill's invoice number points to its code, for anyone to read but never list", async () => {
    await setPrices();
    const db = as('sup1');
    await assertSucceeds(addSale(db, 'NDXA2345', sale('sup1', 'NDXA2345')));
    await assertSucceeds(getDoc(doc(as('op1'), 'saleIndex', '2026-09-1')));
    await assertFails(getDocs(collection(as('sup1'), 'saleIndex')));
    // Only ever written with the bill it names: a pointer set on its own —
    // ahead of a number, or at a bill already written — is refused, staff's
    // included, so no seller can hold a number's id against the real bill.
    await assertFails(setDoc(doc(as('op1'), 'saleIndex', '2026-09-2'), { code: 'NDXA2345' }));
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-2'), { code: 'NDXA2345' }));
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-9'), { code: 'NDXB2345' }));
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-2'), { code: 'not-a-code' }));
    // Pointed at the wrong number, the bill and its count are refused with it.
    const wrong = writeBatch(db);
    wrong.set(doc(db, 'sales', 'NDXC2345'), sale('sup1', 'NDXC2345', { number: 2 }));
    wrong.set(doc(db, 'saleCounters', '2026-09'), { last: 2, lastCode: 'NDXC2345' });
    wrong.set(doc(db, 'saleIndex', '2026-09-3'), { code: 'NDXC2345' });
    await assertFails(wrong.commit());
    // Set once; never repointed or removed.
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-1'), { code: 'NDXA2345' }));
    await assertFails(deleteDoc(doc(db, 'saleIndex', '2026-09-1')));
  });

  it('anyone looks a sale up by its code; staff list them all, the excavator crew their own', async () => {
    await seedSale('LOOK2345', 1);
    await assertSucceeds(getDoc(doc(as('op1'), 'sales', 'LOOK2345')));
    await assertSucceeds(getDoc(doc(as('comp1'), 'sales', 'LOOK2345')));
    await assertFails(getDocs(collection(as('op1'), 'sales')));
    await assertSucceeds(getDocs(collection(as('sup1'), 'sales')));
    // Only by asking for the ones they wrote — never anyone else's.
    const own = (uid: string, by = uid) => query(collection(as(uid), 'sales'), where('createdBy', '==', by));
    await assertSucceeds(getDocs(own('op1')));
    await assertFails(getDocs(own('op1', 'sup1')));
    await assertFails(getDocs(own('comp1')));
  });

  it('any role verifies a pending sale within the day — once', async () => {
    await seedSale('SCAN2345', 2);
    await assertFails(updateDoc(doc(as('op1'), 'sales', 'SCAN2345'), verify('comp1')));
    await assertSucceeds(updateDoc(doc(as('op1'), 'sales', 'SCAN2345'), verify('op1')));
    await assertFails(updateDoc(doc(as('comp1'), 'sales', 'SCAN2345'), verify('comp1')));
    // Nothing else about the sale changes with it.
    await seedSale('EDIT2345', 2);
    await assertFails(
      updateDoc(doc(as('op1'), 'sales', 'EDIT2345'), { ...verify('op1'), amount: 1 }),
    );
  });

  it('after 24 hours it can no longer be verified, and staff cancel it', async () => {
    await seedSale('LATE2345', 25);
    await assertFails(updateDoc(doc(as('op1'), 'sales', 'LATE2345'), verify('op1')));
    await assertFails(
      updateDoc(doc(as('op1'), 'sales', 'LATE2345'), { status: 'cancelled', cancelledAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(doc(as('sup1'), 'sales', 'LATE2345'), { status: 'cancelled', cancelledAt: serverTimestamp() }),
    );

    await seedSale('SOON2345', 3);
    await assertFails(
      updateDoc(doc(as('sup1'), 'sales', 'SOON2345'), { status: 'cancelled', cancelledAt: serverTimestamp() }),
    );
  });

  it('a prepaid bill is paid in cash, never lapses, and is verified whenever its load goes', async () => {
    const db = as('sup1');
    // Paid there and then, so never on credit.
    await assertFails(addSale(db, 'PCRD2345', sale('sup1', 'PCRD2345', { prepaid: true, paymentType: 'credit' })));
    await assertFails(addSale(db, 'PBAD2345', sale('sup1', 'PBAD2345', { prepaid: 'yes' })));
    await assertSucceeds(addSale(db, 'PREP2345', sale('sup1', 'PREP2345', { prepaid: true })));

    // A week on, the load goes: it can still be verified — once — but never
    // cancelled for running past its day.
    await seedSale('WEEK2345', 7 * 24, 'pending', { prepaid: true });
    await assertFails(
      updateDoc(doc(as('sup1'), 'sales', 'WEEK2345'), { status: 'cancelled', cancelledAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(doc(as('op1'), 'sales', 'WEEK2345'), verify('op1')));
    await assertFails(updateDoc(doc(as('comp1'), 'sales', 'WEEK2345'), verify('comp1')));
  });

  /** What the panel writes to put a bill right: 2 cubes at 6,500, for someone else. */
  const correction = (overrides: object = {}) => ({
    quantity: 2,
    amount: 13000,
    customerName: 'Perera',
    customerKey: 'perera',
    customerPhone: '0711234567',
    vehicleNo: 'WP LK-1234',
    material: 'boldas',
    paymentType: 'credit',
    note: 'corrected',
    ...overrides,
  });

  it('a supervisor corrects the bills they wrote, and no one else’s', async () => {
    await seedSale('OWNA2345', 2, 'pending', { createdBy: 'sup1' });
    await seedSale('OWNB2345', 2, 'pending', { createdBy: 'admin1' });
    await assertSucceeds(updateDoc(doc(as('sup1'), 'sales', 'OWNA2345'), correction()));
    await assertFails(updateDoc(doc(as('sup1'), 'sales', 'OWNB2345'), correction()));
    // What it may change is the same as for the admin: never the price or the number.
    await assertFails(updateDoc(doc(as('sup1'), 'sales', 'OWNA2345'), correction({ number: 9 })));
    await assertFails(updateDoc(doc(as('sup1'), 'sales', 'OWNA2345'), correction({ unitPrice: 1, amount: 2 })));
  });

  it('the admin corrects a bill in any state; a crew member never does', async () => {
    await seedSale('FIXA2345', 2, 'pending', { createdBy: 'admin1' });
    await assertFails(updateDoc(doc(as('sup1'), 'sales', 'FIXA2345'), correction()));
    await assertFails(updateDoc(doc(as('op1'), 'sales', 'FIXA2345'), correction()));
    await assertSucceeds(updateDoc(doc(as('admin1'), 'sales', 'FIXA2345'), correction()));

    // Verified income and a lapsed bill are put right as well.
    await seedSale('FIXB2345', 2, 'verified', { verifiedBy: 'sup1' });
    await assertSucceeds(updateDoc(doc(as('admin1'), 'sales', 'FIXB2345'), correction()));
    await seedSale('FIXC2345', 30, 'cancelled');
    await assertSucceeds(updateDoc(doc(as('admin1'), 'sales', 'FIXC2345'), correction()));
  });

  it('a corrected bill still adds up, at the price it was written at', async () => {
    await seedSale('SUMA2345', 2);
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ amount: 14000 })));
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ quantity: 0, amount: 0 })));
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ quantity: 'two' })));
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ material: 'gold' })));
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ paymentType: 'cheque' })));
    await assertFails(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ customerName: 7 })));
    // A fractional load, as the tipper takes.
    await assertSucceeds(updateDoc(doc(db, 'sales', 'SUMA2345'), correction({ quantity: 2.5, amount: 16250 })));
  });

  it('a correction never moves the price, the number, the date, the status or who wrote it', async () => {
    await seedSale('KEPA2345', 2);
    const db = as('admin1');
    const refused: object[] = [
      { unitPrice: 5000, amount: 10000 },
      { number: 9 },
      { date: '2026-09-14' },
      { status: 'verified' },
      { status: 'cancelled' },
      { createdBy: 'admin1' },
      { code: 'KEPB2345' },
      { type: 'tractor' },
      { prepaid: true },
      { machineCharge: 1 },
      { verifiedBy: 'admin1' },
    ];
    for (const change of refused) {
      await assertFails(updateDoc(doc(db, 'sales', 'KEPA2345'), correction(change)));
    }
  });

  it('a prepaid bill stays paid in cash through a correction', async () => {
    await seedSale('PRPA2345', 2, 'pending', { prepaid: true });
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'sales', 'PRPA2345'), correction({ paymentType: 'credit' })));
    await assertSucceeds(updateDoc(doc(db, 'sales', 'PRPA2345'), correction({ paymentType: 'cash' })));
  });

  it('a supervisor deletes the sale they wrote — pointer and all — and no one else’s', async () => {
    await setPrices();
    await assertSucceeds(addSale(as('sup1'), 'MYSA2345', sale('sup1', 'MYSA2345')));
    await assertSucceeds(addSale(as('admin1'), 'ADMA2345', sale('admin1', 'ADMA2345', { number: 2 })));

    // Another's bill, and its pointer, are not theirs to take.
    await assertFails(deleteDoc(doc(as('sup1'), 'sales', 'ADMA2345')));
    const theirs = as('sup1');
    const taking = writeBatch(theirs);
    taking.delete(doc(theirs, 'sales', 'ADMA2345'));
    taking.delete(doc(theirs, 'saleIndex', '2026-09-2'));
    await assertFails(taking.commit());

    // A pointer is not taken from a bill that is still there.
    await assertFails(deleteDoc(doc(as('sup1'), 'saleIndex', '2026-09-1')));
    const mine = as('sup1');
    const removal = writeBatch(mine);
    removal.delete(doc(mine, 'sales', 'MYSA2345'));
    removal.delete(doc(mine, 'saleIndex', '2026-09-1'));
    await assertSucceeds(removal.commit());
  });

  it('only the admin deletes a sale written by someone else, and its invoice pointer goes with it', async () => {
    await setPrices();
    await assertSucceeds(addSale(as('admin1'), 'DELA2345', sale('admin1', 'DELA2345')));
    await assertFails(deleteDoc(doc(as('sup1'), 'sales', 'DELA2345')));
    await assertFails(deleteDoc(doc(as('op1'), 'sales', 'DELA2345')));
    await assertFails(deleteDoc(doc(as('comp1'), 'sales', 'DELA2345')));

    // A pointer is not taken from a bill that is still there, nor by anyone
    // but the admin.
    await assertFails(deleteDoc(doc(as('admin1'), 'saleIndex', '2026-09-1')));
    const supervisor = as('sup1');
    const bySupervisor = writeBatch(supervisor);
    bySupervisor.delete(doc(supervisor, 'sales', 'DELA2345'));
    bySupervisor.delete(doc(supervisor, 'saleIndex', '2026-09-1'));
    await assertFails(bySupervisor.commit());

    const admin = as('admin1');
    const removal = writeBatch(admin);
    removal.delete(doc(admin, 'sales', 'DELA2345'));
    removal.delete(doc(admin, 'saleIndex', '2026-09-1'));
    await assertSucceeds(removal.commit());
  });

  /** Takes the bill, its pointer and one off the count — what the panel writes for the newest bill. */
  function removeNewest(db: Firestore, code: string, number: number, below: string, month = '2026-09') {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'sales', code));
    batch.delete(doc(db, 'saleIndex', `${month}-${number}`));
    batch.update(doc(db, 'saleCounters', month), { last: number - 1, lastCode: below });
    return batch.commit();
  }

  /** Three bills of September, written by the admin — so a supervisor has none of them to take away. */
  async function addThreeBills() {
    const db = as('admin1');
    await assertSucceeds(addSale(db, 'BLKA2345', sale('admin1', 'BLKA2345')));
    await assertSucceeds(addSale(db, 'BLKB2345', sale('admin1', 'BLKB2345', { number: 2 })));
    await assertSucceeds(addSale(db, 'BLKC2345', sale('admin1', 'BLKC2345', { number: 3 })));
  }

  it('a supervisor gives back the number of the newest bill they wrote, and of no one else’s', async () => {
    await setPrices();
    const db = as('sup1');
    await assertSucceeds(addSale(as('admin1'), 'ADMA2345', sale('admin1', 'ADMA2345')));
    await assertSucceeds(addSale(db, 'MYSB2345', sale('sup1', 'MYSB2345', { number: 2 })));

    // The newest is theirs: it comes off with the count.
    await assertSucceeds(removeNewest(db, 'MYSB2345', 2, 'ADMA2345'));
    expect((await getDoc(doc(db, 'saleCounters', '2026-09'))).data()).toEqual({ last: 1, lastCode: 'ADMA2345' });
    // The one before it is the admin's — not theirs to take back to nothing.
    await assertFails(removeNewest(db, 'ADMA2345', 1, ''));
    await assertSucceeds(removeNewest(as('admin1'), 'ADMA2345', 1, ''));
  });

  it("deleting the month's newest bill gives its number back — and only the newest's", async () => {
    await setPrices();
    await addThreeBills();
    const admin = as('admin1');

    // The count goes back with the bill it names, never on its own...
    const alone = writeBatch(admin);
    alone.update(doc(admin, 'saleCounters', '2026-09'), { last: 2, lastCode: 'BLKB2345' });
    await assertFails(alone.commit());
    // ...nor for a bill that is not the newest: a count moved down by one
    // while the newest bill is still there would hand its number out twice...
    const middle = writeBatch(admin);
    middle.delete(doc(admin, 'sales', 'BLKB2345'));
    middle.delete(doc(admin, 'saleIndex', '2026-09-2'));
    middle.update(doc(admin, 'saleCounters', '2026-09'), { last: 2, lastCode: 'BLKA2345' });
    await assertFails(middle.commit());
    await assertFails(removeNewest(admin, 'BLKB2345', 2, 'BLKA2345'));
    // ...nor by more than one, to a code that is no code, or at anyone else's hand.
    const byTwo = writeBatch(admin);
    byTwo.delete(doc(admin, 'sales', 'BLKC2345'));
    byTwo.delete(doc(admin, 'saleIndex', '2026-09-3'));
    byTwo.update(doc(admin, 'saleCounters', '2026-09'), { last: 1, lastCode: 'BLKA2345' });
    await assertFails(byTwo.commit());
    await assertFails(removeNewest(admin, 'BLKC2345', 3, 'not-a-code'));
    await assertFails(removeNewest(as('sup1'), 'BLKC2345', 3, 'BLKB2345'));

    await assertSucceeds(removeNewest(admin, 'BLKC2345', 3, 'BLKB2345'));
    const count = await getDoc(doc(as('sup1'), 'saleCounters', '2026-09'));
    expect(count.data()).toEqual({ last: 2, lastCode: 'BLKB2345' });

    // The freed number goes to the next bill, with a pointer of its own.
    await assertSucceeds(addSale(as('sup1'), 'BLKD2345', sale('sup1', 'BLKD2345', { number: 3 })));
    const pointer = await getDoc(doc(as('sup1'), 'saleIndex', '2026-09-3'));
    expect(pointer.data()).toEqual({ code: 'BLKD2345' });
  });

  it('a bill taken out of the middle leaves its number empty and the count where it was', async () => {
    await setPrices();
    await addThreeBills();
    const admin = as('admin1');

    const removal = writeBatch(admin);
    removal.delete(doc(admin, 'sales', 'BLKB2345'));
    removal.delete(doc(admin, 'saleIndex', '2026-09-2'));
    await assertSucceeds(removal.commit());

    // The count never goes back past a bill that is still there.
    const db = as('sup1');
    await assertFails(addSale(db, 'BLKD2345', sale('sup1', 'BLKD2345', { number: 2 })));
    await assertFails(addSale(db, 'BLKD2345', sale('sup1', 'BLKD2345', { number: 3 })));
    await assertSucceeds(addSale(db, 'BLKD2345', sale('sup1', 'BLKD2345', { number: 4 })));
  });

  it('with every bill of a month deleted, the month starts again at 001', async () => {
    await setPrices();
    const db = as('sup1');
    await assertSucceeds(addSale(db, 'BLKA2345', sale('sup1', 'BLKA2345')));
    await assertSucceeds(addSale(db, 'BLKB2345', sale('sup1', 'BLKB2345', { number: 2 })));
    const admin = as('admin1');
    await assertSucceeds(removeNewest(admin, 'BLKB2345', 2, 'BLKA2345'));
    await assertSucceeds(removeNewest(admin, 'BLKA2345', 1, ''));

    await assertFails(addSale(db, 'BLKC2345', sale('sup1', 'BLKC2345', { number: 2 })));
    await assertSucceeds(addSale(db, 'BLKC2345', sale('sup1', 'BLKC2345')));
  });

  it('a sale is deleted whole or not at all: a bill from before bills were numbered goes alone', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      const unnumbered = Object.entries(sale('admin1', 'OLDA2345', { status: 'cancelled' })).filter(
        ([key]) => key !== 'number',
      );
      await setDoc(doc(db, 'sales', 'OLDA2345'), {
        ...Object.fromEntries(unnumbered),
        createdAt: Timestamp.fromMillis(Date.now() - 30 * 3_600_000),
      });
    });
    await assertFails(deleteDoc(doc(as('sup1'), 'sales', 'OLDA2345')));
    await assertSucceeds(deleteDoc(doc(as('admin1'), 'sales', 'OLDA2345')));
  });
});
