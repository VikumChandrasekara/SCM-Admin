import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteSale, updateSale } from '../src/data/sales';
import type { Person } from '../src/lib/model';
import type { SaleEdit } from '../src/lib/saleEdit';

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

const person = (id: string, role: Person['role']): Person => ({
  id,
  name: id,
  username: id,
  machineId: '',
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
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

const auditLog = () =>
  direct(async (db) => (await getDocs(collection(db, 'auditLog'))).docs.map((entry) => entry.data()));

const codeOf = (number: number) => `BLK${'ABCDE'[number - 1]}2345`;

const sale = (number: number | null, overrides: object = {}) => {
  const fields = {
    code: number == null ? 'OLDX2345' : codeOf(number),
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
    status: 'verified',
    createdBy: 'sup1',
    createdByName: 'sup1',
    createdAt: Timestamp.now(),
    ...overrides,
  };
  return number == null ? fields : { ...fields, number };
};

/** Bills 1…[count] of September, written the way the apps write them. */
function seedBills(count: number) {
  return direct(async (db) => {
    for (let number = 1; number <= count; number++) {
      await setDoc(doc(db, 'sales', codeOf(number)), sale(number));
      await setDoc(doc(db, 'saleIndex', `2026-09-${number}`), { code: codeOf(number) });
    }
    await setDoc(doc(db, 'saleCounters', '2026-09'), { last: count, lastCode: codeOf(count) });
  });
}

const edit: SaleEdit = {
  quantity: 2,
  customerName: ' Perera ',
  customerPhone: '',
  vehicleNo: 'wp lk-1',
  material: 'boldas',
  paymentType: 'credit',
  note: 'gate 2',
};

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

describe('deleting a bill', () => {
  it("takes the month's newest with its pointer, gives its number back and logs it", async () => {
    await seedBills(3);
    signIn('admin1');

    expect(await deleteSale(codeOf(3), admin)).toBe(3);
    expect(await data(`sales/${codeOf(3)}`)).toBeUndefined();
    expect(await data('saleIndex/2026-09-3')).toBeUndefined();
    expect(await data('saleIndex/2026-09-2')).toEqual({ code: codeOf(2) });
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: codeOf(2) });

    const [entry, ...rest] = await auditLog();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'sales.delete', entityType: 'sale', entityId: codeOf(3), createdBy: 'admin1' });
    expect(entry.summary).toContain(codeOf(3));

    // A repeat after a dropped line finds nothing left, and logs nothing more.
    expect(await deleteSale(codeOf(3), admin)).toBeNull();
    expect(await auditLog()).toHaveLength(1);
  });

  it('leaves the count where it was for a bill from the middle, and its number empty', async () => {
    await seedBills(3);
    signIn('admin1');

    expect(await deleteSale(codeOf(2), admin)).toBeNull();
    expect(await data(`sales/${codeOf(2)}`)).toBeUndefined();
    expect(await data('saleIndex/2026-09-2')).toBeUndefined();
    expect(await data('saleCounters/2026-09')).toEqual({ last: 3, lastCode: codeOf(3) });

    // The newest then goes back to the empty number, not past a bill still there.
    expect(await deleteSale(codeOf(3), admin)).toBe(3);
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: '' });
    // Which is no longer the top: bill 1 leaves a gap in its turn.
    expect(await deleteSale(codeOf(1), admin)).toBeNull();
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: '' });
  });

  it('starts the month again at 001 once its last bill is gone', async () => {
    await seedBills(1);
    signIn('admin1');

    expect(await deleteSale(codeOf(1), admin)).toBe(1);
    expect(await data('saleCounters/2026-09')).toEqual({ last: 0, lastCode: '' });
  });

  it('removes a bill from before bills were numbered on its own', async () => {
    await direct((db) => setDoc(doc(db, 'sales', 'OLDX2345'), sale(null)));
    signIn('admin1');

    expect(await deleteSale('OLDX2345', admin)).toBeNull();
    expect(await data('sales/OLDX2345')).toBeUndefined();
    expect(await auditLog()).toHaveLength(1);
  });

  it('is refused for anyone but the admin, and nothing is half-done', async () => {
    await seedBills(2);
    signIn('sup1');

    await expect(deleteSale(codeOf(2), supervisor)).rejects.toThrow();
    expect(await data(`sales/${codeOf(2)}`)).toBeDefined();
    expect(await data('saleIndex/2026-09-2')).toBeDefined();
    expect(await data('saleCounters/2026-09')).toEqual({ last: 2, lastCode: codeOf(2) });
    expect(await auditLog()).toEqual([]);
  });
});

describe('correcting a bill', () => {
  it('rewrites the sum at its own price, keeps the rest, and logs what moved — once', async () => {
    await seedBills(1);
    signIn('admin1');

    await updateSale(codeOf(1), edit, admin);
    expect(await data(`sales/${codeOf(1)}`)).toMatchObject({
      quantity: 2,
      amount: 13000,
      unitPrice: 6500,
      customerName: 'Perera',
      customerKey: 'perera',
      vehicleNo: 'WP LK-1',
      material: 'boldas',
      paymentType: 'credit',
      note: 'gate 2',
      number: 1,
      status: 'verified',
      date: '2026-09-13',
    });

    const [entry, ...rest] = await auditLog();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ action: 'sales.update', entityType: 'sale', entityId: codeOf(1) });
    expect(entry.summary).toContain('ප්‍රමාණය: 3 → 2');

    // The same correction again changes nothing, so it logs nothing.
    await updateSale(codeOf(1), edit, admin);
    expect(await auditLog()).toHaveLength(1);
  });

  it('says so when the bill has been removed in the meantime', async () => {
    signIn('admin1');
    await expect(updateSale(codeOf(1), edit, admin)).rejects.toThrow('ඉවත් කර ඇත');
  });

  it('is refused for anyone but the admin', async () => {
    await seedBills(1);
    signIn('sup1');

    await expect(updateSale(codeOf(1), edit, supervisor)).rejects.toThrow();
    expect(await data(`sales/${codeOf(1)}`)).toMatchObject({ quantity: 3, amount: 19500, customerName: 'Silva' });
    expect(await auditLog()).toEqual([]);
  });
});
