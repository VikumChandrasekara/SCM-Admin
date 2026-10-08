import type { DocumentData } from 'firebase/firestore';

import { toDate } from './model';
import type { Sale, SaleMaterial } from './model';

/**
 * ඉඩම් හිමියා (the landowner) is paid a set amount for every load of certain
 * materials that is sold. The amount is whatever staff last set, and each
 * change is kept — see {@link LandownerRate} — so a month already reported
 * never moves when it changes.
 */

/** The materials that earn the landowner a share. බෝල්දාස් does not. */
export const LANDOWNER_MATERIALS: readonly SaleMaterial[] = ['six_nine', 'sakka', 'kory_dust'];

/** A bill from before materials were recorded has none, and earns the landowner nothing. */
export function paysLandowner(sale: Pick<Sale, 'material'>): boolean {
  return sale.material != null && LANDOWNER_MATERIALS.includes(sale.material);
}

/** Loads a sale counts for: a tipper bill is one trip whatever it carried; a tractor bill is its load count. */
export function saleLoads(sale: Pick<Sale, 'type' | 'quantity'>): number {
  return sale.type === 'tipper' ? 1 : sale.quantity;
}

/** One setting of the per-load figure, as it was recorded. */
export interface LandownerRate {
  id: string;
  /** Rupees per load from this moment on. */
  rate: number;
  /** What it was before, or null for the very first. */
  previousRate: number | null;
  setBy: string;
  setByName: string;
  /** Null for the moment between saving and the server stamping it. */
  at: Date | null;
}

export function landownerRateFrom(id: string, data: DocumentData): LandownerRate {
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    id,
    rate: number(data.rate) ?? 0,
    previousRate: number(data.previousRate),
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
export function currentRate(history: readonly LandownerRate[]): number {
  return newestFirst(history)[0]?.rate ?? 0;
}

/**
 * The figure in force at [moment]: the latest one set on or before it. A
 * moment before the first was ever set takes the first, so the days before it
 * was entered are not left unpaid.
 */
export function rateAt(history: readonly LandownerRate[], moment: Date): number {
  if (history.length === 0) return 0;
  const now = Date.now();
  const ordered = newestFirst(history, now).reverse();
  const time = moment.getTime();
  let found = ordered[0];
  for (const entry of ordered) {
    if (timeOf(entry, now) <= time) found = entry;
    else break;
  }
  return found.rate;
}

/** What a sale sends to the landowner, at the figure in force when its bill was written. */
export function landownerChargeOf(sale: Sale, history: readonly LandownerRate[]): number {
  if (!paysLandowner(sale)) return 0;
  const written = sale.createdAt ?? new Date(`${sale.date}T00:00:00`);
  return saleLoads(sale) * rateAt(history, written);
}
