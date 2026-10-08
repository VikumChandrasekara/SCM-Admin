import type { DocumentData } from 'firebase/firestore';

import { isSaleIncome, toDate } from './model';
import type { Sale, SaleMaterial } from './model';

/**
 * The landowner (ඉඩම් හිමියා) is paid a set amount for every load of certain
 * materials that is sold, a figure for each material. The figures are whatever
 * staff last set and each change is kept — see {@link LandownerRate} — so a
 * month already reported never moves when one changes. What he is owed is
 * worked out for the month and paid once; see {@link LandownerPayment}.
 */

/** The materials that earn the landowner a share. බෝල්දාස් does not. */
export const LANDOWNER_MATERIALS = ['six_nine', 'sakka', 'kory_dust'] as const satisfies readonly SaleMaterial[];

export type LandownerMaterial = (typeof LANDOWNER_MATERIALS)[number];

/** Rupees per load, for each material that earns a share. */
export type MaterialRates = Record<LandownerMaterial, number>;

export const noRates = (): MaterialRates => ({ six_nine: 0, sakka: 0, kory_dust: 0 });

export function paysLandowner(
  sale: Pick<Sale, 'material'>,
): sale is Pick<Sale, 'material'> & { material: LandownerMaterial } {
  return sale.material != null && (LANDOWNER_MATERIALS as readonly string[]).includes(sale.material);
}

/** Loads a sale counts for: a tipper bill is one trip whatever it carried; a tractor bill is its load count. */
export function saleLoads(sale: Pick<Sale, 'type' | 'quantity'>): number {
  return sale.type === 'tipper' ? 1 : sale.quantity;
}

/** One setting of the per-load figures, as it was recorded. */
export interface LandownerRate {
  id: string;
  rates: MaterialRates;
  /** What they were before, or null for the very first. */
  previousRates: MaterialRates | null;
  setBy: string;
  setByName: string;
  /** Null for the moment between saving and the server stamping it. */
  at: Date | null;
}

function ratesFrom(value: unknown, fallback: number | null): MaterialRates | null {
  const number = (entry: unknown) => (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 ? entry : null);
  if (value && typeof value === 'object') {
    const map = value as Record<string, unknown>;
    const rates = noRates();
    for (const material of LANDOWNER_MATERIALS) rates[material] = number(map[material]) ?? 0;
    return rates;
  }
  // An entry from when there was one figure for every material.
  return fallback == null ? null : { six_nine: fallback, sakka: fallback, kory_dust: fallback };
}

export function landownerRateFrom(id: string, data: DocumentData): LandownerRate {
  const single = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    id,
    rates: ratesFrom(data.rates, single(data.rate)) ?? noRates(),
    previousRates: ratesFrom(data.previousRates, single(data.previousRate)),
    setBy: typeof data.setBy === 'string' ? data.setBy : '',
    setByName: typeof data.setByName === 'string' ? data.setByName : '',
    at: toDate(data.at),
  };
}

/** A just-saved entry, not yet stamped by the server, counts as now. */
const timeOf = (entry: LandownerRate, now: number) => entry.at?.getTime() ?? now;

/** Newest first, as the history is listed. */
export function newestFirst(history: readonly LandownerRate[], now = Date.now()): LandownerRate[] {
  return [...history].sort((a, b) => timeOf(b, now) - timeOf(a, now));
}

/** What is set now — nothing, until staff first set it. */
export function currentRates(history: readonly LandownerRate[]): MaterialRates {
  return newestFirst(history)[0]?.rates ?? noRates();
}

/**
 * The figure for [material] in force at [moment]: the latest one set on or
 * before it. A moment before the first was ever set takes the first, so the
 * days before it was entered are not left unpaid.
 */
export function rateAt(history: readonly LandownerRate[], moment: Date, material: LandownerMaterial): number {
  if (history.length === 0) return 0;
  const now = Date.now();
  const ordered = newestFirst(history, now).reverse();
  const time = moment.getTime();
  let found = ordered[0];
  for (const entry of ordered) {
    if (timeOf(entry, now) <= time) found = entry;
    else break;
  }
  return found.rates[material];
}

/** What a sale sends to the landowner, at the figure in force when its bill was written. */
export function landownerChargeOf(sale: Sale, history: readonly LandownerRate[]): number {
  if (!paysLandowner(sale)) return 0;
  const written = sale.createdAt ?? new Date(`${sale.date}T00:00:00`);
  return saleLoads(sale) * rateAt(history, written, sale.material);
}

export interface MaterialShare {
  loads: number;
  amount: number;
}

export type MaterialShares = Record<LandownerMaterial, MaterialShare>;

export function noShares(): MaterialShares {
  return {
    six_nine: { loads: 0, amount: 0 },
    sakka: { loads: 0, amount: 0 },
    kory_dust: { loads: 0, amount: 0 },
  };
}

/** What a month's sales come to for the landowner, in all and by material. */
export interface LandownerShare {
  loads: number;
  amount: number;
  byMaterial: MaterialShares;
}

/** Worked out automatically from the month's verified sales — nothing is typed in. */
export function landownerShare(
  sales: readonly Sale[],
  history: readonly LandownerRate[],
  now = Date.now(),
): LandownerShare {
  const byMaterial = noShares();
  for (const sale of sales) {
    if (!isSaleIncome(sale, now) || !paysLandowner(sale)) continue;
    byMaterial[sale.material].loads += saleLoads(sale);
    byMaterial[sale.material].amount += landownerChargeOf(sale, history);
  }
  return {
    loads: LANDOWNER_MATERIALS.reduce((total, material) => total + byMaterial[material].loads, 0),
    amount: LANDOWNER_MATERIALS.reduce((total, material) => total + byMaterial[material].amount, 0),
    byMaterial,
  };
}

/**
 * A month's amount marked as paid: what it came to then, who confirmed it —
 * by name and by a signature drawn on the spot — and when. One per month, and
 * what is written is never changed.
 */
export interface LandownerPayment {
  /** `yyyy-MM`, which is also the document's id. */
  month: string;
  amount: number;
  loads: number;
  byMaterial: MaterialShares;
  /** The name of the person who confirmed the payment. */
  confirmedName: string;
  /** The signature, as an SVG path — see signature.ts. */
  signature: string;
  /** The signed-in staff member who marked it. */
  markedBy: string;
  markedByName: string;
  paidAt: Date | null;
}

export function landownerPaymentFrom(id: string, data: DocumentData): LandownerPayment {
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const byMaterial = noShares();
  const stored = (data.byMaterial ?? {}) as Record<string, { loads?: unknown; amount?: unknown } | undefined>;
  for (const material of LANDOWNER_MATERIALS) {
    byMaterial[material] = { loads: number(stored[material]?.loads), amount: number(stored[material]?.amount) };
  }
  return {
    month: id,
    amount: number(data.amount),
    loads: number(data.loads),
    byMaterial,
    confirmedName: text(data.confirmedName),
    signature: text(data.signature),
    markedBy: text(data.markedBy),
    markedByName: text(data.markedByName),
    paidAt: toDate(data.paidAt),
  };
}
