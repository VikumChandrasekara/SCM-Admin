import { hours } from './format';
import {
  FUEL_LABEL,
  RATE_BASIS_LABEL,
  ROLES,
  dayOffHours,
  dayOnHours,
  machineTypeDef,
  machineTypeForRole,
  machineTypeLabel,
  meterReading,
  workedHours,
  type Day,
  type Machine,
  type MachineDetails,
  type MachineKind,
  type MachineType,
  type MachineTypes,
  type MonthTally,
  type Person,
  type RateBasis,
  type RoleId,
} from './model';

/**
 * The machine registry: who is on which machine, which machine a crew member
 * may be put on, and the hours each has worked. Mirrors what the operator app
 * works out for the supervisor's යන්ත්‍ර screen — keep the two in step.
 */

/** The ids firestore.rules accepts for a machine. */
export const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** The longest each detail may be — firestore.rules refuses more. */
export const DETAIL_LIMITS = { name: 100, model: 100, registrationNo: 40, notes: 1000 } as const;

/** Crew members whose machine is [machineId], in the order [people] is in. */
export function crewOn(machineId: string, people: readonly Person[]): Person[] {
  return people.filter((person) => ROLES[person.role].isCrew && person.machineId === machineId);
}

/**
 * What kind of machine [machine] is. A machine set up before its details were
 * kept has no type of its own, so it is read as the kind of the crew on it;
 * null while it has neither.
 */
export function machineTypeOf(machine: Pick<Machine, 'id' | 'type'>, people: readonly Person[]): MachineType | null {
  if (machine.type) return machine.type;
  for (const person of crewOn(machine.id, people)) {
    const type = machineTypeForRole(person.role);
    if (type) return type;
  }
  return null;
}

/**
 * How [machine] behaves — the kind of its type, which says which crew works
 * it. Null while it has no type yet.
 */
export function machineKindOf(
  machine: Pick<Machine, 'id' | 'type'>,
  people: readonly Person[],
  types: MachineTypes,
): MachineKind | null {
  const type = machineTypeOf(machine, people);
  return type ? machineTypeDef(types, type).kind : null;
}

/**
 * Whether a [role] crew member can work [machine]: an excavator operator a
 * machine that behaves like an excavator, a compressor driller one that
 * behaves like a compressor. A machine with no type yet suits either; staff
 * work none, and neither does a crew work a machine of a type with no crew.
 */
export function machineFitsRole(
  machine: Pick<Machine, 'id' | 'type'>,
  role: RoleId,
  people: readonly Person[],
  types: MachineTypes,
): boolean {
  const wanted = machineTypeForRole(role);
  if (!wanted) return false;
  const kind = machineKindOf(machine, people, types);
  return kind == null || kind === wanted;
}

/**
 * The machines [role] can be put on, by number. Retired machines are left out
 * — except [keepId], the one the person is on now, so a form editing them
 * still shows where they are.
 */
export function assignableMachines(
  role: RoleId,
  machines: Iterable<Machine>,
  people: readonly Person[],
  types: MachineTypes,
  keepId = '',
): Machine[] {
  return [...machines]
    .filter((machine) => machine.id === keepId || (machine.active && machineFitsRole(machine, role, people, types)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The longest a machine type's name may be — firestore.rules refuses more. */
export const TYPE_NAME_LIMIT = 40;

/** Why a machine type with these names cannot be saved, or null when it can. */
export function typeNameError(label: string, english: string): string | null {
  if (label.trim() === '') return 'වර්ගයේ නම ඇතුළත් කරන්න.';
  if (label.trim().length > TYPE_NAME_LIMIT || english.trim().length > TYPE_NAME_LIMIT) {
    return `නම අකුරු ${TYPE_NAME_LIMIT}ට වඩා දිග නොවිය යුතුය.`;
  }
  return null;
}

/** Why [details] cannot be saved, or null when they can. */
export function detailsError(
  details: Pick<MachineDetails, 'name' | 'model' | 'registrationNo' | 'notes' | 'rate'>,
): string | null {
  if (details.rate != null && !(Number.isFinite(details.rate) && details.rate >= 0)) {
    return 'යන්ත්‍රයේ ගාස්තුව ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.';
  }
  if (details.name.trim().length > DETAIL_LIMITS.name) return `නම අකුරු ${DETAIL_LIMITS.name}ට වඩා දිග නොවිය යුතුය.`;
  if (details.model.trim().length > DETAIL_LIMITS.model) {
    return `මාදිලිය අකුරු ${DETAIL_LIMITS.model}ට වඩා දිග නොවිය යුතුය.`;
  }
  if (details.registrationNo.trim().length > DETAIL_LIMITS.registrationNo) {
    return `ලියාපදිංචි අංකය අකුරු ${DETAIL_LIMITS.registrationNo}ට වඩා දිග නොවිය යුතුය.`;
  }
  if (details.notes.trim().length > DETAIL_LIMITS.notes) {
    return `සටහන් අකුරු ${DETAIL_LIMITS.notes}ට වඩා දිග නොවිය යුතුය.`;
  }
  return null;
}

/** [details] as they are stored: trimmed. */
export function cleanDetails(details: MachineDetails): MachineDetails {
  return {
    type: details.type,
    // Only when it is set: firestore refuses an undefined field.
    ...(details.meterUnit ? { meterUnit: details.meterUnit } : {}),
    ...(details.fuel ? { fuel: details.fuel } : {}),
    ...(details.rate != null ? { rate: details.rate } : {}),
    ...(details.rateBasis ? { rateBasis: details.rateBasis } : {}),
    name: details.name.trim(),
    model: details.model.trim(),
    registrationNo: details.registrationNo.trim(),
    notes: details.notes.trim(),
    active: details.active,
  };
}

const dash = (value: string) => value || '—';

/** Why a meter reading cannot be saved, or null when it can. */
export function meterError(reading: number): string | null {
  return Number.isFinite(reading) && reading >= 0 ? null : 'මීටර් අගය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.';
}

/**
 * What changed between the stored machine and the details about to be saved —
 * the audit line. [meterHours], when the meter is being put right too, adds its
 * line.
 */
export function machineDiff(
  before: Machine,
  after: MachineDetails,
  types: MachineTypes,
  meterHours?: number,
): string {
  const next = cleanDetails(after);
  const lines: string[] = [];
  if (next.type !== before.type) {
    lines.push(`වර්ගය: ${machineTypeLabel(types, before.type)} → ${machineTypeLabel(types, next.type)}`);
  }
  if (next.fuel && next.fuel !== before.fuel) {
    lines.push(`ඉන්ධන: ${before.fuel ? FUEL_LABEL[before.fuel] : '—'} → ${FUEL_LABEL[next.fuel]}`);
  }
  const basis = next.rateBasis ?? before.rateBasis;
  if ((next.rate != null && next.rate !== before.rate) || basis !== before.rateBasis) {
    const shown = (rate: number | null, per: RateBasis) => (rate == null ? '—' : `රු.${rate} ${RATE_BASIS_LABEL[per].per}`);
    lines.push(`ගාස්තුව: ${shown(before.rate, before.rateBasis)} → ${shown(next.rate ?? before.rate, basis)}`);
  }
  const unit = next.meterUnit ?? before.meterUnit;
  if (unit !== before.meterUnit && meterHours == null) lines.push(`මීටර ඒකකය: ${before.meterUnit} → ${unit}`);
  if (meterHours != null && (meterHours !== before.totalHours || unit !== before.meterUnit)) {
    lines.push(`මීටරය: ${meterReading(before.totalHours, before.meterUnit)} → ${meterReading(meterHours, unit)}`);
  }
  if (next.name !== before.name) lines.push(`නම: ${dash(before.name)} → ${dash(next.name)}`);
  if (next.model !== before.model) lines.push(`මාදිලිය: ${dash(before.model)} → ${dash(next.model)}`);
  if (next.registrationNo !== before.registrationNo) {
    lines.push(`ලියාපදිංචි අංකය: ${dash(before.registrationNo)} → ${dash(next.registrationNo)}`);
  }
  if (next.notes !== before.notes) lines.push(`සටහන්: ${dash(before.notes)} → ${dash(next.notes)}`);
  if (next.active !== before.active) {
    lines.push(next.active ? 'නැවත ක්‍රියාත්මක කළා' : 'විශ්‍රාම ගැන්වූවා (ක්‍රියාත්මක නොවේ)');
  }
  return lines.length > 0 ? lines.join(' · ') : 'වෙනසක් නැත';
}

/** The audit line for a machine that has just been set up. */
export function newMachineSummary(details: MachineDetails, meterHours: number, types: MachineTypes): string {
  const next = cleanDetails(details);
  // Hours read as before — `මීටරය පැය 12` — and kilometres say so.
  const meter = next.meterUnit === 'km' ? `මීටරය km ${hours(meterHours)}` : `මීටරය පැය ${hours(meterHours)}`;
  return [
    machineTypeLabel(types, next.type),
    next.fuel ? FUEL_LABEL[next.fuel] : '',
    next.rate != null ? `රු.${next.rate} ${RATE_BASIS_LABEL[next.rateBasis ?? 'hour'].per}` : '',
    next.name,
    next.model,
    next.registrationNo,
    meter,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The audit line for a crew member moved from one machine to another. */
export function assignSummary(from: string, to: string): string {
  return `යන්ත්‍රය: ${from || '—'} → ${to}`;
}

// ---- the hours a machine has worked -------------------------------------------

/** Months with something recorded in them, newest first. */
export function monthsNewestFirst(months: readonly MonthTally[]): MonthTally[] {
  return months
    .filter((month) => month.hours > 0 || month.loads > 0 || month.feet > 0)
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Hours the months add up to — what was worked on closed days, month by month. */
export function recordedHours(months: readonly MonthTally[]): number {
  return months.reduce((total, month) => total + month.hours, 0);
}

export interface WorkedDay {
  date: string;
  /** The hour meter at the start of the day and at the end of it. */
  on: number;
  off: number;
  hours: number;
}

/**
 * The days that have both readings, newest first, each with the hours it
 * worked. A day still open — no OFF yet — has none to count, which is also
 * why the month's hours run a day behind.
 */
export function workedDayRows(days: readonly Day[]): WorkedDay[] {
  const rows: WorkedDay[] = [];
  for (const day of days) {
    const on = dayOnHours(day);
    const off = dayOffHours(day);
    const worked = workedHours(day);
    if (on == null || off == null || worked == null) continue;
    rows.push({ date: day.date, on, off, hours: worked });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
