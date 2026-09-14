// Formatting shared by every page. Mirrors lib/utils/formats.dart in the
// operator app, so a figure reads the same on the phone and in the office.

const moneyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `12,500` — whole rupees, grouped. */
export function money(value: number): string {
  return moneyFormat.format(Math.round(value));
}

/** `රු. 12,500` */
export function rupees(value: number): string {
  return `රු. ${money(value)}`;
}

/** Meter readings carry one decimal only when they need it. */
export function hours(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

/** Signed, so an overdue service reads as `-30`. */
export function signedHours(value: number): string {
  return value < 0 ? `-${hours(Math.abs(value))}` : hours(value);
}

/** A stock or usage quantity with its unit: `40 L`, `12.5 kg`, `8`. */
export function quantity(value: number, unit = ''): string {
  const shown = Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(2).replace(/0$/, '');
  return unit ? `${shown} ${unit}` : shown;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `yyyy-MM-dd` in local time — the id every day record is stored under. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `yyyy-MM` — the id every month record is stored under. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function addMonths(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  return monthKey(new Date(year, index - 1 + delta, 1));
}

/** First and last day of a `yyyy-MM` month, as date keys. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(year, index, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function dateTime(value: Date | null): string {
  if (!value) return '—';
  return `${dateKey(value)} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

const sinhalaMonths = [
  'ජනවාරි',
  'පෙබරවාරි',
  'මාර්තු',
  'අප්‍රේල්',
  'මැයි',
  'ජූනි',
  'ජූලි',
  'අගෝස්තු',
  'සැප්තැම්බර්',
  'ඔක්තෝබර්',
  'නොවැම්බර්',
  'දෙසැම්බර්',
];

/** `2026 සැප්තැම්බර්` */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${year} ${sinhalaMonths[index - 1]}`;
}
