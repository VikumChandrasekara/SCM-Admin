import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveDayEdit } from '../src/data/dayEdit';
import { draftOf, type DayEdit } from '../src/lib/dayEdit';
import { ROLES, dayFrom, type Person } from '../src/lib/model';

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
/** The crew member whose days are put right. */
const crew = person('op1', 'operator', 'ex1');

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

const LOCKED = '2026-10-07T07:00:00.000Z';

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
    await setDoc(doc(db, 'machines', 'ex1'), { totalHours: 6789.7, serviceDueAt: {} });

    // 6 → 7 → 8 October, each closed by the next morning's ON.
    await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-10-06'), {
      date: '2026-10-06',
      closingHours: 6780.5,
      fillings: { '1': { onHours: 6771.2, amounts: { diesel: 20 }, lockedAt: LOCKED } },
    });
    await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-10-07'), {
      date: '2026-10-07',
      closingHours: 6789.7,
      loads: 4,
      inspection: { diesel: true },
      fillings: { '1': { onHours: 6780.5, amounts: { diesel: 220 }, lockedAt: LOCKED } },
    });
    await setDoc(doc(db, 'machines', 'ex1', 'days', '2026-10-08'), {
      date: '2026-10-08',
      fillings: { '1': { onHours: 6789.7, amounts: {} } },
    });
    await setDoc(doc(db, 'machines', 'ex1', 'months', '2026-10'), { month: '2026-10', loads: 4, hours: 18.5 });

    await setDoc(doc(db, 'store', 'fill-diesel'), {
      name: 'Diesel',
      unit: 'L',
      quantity: 500,
      minQuantity: 0,
      unitPrice: 300,
      link: 'fill:diesel',
    });
    // The 7th's fill has drawn its diesel; the 6th's never did.
    await setDoc(doc(db, 'storeMovements', 'use_ex1_2026-10-07_fill1'), {
      type: 'usage',
      items: [{ itemId: 'fill-diesel', name: 'Diesel', unit: 'L', delta: -220, unitPrice: 300 }],
      unmatched: [],
      machineId: 'ex1',
      date: '2026-10-07',
      source: 'fill1',
      createdBy: 'op1',
      createdByName: 'op1',
    });
  });
});

/** The day as stored, as the form starts from it, with [change] applied. */
async function editing(date: string, change: (edit: DayEdit) => void): Promise<DayEdit> {
  const day = dayFrom(date, await data(`machines/ex1/days/${date}`));
  const edit = draftOf(day, 'loads', ROLES.operator);
  change(edit);
  return edit;
}

describe('putting a day right from the history page', () => {
  it('corrects an OK’d fill, the loads and a mark — the store, the month and the log follow', async () => {
    signIn('sup1');
    const edit = await editing('2026-10-07', (draft) => {
      draft.fillings[1] = { diesel: 250 };
      draft.tally = 6;
      draft.inspection.diesel = false;
      draft.inspection.surroundings = true;
    });
    const lines = await saveDayEdit(crew, '2026-10-07', edit, supervisor);
    expect(lines).toHaveLength(4);

    const stored = await data('machines/ex1/days/2026-10-07');
    expect(stored).toMatchObject({
      loads: 6,
      inspection: { diesel: false, surroundings: true },
      fillings: { '1': { onHours: 6780.5, amounts: { diesel: 250 }, lockedAt: LOCKED } },
    });
    // The month moves by the difference, not by the new figure.
    expect(await data('machines/ex1/months/2026-10')).toMatchObject({ loads: 6, hours: 18.5 });

    // 30 L more went into the machine, so 30 L less is on the shelf — once, with a movement to show it.
    expect((await data('store/fill-diesel'))?.quantity).toBe(470);
    const adjustments = (await all('storeMovements')).filter((entry) => entry.type === 'adjust');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ machineId: 'ex1', date: '2026-10-07', createdBy: 'sup1' });
    expect(adjustments[0].items[0]).toMatchObject({ itemId: 'fill-diesel', delta: -30 });

    const [entry] = await all('auditLog');
    expect(entry).toMatchObject({ action: 'day.edit', entityType: 'operator', entityId: 'op1', source: 'panel', createdBy: 'sup1' });
    expect(entry.summary).toContain('2026-10-07');
    expect(entry.summary).toContain('220 → 250 L');
    expect(entry.summary).toContain('ලෝඩ් 4 → 6');
    expect(entry.summary).toContain('Diesel -30 L');
  });

  it('a mark can be taken away', async () => {
    signIn('admin1');
    const edit = await editing('2026-10-07', (draft) => {
      draft.inspection.diesel = null;
    });
    await saveDayEdit(crew, '2026-10-07', edit, admin);
    expect((await data('machines/ex1/days/2026-10-07'))?.inspection).toEqual({});
  });

  it('a fill whose fuel was never drawn leaves the shelf alone', async () => {
    signIn('sup1');
    const edit = await editing('2026-10-06', (draft) => {
      draft.fillings[1] = { diesel: 45 };
    });
    await saveDayEdit(crew, '2026-10-06', edit, supervisor);
    expect((await data('machines/ex1/days/2026-10-06'))?.fillings['1'].amounts.diesel).toBe(45);
    expect((await data('store/fill-diesel'))?.quantity).toBe(500);
    expect((await all('storeMovements')).filter((entry) => entry.type === 'adjust')).toHaveLength(0);
  });

  it('an ON moved takes the day before’s closing with it and leaves the month’s hours where they were', async () => {
    signIn('admin1');
    const edit = await editing('2026-10-07', (draft) => {
      draft.onHours = 6781;
    });
    await saveDayEdit(crew, '2026-10-07', edit, admin);

    expect((await data('machines/ex1/days/2026-10-07'))?.fillings['1'].onHours).toBe(6781);
    expect((await data('machines/ex1/days/2026-10-06'))?.closingHours).toBe(6781);
    expect(((await data('machines/ex1/months/2026-10')) as { hours: number }).hours).toBeCloseTo(18.5, 6);
    expect((await data('machines/ex1'))?.totalHours).toBe(6789.7);
  });

  it('the last day’s OFF adds its hours to the month and moves the machine’s meter', async () => {
    signIn('sup1');
    const edit = await editing('2026-10-08', (draft) => {
      draft.offHours = 6795;
    });
    await saveDayEdit(crew, '2026-10-08', edit, supervisor);

    expect((await data('machines/ex1/days/2026-10-08'))?.closingHours).toBe(6795);
    expect(((await data('machines/ex1/months/2026-10')) as { hours: number }).hours).toBeCloseTo(18.5 + 5.3, 6);
    expect((await data('machines/ex1'))?.totalHours).toBe(6795);
  });

  it('refuses what cannot be — a reading out of order, an OFF the next day owns, no change — and writes nothing', async () => {
    signIn('sup1');
    const before = await all('auditLog');

    const low = await editing('2026-10-07', (draft) => {
      draft.onHours = 6700;
    });
    await expect(saveDayEdit(crew, '2026-10-07', low, supervisor)).rejects.toThrow(/වඩා අඩු විය නොහැක/);

    const off = await editing('2026-10-07', (draft) => {
      draft.offHours = 6790;
    });
    await expect(saveDayEdit(crew, '2026-10-07', off, supervisor)).rejects.toThrow(/පසු දවසේ ON/);

    const same = await editing('2026-10-07', () => {});
    await expect(saveDayEdit(crew, '2026-10-07', same, supervisor)).rejects.toThrow('වෙනසක් නැත');

    const negative = await editing('2026-10-07', (draft) => {
      draft.tally = -3;
    });
    await expect(saveDayEdit(crew, '2026-10-07', negative, supervisor)).rejects.toThrow();

    await expect(saveDayEdit(crew, '2026-10-20', same, supervisor)).rejects.toThrow(/වාර්තාවක් නැත/);

    expect(await all('auditLog')).toEqual(before);
    expect((await data('machines/ex1/days/2026-10-07'))?.loads).toBe(4);
  });

  it('is refused for the crew — an OK’d fill is theirs no longer to change — and leaves the day as it was', async () => {
    signIn('op1');
    const edit = await editing('2026-10-07', (draft) => {
      draft.fillings[1] = { diesel: 1 };
    });
    await assertFails(saveDayEdit(crew, '2026-10-07', edit, crew));

    const stored = await data('machines/ex1/days/2026-10-07');
    expect(stored?.fillings['1'].amounts.diesel).toBe(220);
    expect((await data('store/fill-diesel'))?.quantity).toBe(500);
    expect(await all('auditLog')).toHaveLength(0);
  });
});
