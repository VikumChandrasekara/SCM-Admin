import { describe, expect, it } from 'vitest';

import {
  MACHINE_ID_PATTERN,
  assignSummary,
  assignableMachines,
  cleanDetails,
  crewOn,
  detailsError,
  machineDiff,
  machineFitsRole,
  machineTypeOf,
  monthsNewestFirst,
  newMachineSummary,
  recordedHours,
  workedDayRows,
} from '../src/lib/machines';
import {
  dayFrom,
  machineFrom,
  machineTitle,
  machineTypeForRole,
  monthFrom,
  type Machine,
  type MachineDetails,
  type Person,
} from '../src/lib/model';

const person = (id: string, role: Person['role'], machineId: string): Person => ({
  id,
  name: id,
  username: id,
  machineId,
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
});

const machine = (id: string, extra: object = {}): Machine => machineFrom(id, { totalHours: 100, ...extra });

const kamal = person('kamal', 'operator', 'ex1');
const ruwan = person('ruwan', 'compressor', 'cp1');
const nimal = person('nimal', 'supervisor', '');
const people = [kamal, ruwan, nimal];

describe('reading a machine', () => {
  it('has no details on a machine set up before they were kept, and counts it as in use', () => {
    const old = machineFrom('ex1', { totalHours: 6789.7, serviceDueAt: { engineOil: 7000 } });
    expect(old).toMatchObject({ type: null, name: '', model: '', registrationNo: '', notes: '', active: true });
    expect(old.totalHours).toBe(6789.7);
  });

  it('reads the details it is given, and ignores a type it does not know', () => {
    const full = machineFrom('cp1', {
      type: 'compressor',
      name: 'Atlas',
      model: 'XAS 185',
      registrationNo: 'LB-1234',
      notes: 'north pit',
      active: false,
    });
    expect(full).toMatchObject({ type: 'compressor', name: 'Atlas', model: 'XAS 185', registrationNo: 'LB-1234', active: false });
    expect(machineFrom('x', { type: 'dozer' }).type).toBeNull();
  });

  it('titles a machine by its name when it has one', () => {
    expect(machineTitle(machine('ex1'))).toBe('ex1');
    expect(machineTitle(machine('ex1', { name: 'CAT 320D' }))).toBe('CAT 320D · ex1');
  });

  it('matches each crew to the kind of machine it works, and staff to none', () => {
    expect(machineTypeForRole('operator')).toBe('excavator');
    expect(machineTypeForRole('compressor')).toBe('compressor');
    expect(machineTypeForRole('supervisor')).toBeNull();
    expect(machineTypeForRole('admin')).toBeNull();
  });
});

describe('who is on a machine', () => {
  it('lists the crew on it, never staff, whatever machine id they carry', () => {
    const stray = person('sup', 'supervisor', 'ex1');
    expect(crewOn('ex1', [...people, stray]).map((p) => p.id)).toEqual(['kamal']);
    expect(crewOn('nothing', people)).toEqual([]);
  });

  it('reads the kind of a machine with no type from the crew on it', () => {
    expect(machineTypeOf(machine('ex1'), people)).toBe('excavator');
    expect(machineTypeOf(machine('cp1'), people)).toBe('compressor');
    expect(machineTypeOf(machine('empty'), people)).toBeNull();
  });

  it('trusts the type a machine carries over its crew', () => {
    expect(machineTypeOf(machine('ex1', { type: 'compressor' }), people)).toBe('compressor');
  });
});

describe('which machine a crew member may be put on', () => {
  it('fits an operator to an excavator and a compressor driller to a compressor', () => {
    const excavator = machine('ex2', { type: 'excavator' });
    const compressor = machine('cp2', { type: 'compressor' });
    expect(machineFitsRole(excavator, 'operator', people)).toBe(true);
    expect(machineFitsRole(excavator, 'compressor', people)).toBe(false);
    expect(machineFitsRole(compressor, 'compressor', people)).toBe(true);
    expect(machineFitsRole(compressor, 'operator', people)).toBe(false);
  });

  it('lets a machine with no kind yet take either, but not once its crew give it one', () => {
    expect(machineFitsRole(machine('fresh'), 'operator', people)).toBe(true);
    expect(machineFitsRole(machine('fresh'), 'compressor', people)).toBe(true);
    // ex1 has an excavator operator on it, so it is an excavator.
    expect(machineFitsRole(machine('ex1'), 'compressor', people)).toBe(false);
  });

  it('puts staff on no machine at all', () => {
    expect(machineFitsRole(machine('fresh', { type: 'excavator' }), 'supervisor', people)).toBe(false);
    expect(machineFitsRole(machine('fresh'), 'admin', people)).toBe(false);
  });

  it('offers only machines in use and of the right kind, by number', () => {
    const all = [
      machine('ex3', { type: 'excavator' }),
      machine('ex2', { type: 'excavator' }),
      machine('cp2', { type: 'compressor' }),
      machine('ex9', { type: 'excavator', active: false }),
    ];
    expect(assignableMachines('operator', all, people).map((m) => m.id)).toEqual(['ex2', 'ex3']);
    expect(assignableMachines('compressor', all, people).map((m) => m.id)).toEqual(['cp2']);
  });

  it('keeps the machine a person is on in the list even once it is retired', () => {
    const all = [machine('ex2', { type: 'excavator' }), machine('ex9', { type: 'excavator', active: false })];
    expect(assignableMachines('operator', all, people, 'ex9').map((m) => m.id)).toEqual(['ex2', 'ex9']);
  });
});

describe('the details of a machine', () => {
  const details: MachineDetails = {
    type: 'excavator',
    name: '  CAT 320D ',
    model: 'Cat  ',
    registrationNo: ' LB-1 ',
    notes: ' ',
    active: true,
  };

  it('are stored trimmed', () => {
    expect(cleanDetails(details)).toEqual({
      type: 'excavator',
      name: 'CAT 320D',
      model: 'Cat',
      registrationNo: 'LB-1',
      notes: '',
      active: true,
    });
  });

  it('are refused when they would not fit the rules', () => {
    expect(detailsError(details)).toBeNull();
    expect(detailsError({ ...details, name: 'x'.repeat(101) })).toContain('100');
    expect(detailsError({ ...details, model: 'x'.repeat(101) })).toContain('100');
    expect(detailsError({ ...details, registrationNo: 'x'.repeat(41) })).toContain('40');
    expect(detailsError({ ...details, notes: 'x'.repeat(1001) })).toContain('1000');
    // Counted after trimming, as they are stored.
    expect(detailsError({ ...details, notes: `${'x'.repeat(1000)}   ` })).toBeNull();
  });

  it('take only the ids the rules accept', () => {
    expect(MACHINE_ID_PATTERN.test('excavator-01')).toBe(true);
    expect(MACHINE_ID_PATTERN.test('EX_2')).toBe(true);
    expect(MACHINE_ID_PATTERN.test('')).toBe(false);
    expect(MACHINE_ID_PATTERN.test('ex 1')).toBe(false);
    expect(MACHINE_ID_PATTERN.test('a/b')).toBe(false);
    expect(MACHINE_ID_PATTERN.test('x'.repeat(41))).toBe(false);
  });

  it('read back, in the audit log, as exactly what moved', () => {
    const before = machine('ex1', { type: 'excavator', name: 'Old', model: 'Cat' });
    expect(machineDiff(before, { ...details, name: 'Old', model: 'Cat', registrationNo: '', notes: '' })).toBe(
      'වෙනසක් නැත',
    );
    const diff = machineDiff(before, { ...details, name: 'New', model: 'Cat', registrationNo: 'LB-1', notes: '' });
    expect(diff).toBe('නම: Old → New · ලියාපදිංචි අංකය: — → LB-1');
    expect(machineDiff(before, { ...details, name: 'Old', model: 'Cat', registrationNo: '', notes: '', active: false })).toContain(
      'විශ්‍රාම',
    );
  });

  it('say what a new machine is, and what its meter starts at', () => {
    expect(newMachineSummary({ ...details, name: 'CAT 320D', model: '320D', registrationNo: '' }, 6789.7)).toBe(
      'එක්ස්කවේටර් · CAT 320D · 320D · මීටරය පැය 6789.7',
    );
  });

  it('say where a crew member moved from and to', () => {
    expect(assignSummary('ex1', 'ex2')).toBe('යන්ත්‍රය: ex1 → ex2');
    expect(assignSummary('', 'ex2')).toBe('යන්ත්‍රය: — → ex2');
  });
});

describe('the hours a machine has worked', () => {
  const months = [
    monthFrom('2026-08', { hours: 180.5, loads: 300 }),
    monthFrom('2026-10', { hours: 90, loads: 120 }),
    monthFrom('2026-09', { hours: 210, loads: 410 }),
    monthFrom('2026-07', {}),
  ];

  it('lists the months that have something in them, newest first', () => {
    expect(monthsNewestFirst(months).map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('adds up what the months recorded', () => {
    expect(recordedHours(months)).toBe(480.5);
    expect(recordedHours([])).toBe(0);
  });

  it('works out each closed day’s hours from its readings, newest first, and skips an open one', () => {
    const closed = (date: string, on: number, off: number) =>
      dayFrom(date, { date, fillings: { '1': { onHours: on } }, closingHours: off });
    const days = [
      closed('2026-10-01', 6700, 6708),
      closed('2026-10-03', 6716.5, 6723),
      // Started, not yet closed by the next morning's ON.
      dayFrom('2026-10-04', { date: '2026-10-04', fillings: { '1': { onHours: 6723 } } }),
      // Marked worked by hand — it has no meter at all.
      dayFrom('2026-10-02', { date: '2026-10-02', workedManually: true }),
    ];
    expect(workedDayRows(days)).toEqual([
      { date: '2026-10-03', on: 6716.5, off: 6723, hours: 6.5 },
      { date: '2026-10-01', on: 6700, off: 6708, hours: 8 },
    ]);
  });
});
