import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMachineType,
  deleteMachineType,
  restoreMachineType,
  updateMachineType,
  type MachineTypeChanges,
} from '../src/data/machineTypes';
import {
  assignMachine,
  createMachine,
  deleteMachine,
  resetService,
  setServiceDue,
  updateMachine,
} from '../src/data/machines';
import {
  BUILT_IN_TYPES,
  machineFrom,
  machineTypeDef,
  machineTypeDefFrom,
  machineTypesFrom,
  pickableTypes,
  type MachineDetails,
  type Person,
} from '../src/lib/model';

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
    await createMachine('ex9', excavator, 1200, BUILT_IN_TYPES, admin);

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
    await createMachine('cp9', { ...excavator, type: 'compressor', name: 'Atlas' }, 0, BUILT_IN_TYPES, supervisor);
    expect((await data('machines/cp9'))?.serviceDueAt).toEqual({
      engineOil: 250,
      dieselFilter: 250,
      majorService: 10000,
    });
  });

  it('is the supervisor’s to do as well, and never the crew’s', async () => {
    signIn('sup1');
    await createMachine('ex8', excavator, 0, BUILT_IN_TYPES, supervisor);
    expect(await data('machines/ex8')).toBeDefined();

    signIn('op1');
    await expect(createMachine('ex7', excavator, 0, BUILT_IN_TYPES, operator)).rejects.toThrow();
    expect(await data('machines/ex7')).toBeUndefined();
  });

  it('refuses a number already taken, rather than resetting that machine’s meter', async () => {
    signIn('admin1');
    await expect(createMachine('ex1', excavator, 0, BUILT_IN_TYPES, admin)).rejects.toThrow(/ex1/);
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6789.7 });
    expect(await auditLog()).toHaveLength(0);
  });

  it('refuses an id, a meter or a detail that cannot be right before anything is written', async () => {
    signIn('admin1');
    await expect(createMachine('ex 9', excavator, 0, BUILT_IN_TYPES, admin)).rejects.toThrow();
    await expect(createMachine('ex9', excavator, -5, BUILT_IN_TYPES, admin)).rejects.toThrow();
    await expect(createMachine('ex9', { ...excavator, name: 'x'.repeat(101) }, 0, BUILT_IN_TYPES, admin)).rejects.toThrow();
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
    await updateMachine(before, { ...excavator, registrationNo: '' }, [], BUILT_IN_TYPES, supervisor);

    expect(await data('machines/ex2')).toMatchObject({ name: 'CAT 320D', model: '320D', type: 'excavator' });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'machine.update', entityId: 'ex2', createdBy: 'sup1' });
    expect(entry.summary).toBe('නම: — → CAT 320D · මාදිලිය: — → 320D');
  });

  it('logs nothing when nothing changed', async () => {
    signIn('admin1');
    await updateMachine(await machineNow('ex2'), { ...excavator, name: '', model: '', registrationNo: '' }, [], BUILT_IN_TYPES, admin);
    expect(await auditLog()).toHaveLength(0);
  });

  it('gives a machine with no kind yet the kind of its crew, and keeps it', async () => {
    signIn('sup1');
    const before = await machineNow('ex1');
    await updateMachine(before, excavator, [operator], BUILT_IN_TYPES, supervisor);
    expect(await data('machines/ex1')).toMatchObject({ type: 'excavator', name: 'CAT 320D' });
    // The meter and the service are left as they were.
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 6789.7, serviceDueAt: { engineOil: 7000 } });

    // Its kind can be put right later, once no crew are on it.
    const typed = await machineNow('ex1');
    await updateMachine(typed, { ...excavator, type: 'compressor' }, [], BUILT_IN_TYPES, supervisor);
    expect((await data('machines/ex1'))?.type).toBe('compressor');
  });

  it('refuses a kind that its crew do not work', async () => {
    signIn('sup1');
    await expect(
      updateMachine(await machineNow('ex1'), { ...excavator, type: 'compressor' }, [operator], BUILT_IN_TYPES, supervisor),
    ).rejects.toThrow();
    expect((await data('machines/ex1'))?.type).toBeUndefined();
  });

  it('retires a machine and brings it back, with its history', async () => {
    signIn('admin1');
    const plain = { ...excavator, name: '', model: '', registrationNo: '' };
    await updateMachine(await machineNow('ex2'), { ...plain, active: false }, [], BUILT_IN_TYPES, admin);
    expect((await data('machines/ex2'))?.active).toBe(false);
    await updateMachine(await machineNow('ex2'), { ...plain, active: true }, [], BUILT_IN_TYPES, admin);
    expect((await data('machines/ex2'))?.active).toBe(true);
    expect((await auditLog()).map((entry) => entry.summary)).toEqual(
      expect.arrayContaining([expect.stringContaining('විශ්‍රාම'), expect.stringContaining('නැවත ක්‍රියාත්මක')]),
    );
  });

  it('is not the crew’s to do', async () => {
    signIn('op1');
    await expect(updateMachine(await machineNow('ex2'), excavator, [], BUILT_IN_TYPES, operator)).rejects.toThrow();
    expect((await data('machines/ex2'))?.name).toBeUndefined();
  });
});

describe('putting a crew member on a machine', () => {
  it('moves them, and logs where from and to', async () => {
    signIn('sup1');
    await assignMachine(operator, await machineNow('ex2'), people, BUILT_IN_TYPES, supervisor);

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
    await assignMachine(driller, await machineNow('cp2'), people, BUILT_IN_TYPES, admin);
    expect(await data('operators/comp1')).toMatchObject({ machineId: 'cp2' });

    await assignMachine({ ...driller, machineId: 'cp2' }, await machineNow('cp2'), people, BUILT_IN_TYPES, admin);
    expect(await auditLog()).toHaveLength(1);
  });

  it('leaves the hours already worked with the machine they were worked on', async () => {
    await direct(async (db) => {
      await setDoc(doc(db, 'machines', 'ex1', 'months', '2026-10'), { month: '2026-10', hours: 90, loads: 120 });
    });
    signIn('sup1');
    await assignMachine(operator, await machineNow('ex2'), people, BUILT_IN_TYPES, supervisor);
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ hours: 90, loads: 120 });
    expect(await data('machines/ex2/months/2026-10')).toBeUndefined();
  });

  it('refuses a machine of the other kind, a retired one, and a person who is not crew', async () => {
    signIn('sup1');
    await expect(assignMachine(operator, await machineNow('cp2'), people, BUILT_IN_TYPES, supervisor)).rejects.toThrow();
    await expect(assignMachine(driller, await machineNow('ex2'), people, BUILT_IN_TYPES, supervisor)).rejects.toThrow();
    await expect(assignMachine(operator, await machineNow('ex3'), people, BUILT_IN_TYPES, supervisor)).rejects.toThrow();
    await expect(assignMachine(supervisor, await machineNow('ex2'), people, BUILT_IN_TYPES, supervisor)).rejects.toThrow();

    expect(await data('operators/op1')).toMatchObject({ machineId: 'ex1' });
    expect(await data('operators/comp1')).toMatchObject({ machineId: 'cp1' });
    expect(await auditLog()).toHaveLength(0);
  });

  it('reads a machine with no kind yet from the crew on it', async () => {
    signIn('sup1');
    // cp1 has a compressor driller on it, so an operator cannot go there.
    await expect(assignMachine(operator, await machineNow('cp1'), people, BUILT_IN_TYPES, supervisor)).rejects.toThrow();
  });

  it('is not the crew’s to do for themselves', async () => {
    signIn('op1');
    await expect(assignMachine(operator, await machineNow('ex2'), people, BUILT_IN_TYPES, operator)).rejects.toThrow();
    expect(await data('operators/op1')).toMatchObject({ machineId: 'ex1' });
  });
});

describe('machine types an admin adds', () => {
  /** The types as the panel would hold them: the built-in two and what is stored. */
  async function typesNow() {
    const added = await direct(async (db) =>
      (await getDocs(collection(db, 'machineTypes'))).docs.map((entry) => machineTypeDefFrom(entry.id, entry.data())),
    );
    return machineTypesFrom(added);
  }

  it('are added with a name and a kind, and logged', async () => {
    signIn('admin1');
    const id = await createMachineType('  ට්‍රක් රථය ', 'Truck', 'none', BUILT_IN_TYPES, admin);

    expect(await data(`machineTypes/${id}`)).toEqual({ label: 'ට්‍රක් රථය', english: 'Truck', kind: 'none', meterUnit: 'h' });
    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'machine.typeCreate', entityType: 'machine', entityId: id, createdBy: 'admin1' });
  });

  it('carry what their meter counts, hours unless they are given kilometres', async () => {
    signIn('admin1');
    const lorry = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin, 'km');
    const crane = await createMachineType('ක්‍රේන්', '', 'none', BUILT_IN_TYPES, admin);
    expect(await data(`machineTypes/${lorry}`)).toMatchObject({ meterUnit: 'km' });
    const types = await typesNow();
    expect(machineTypeDef(types, lorry).meterUnit).toBe('km');
    expect(machineTypeDef(types, crane).meterUnit).toBe('h');
    expect(types.get('excavator')?.meterUnit).toBe('h');
  });

  it('are the admin’s to add, and no one else’s', async () => {
    signIn('sup1');
    await expect(createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, supervisor)).rejects.toThrow();
    signIn('op1');
    await expect(createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, operator)).rejects.toThrow();
    expect((await typesNow()).size).toBe(2);
  });

  it('are refused for a name that is empty, too long or already taken, before anything is written', async () => {
    signIn('admin1');
    await expect(createMachineType('   ', '', 'none', BUILT_IN_TYPES, admin)).rejects.toThrow();
    await expect(createMachineType('x'.repeat(41), '', 'none', BUILT_IN_TYPES, admin)).rejects.toThrow();
    await expect(createMachineType('කම්පසර්', '', 'none', BUILT_IN_TYPES, admin)).rejects.toThrow(/දැනටමත්/);
    expect((await typesNow()).size).toBe(2);
    expect(await auditLog()).toHaveLength(0);
  });

  it('make machines that are serviced, and crewed, like the kind they behave like', async () => {
    signIn('admin1');
    const loaderId = await createMachineType('ලෝඩරය', 'Loader', 'excavator', BUILT_IN_TYPES, admin);
    const lorryId = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin);
    const types = await typesNow();

    await createMachine('ld1', { ...excavator, type: loaderId }, 100, types, admin);
    await createMachine('lr1', { ...excavator, type: lorryId }, 100, types, admin);
    expect(await data('machines/ld1')).toMatchObject({ type: loaderId });
    expect((await data('machines/ld1'))?.serviceDueAt).toEqual({
      engineOil: 350,
      dieselFilter: 350,
      hydraulicFilter: 2100,
      majorService: 10100,
    });
    // A lorry has no crew to service anything.
    expect((await data('machines/lr1'))?.serviceDueAt).toEqual({});

    // The excavator crew may go on the loader; no crew goes on the lorry.
    await assignMachine(operator, await machineNow('ld1'), people, types, admin);
    expect(await data('operators/op1')).toMatchObject({ machineId: 'ld1' });
    await expect(assignMachine(driller, await machineNow('ld1'), people, types, admin)).rejects.toThrow();
    await expect(assignMachine(operator, await machineNow('lr1'), people, types, admin)).rejects.toThrow();
    await expect(assignMachine(driller, await machineNow('lr1'), people, types, admin)).rejects.toThrow();
  });

  it('are named in the log of the machine they made', async () => {
    signIn('admin1');
    const lorryId = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin);
    await createMachine('lr1', { ...excavator, type: lorryId, name: 'Tata' }, 0, await typesNow(), admin);
    const entries = await auditLog();
    expect(entries.find((entry) => entry.action === 'machine.create')?.summary).toContain('ට්‍රක්');
  });

  it('cannot be what a machine is unless they exist', async () => {
    signIn('admin1');
    await expect(createMachine('lr1', { ...excavator, type: 'nope' }, 0, BUILT_IN_TYPES, admin)).rejects.toThrow();
    expect(await data('machines/lr1')).toBeUndefined();
  });

  const everyMachine = async () =>
    (await direct(async (db) => (await getDocs(collection(db, 'machines'))).docs.map((entry) => machineFrom(entry.id, entry.data()))));
  const change = (type: ReturnType<typeof machineTypeDef>, next: Partial<MachineTypeChanges>) => ({
    label: type.label,
    english: type.english,
    kind: type.kind,
    meterUnit: type.meterUnit,
    ...next,
  });

  it('are put right by an admin at any time — names, behaviour and meter unit — and logged', async () => {
    signIn('admin1');
    const id = await createMachineType('ට්‍රක්', 'Truck', 'excavator', BUILT_IN_TYPES, admin);
    const types = await typesNow();
    await updateMachineType(
      machineTypeDef(types, id),
      { label: 'ටිපර්', english: 'Tipper', kind: 'none', meterUnit: 'km' },
      types,
      await everyMachine(),
      people,
      admin,
    );

    expect(await data(`machineTypes/${id}`)).toEqual({ label: 'ටිපර්', english: 'Tipper', kind: 'none', meterUnit: 'km' });
    const entry = (await auditLog()).find((row) => row.action === 'machine.typeUpdate');
    expect(entry).toMatchObject({ entityId: id });
    expect(entry?.summary).toContain('නම: ට්‍රක් → ටිපර්');
    expect(entry?.summary).toContain('මීටරය: h → km');
  });

  it('keeps the crew a machine has: behaviour cannot change to one that does not suit them', async () => {
    signIn('admin1');
    const id = await createMachineType('ලෝඩරය', '', 'excavator', BUILT_IN_TYPES, admin);
    const types = await typesNow();
    await direct(async (db) => setDoc(doc(db, 'machines', 'ld1'), { totalHours: 0, serviceDueAt: {}, type: id }));
    const crewed = [{ ...operator, machineId: 'ld1' }];
    const mine = machineTypeDef(types, id);

    await expect(
      updateMachineType(mine, change(mine, { kind: 'none' }), types, await everyMachine(), crewed, admin),
    ).rejects.toThrow(/ld1/);
    await expect(
      updateMachineType(mine, change(mine, { kind: 'compressor' }), types, await everyMachine(), crewed, admin),
    ).rejects.toThrow(/ld1/);
    expect(await data(`machineTypes/${id}`)).toMatchObject({ kind: 'excavator' });
    // A change that suits them is fine, and so is one once they are gone.
    await updateMachineType(mine, change(mine, { label: 'Loader 2' }), types, await everyMachine(), crewed, admin);
    await updateMachineType(machineTypeDef(await typesNow(), id), change(mine, { label: 'Loader 2', kind: 'none' }), await typesNow(), await everyMachine(), [], admin);
    expect(await data(`machineTypes/${id}`)).toMatchObject({ label: 'Loader 2', kind: 'none' });
  });

  it('can have the built-in two renamed and given another meter unit, kept as what differs', async () => {
    signIn('admin1');
    const types = await typesNow();
    const digger = machineTypeDef(types, 'excavator');
    await updateMachineType(digger, change(digger, { label: 'ඩිගර්', english: 'Digger', meterUnit: 'km' }), types, await everyMachine(), people, admin);

    expect(await data('machineTypes/excavator')).toEqual({ label: 'ඩිගර්', english: 'Digger', meterUnit: 'km' });
    const after = await typesNow();
    expect(after.get('excavator')).toMatchObject({ label: 'ඩිගර්', english: 'Digger', meterUnit: 'km', kind: 'excavator', builtIn: true });
    // What they behave like stays.
    await expect(
      updateMachineType(machineTypeDef(after, 'excavator'), change(machineTypeDef(after, 'excavator'), { kind: 'none' }), after, await everyMachine(), people, admin),
    ).rejects.toThrow();
    expect(after.get('compressor')).toMatchObject({ label: 'කම්පසර්' });
  });

  it('are put right to a name that is not taken or empty, and by an admin alone', async () => {
    signIn('admin1');
    const id = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin);
    const types = await typesNow();
    const mine = machineTypeDef(types, id);
    await expect(updateMachineType(mine, change(mine, { label: 'කම්පසර්' }), types, [], people, admin)).rejects.toThrow(/දැනටමත්/);
    await expect(updateMachineType(mine, change(mine, { label: ' ' }), types, [], people, admin)).rejects.toThrow();
    expect(await data(`machineTypes/${id}`)).toMatchObject({ label: 'ට්‍රක්' });

    signIn('sup1');
    await expect(updateMachineType(mine, change(mine, { label: 'Mine' }), types, [], people, supervisor)).rejects.toThrow();
  });

  it('are removed only while no machine is of them', async () => {
    signIn('admin1');
    const id = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin);
    const types = await typesNow();
    await createMachine('lr1', { ...excavator, type: id }, 0, types, admin);

    await expect(deleteMachineType(machineTypeDef(types, id), admin)).rejects.toThrow(/lr1/);
    expect(await data(`machineTypes/${id}`)).toBeDefined();

    await deleteMachine(await machineNow('lr1'), [], admin);
    await deleteMachineType(machineTypeDef(types, id), admin);
    expect(await data(`machineTypes/${id}`)).toBeUndefined();
    expect((await auditLog()).some((entry) => entry.action === 'machine.typeDelete' && entry.entityId === id)).toBe(true);
  });

  it('are removed by an admin alone', async () => {
    signIn('admin1');
    const id = await createMachineType('ට්‍රක්', '', 'none', BUILT_IN_TYPES, admin);
    const types = await typesNow();

    signIn('sup1');
    await expect(deleteMachineType(machineTypeDef(types, id), supervisor)).rejects.toThrow();
    expect(await data(`machineTypes/${id}`)).toBeDefined();
  });

  it('can be a built-in one too: removed when no machine is of it, and brought back', async () => {
    signIn('admin1');
    const types = await typesNow();

    // ex2 is an excavator, so that one stays.
    await expect(deleteMachineType(machineTypeDef(types, 'excavator'), admin)).rejects.toThrow(/ex2/);
    expect(await data('machineTypes/excavator')).toBeUndefined();

    // Nothing is a compressor once cp2 is gone.
    await direct(async (db) => deleteDoc(doc(db, 'machines', 'cp2')));
    await deleteMachineType(machineTypeDef(types, 'compressor'), admin);
    expect(await data('machineTypes/compressor')).toEqual({ hidden: true });
    const hidden = await typesNow();
    expect(hidden.get('compressor')).toMatchObject({ hidden: true, builtIn: true, label: 'කම්පසර්' });
    expect(pickableTypes(hidden).map((type) => type.id)).toEqual(['excavator']);
    // A machine still of it keeps its name.
    expect(machineTypeDef(hidden, 'compressor').label).toBe('කම්පසර්');

    signIn('sup1');
    await expect(restoreMachineType(machineTypeDef(hidden, 'compressor'), supervisor)).rejects.toThrow();
    signIn('admin1');
    await restoreMachineType(machineTypeDef(hidden, 'compressor'), admin);
    // Only the removal is taken back; the record stays, holding nothing.
    expect(await data('machineTypes/compressor')).toEqual({});
    expect(pickableTypes(await typesNow()).map((type) => type.id)).toEqual(['excavator', 'compressor']);
  });
});

describe('the meter of a machine, put right by hand', () => {
  it('moves the meter and its unit on a machine with no crew, and logs both', async () => {
    signIn('sup1');
    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor, 1204);

    expect(await data('machines/ex2')).toMatchObject({ totalHours: 1204, meterUnit: 'km' });
    const [entry] = await auditLog();
    expect(entry.summary).toContain('මීටරය: 10 h → 1204 km');
  });

  it('moves the meter of a machine that has a crew on it as well', async () => {
    signIn('admin1');
    await updateMachine(await machineNow('ex1'), { ...excavator, type: 'excavator' }, [operator], BUILT_IN_TYPES, admin, 7000);
    expect(await data('machines/ex1')).toMatchObject({ totalHours: 7000 });
  });

  it('puts only the unit right when the meter is left alone', async () => {
    signIn('sup1');
    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor);
    expect(await data('machines/ex2')).toMatchObject({ totalHours: 10, meterUnit: 'km' });
  });

  it('refuses a negative meter, and writes nothing', async () => {
    signIn('sup1');
    await expect(updateMachine(await machineNow('ex2'), excavator, [], BUILT_IN_TYPES, supervisor, -3)).rejects.toThrow();
    expect(await data('machines/ex2')).toMatchObject({ totalHours: 10 });
    expect(await auditLog()).toHaveLength(0);
  });

  it('adds what a machine with no crew has moved on to this month’s use, and only then', async () => {
    const month = new Date().toISOString().slice(0, 7);
    signIn('sup1');
    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor, 1204);
    // The unit changed with it: not a reading of the same thing, so nothing is added.
    expect(await data(`machines/ex2/months/${month}`)).toBeUndefined();

    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor, 1260.5);
    expect(await data(`machines/ex2/months/${month}`)).toMatchObject({ month, hours: 56.5 });
    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor, 1300);
    expect(await data(`machines/ex2/months/${month}`)).toMatchObject({ hours: 96 });

    // A reading put right downwards is a correction, not use.
    await updateMachine(await machineNow('ex2'), { ...excavator, meterUnit: 'km' }, [], BUILT_IN_TYPES, supervisor, 1290);
    expect(await data(`machines/ex2/months/${month}`)).toMatchObject({ hours: 96 });
  });

  it('adds nothing for a machine with a crew on it — its days do that', async () => {
    const month = new Date().toISOString().slice(0, 7);
    signIn('admin1');
    await updateMachine(await machineNow('ex1'), excavator, [operator], BUILT_IN_TYPES, admin, 7500);
    expect(await data(`machines/ex1/months/${month}`)).toBeUndefined();
  });

  it('is set when a machine is set up', async () => {
    signIn('sup1');
    await createMachine('lr5', { ...excavator, meterUnit: 'km' }, 88000, BUILT_IN_TYPES, supervisor);
    expect(await data('machines/lr5')).toMatchObject({ totalHours: 88000, meterUnit: 'km' });
  });
});

describe('what a machine runs on, when it is set up', () => {
  it('is kept with the machine and can be put right', async () => {
    signIn('sup1');
    await createMachine('pt1', { ...excavator, fuel: 'petrol' }, 0, BUILT_IN_TYPES, supervisor);
    expect(await data('machines/pt1')).toMatchObject({ fuel: 'petrol' });
    await updateMachine(await machineNow('pt1'), { ...excavator, fuel: 'diesel' }, [], BUILT_IN_TYPES, supervisor);
    expect(await data('machines/pt1')).toMatchObject({ fuel: 'diesel' });
  });
});

describe('removing a machine', () => {
  async function seedHistory(id: string, days: number) {
    await direct(async (db) => {
      await setDoc(doc(db, 'machines', id), { totalHours: 40, serviceDueAt: {}, type: 'excavator' });
      const batch = writeBatch(db);
      for (let day = 1; day <= days; day += 1) {
        const date = `2026-01-${String(day).padStart(2, '0')}`;
        batch.set(doc(db, 'machines', id, 'days', `${date}-${day}`), { date });
      }
      batch.set(doc(db, 'machines', id, 'months', '2026-01'), { month: '2026-01', hours: 12 });
      await batch.commit();
    });
  }

  const daysOf = (id: string) => direct(async (db) => (await getDocs(collection(db, 'machines', id, 'days'))).size);

  it('takes its days and months with it, and logs it', async () => {
    await seedHistory('old1', 3);
    signIn('admin1');
    await deleteMachine(await machineNow('old1'), [], admin);

    expect(await data('machines/old1')).toBeUndefined();
    expect(await daysOf('old1')).toBe(0);
    expect(await data('machines/old1/months/2026-01')).toBeUndefined();
    const [entry] = await auditLog();
    expect(entry).toMatchObject({ action: 'machine.delete', entityType: 'machine', entityId: 'old1', createdBy: 'admin1' });
    expect(entry.summary).toContain('දින 3');
  });

  it('clears a long history in more than one batch', async () => {
    await seedHistory('old2', 450);
    signIn('admin1');
    await deleteMachine(await machineNow('old2'), [], admin);
    expect(await data('machines/old2')).toBeUndefined();
    expect(await daysOf('old2')).toBe(0);
  });

  it('is refused while a crew member is still on it', async () => {
    signIn('admin1');
    await expect(deleteMachine(await machineNow('ex1'), [operator], admin)).rejects.toThrow(/ex1/);
    expect(await data('machines/ex1')).toBeDefined();
    expect(await auditLog()).toHaveLength(0);
  });

  it('is the admin’s alone: a supervisor’s attempt leaves everything as it was', async () => {
    await seedHistory('old3', 2);
    signIn('sup1');
    await expect(deleteMachine(await machineNow('old3'), [], supervisor)).rejects.toThrow();
    expect(await data('machines/old3')).toBeDefined();
    expect(await daysOf('old3')).toBe(2);
    expect(await auditLog()).toHaveLength(0);
  });
});
