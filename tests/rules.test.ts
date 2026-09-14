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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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
      op1: { name: 'Kamal', role: 'operator', machineId: 'ex1', leaveDays: 0, advanceAmount: 0, bonusTotal: 0 },
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

  it('a supervisor sets the three තොරතුරු figures and nothing else', async () => {
    const record = doc(as('sup1'), 'operators', 'op1');
    await assertSucceeds(updateDoc(record, { advanceAmount: 5000, leaveDays: 2 }));
    await assertFails(updateDoc(record, { role: 'admin' }));
    await assertFails(updateDoc(record, { dailyWage: 4000 }));
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
  async function setPrices() {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'settings', 'sales'), { cubePrice: 8500, tractorPrice: 4500 });
    });
  }

  const sale = (by: string, code: string, overrides: object = {}) => ({
    code,
    type: 'cube',
    quantity: 3,
    unitPrice: 8500,
    amount: 25500,
    customerName: 'Silva',
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
  async function seedSale(code: string, hoursAgo: number, status = 'pending') {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'sales', code), {
        ...sale('sup1', code, { status }),
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

  it('only the admin sets the prices, and never to nothing', async () => {
    await assertSucceeds(setDoc(doc(as('admin1'), 'settings', 'sales'), { cubePrice: 9000, tractorPrice: 5000 }));
    await assertFails(setDoc(doc(as('sup1'), 'settings', 'sales'), { cubePrice: 1, tractorPrice: 1 }));
    await assertFails(setDoc(doc(as('admin1'), 'settings', 'sales'), { cubePrice: 0, tractorPrice: 5000 }));
    await assertSucceeds(getDoc(doc(as('op1'), 'settings', 'sales')));
  });

  it('staff add a sale priced from the settings; crews cannot', async () => {
    await setPrices();
    await assertSucceeds(addSale(as('sup1'), 'CUBE2345', sale('sup1', 'CUBE2345')));
    await assertSucceeds(
      addSale(
        as('admin1'),
        'TRAC2345',
        sale('admin1', 'TRAC2345', { type: 'tractor', quantity: 2, unitPrice: 4500, amount: 9000, number: 2 }),
      ),
    );
    await assertFails(addSale(as('op1'), 'CREW2345', sale('op1', 'CREW2345', { number: 3 })));
  });

  it('a part-cube is priced the same way, whole and fractional numbers mixing', async () => {
    await setPrices();
    // 2.5 is stored as a double and 8500 as an integer; the sum has to hold
    // across the two, as it does when the operator app writes it.
    await assertSucceeds(
      addSale(as('sup1'), 'HALF2345', sale('sup1', 'HALF2345', { quantity: 2.5, unitPrice: 8500, amount: 21250 })),
    );
  });

  it('the price and the sum have to be the settings\' own', async () => {
    await setPrices();
    const db = as('sup1');
    await assertFails(addSale(db, 'CHEAP234', sale('sup1', 'CHEAP234', { unitPrice: 5000, amount: 15000 })));
    await assertFails(addSale(db, 'WRNGSUM2', sale('sup1', 'WRNGSUM2', { amount: 20000 })));
    await assertFails(addSale(db, 'TYPE2345', sale('sup1', 'TYPE2345', { type: 'tractor' })));
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
    // Staff read the count, as the transaction does; the crews have no need.
    await assertSucceeds(getDoc(doc(db, 'saleCounters', '2026-09')));
    await assertFails(getDoc(doc(as('op1'), 'saleCounters', '2026-09')));
  });

  it("a bill's invoice number points to its code, for anyone to read but never list", async () => {
    await setPrices();
    const db = as('sup1');
    await assertSucceeds(addSale(db, 'NDXA2345', sale('sup1', 'NDXA2345')));
    await assertSucceeds(getDoc(doc(as('op1'), 'saleIndex', '2026-09-1')));
    await assertFails(getDocs(collection(as('sup1'), 'saleIndex')));
    // Only staff point one at a code, and only a real bill's code.
    await assertFails(setDoc(doc(as('op1'), 'saleIndex', '2026-09-2'), { code: 'NDXA2345' }));
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-2'), { code: 'not-a-code' }));
    // Set once; never repointed or removed.
    await assertFails(setDoc(doc(db, 'saleIndex', '2026-09-1'), { code: 'NDXA2345' }));
    await assertFails(deleteDoc(doc(db, 'saleIndex', '2026-09-1')));
  });

  it('anyone looks a sale up by its code; only staff list them', async () => {
    await seedSale('LOOK2345', 1);
    await assertSucceeds(getDoc(doc(as('op1'), 'sales', 'LOOK2345')));
    await assertSucceeds(getDoc(doc(as('comp1'), 'sales', 'LOOK2345')));
    await assertFails(getDocs(collection(as('op1'), 'sales')));
    await assertSucceeds(getDocs(collection(as('sup1'), 'sales')));
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

  it('no sale is ever deleted', async () => {
    await seedSale('KEEP2345', 30, 'cancelled');
    await assertFails(deleteDoc(doc(as('admin1'), 'sales', 'KEEP2345')));
  });
});
