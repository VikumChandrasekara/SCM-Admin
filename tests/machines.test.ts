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
  machineKindOf,
  machineTypeOf,
  meterError,
  monthsNewestFirst,
  newMachineSummary,
  recordedHours,
  typeNameError,
  workedDayRows,
} from '../src/lib/machines';
import {
  BUILT_IN_TYPES,
  dayFrom,
  machineFrom,
  machineTitle,
  machineTypeDef,
  machineTypeDefFrom,
  machineTypeForRole,
  machineTypesFrom,
  meterReading,
  monthFrom,
  pickableTypes,
  serviceTasksOfKind,
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
  sakkaLoadWage: 0,
  boldasLoadWage: 0,
  c1LoadWage: 0,
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

  it('reads the details it is given, and keeps the id of a type it is not told about', () => {
    const full = machineFrom('cp1', {
      type: 'compressor',
      name: 'Atlas',
      model: 'XAS 185',
      registrationNo: 'LB-1234',
      notes: 'north pit',
      active: false,
    });
    expect(full).toMatchObject({ type: 'compressor', name: 'Atlas', model: 'XAS 185', registrationNo: 'LB-1234', active: false });
    // A type an admin added is stored by its id; the registry says what it is.
    expect(machineFrom('x', { type: 'lorry123' }).type).toBe('lorry123');
    expect(machineFrom('x', { type: '' }).type).toBeNull();
    expect(machineFrom('x', { type: 7 }).type).toBeNull();
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
    expect(machineFitsRole(excavator, 'operator', people, BUILT_IN_TYPES)).toBe(true);
    expect(machineFitsRole(excavator, 'compressor', people, BUILT_IN_TYPES)).toBe(false);
    expect(machineFitsRole(compressor, 'compressor', people, BUILT_IN_TYPES)).toBe(true);
    expect(machineFitsRole(compressor, 'operator', people, BUILT_IN_TYPES)).toBe(false);
  });

  it('lets a machine with no kind yet take either, but not once its crew give it one', () => {
    expect(machineFitsRole(machine('fresh'), 'operator', people, BUILT_IN_TYPES)).toBe(true);
    expect(machineFitsRole(machine('fresh'), 'compressor', people, BUILT_IN_TYPES)).toBe(true);
    // ex1 has an excavator operator on it, so it is an excavator.
    expect(machineFitsRole(machine('ex1'), 'compressor', people, BUILT_IN_TYPES)).toBe(false);
  });

  it('puts staff on no machine at all', () => {
    expect(machineFitsRole(machine('fresh', { type: 'excavator' }), 'supervisor', people, BUILT_IN_TYPES)).toBe(false);
    expect(machineFitsRole(machine('fresh'), 'admin', people, BUILT_IN_TYPES)).toBe(false);
  });

  it('offers only machines in use and of the right kind, by number', () => {
    const all = [
      machine('ex3', { type: 'excavator' }),
      machine('ex2', { type: 'excavator' }),
      machine('cp2', { type: 'compressor' }),
      machine('ex9', { type: 'excavator', active: false }),
    ];
    expect(assignableMachines('operator', all, people, BUILT_IN_TYPES).map((m) => m.id)).toEqual(['ex2', 'ex3']);
    expect(assignableMachines('compressor', all, people, BUILT_IN_TYPES).map((m) => m.id)).toEqual(['cp2']);
  });

  it('keeps the machine a person is on in the list even once it is retired', () => {
    const all = [machine('ex2', { type: 'excavator' }), machine('ex9', { type: 'excavator', active: false })];
    expect(assignableMachines('operator', all, people, BUILT_IN_TYPES, 'ex9').map((m) => m.id)).toEqual(['ex2', 'ex9']);
  });
});

describe('machine types an admin adds', () => {
  const lorry = machineTypeDefFrom('lorry1', { label: 'ට්‍රක් රථය', english: 'Truck', kind: 'none' });
  const loader = machineTypeDefFrom('loader1', { label: 'ලෝඩරය', english: 'Loader', kind: 'excavator' });
  const roller = machineTypeDefFrom('roller1', { label: 'රෝලරය', english: '', kind: 'compressor' });
  const types = machineTypesFrom([lorry, loader, roller]);

  it('come after the built-in two, and never replace one', () => {
    expect([...types.keys()].slice(0, 2)).toEqual(['excavator', 'compressor']);
    expect(types.size).toBe(5);
    const shadow = machineTypeDefFrom('excavator', { label: 'Mine', kind: 'none' });
    expect(machineTypesFrom([shadow]).get('excavator')).toMatchObject({ label: 'එක්ස්කවේටර්', builtIn: true });
  });

  it('hide a built-in one when its record says so, and still know its name', () => {
    const hidden = machineTypesFrom([machineTypeDefFrom('compressor', { hidden: true })]);
    expect(hidden.get('compressor')).toMatchObject({ hidden: true, builtIn: true, label: 'කම්පසර්' });
    expect(pickableTypes(hidden).map((type) => type.id)).toEqual(['excavator']);
    // Unless it is the one a machine is already of.
    expect(pickableTypes(hidden, 'compressor').map((type) => type.id)).toEqual(['excavator', 'compressor']);
    // A record that does not say hidden hides nothing.
    expect(machineTypesFrom([machineTypeDefFrom('compressor', {})]).get('compressor')?.hidden).toBe(false);
  });

  it('read a kind they do not know as no crew', () => {
    expect(machineTypeDefFrom('x', { label: 'X', kind: 'dozer' }).kind).toBe('none');
    expect(machineTypeDefFrom('x', {}).kind).toBe('none');
  });

  it('behave like the kind they were given', () => {
    expect(machineKindOf(machine('l1', { type: 'loader1' }), people, types)).toBe('excavator');
    expect(machineKindOf(machine('t1', { type: 'lorry1' }), people, types)).toBe('none');
    expect(machineKindOf(machine('fresh'), people, types)).toBeNull();
  });

  it('take the crew of the kind they behave like — and none for a type with no crew', () => {
    const asLoader = machine('l1', { type: 'loader1' });
    const asRoller = machine('r1', { type: 'roller1' });
    const asLorry = machine('t1', { type: 'lorry1' });
    expect(machineFitsRole(asLoader, 'operator', people, types)).toBe(true);
    expect(machineFitsRole(asLoader, 'compressor', people, types)).toBe(false);
    expect(machineFitsRole(asRoller, 'compressor', people, types)).toBe(true);
    expect(machineFitsRole(asLorry, 'operator', people, types)).toBe(false);
    expect(machineFitsRole(asLorry, 'compressor', people, types)).toBe(false);
  });

  it('are offered no crew in the list of machines to put someone on', () => {
    const all = [machine('l1', { type: 'loader1' }), machine('t1', { type: 'lorry1' }), machine('ex2', { type: 'excavator' })];
    expect(assignableMachines('operator', all, people, types).map((m) => m.id)).toEqual(['ex2', 'l1']);
    expect(assignableMachines('compressor', all, people, types)).toEqual([]);
  });

  it('read as no crew once the type has been removed, rather than failing', () => {
    expect(machineTypeDef(types, 'gone')).toMatchObject({ id: 'gone', label: 'gone', kind: 'none' });
    expect(machineFitsRole(machine('g1', { type: 'gone' }), 'operator', people, types)).toBe(false);
  });

  it('are serviced only for the parts of the crew they behave like', () => {
    expect(serviceTasksOfKind('none')).toEqual([]);
    expect(serviceTasksOfKind('excavator')).toContain('hydraulicFilter');
    expect(serviceTasksOfKind('compressor')).not.toContain('hydraulicFilter');
  });

  it('are named in the audit log by what the admin called them', () => {
    const details: MachineDetails = { type: 'lorry1', name: 'Tata', model: '', registrationNo: '', notes: '', active: true };
    expect(newMachineSummary(details, 12, types)).toBe('ට්‍රක් රථය · Tata · මීටරය පැය 12');
    expect(machineDiff(machine('t1'), details, types)).toContain('වර්ගය: — → ට්‍රක් රථය');
  });

  it('need a name that fits the rules', () => {
    expect(typeNameError('ට්‍රක්', '')).toBeNull();
    expect(typeNameError('   ', '')).toContain('නම');
    expect(typeNameError('x'.repeat(41), '')).toContain('40');
    expect(typeNameError('ok', 'x'.repeat(41))).toContain('40');
    expect(typeNameError(`${'x'.repeat(40)}  `, '')).toBeNull();
  });

  it('leave the built-in two behaving as they always did', () => {
    expect(machineFitsRole(machine('ex2', { type: 'excavator' }), 'operator', people, BUILT_IN_TYPES)).toBe(true);
    expect(machineFitsRole(machine('cp2', { type: 'compressor' }), 'operator', people, BUILT_IN_TYPES)).toBe(false);
  });
});

describe('what a machine’s meter counts', () => {
  const details: MachineDetails = { type: 'excavator', name: '', model: '', registrationNo: '', notes: '', active: true };

  it('reads hours unless a machine says kilometres', () => {
    expect(machineFrom('a', { totalHours: 5 }).meterUnit).toBe('h');
    expect(machineFrom('a', { totalHours: 5, meterUnit: 'km' }).meterUnit).toBe('km');
    expect(machineFrom('a', { totalHours: 5, meterUnit: 'miles' }).meterUnit).toBe('h');
  });

  it('shows a reading with its unit', () => {
    expect(meterReading(6833.3, 'h')).toBe('6833.3 h');
    expect(meterReading(1204, 'km')).toBe('1204 km');
  });

  it('is stored only when it is set', () => {
    expect('meterUnit' in cleanDetails(details)).toBe(false);
    expect(cleanDetails({ ...details, meterUnit: 'km' }).meterUnit).toBe('km');
  });

  it('says in the audit log what the meter and its unit became', () => {
    const before = machine('lr1', { type: 'excavator', totalHours: 100 });
    expect(machineDiff(before, { ...details, meterUnit: 'km' }, BUILT_IN_TYPES)).toBe('මීටර ඒකකය: h → km');
    expect(machineDiff(before, details, BUILT_IN_TYPES, 120)).toBe('මීටරය: 100 h → 120 h');
    expect(machineDiff(before, { ...details, meterUnit: 'km' }, BUILT_IN_TYPES, 120)).toBe('මීටරය: 100 h → 120 km');
    expect(newMachineSummary({ ...details, meterUnit: 'km' }, 12, BUILT_IN_TYPES)).toBe('එක්ස්කවේටර් · මීටරය km 12');
  });

  it('refuses a reading that is negative or not a number', () => {
    expect(meterError(0)).toBeNull();
    expect(meterError(1204.5)).toBeNull();
    expect(meterError(-1)).not.toBeNull();
    expect(meterError(Number.NaN)).not.toBeNull();
  });
});

describe('what a machine runs on', () => {
  const details: MachineDetails = { type: 'excavator', name: '', model: '', registrationNo: '', notes: '', active: true };

  it('is petrol or diesel, and none until someone says', () => {
    expect(machineFrom('a', { fuel: 'petrol' }).fuel).toBe('petrol');
    expect(machineFrom('a', { fuel: 'diesel' }).fuel).toBe('diesel');
    expect(machineFrom('a', {}).fuel).toBeNull();
    expect(machineFrom('a', { fuel: 'coal' }).fuel).toBeNull();
  });

  it('is stored only when it is set, and logged by name', () => {
    expect('fuel' in cleanDetails(details)).toBe(false);
    expect(cleanDetails({ ...details, fuel: 'petrol' }).fuel).toBe('petrol');
    const before = machine('a', { type: 'excavator' });
    expect(machineDiff(before, { ...details, fuel: 'diesel' }, BUILT_IN_TYPES)).toBe('ඉන්ධන: — → ඩීසල්');
    expect(newMachineSummary({ ...details, fuel: 'petrol' }, 5, BUILT_IN_TYPES)).toBe(
      'එක්ස්කවේටර් · පෙට්‍රල් · මීටරය පැය 5',
    );
  });
});

describe('what a machine is charged', () => {
  const details: MachineDetails = { type: 'excavator', name: '', model: '', registrationNo: '', notes: '', active: true };

  it('is a rate per hour, load or foot — none until someone says, and per hour by default', () => {
    expect(machineFrom('a', {})).toMatchObject({ rate: null, rateBasis: 'hour' });
    expect(machineFrom('a', { rate: 6000, rateBasis: 'load' })).toMatchObject({ rate: 6000, rateBasis: 'load' });
    expect(machineFrom('a', { rate: -5 }).rate).toBeNull();
    expect(machineFrom('a', { rate: '6000' }).rate).toBeNull();
    expect(machineFrom('a', { rateBasis: 'mile' }).rateBasis).toBe('hour');
  });

  it('is stored only when it is set — even a rate of nothing', () => {
    expect('rate' in cleanDetails(details)).toBe(false);
    expect(cleanDetails({ ...details, rate: 0 }).rate).toBe(0);
    expect(cleanDetails({ ...details, rate: 500, rateBasis: 'foot' })).toMatchObject({ rate: 500, rateBasis: 'foot' });
  });

  it('is refused when negative or not a number', () => {
    expect(detailsError({ ...details, rate: 0 })).toBeNull();
    expect(detailsError({ ...details, rate: 6000 })).toBeNull();
    expect(detailsError({ ...details, rate: -1 })).not.toBeNull();
    expect(detailsError({ ...details, rate: Number.NaN })).not.toBeNull();
  });

  it('is logged with what it is for', () => {
    const before = machine('a', { type: 'excavator', rate: 6000 });
    expect(machineDiff(before, { ...details, rate: 500, rateBasis: 'load' }, BUILT_IN_TYPES)).toBe(
      'ගාස්තුව: රු.6000 පැයකට → රු.500 ලෝඩ් එකකට',
    );
    expect(machineDiff(machine('b', { type: 'excavator' }), { ...details, rate: 2500 }, BUILT_IN_TYPES)).toBe(
      'ගාස්තුව: — → රු.2500 පැයකට',
    );
    expect(newMachineSummary({ ...details, rate: 20, rateBasis: 'foot' }, 0, BUILT_IN_TYPES)).toContain('රු.20 අඩියකට');
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
    expect(machineDiff(before, { ...details, name: 'Old', model: 'Cat', registrationNo: '', notes: '' }, BUILT_IN_TYPES)).toBe(
      'වෙනසක් නැත',
    );
    const diff = machineDiff(before, { ...details, name: 'New', model: 'Cat', registrationNo: 'LB-1', notes: '' }, BUILT_IN_TYPES);
    expect(diff).toBe('නම: Old → New · ලියාපදිංචි අංකය: — → LB-1');
    expect(machineDiff(before, { ...details, name: 'Old', model: 'Cat', registrationNo: '', notes: '', active: false }, BUILT_IN_TYPES)).toContain(
      'විශ්‍රාම',
    );
  });

  it('say what a new machine is, and what its meter starts at', () => {
    expect(newMachineSummary({ ...details, name: 'CAT 320D', model: '320D', registrationNo: '' }, 6789.7, BUILT_IN_TYPES)).toBe(
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
