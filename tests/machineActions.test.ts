import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { assignMachine, createMachine, resetService, setServiceDue, updateMachine } from '../src/data/machines';
import { machineFrom, type MachineDetails, type Person } from '../src/lib/model';

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
const driller = person('comp1', 'compressor', 'cp1');
const people = [admin, supervisor, operator, driller];

const excavator: MachineDetails = {
  type: 'excavator',
  name: 'CAT 320D',
  model: '320D',
  registrationNo: 'LB-1234',
  notes: '',
  active: true,
};

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

/** A machine as the panel holds it, read back from the database. */
async function machineNow(id: string) {
  return machineFrom(id, (await data(`machines/${id}`)) ?? {});
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
    await setDoc(doc(db, 'operators', 'op1'), { name: 'Kamal', role: 'operator', machineId: 'ex1' });
    await setDoc(doc(db, 'operators', 'comp1'), { name: 'Ruwan', role: 'compressor', machineId: 'cp1' });
    // Set up before machines had a kind or details.
    await setDoc(doc(db, 'machines', 'ex1'), { totalHours: 6789.7, serviceDueAt: { engineOil: 7000 } });
    await setDoc(doc(db, 'machines', 'cp1'), { totalHours: 50, serviceDueAt: {} });
    await setDoc(doc(db, 'machines', 'ex2'), { totalHours: 10, serviceDueAt: {}, type: 'excavator' });
    await setDoc(doc(db, 'machines', 'ex3'), { totalHours: 10, serviceDueAt: {}, type: 'excavator', active: false });
    await setDoc(doc(db, 'machines', 'cp2'), { totalHours: 10, serviceDueAt: {}, type: 'compressor' });
  });
});

describe('setting up a machine', () => {
  it('writes its details, the meter it counts from and a service due an interval on — and logs it', async () => {
    signIn('admin1');
    await createMachine('ex9', excavator, 1200, admin);

    expect(await data('machines/ex9')).toMatchObject({
      ...excavator,
      totalHours: 1200,
      // An excavator crew service three parts, each due one interval on — and
      // the machine itself is due its 10,000 hour service.
      serviceDueAt: { engineOil: 1450, dieselFilter: 1450, hydraulicFilter: 3200, majorService: 11200 },
    });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({
      action: 'machine.create',
      entityType: 'machine',
      entityId: 'ex9',
      source: 'panel',
      createdBy: 'admin1',
    });
    expect(entry.summary).toContain('CAT 320D');
    expect(entry.summary).toContain('1200');
  });

  it('gives a compressor only the parts a compressor has', async () => {
    signIn('sup1');
    await createMachine('cp9', { ...excavator, type: 'compressor', name: 'Atlas' }, 0, supervisor);
    expect((await data('machines/cp9'))?.serviceDueAt).toEqual({
      engineOil: 250,
      dieselFilter: 250,
      majorService: 10000,
    });
  });

  it('is the supervisor’s to do as well, and never the crew’s', async () => {
    signIn('sup1');
    await createMachine('ex8', excavator, 0, supervisor);
    expect(await data('machines/ex8')).toBeDefined();

    signIn('op1');
    await expect(createMachine('ex7', excavator, 0, operator)).rejects.toThrow();
    expect(await data('machines/ex7')).toBeUndefined();
  });

  it('refuses a number already taken, rather than resetting that machine’s meter', async () => {
    signIn('admin1');
    await expect(createMachine('ex1', excavator, 0, admin)).rejects.toThrow(/ex1/);
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6789.7 });
    expect(await auditLog()).toHaveLength(0);
  });

  it('refuses an id, a meter or a detail that cannot be right before anything is written', async () => {
    signIn('admin1');
    await expect(createMachine('ex 9', excavator, 0, admin)).rejects.toThrow();
    await expect(createMachine('ex9', excavator, -5, admin)).rejects.toThrow();
    await expect(createMachine('ex9', { ...excavator, name: 'x'.repeat(101) }, 0, admin)).rejects.toThrow();
    expect(await data('machines/ex9')).toBeUndefined();
    expect(await data('machines/ex 9')).toBeUndefined();
  });
});

describe('the 10,000 hour service', () => {
  it('is given a meter reading by staff — how a machine already running gets one — and logged', async () => {
    signIn('sup1');
    await setServiceDue(await machineNow('ex1'), 'majorService', 10000, supervisor);

    // The meter and the other services are left as they were.
    expect(await data('machines/ex1')).toMatchObject({
      totalHours: 6789.7,
      serviceDueAt: { engineOil: 7000, majorService: 10000 },
    });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'service.set', entityType: 'machine', entityId: 'ex1', createdBy: 'sup1' });
    expect(entry.summary).toBe('10,000 පැය සේවාව: ඊළඟ සේවාව — → 10000');
  });

  it('can be put right, and logs nothing when the reading is the one it already has', async () => {
    signIn('admin1');
    await setServiceDue(await machineNow('ex1'), 'majorService', 10000, admin);
    await setServiceDue(await machineNow('ex1'), 'majorService', 10000, admin);
    expect(await auditLog()).toHaveLength(1);

    await setServiceDue(await machineNow('ex1'), 'majorService', 9800, admin);
    expect((await data('machines/ex1'))?.serviceDueAt.majorService).toBe(9800);
    expect((await auditLog()).map((entry) => entry.summary)).toContain('10,000 පැය සේවාව: ඊළඟ සේවාව 10000 → 9800');
  });

  it('refuses a reading that cannot be right before anything is written', async () => {
    signIn('admin1');
    await expect(setServiceDue(await machineNow('ex1'), 'majorService', -1, admin)).rejects.toThrow();
    await expect(setServiceDue(await machineNow('ex1'), 'majorService', Number.NaN, admin)).rejects.toThrow();
    expect((await data('machines/ex1'))?.serviceDueAt).toEqual({ engineOil: 7000 });
    expect(await auditLog()).toHaveLength(0);
  });

  it('is not the crew’s to set', async () => {
    signIn('op1');
    await expect(setServiceDue(await machineNow('ex1'), 'majorService', 10000, operator)).rejects.toThrow();
    expect((await data('machines/ex1'))?.serviceDueAt).toEqual({ engineOil: 7000 });
  });

  it('once done, falls due a whole interval on from the meter — and takes nothing from the store', async () => {
    signIn('admin1');
    await setServiceDue(await machineNow('ex1'), 'majorService', 6800, admin);
    await resetService(await machineNow('ex1'), 'majorService', null, operator, admin);

    const { serviceDueAt } = (await data('machines/ex1')) ?? {};
    expect(serviceDueAt.majorService).toBeCloseTo(6789.7 + 10000, 5);
    expect(serviceDueAt.engineOil).toBe(7000);
    expect((await auditLog()).map((entry) => entry.action).sort()).toEqual(['service.reset', 'service.set']);
    expect(await direct(async (db) => (await getDocs(collection(db, 'storeMovements'))).size)).toBe(0);
  });
});

describe('putting a machine’s details right', () => {
  it('saves them, logging exactly what changed', async () => {
    signIn('sup1');
    const before = await machineNow('ex2');
    await updateMachine(before, { ...excavator, registrationNo: '' }, [], supervisor);

    expect(await data('machines/ex2')).toMatchObject({ name: 'CAT 320D', model: '320D', type: 'excavator' });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'machine.update', entityId: 'ex2', createdBy: 'sup1' });
    expect(entry.summary).toBe('නම: — → CAT 320D · මාදිලිය: — → 320D');
  });

  it('logs nothing when nothing changed', async () => {
    signIn('admin1');
    await updateMachine(await machineNow('ex2'), { ...excavator, name: '', model: '', registrationNo: '' }, [], admin);
    expect(await auditLog()).toHaveLength(0);
  });

  it('gives a machine with no kind yet the kind of its crew, and keeps it', async () => {
    signIn('sup1');
    const before = await machineNow('ex1');
    await updateMachine(before, excavator, [operator], supervisor);
    expect(await data('machines/ex1')).toMatchObject({ type: 'excavator', name: 'CAT 320D' });
    // The meter and the service are left as they were.
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6789.7, serviceDueAt: { engineOil: 7000 } });

    // Its kind cannot be changed once it has one.
    const typed = await machineNow('ex1');
    await expect(updateMachine(typed, { ...excavator, type: 'compressor' }, [], supervisor)).rejects.toThrow();
    expect((await data('machines/ex1'))?.type).toBe('excavator');
  });

  it('refuses a kind that its crew do not work', async () => {
    signIn('sup1');
    await expect(
      updateMachine(await machineNow('ex1'), { ...excavator, type: 'compressor' }, [operator], supervisor),
    ).rejects.toThrow();
    expect((await data('machines/ex1'))?.type).toBeUndefined();
  });

  it('retires a machine and brings it back, with its history', async () => {
    signIn('admin1');
    const plain = { ...excavator, name: '', model: '', registrationNo: '' };
    await updateMachine(await machineNow('ex2'), { ...plain, active: false }, [], admin);
    expect((await data('machines/ex2'))?.active).toBe(false);
    await updateMachine(await machineNow('ex2'), { ...plain, active: true }, [], admin);
    expect((await data('machines/ex2'))?.active).toBe(true);
    expect((await auditLog()).map((entry) => entry.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining('විශ්‍රාම'), expect.stringContaining('නැවත ක්‍රියාත්මක')]),
    );
  });

  it('is not the crew’s to do', async () => {
    signIn('op1');
    await expect(updateMachine(await machineNow('ex2'), excavator, [], operator)).rejects.toThrow();
    expect((await data('machines/ex2'))?.name).toBeUndefined();
  });
});

describe('putting a crew member on a machine', () => {
  it('moves them, and logs where from and to', async () => {
    signIn('sup1');
    await assignMachine(operator, await machineNow('ex2'), people, supervisor);

    expect(await data('operators/op1')).toMatchObject({ machineId: 'ex2' });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({
      action: 'machine.assign',
      entityType: 'operator',
      entityId: 'op1',
      entityLabel: 'op1',
      summary: 'යන්ත්‍රය: ex1 → ex2',
      createdBy: 'sup1',
    });
  });

  it('is the admin’s to do as well, and does nothing when they are on it already', async () => {
    signIn('admin1');
    await assignMachine(driller, await machineNow('cp2'), people, admin);
    expect(await data('operators/comp1')).toMatchObject({ machineId: 'cp2' });

    await assignMachine({ ...driller, machineId: 'cp2' }, await machineNow('cp2'), people, admin);
    expect(await auditLog()).toHaveLength(1);
  });

  it('leaves the hours already worked with the machine they were worked on', async () => {
    await direct(async (db) => {
      await setDoc(doc(db, 'machines', 'ex1', 'months', '2026-10'), { month: '2026-10', hours: 90, loads: 120 });
    });
    signIn('sup1');
    await assignMachine(operator, await machineNow('ex2'), people, supervisor);
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 90, loads: 120 });
    expect(await data('machines/ex2/months/2026-10')).toBeUndefined();
  });

  it('refuses a machine of the other kind, a retired one, and a person who is not crew', async () => {
    signIn('sup1');
    await expect(assignMachine(operator, await machineNow('cp2'), people, supervisor)).rejects.toThrow();
    await expect(assignMachine(driller, await machineNow('ex2'), people, supervisor)).rejects.toThrow();
    await expect(assignMachine(operator, await machineNow('ex3'), people, supervisor)).rejects.toThrow();
    await expect(assignMachine(supervisor, await machineNow('ex2'), people, supervisor)).rejects.toThrow();

    expect(await data('operators/op1')).toMatchObject({ machineId: 'ex1' });
    expect(await data('operators/comp1')).toMatchObject({ machineId: 'cp1' });
    expect(await auditLog()).toHaveLength(0);
  });

  it('reads a machine with no kind yet from the crew on it', async () => {
    signIn('sup1');
    // cp1 has a compressor driller on it, so an operator cannot go there.
    await expect(assignMachine(operator, await machineNow('cp1'), people, supervisor)).rejects.toThrow();
  });

  it('is not the crew’s to do for themselves', async () => {
    signIn('op1');
    await expect(assignMachine(operator, await machineNow('ex2'), people, operator)).rejects.toThrow();
    expect(await data('operators/op1')).toMatchObject({ machineId: 'ex1' });
  });
});
