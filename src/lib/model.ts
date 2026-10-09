import type { DocumentData, Timestamp } from 'firebase/firestore';

// The shapes stored in Firestore, read the way the operator app reads them
// (lib/models in the SCM Flutter project). Keep the two in step: a key renamed
// on one side silently orphans the other side's data.

// ---- small readers ----------------------------------------------------------

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Firestore timestamps, and the ISO strings the operator app writes. */
export function toDate(value: unknown): Date | null {
  if (value && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate();
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function amountsFrom<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Partial<Record<K, number>> {
  const amounts: Partial<Record<K, number>> = {};
  if (raw && typeof raw === 'object') {
    for (const key of keys) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) amounts[key] = value;
    }
  }
  return amounts;
}

// ---- what the crews record --------------------------------------------------

export type FillItem = 'diesel' | 'hydraulic' | 'compressorOil' | 'engineOil' | 'coolant';
export type InspectionItem = FillItem | 'surroundings';
/** The parts changed on a cycle, and the whole-machine service done every 10,000 hours. */
export type ServiceTask = 'engineOil' | 'dieselFilter' | 'hydraulicFilter' | 'majorService';
/** The tasks that swap a part out — the ones the store can give the part for. */
export type PartTask = Exclude<ServiceTask, 'majorService'>;
export type BlastItem =
  | 'shells'
  | 'caps'
  | 'blastingWire'
  | 'ammonia'
  | 'yaramila'
  | 'blastPowder'
  | 'dieselMix';

export const FILL_ITEMS: readonly FillItem[] = [
  'diesel',
  'hydraulic',
  'compressorOil',
  'engineOil',
  'coolant',
];

export const FILL_LABEL: Record<FillItem, string> = {
  diesel: 'ඩීසල්',
  hydraulic: 'හයිඩ්‍රොලික්',
  compressorOil: 'කම්පසර් ඔයිල්',
  engineOil: 'එන්ජින් ඔයිල්',
  coolant: 'කුලන්ට්',
};

export const INSPECTION_ITEMS: readonly InspectionItem[] = [...FILL_ITEMS, 'surroundings'];

export const INSPECTION_LABEL: Record<InspectionItem, string> = {
  ...FILL_LABEL,
  surroundings: 'වටපිට',
};

export const SERVICE_TASKS: readonly ServiceTask[] = ['engineOil', 'dieselFilter', 'hydraulicFilter', 'majorService'];

export const PART_TASKS: readonly PartTask[] = ['engineOil', 'dieselFilter', 'hydraulicFilter'];

export function isPartTask(task: ServiceTask): task is PartTask {
  return task !== 'majorService';
}

/**
 * [interval] is the hours between two services; [remindWithin] how many hours
 * before one falls due it is flagged. A part change is flagged 50 hours out —
 * a week's work. The 10,000 hour service takes booking and a machine off the
 * job, so it is flagged 500 hours out.
 */
export const SERVICE: Record<ServiceTask, { label: string; short: string; interval: number; remindWithin: number }> = {
  engineOil: { label: 'එන්ජින් ඔයිල් මාරු කිරීමට ඇති පැය', short: 'එන්ජින් ඔයිල්', interval: 250, remindWithin: 50 },
  dieselFilter: { label: 'ඩීසල් ෆිල්ටර් මාරු කිරීමට ඇති පැය', short: 'ඩීසල් ෆිල්ටර්', interval: 250, remindWithin: 50 },
  hydraulicFilter: {
    label: 'හයිඩ්‍රොලික් ෆිල්ටර් මාරු කිරීමට ඇති පැය',
    short: 'හයිඩ්‍රොලික් ෆිල්ටර්',
    interval: 2000,
    remindWithin: 50,
  },
  majorService: {
    label: '10,000 පැය සේවාවට ඇති පැය',
    short: '10,000 පැය සේවාව',
    interval: 10000,
    remindWithin: 500,
  },
};

/** The part fitted when each service is done — what the store gives out. */
export const SERVICE_PART: Record<PartTask, string> = {
  engineOil: 'එන්ජින් ඔයිල් ෆිල්ටර්',
  dieselFilter: 'ඩීසල් ෆිල්ටර්',
  hydraulicFilter: 'හයිඩ්‍රොලික් ෆිල්ටර්',
};

/** What the button that records [task] as done says. */
export function serviceDoneLabel(task: ServiceTask): string {
  return isPartTask(task) ? 'මාරු කළා' : 'සේවාව කළා';
}

/** `ඊළඟ මාරුව` or `ඊළඟ සේවාව` — the next time [task] falls due. */
export function serviceNextLabel(task: ServiceTask): string {
  return isPartTask(task) ? 'ඊළඟ මාරුව' : 'ඊළඟ සේවාව';
}

export const BLAST_ITEMS: readonly BlastItem[] = [
  'shells',
  'caps',
  'blastingWire',
  'ammonia',
  'yaramila',
  'blastPowder',
  'dieselMix',
];

export const BLAST: Record<BlastItem, { label: string; unit: string }> = {
  shells: { label: 'වෙඩි කරල් 1 / 1.5 / 1.25', unit: '' },
  caps: { label: 'කැප්', unit: '' },
  // Counted off the reel in අඩි and stored that way; shown in metres too.
  blastingWire: { label: 'වෙඩි නූල් (අඩි)', unit: 'ft' },
  ammonia: { label: 'ඇමෝනියා', unit: 'kg' },
  yaramila: { label: 'යාරමීලා', unit: 'kg' },
  blastPowder: { label: 'වෙඩි කුඩු', unit: 'kg' },
  dieselMix: { label: 'ඩීසල් මිශ්‍ර', unit: 'L' },
};

/**
 * Things drawn in several sizes, each with a quantity: 4 of the 36 bits, 4 of
 * the 38. Mirrors SizedItem in the operator app.
 */
export type SizedItem = 'bits' | 'rods';

export const SIZED_ITEMS: readonly SizedItem[] = ['bits', 'rods'];

export const SIZED_LABEL: Record<SizedItem, string> = { bits: 'බිට්', rods: 'කටු' };

/** Quantity by size; the size is the key, written as `36` or `2.5`. */
export type SizeQuantities = Record<string, number>;

/** [sizes] as size / quantity pairs, smallest size first. */
export function sizeLines(sizes: SizeQuantities | undefined): [number, number][] {
  return Object.entries(sizes ?? {})
    .map(([size, count]) => [Number(size), count] as [number, number])
    .filter(([size, count]) => Number.isFinite(size) && count > 0)
    .sort((a, b) => a[0] - b[0]);
}

function sizesFrom(raw: unknown): Partial<Record<SizedItem, SizeQuantities>> {
  const sizes: Partial<Record<SizedItem, SizeQuantities>> = {};
  if (!raw || typeof raw !== 'object') return sizes;
  for (const item of SIZED_ITEMS) {
    const lines = (raw as Record<string, unknown>)[item];
    if (!lines || typeof lines !== 'object') continue;
    const parsed: SizeQuantities = {};
    for (const [size, count] of Object.entries(lines)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) parsed[size] = count;
    }
    if (Object.keys(parsed).length > 0) sizes[item] = parsed;
  }
  return sizes;
}

export const METRES_PER_FOOT = 0.3048;

/** [amount] in metres for the one item that is a length, else null. */
export function blastMetres(item: BlastItem, amount: number): number | null {
  return item === 'blastingWire' ? amount * METRES_PER_FOOT : null;
}

/**
 * [amount] as a store item counted in [storeUnit] holds it. A store item for
 * the wire may be kept in metres, and drawing it down by the අඩි figure would
 * be out by a factor of three. [link] is a `blast:…` link; anything else, and
 * any other unit, passes through untouched.
 */
export function usageInStoreUnit(link: string, storeUnit: string, amount: number): number {
  const item = link.startsWith('blast:') ? link.slice('blast:'.length) : null;
  return item === 'blastingWire' && storeUnit === 'm' ? amount * METRES_PER_FOOT : amount;
}

// ---- roles ------------------------------------------------------------------

export type RoleId = 'operator' | 'compressor' | 'supervisor' | 'admin';

export interface RoleSpec {
  id: RoleId;
  label: string;
  /** The mockup's own word for the crew: OPERATOR, DRILLER. */
  english: string;
  fillingSlots: number;
  fillItems: readonly FillItem[];
  inspectionItems: readonly InspectionItem[];
  serviceTasks: readonly ServiceTask[];
  tracksBlasting: boolean;
  tracksBonus: boolean;
  isCrew: boolean;
}

export const ROLE_IDS: readonly RoleId[] = ['operator', 'compressor', 'supervisor', 'admin'];

/** Mirrors lib/models/user_role.dart. */
export const ROLES: Record<RoleId, RoleSpec> = {
  operator: {
    id: 'operator',
    label: 'ඔපරේටර්',
    english: 'Operator',
    fillingSlots: 3,
    fillItems: ['diesel', 'hydraulic', 'engineOil', 'coolant'],
    inspectionItems: ['diesel', 'hydraulic', 'engineOil', 'coolant', 'surroundings'],
    serviceTasks: ['engineOil', 'dieselFilter', 'hydraulicFilter', 'majorService'],
    tracksBlasting: false,
    tracksBonus: true,
    isCrew: true,
  },
  compressor: {
    id: 'compressor',
    label: 'කම්පසර්',
    english: 'Driller',
    fillingSlots: 2,
    fillItems: ['diesel', 'compressorOil', 'engineOil', 'coolant'],
    inspectionItems: ['diesel', 'compressorOil', 'engineOil', 'coolant', 'surroundings'],
    serviceTasks: ['engineOil', 'dieselFilter', 'majorService'],
    tracksBlasting: true,
    tracksBonus: false,
    isCrew: true,
  },
  supervisor: {
    id: 'supervisor',
    label: 'සුපවයිසර්',
    english: 'Supervisor',
    fillingSlots: 0,
    fillItems: [],
    inspectionItems: [],
    serviceTasks: [],
    tracksBlasting: false,
    tracksBonus: false,
    isCrew: false,
  },
  admin: {
    id: 'admin',
    label: 'පරිපාලක',
    english: 'Admin',
    fillingSlots: 0,
    fillItems: [],
    inspectionItems: [],
    serviceTasks: [],
    tracksBlasting: false,
    tracksBonus: false,
    isCrew: false,
  },
};

/** Falls back to the excavator crew, exactly as UserRole.byId does. */
export function roleById(value: unknown): RoleId {
  return value === 'compressor' || value === 'supervisor' || value === 'admin'
    ? value
    : 'operator';
}

export function isStaffRole(role: RoleId): boolean {
  return role === 'supervisor' || role === 'admin';
}

/** Crew are paid per unit; a supervisor is paid a fixed monthly salary. Admins are not paid through the panel. */
export function hasWageRate(role: RoleId): boolean {
  return ROLES[role].isCrew || role === 'supervisor';
}

// ---- people -----------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  username: string;
  machineId: string;
  role: RoleId;
  /** ඇඩ්වාන්ස් ගණන */
  advanceAmount: number;
  /**
   * දවසේ පඩිය — the wage rate. Named for what it was first (a day's wage);
   * [wageBasis] says what one unit of it is now: a day, an hour, a foot
   * drilled or a load.
   */
  dailyWage: number;
  /** What [dailyWage] is paid for. */
  wageBasis: WageBasis;
}

/**
 * One rate, one basis, for every role — an excavator operator usually per
 * day, a compressor driller per foot drilled or per load, and either can be
 * put on an hourly rate instead. Mirrors WageBasis in the operator app.
 */
/** `month` is a fixed monthly salary, set for supervisors only. */
export type WageBasis = 'day' | 'hour' | 'foot' | 'load' | 'month';

/** The bases offered for a crew member. A supervisor is always on `month`. */
export const WAGE_BASES: readonly WageBasis[] = ['day', 'hour', 'foot', 'load'];

export const WAGE_BASIS_LABEL: Record<WageBasis, { per: string; unit: string }> = {
  day: { per: 'දවසකට', unit: 'දින' },
  hour: { per: 'පැයකට', unit: 'පැය' },
  foot: { per: 'අඩියකට', unit: 'අඩි' },
  load: { per: 'ලෝඩ් එකකට', unit: 'ලෝඩ්' },
  month: { per: 'මාසෙකට', unit: 'මාසය' },
};

/** Records written before the basis existed are paid per day, as they were. */
export function wageBasisById(value: unknown): WageBasis {
  return value === 'hour' || value === 'foot' || value === 'load' || value === 'month' ? value : 'day';
}

/** A compressor crew member paid per load rather than per foot drilled. */
export function paidPerLoad(person: Pick<Person, 'role' | 'wageBasis'>): boolean {
  return person.role === 'compressor' && person.wageBasis === 'load';
}

/**
 * Which daily figure staff enter for [person] — loads for an excavator crew
 * and for a compressor crew paid per load, අඩි otherwise.
 */
export function tallyField(person: Pick<Person, 'role' | 'wageBasis'>): 'loads' | 'feet' {
  return ROLES[person.role].tracksBonus || paidPerLoad(person) ? 'loads' : 'feet';
}

export function personFrom(id: string, data: DocumentData): Person {
  return {
    id,
    name: str(data.name),
    username: str(data.username),
    machineId: str(data.machineId),
    role: roleById(data.role),
    advanceAmount: num(data.advanceAmount),
    dailyWage: num(data.dailyWage),
    wageBasis: wageBasisById(data.wageBasis),
  };
}

export function nameOf(person: Pick<Person, 'name' | 'username' | 'id'>): string {
  return person.name || person.username || person.id;
}

/** Excavator crews first, then compressors, each by name — the yard's order. */
export function byCrewThenName(a: Person, b: Person): number {
  const order = ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role);
  return order !== 0 ? order : nameOf(a).localeCompare(nameOf(b));
}

// ---- machines ---------------------------------------------------------------

/**
 * What a machine is. A crew works one kind or the other — the excavator crew
 * an excavator, the compressor crew a compressor — so this is what decides who
 * may be put on it. Mirrors MachineType in the operator app.
 */
export type MachineType = 'excavator' | 'compressor';

export const MACHINE_TYPES: readonly MachineType[] = ['excavator', 'compressor'];

export const MACHINE_TYPE: Record<MachineType, { label: string; english: string; role: RoleId }> = {
  excavator: { label: 'එක්ස්කවේටර්', english: 'Excavator', role: 'operator' },
  compressor: { label: 'කම්පසර්', english: 'Compressor', role: 'compressor' },
};

export function machineTypeById(value: unknown): MachineType | null {
  return value === 'excavator' || value === 'compressor' ? value : null;
}

/** The kind of machine [role] works — null for staff, who work none. */
export function machineTypeForRole(role: RoleId): MachineType | null {
  return MACHINE_TYPES.find((type) => MACHINE_TYPE[type].role === role) ?? null;
}

export interface Machine {
  id: string;
  /** වැඩ කර ඇති මුළු පැය ගණන — the running hour meter. */
  totalHours: number;
  /** Meter reading each part is next due at. */
  serviceDueAt: Partial<Record<ServiceTask, number>>;
  /** Null on a machine set up before its details were kept — see machineTypeOf. */
  type: MachineType | null;
  /** What the yard calls it, if it has a name beyond its number. */
  name: string;
  /** Make and model. */
  model: string;
  /** The plate, or the serial number for a machine that is not registered. */
  registrationNo: string;
  notes: string;
  /**
   * False once a machine is retired: it stays, with all its history, but no
   * one new is put on it.
   */
  active: boolean;
}

/** What is kept about a machine besides its meter and its service. */
export interface MachineDetails {
  type: MachineType;
  name: string;
  model: string;
  registrationNo: string;
  notes: string;
  active: boolean;
}

export function machineFrom(id: string, data: DocumentData): Machine {
  return {
    id,
    totalHours: num(data.totalHours),
    serviceDueAt: amountsFrom(data.serviceDueAt, SERVICE_TASKS),
    type: machineTypeById(data.type),
    name: str(data.name),
    model: str(data.model),
    registrationNo: str(data.registrationNo),
    notes: str(data.notes),
    // A machine from before this was kept is in use.
    active: data.active !== false,
  };
}

/** `CAT 320D · excavator-01`, or just the number for a machine with no name. */
export function machineTitle(machine: Pick<Machine, 'id' | 'name'>): string {
  return machine.name ? `${machine.name} · ${machine.id}` : machine.id;
}

export interface ServiceStatus {
  task: ServiceTask;
  /** Hours left on the meter; negative once overdue. */
  remaining: number;
  isDue: boolean;
  isDueSoon: boolean;
}

/** Null while the part has not been set up — never a confident "overdue". */
export function serviceStatus(machine: Machine | undefined, task: ServiceTask): ServiceStatus | null {
  const due = machine?.serviceDueAt[task];
  if (!machine || due == null) return null;
  const remaining = due - machine.totalHours;
  return {
    task,
    remaining,
    isDue: remaining <= 0,
    isDueSoon: remaining > 0 && remaining <= SERVICE[task].remindWithin,
  };
}

/** Everything needing attention, the most urgent first. */
export function serviceAlerts(
  machine: Machine | undefined,
  tasks: readonly ServiceTask[],
): ServiceStatus[] {
  return tasks
    .map((task) => serviceStatus(machine, task))
    .filter((status): status is ServiceStatus => !!status && (status.isDue || status.isDueSoon))
    .sort((a, b) => a.remaining - b.remaining);
}

export function serviceMessage(status: ServiceStatus): string {
  const shown = Math.abs(status.remaining);
  const amount = Number.isInteger(shown) ? shown.toFixed(0) : shown.toFixed(1);
  const name = SERVICE[status.task].short;
  if (!isPartTask(status.task)) {
    return status.isDue ? `${name} පැය ${amount} කින් ප්‍රමාද වී ඇත` : `${name}ට තව පැය ${amount} යි`;
  }
  return status.isDue
    ? `${name} මාරු කිරීම පැය ${amount} කින් ප්‍රමාද වී ඇත`
    : `${name} මාරු කිරීමට තව පැය ${amount} යි`;
}

// ---- days -------------------------------------------------------------------

export const SLOTS_PER_DAY = 3;

export interface Filling {
  slot: number;
  onHours: number | null;
  offHours: number | null;
  amounts: Partial<Record<FillItem, number>>;
  lockedAt: Date | null;
}

export interface Blasting {
  amounts: Partial<Record<BlastItem, number>>;
  /** බිට් and කටු, by size. */
  sizes: Partial<Record<SizedItem, SizeQuantities>>;
  lockedAt: Date | null;
}

export interface Day {
  date: string;
  /** False when nothing has been recorded against the day yet. */
  exists: boolean;
  fillings: Filling[];
  inspection: Partial<Record<InspectionItem, boolean>>;
  /** පැටවූ ලෝඩ් ගණන */
  loads: number;
  /** අඩි ගණන */
  feet: number;
  /** The OFF meter, carried back from the next morning's ON. */
  closingHours: number | null;
  /** Worked, but marked by hand rather than entered — it has no meter reading. */
  workedManually: boolean;
  blasting: Blasting;
}

export function emptyDay(date: string): Day {
  return {
    date,
    exists: false,
    fillings: [],
    inspection: {},
    loads: 0,
    feet: 0,
    closingHours: null,
    workedManually: false,
    blasting: { amounts: {}, sizes: {}, lockedAt: null },
  };
}

export function dayFrom(date: string, data: DocumentData | undefined): Day {
  if (!data) return emptyDay(date);

  const fillings: Filling[] = [];
  const rawFillings = data.fillings as Record<string, DocumentData> | undefined;
  for (let slot = 1; slot <= SLOTS_PER_DAY; slot++) {
    const entry = rawFillings?.[String(slot)];
    if (entry && typeof entry === 'object') {
      fillings.push({
        slot,
        onHours: numOrNull(entry.onHours),
        offHours: numOrNull(entry.offHours),
        amounts: amountsFrom(entry.amounts, FILL_ITEMS),
        lockedAt: toDate(entry.lockedAt),
      });
    }
  }

  const inspection: Partial<Record<InspectionItem, boolean>> = {};
  const rawInspection = data.inspection as Record<string, unknown> | undefined;
  for (const item of INSPECTION_ITEMS) {
    const value = rawInspection?.[item];
    if (typeof value === 'boolean') inspection[item] = value;
  }

  const rawBlasting = data.blasting as DocumentData | undefined;

  return {
    date: str(data.date) || date,
    exists: true,
    fillings,
    inspection,
    loads: num(data.loads),
    feet: num(data.feet),
    closingHours: numOrNull(data.closingHours),
    workedManually: data.workedManually === true,
    blasting: {
      amounts: amountsFrom(rawBlasting?.amounts, BLAST_ITEMS),
      sizes: sizesFrom(rawBlasting?.sizes),
      lockedAt: toDate(rawBlasting?.lockedAt),
    },
  };
}

export function slotOf(day: Day, slot: number): Filling | undefined {
  return day.fillings.find((filling) => filling.slot === slot);
}

/** The meter the machine started the day on — recorded in slot 1. */
export function dayOnHours(day: Day): number | null {
  for (let slot = 1; slot <= SLOTS_PER_DAY; slot++) {
    const value = slotOf(day, slot)?.onHours;
    if (value != null) return value;
  }
  return null;
}

/** Normally the closing hours; older records kept an OFF inside a slot. */
/** Counts toward the month's worked days — started on, or marked worked by hand. */
export function dayWorked(day: Day): boolean {
  return dayOnHours(day) != null || day.workedManually;
}

export function dayOffHours(day: Day): number | null {
  if (day.closingHours != null) return day.closingHours;
  for (let slot = SLOTS_PER_DAY; slot >= 1; slot--) {
    const value = slotOf(day, slot)?.offHours;
    if (value != null) return value;
  }
  return null;
}

export function workedHours(day: Day): number | null {
  const start = dayOnHours(day);
  const end = dayOffHours(day);
  return start == null || end == null ? null : end - start;
}

export function totalFilled(day: Day, item: FillItem): number {
  return day.fillings.reduce((sum, filling) => sum + (filling.amounts[item] ?? 0), 0);
}

export function lockedSlotCount(day: Day): number {
  return day.fillings.filter((filling) => filling.lockedAt).length;
}

// ---- months -----------------------------------------------------------------

export interface MonthTally {
  /** `yyyy-MM` */
  month: string;
  loads: number;
  feet: number;
  hours: number;
}

export function monthFrom(month: string, data: DocumentData | undefined): MonthTally {
  return {
    month,
    loads: num(data?.loads),
    feet: num(data?.feet),
    hours: num(data?.hours),
  };
}

// ---- store ------------------------------------------------------------------

/**
 * Ties a store item to what uses it up, so recording that draws the stock
 * down: a fluid on a පිරවීම, an explosive on a වෙඩි බඩු sheet, or the part
 * fitted when a service is marked done.
 */
export type StockLink = `fill:${FillItem}` | `blast:${BlastItem}` | `service:${PartTask}`;

export interface LinkOption {
  link: StockLink;
  label: string;
  group: string;
  unit: string;
}

export const LINK_OPTIONS: readonly LinkOption[] = [
  ...FILL_ITEMS.map((item) => ({
    link: `fill:${item}` as StockLink,
    label: FILL_LABEL[item],
    group: 'පිරවීම',
    unit: 'L',
  })),
  ...BLAST_ITEMS.map((item) => ({
    link: `blast:${item}` as StockLink,
    label: BLAST[item].label,
    group: 'වෙඩි බඩු',
    unit: BLAST[item].unit || 'ගණන',
  })),
  ...PART_TASKS.map((task) => ({
    link: `service:${task}` as StockLink,
    label: SERVICE_PART[task],
    group: 'සේවා (මාරු කළා)',
    unit: 'ගණන',
  })),
];

export function isStockLink(value: unknown): value is StockLink {
  return LINK_OPTIONS.some((option) => option.link === value);
}

/** A linked item lives at a fixed id — firestore.rules insists on it. */
export function linkDocId(link: StockLink): string {
  return link.replace(':', '-');
}

export function linkLabel(link: StockLink | null): string {
  const option = LINK_OPTIONS.find((candidate) => candidate.link === link);
  return option ? `${option.group} · ${option.label}` : '—';
}

export interface StoreItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  /** At or below this the item is flagged as low. */
  minQuantity: number;
  /** Rupees per unit — prices the fuel on the dashboard. */
  unitPrice: number;
  link: StockLink | null;
  note: string;
  createdAt: Date | null;
  /** When the shelf was last physically counted. */
  countedAt: Date | null;
  updatedAt: Date | null;
}

export function storeItemFrom(id: string, data: DocumentData): StoreItem {
  return {
    id,
    name: str(data.name),
    unit: str(data.unit),
    quantity: num(data.quantity),
    minQuantity: num(data.minQuantity),
    unitPrice: num(data.unitPrice),
    link: isStockLink(data.link) ? data.link : null,
    note: str(data.note),
    createdAt: toDate(data.createdAt),
    countedAt: toDate(data.countedAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(item: Pick<StoreItem, 'quantity' | 'minQuantity'>): StockStatus {
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= item.minQuantity) return 'low';
  return 'ok';
}

export const STOCK_LABEL: Record<StockStatus, string> = {
  out: 'තොග අවසන්',
  low: 'තොග අඩුයි',
  ok: 'ප්‍රමාණවත්',
};

// ---- store movements --------------------------------------------------------

export type MovementType = 'create' | 'restock' | 'use' | 'adjust' | 'delete' | 'usage';

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  create: 'නව අයිතමය',
  restock: 'තොග එකතු කිරීම',
  use: 'භාවිතය (අතින්)',
  adjust: 'නැවත ගණන් කිරීම',
  delete: 'අයිතමය ඉවත් කිරීම',
  usage: 'භාවිතය',
};

export interface MovementLine {
  itemId: string;
  name: string;
  unit: string;
  delta: number;
  /**
   * What one unit cost when the change was made — prices purchases and use
   * in the finance view. Missing on lines written before it was recorded.
   */
  unitPrice: number | null;
}

export interface Movement {
  id: string;
  type: MovementType;
  items: MovementLine[];
  /** Usage that had no store item to draw from. */
  unmatched: string[];
  machineId: string | null;
  date: string | null;
  source: string | null;
  operatorName: string | null;
  note: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date | null;
}

export function movementFrom(id: string, data: DocumentData): Movement {
  const type = data.type as MovementType;
  const items = Array.isArray(data.items) ? (data.items as DocumentData[]) : [];
  return {
    id,
    type: type in MOVEMENT_LABEL ? type : 'adjust',
    items: items.map((line) => ({
      itemId: str(line.itemId),
      name: str(line.name),
      unit: str(line.unit),
      delta: num(line.delta),
      unitPrice: numOrNull(line.unitPrice),
    })),
    unmatched: Array.isArray(data.unmatched) ? data.unmatched.map(String) : [],
    machineId: str(data.machineId) || null,
    date: str(data.date) || null,
    source: str(data.source) || null,
    operatorName: str(data.operatorName) || null,
    note: str(data.note),
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName),
    createdAt: toDate(data.createdAt),
  };
}

/** `fill2` → `පිරවීම 2`, `blast` → `වෙඩි බඩු`. */
export function sourceLabel(source: string | null): string {
  if (!source) return '';
  if (source === 'blast') return 'වෙඩි බඩු';
  const slot = /^fill(\d)$/.exec(source);
  return slot ? `පිරවීම ${slot[1]}` : source;
}

// ---- audit log ----------------------------------------------------------------

/**
 * Every admin-panel action that changes an account, a store item's setup, a
 * bill or a setting, or writes a sale, kept for good — what [storeMovements]
 * is for a count. Routine stock movements stay in their own trail
 * ([Movement]). A sale's verification and lapse are left to the `sales` doc
 * itself: anyone signed in may verify a bill, and the rules let only staff
 * write here.
 */
export type AuditAction =
  | 'account.create'
  | 'account.update'
  | 'account.remove'
  | 'account.restore'
  | 'account.password'
  | 'store.create'
  | 'store.update'
  | 'store.delete'
  | 'store.restore'
  | 'store.stock'
  | 'bill.create'
  | 'bill.update'
  | 'bill.delete'
  | 'bill.restore'
  | 'sales.create'
  | 'sales.update'
  | 'sales.delete'
  | 'sales.restore'
  | 'sales.verify'
  | 'sales.prices'
  | 'landowner.rate'
  | 'landowner.paid'
  | 'landowner.unpaid'
  | 'service.reset'
  | 'service.set'
  | 'machine.create'
  | 'machine.update'
  | 'machine.assign'
  | 'leave.workday'
  | 'payment.add'
  | 'figures.set'
  | 'tally.set'
  | 'day.edit'
  // Staff recording for a crew member, which the crew record for themselves.
  | 'crew.fill'
  | 'crew.blast'
  | 'crew.inspect';

export const AUDIT_LABEL: Record<AuditAction, string> = {
  'account.create': 'ගිණුම සෑදුවා',
  'account.update': 'ගිණුම යාවත්කාලීන කළා',
  'account.remove': 'ගිණුම ඉවත් කළා',
  'account.restore': 'ගිණුම ආපසු ගත්තා',
  'account.password': 'මුරපදය වෙනස් කළා',
  'store.create': 'ගබඩා අයිතමය සෑදුවා',
  'store.update': 'ගබඩා අයිතමය යාවත්කාලීන කළා',
  'store.delete': 'ගබඩා අයිතමය ඉවත් කළා',
  'store.restore': 'ගබඩා අයිතමය ආපසු ගත්තා',
  'store.stock': 'ගබඩා තොගය වෙනස් කළා',
  'bill.create': 'බිල්පතක් සෑදුවා',
  'bill.update': 'බිල්පතක් සංස්කරණය කළා',
  'bill.delete': 'බිල්පතක් ඉවත් කළා',
  'bill.restore': 'බිල්පතක් ආපසු ගත්තා',
  'sales.create': 'විකුණුම් බිල්පතක් සෑදුවා',
  'sales.update': 'විකුණුම් බිල්පතක් සංස්කරණය කළා',
  'sales.delete': 'විකුණුම් බිල්පතක් ඉවත් කළා',
  'sales.restore': 'විකුණුම් බිල්පතක් ආපසු ගත්තා',
  'sales.verify': 'විකුණුම් බිල්පතක් තහවුරු කළා',
  'sales.prices': 'විකුණුම් මිල වෙනස් කළා',
  'landowner.rate': 'ඉඩම් හිමියාගේ ගාස්තු වෙනස් කළා',
  'landowner.paid': 'ඉඩම් හිමියාට ගෙවූ බව සලකුණු කළා',
  'landowner.unpaid': 'ඉඩම් හිමියාට ගෙවූ බව ඉවත් කළා',
  'service.reset': 'සේවා කාලය යළි පිහිටෙව්වා',
  'service.set': 'ඊළඟ සේවා මීටරය සකස් කළා',
  'machine.create': 'යන්ත්‍රයක් එකතු කළා',
  'machine.update': 'යන්ත්‍රයේ විස්තර වෙනස් කළා',
  'machine.assign': 'කණ්ඩායම් සාමාජිකයෙක් යන්ත්‍රයකට යෙදුවා',
  'leave.workday': 'නිවාඩු දිනයක් වැඩ කළ දිනයක් ලෙස සුරැකුණා',
  'payment.add': 'ණය ගෙවීමක් එකතු කළා',
  'figures.set': 'වැටුප/ඇඩ්වාන්ස් වෙනස් කළා',
  'tally.set': 'ලෝඩ්/අඩි නිවැරදි කළා',
  'day.edit': 'දවසක සටහන් සංස්කරණය කළා',
  'crew.fill': 'කණ්ඩායමක් වෙනුවෙන් පිරවීමක් සුරැකුවා',
  'crew.blast': 'කණ්ඩායමක් වෙනුවෙන් වෙඩි බඩු සුරැකුවා',
  'crew.inspect': 'කණ්ඩායමක් වෙනුවෙන් පරික්ෂාව සුරැකුවා',
};

/** What group of the panel [action] belongs to — the audit page's filter. */
export function auditGroup(action: AuditAction): string {
  return action.split('.')[0];
}

export interface AuditEntry {
  id: string;
  action: AuditAction;
  entityType: 'operator' | 'store' | 'bill' | 'sale' | 'machine' | 'settings';
  entityId: string;
  /** The person's name, the item's name, "විකුණුම් මිල", the machine id, ... */
  entityLabel: string;
  /** A human-readable line, before → after where that matters. */
  summary: string;
  /** Which app wrote it; empty on an entry from before this was kept. */
  source: 'panel' | 'phone' | '';
  createdBy: string;
  createdByName: string;
  createdAt: Date | null;
}

export function auditEntryFrom(id: string, data: DocumentData): AuditEntry {
  const action = data.action as AuditAction;
  return {
    id,
    action: action in AUDIT_LABEL ? action : 'account.update',
    entityType: str(data.entityType) as AuditEntry['entityType'],
    entityId: str(data.entityId),
    entityLabel: str(data.entityLabel),
    summary: str(data.summary),
    source: data.source === 'panel' || data.source === 'phone' ? data.source : '',
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName),
    createdAt: toDate(data.createdAt),
  };
}

// ---- bills ------------------------------------------------------------------

export type BillCategory = 'advance' | 'food' | 'water' | 'other';

export const BILL_CATEGORIES: readonly BillCategory[] = ['advance', 'food', 'water', 'other'];

export const BILL: Record<
  BillCategory,
  { label: string; english: string; /** Taken out of the crew member's pay. */ deduction: boolean }
> = {
  advance: { label: 'ඇඩ්වාන්ස්', english: 'Advance', deduction: true },
  food: { label: 'කෑම', english: 'Food', deduction: true },
  water: { label: 'වතුර බිල', english: 'Water bill', deduction: false },
  other: { label: 'වෙනත්', english: 'Other', deduction: false },
};

export interface Bill {
  id: string;
  category: BillCategory;
  amount: number;
  /** `yyyy-MM-dd` */
  date: string;
  note: string;
  operatorId: string | null;
  operatorName: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date | null;
}

export function billFrom(id: string, data: DocumentData): Bill {
  const category = data.category as BillCategory;
  return {
    id,
    category: BILL_CATEGORIES.includes(category) ? category : 'other',
    amount: num(data.amount),
    date: str(data.date),
    note: str(data.note),
    operatorId: str(data.operatorId) || null,
    operatorName: str(data.operatorName) || null,
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName),
    createdAt: toDate(data.createdAt),
  };
}

// ---- sales ------------------------------------------------------------------

/**
 * What the yard sells, by the vehicle it leaves in: a tipper lorry, measured
 * and priced in the cubes it carried, or a tractor, measured and priced one
 * trailer load at a time — see {@link SalesPrices}.
 */
export type SaleType = 'tipper' | 'tractor';

export const SALE_TYPES: readonly SaleType[] = ['tipper', 'tractor'];

/** `unit` is what the type's quantity counts. */
export const SALE_TYPE: Record<SaleType, { label: string; unit: string }> = {
  tipper: { label: 'ටිපර් ලෝඩ්', unit: 'කියුබ්' },
  tractor: { label: 'ට්‍රැක්ටර් ලෝඩ්', unit: 'ලෝඩ්' },
};

/**
 * The cube capacities a tipper comes in. A tipper sale's quantity is chosen
 * from here rather than typed in: a lorry cannot carry an arbitrary amount,
 * only what it was built to.
 */
export const TIPPER_SIZES: readonly number[] = [1, 2, 2.5, 3, 4, 5];

export type SaleStatus = 'pending' | 'verified' | 'cancelled';

export const SALE_STATUS: Record<SaleStatus, string> = {
  pending: 'තහවුරු කර නැත',
  verified: 'තහවුරුයි',
  cancelled: 'අවලංගුයි',
};

/** An unverified sale lapses this long after it was written. */
export const SALE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** The letters a sale's code is made of — no 0/O or 1/I to misread. */
export const SALE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A full tipper load is this many cubes. */
export const CUBES_PER_TIPPER = 3;

/**
 * What staff set — a full tipper load's price and a tractor load's — and the
 * cube price worked out from the first. A tipper sale is priced per cube from
 * {@link cubePrice}, a tractor sale per load from {@link tractorPrice}, and
 * firestore.rules checks the sum against the same figure.
 */
export interface SalesPrices {
  /** Rupees for a full tipper load — {@link CUBES_PER_TIPPER} cubes. */
  tipperPrice: number;
  /** Rupees for one cube: {@link tipperPrice} over {@link CUBES_PER_TIPPER}. */
  cubePrice: number;
  /** Rupees for one tractor load. */
  tractorPrice: number;
  /**
   * Rupees per load that went to the machine before it was charged by the
   * hour. Still written on every sale (firestore.rules checks it) but the
   * finance report no longer reads it — see {@link machineHourly}.
   */
  machineCharge: number;
  /** Rupees the machine is charged for each hour the loading excavator worked. */
  machineHourly: number;
}

/** What the machine was charged per load until it moved to the hour. firestore.rules falls back to the same figure. */
export const DEFAULT_MACHINE_CHARGE = 4000;

/** What the machine is charged for each hour worked until staff set otherwise. */
export const DEFAULT_MACHINE_HOURLY = 6000;

/**
 * What sales are priced at until staff set otherwise. firestore.rules falls
 * back to the same figures.
 */
export const DEFAULT_SALES_PRICES: SalesPrices = {
  tipperPrice: 19500,
  cubePrice: 6500,
  tractorPrice: 6500,
  machineCharge: DEFAULT_MACHINE_CHARGE,
  machineHourly: DEFAULT_MACHINE_HOURLY,
};

/** One cube's price for `tipperPrice` — what a tipper load's figure comes to. */
export function cubePriceFor(tipperPrice: number): number {
  return tipperPrice / CUBES_PER_TIPPER;
}

/** What one of `type`'s units sells for — a cube for a tipper, a load for a tractor. */
export function unitPriceOf(prices: SalesPrices, type: SaleType): number {
  return type === 'tipper' ? prices.cubePrice : prices.tractorPrice;
}

/**
 * The defaults until staff have set the prices — and for a document from
 * before tipper loads were counted in cubes, whose figures meant something
 * else and would misprice every sale.
 */
export function pricesFrom(data: DocumentData | undefined): SalesPrices {
  const positive = (value: unknown) => {
    const number = numOrNull(value);
    return number != null && number > 0 ? number : null;
  };
  const charge = numOrNull(data?.machineCharge);
  const machineCharge = charge != null && charge >= 0 ? charge : DEFAULT_MACHINE_CHARGE;
  const hourly = numOrNull(data?.machineHourly);
  const machineHourly = hourly != null && hourly >= 0 ? hourly : DEFAULT_MACHINE_HOURLY;
  const tipperPrice = positive(data?.tipperPrice);
  const cubePrice = positive(data?.cubePrice);
  if (tipperPrice == null || cubePrice == null) {
    return { ...DEFAULT_SALES_PRICES, machineCharge, machineHourly };
  }
  return {
    tipperPrice,
    cubePrice,
    tractorPrice: positive(data?.tractorPrice) ?? DEFAULT_SALES_PRICES.tractorPrice,
    machineCharge,
    machineHourly,
  };
}

/** The material a load was made of — a label only, the price is the same. */
export type SaleMaterial = 'sakka' | 'six_nine' | 'boldas' | 'kory_dust';

export const SALE_MATERIAL: Record<SaleMaterial, string> = {
  sakka: 'සක්කර',
  six_nine: '6/9',
  boldas: 'බෝල්දාස්',
  kory_dust: 'කෝරි ඩස්ට්',
};

const SALE_MATERIAL_IDS = Object.keys(SALE_MATERIAL) as SaleMaterial[];

/** Paid when the load leaves, or owed until a payment comes in. */
export type PaymentType = 'cash' | 'credit';

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  cash: 'මුදල්',
  credit: 'නයට',
};

/** Trimmed and lowercased, so the same customer typed two ways groups together. */
export function customerKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

/** A payment against a customer's credit account — written once, never changed. */
export interface Payment {
  id: string;
  customerKey: string;
  customerName: string;
  amount: number;
  /** `yyyy-MM-dd` */
  date: string;
  note: string;
  createdByName: string;
  createdAt: Date | null;
}

export function paymentFrom(id: string, data: DocumentData): Payment {
  return {
    id,
    customerKey: str(data.customerKey),
    customerName: str(data.customerName),
    amount: num(data.amount),
    date: str(data.date),
    note: str(data.note),
    createdByName: str(data.createdByName),
    createdAt: toDate(data.createdAt),
  };
}

export interface Sale {
  /** Printed on the bill and carried in its QR; also the document id. */
  code: string;
  /** Null on a sale from before the material was recorded. */
  material: SaleMaterial | null;
  paymentType: PaymentType;
  /**
   * Paid now for a load the customer takes later. Income from the day it is
   * paid; it never lapses, and its QR is scanned whenever the load goes.
   */
  prepaid: boolean;
  customerKey: string;
  /** Rupees per load to the machine when the sale was written; null on a sale from before it was kept. */
  machineCharge: number | null;
  /**
   * The bill's number within its month, from 1 — `001` on the bill. Null on
   * a sale written before bills were numbered.
   */
  number: number | null;
  type: SaleType;
  quantity: number;
  unitPrice: number;
  amount: number;
  customerName: string;
  customerPhone: string;
  vehicleNo: string;
  note: string;
  /** `yyyy-MM-dd` */
  date: string;
  /** As stored — see [saleStatus] for what it means now. */
  status: SaleStatus;
  createdBy: string;
  createdByName: string;
  createdAt: Date | null;
  verifiedBy: string | null;
  verifiedByName: string;
  verifiedAt: Date | null;
  cancelledAt: Date | null;
}

export function saleFrom(id: string, data: DocumentData): Sale {
  const status: SaleStatus =
    data.status === 'verified' || data.status === 'cancelled' ? data.status : 'pending';
  return {
    code: id,
    material: SALE_MATERIAL_IDS.find((item) => item === data.material) ?? null,
    paymentType: data.paymentType === 'credit' ? 'credit' : 'cash',
    prepaid: data.prepaid === true,
    customerKey: str(data.customerKey),
    machineCharge: numOrNull(data.machineCharge),
    number: numOrNull(data.number),
    // A sale written before tipper loads were counted in cubes carries
    // 'cube'; it was a tipper load as well, so it reads as one.
    type: data.type === 'tractor' ? 'tractor' : 'tipper',
    quantity: num(data.quantity),
    unitPrice: num(data.unitPrice),
    amount: num(data.amount),
    customerName: str(data.customerName),
    customerPhone: str(data.customerPhone),
    vehicleNo: str(data.vehicleNo),
    note: str(data.note),
    date: str(data.date),
    status,
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName),
    createdAt: toDate(data.createdAt),
    verifiedBy: str(data.verifiedBy) || null,
    verifiedByName: str(data.verifiedByName),
    verifiedAt: toDate(data.verifiedAt),
    cancelledAt: toDate(data.cancelledAt),
  };
}

/** When an unverified sale lapses; null until the server has dated it. */
export function saleExpiry(sale: Sale): Date | null {
  return sale.createdAt ? new Date(sale.createdAt.getTime() + SALE_LIFETIME_MS) : null;
}

/**
 * What the sale is now. An unverified one past its day is cancelled whether
 * or not anyone has written that down yet — firestore.rules already refuses
 * to verify it. A prepaid one never lapses: it waits for its load.
 */
export function saleStatus(sale: Sale, now = Date.now()): SaleStatus {
  if (sale.status !== 'pending') return sale.status;
  if (sale.prepaid) return 'pending';
  const expiry = saleExpiry(sale);
  return expiry && expiry.getTime() <= now ? 'cancelled' : 'pending';
}

/** Whether the sale is income: verified, or prepaid and not cancelled. */
export function isSaleIncome(sale: Sale, now = Date.now()): boolean {
  const status = saleStatus(sale, now);
  return status === 'verified' || (sale.prepaid && status === 'pending');
}

/** Prepaid, its load not yet gone. */
export function awaitsPrepaidLoad(sale: Sale, now = Date.now()): boolean {
  return sale.prepaid && saleStatus(sale, now) === 'pending';
}

export const PREPAID_LABEL = 'කලින් ගෙවූ · ලෝඩ් ඉතිරි';

/** `K7Q2-M9XA` — how a code is printed and read out. */
export function formatSaleCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** `001` for `1` — how an invoice number is printed. */
export function padSaleNumber(number: number): string {
  return String(number).padStart(3, '0');
}

/** `001` — a bill's number as printed; the code for one from before bills were numbered. */
export function saleNumber(sale: Sale): string {
  return sale.number == null ? formatSaleCode(sale.code) : padSaleNumber(sale.number);
}

/** The invoice number in typed text — what is printed on the bill — or null if it isn't one. */
export function parseInvoiceNumber(text: string): number | null {
  const digits = text.trim().replace(/\D/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** What the QR on a bill carries. */
export function saleQrPayload(code: string): string {
  return `SCM-SALE:${code}`;
}

/** The code in a scanned QR or a typed-in bill number, or null. */
export function parseSaleCode(text: string): string | null {
  const cleaned = text
    .trim()
    .toUpperCase()
    .replace(/^SCM-SALE:/, '')
    .replace(/[\s-]/g, '');
  return /^[2-9A-HJ-NP-Z]{8}$/.test(cleaned) ? cleaned : null;
}
