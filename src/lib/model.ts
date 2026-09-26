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
export type ServiceTask = 'engineOil' | 'dieselFilter' | 'hydraulicFilter';
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

export const SERVICE_TASKS: readonly ServiceTask[] = ['engineOil', 'dieselFilter', 'hydraulicFilter'];

export const SERVICE: Record<ServiceTask, { label: string; short: string; interval: number }> = {
  engineOil: { label: 'එන්ජින් ඔයිල් මාරු කිරීමට ඇති පැය', short: 'එන්ජින් ඔයිල්', interval: 250 },
  dieselFilter: { label: 'ඩීසල් ෆිල්ටර් මාරු කිරීමට ඇති පැය', short: 'ඩීසල් ෆිල්ටර්', interval: 250 },
  hydraulicFilter: {
    label: 'හයිඩ්‍රොලික් ෆිල්ටර් මාරු කිරීමට ඇති පැය',
    short: 'හයිඩ්‍රොලික් ෆිල්ටර්',
    interval: 2000,
  },
};

/** The part fitted when each service is done — what the store gives out. */
export const SERVICE_PART: Record<ServiceTask, string> = {
  engineOil: 'එන්ජින් ඔයිල් ෆිල්ටර්',
  dieselFilter: 'ඩීසල් ෆිල්ටර්',
  hydraulicFilter: 'හයිඩ්‍රොලික් ෆිල්ටර්',
};

/** A change is flagged this many hours before it falls due. */
export const REMIND_WITHIN_HOURS = 50;

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
    serviceTasks: ['engineOil', 'dieselFilter', 'hydraulicFilter'],
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
    serviceTasks: ['engineOil', 'dieselFilter'],
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

// ---- people -----------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  username: string;
  machineId: string;
  role: RoleId;
  /** නිවාඩු ගත් දින ගණන */
  leaveDays: number;
  /** ඇඩ්වාන්ස් ගණන */
  advanceAmount: number;
  /**
   * ලැබිය යුතු මුදල — what they are owed before the advance comes off. Set by
   * hand; the crew's own app shows it less [advanceAmount].
   */
  receivableAmount: number;
  /** බෝනස් මුදල් එකතුව */
  bonusTotal: number;
  /** What one අඩිය pays a compressor crew member paid per foot. */
  ratePerFoot: number;
  /** What one ලෝඩ් එක pays a compressor crew member paid per load. */
  ratePerLoad: number;
  /** Which of the two rates a compressor crew member's month is paid on. */
  payBasis: PayBasis;
  /** දවසේ පඩිය — a worked day's wage. */
  dailyWage: number;
}

export type PayBasis = 'foot' | 'load';

export const PAY_BASIS_LABEL: Record<PayBasis, { choice: string; per: string; unit: string }> = {
  foot: { choice: 'අඩියකට', per: 'අඩියකට', unit: 'අඩි' },
  load: { choice: 'ලෝඩ් එකකට', per: 'ලෝඩ් එකකට', unit: 'ලෝඩ්' },
};

/** Records written before the basis existed are paid per foot, as they were. */
export function payBasisById(value: unknown): PayBasis {
  return value === 'load' ? 'load' : 'foot';
}

/** A compressor crew member paid per load rather than per foot. */
export function paidPerLoad(person: Pick<Person, 'role' | 'payBasis'>): boolean {
  return person.role === 'compressor' && person.payBasis === 'load';
}

/** The rate that applies to [person]: the load rate or the foot rate. */
export function rateOf(person: Pick<Person, 'role' | 'payBasis' | 'ratePerFoot' | 'ratePerLoad'>): number {
  return paidPerLoad(person) ? person.ratePerLoad : person.ratePerFoot;
}

/**
 * Which daily figure staff enter for [person] — loads for an excavator crew
 * and for a compressor crew paid per load, අඩි otherwise.
 */
export function tallyField(person: Pick<Person, 'role' | 'payBasis'>): 'loads' | 'feet' {
  return ROLES[person.role].tracksBonus || paidPerLoad(person) ? 'loads' : 'feet';
}

export function personFrom(id: string, data: DocumentData): Person {
  return {
    id,
    name: str(data.name),
    username: str(data.username),
    machineId: str(data.machineId),
    role: roleById(data.role),
    leaveDays: num(data.leaveDays),
    advanceAmount: num(data.advanceAmount),
    receivableAmount: num(data.receivableAmount),
    bonusTotal: num(data.bonusTotal),
    ratePerFoot: num(data.ratePerFoot),
    ratePerLoad: num(data.ratePerLoad),
    payBasis: payBasisById(data.payBasis),
    dailyWage: num(data.dailyWage),
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

export interface Machine {
  id: string;
  /** වැඩ කර ඇති මුළු පැය ගණන — the running hour meter. */
  totalHours: number;
  /** Meter reading each part is next due at. */
  serviceDueAt: Partial<Record<ServiceTask, number>>;
}

export function machineFrom(id: string, data: DocumentData): Machine {
  return {
    id,
    totalHours: num(data.totalHours),
    serviceDueAt: amountsFrom(data.serviceDueAt, SERVICE_TASKS),
  };
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
    isDueSoon: remaining > 0 && remaining <= REMIND_WITHIN_HOURS,
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
  const part = SERVICE[status.task].short;
  return status.isDue
    ? `${part} මාරු කිරීම පැය ${amount} කින් ප්‍රමාද වී ඇත`
    : `${part} මාරු කිරීමට තව පැය ${amount} යි`;
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
export type StockLink = `fill:${FillItem}` | `blast:${BlastItem}` | `service:${ServiceTask}`;

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
  ...SERVICE_TASKS.map((task) => ({
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

/** What the yard sells: material by the cube, or by the tractor load. */
export type SaleType = 'cube' | 'tractor';

export const SALE_TYPES: readonly SaleType[] = ['cube', 'tractor'];

export const SALE_TYPE: Record<SaleType, { label: string; unit: string }> = {
  cube: { label: 'කියුබ්', unit: 'කියුබ්' },
  tractor: { label: 'ට්‍රැක්ටර් ලෝඩ්', unit: 'ලෝඩ්' },
};

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

export interface SalesPrices {
  /** Rupees for one cube. */
  cubePrice: number;
  /** Rupees for one tractor load. */
  tractorPrice: number;
}

export function pricesFrom(data: DocumentData | undefined): SalesPrices | null {
  const cubePrice = numOrNull(data?.cubePrice);
  const tractorPrice = numOrNull(data?.tractorPrice);
  return cubePrice != null && tractorPrice != null ? { cubePrice, tractorPrice } : null;
}

export function priceOf(prices: SalesPrices, type: SaleType): number {
  return type === 'cube' ? prices.cubePrice : prices.tractorPrice;
}

export interface Sale {
  /** Printed on the bill and carried in its QR; also the document id. */
  code: string;
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
    number: numOrNull(data.number),
    type: data.type === 'tractor' ? 'tractor' : 'cube',
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
 * to verify it.
 */
export function saleStatus(sale: Sale, now = Date.now()): SaleStatus {
  if (sale.status !== 'pending') return sale.status;
  const expiry = saleExpiry(sale);
  return expiry && expiry.getTime() <= now ? 'cancelled' : 'pending';
}

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
