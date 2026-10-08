import { saleLoads } from './landowner';
import { saleStatus, type Sale, type SaleMaterial } from './model';

/**
 * The loads that have gone, as the sales page analyses them. A load has gone
 * when its bill is verified — the QR scanned as it left. Bills still waiting
 * for that, and prepaid ones whose load has not come, are counted apart so the
 * figures add up to every bill of the month without claiming a load that has
 * not left.
 */

/** In the order the sales page lists them. */
export const LOAD_MATERIALS: readonly SaleMaterial[] = ['six_nine', 'sakka', 'kory_dust', 'boldas'];

/** A bill from before materials were recorded has none. */
export type LoadKind = SaleMaterial | 'unknown';

export interface LoadRow {
  kind: LoadKind;
  /** Bills of this kind that have gone. */
  bills: number;
  /** Tipper bills — each one trip — and the cubes they carried. */
  tipperLoads: number;
  cubes: number;
  /** Tractor loads. */
  tractorLoads: number;
  /** Tipper and tractor loads together. */
  loads: number;
  /** What those bills came to. */
  amount: number;
}

export interface WaitingLoads {
  bills: number;
  loads: number;
}

export interface LoadAnalysis {
  /** Every material, then bills with none when there are any. */
  rows: LoadRow[];
  total: LoadRow;
  /** Written but not yet verified — may still go, or lapse. */
  pending: WaitingLoads;
  /** Paid in advance, the load still to come. */
  prepaidOpen: WaitingLoads;
}

const empty = (kind: LoadKind): LoadRow => ({
  kind,
  bills: 0,
  tipperLoads: 0,
  cubes: 0,
  tractorLoads: 0,
  loads: 0,
  amount: 0,
});

function add(row: LoadRow, sale: Sale): void {
  row.bills += 1;
  row.amount += sale.amount;
  row.loads += saleLoads(sale);
  if (sale.type === 'tipper') {
    row.tipperLoads += 1;
    row.cubes += sale.quantity;
  } else {
    row.tractorLoads += sale.quantity;
  }
}

/** The month's loads that have gone, by material and by vehicle. */
export function loadAnalysis(sales: readonly Sale[], now = Date.now()): LoadAnalysis {
  const rows = new Map<LoadKind, LoadRow>(LOAD_MATERIALS.map((material) => [material, empty(material)]));
  rows.set('unknown', empty('unknown'));
  const total = empty('unknown');
  const pending: WaitingLoads = { bills: 0, loads: 0 };
  const prepaidOpen: WaitingLoads = { bills: 0, loads: 0 };

  for (const sale of sales) {
    const status = saleStatus(sale, now);
    if (status === 'verified') {
      add(rows.get(sale.material ?? 'unknown')!, sale);
      add(total, sale);
    } else if (status === 'pending') {
      const waiting = sale.prepaid ? prepaidOpen : pending;
      waiting.bills += 1;
      waiting.loads += saleLoads(sale);
    }
  }

  const unknown = rows.get('unknown')!;
  return {
    rows: [...LOAD_MATERIALS.map((material) => rows.get(material)!), ...(unknown.bills > 0 ? [unknown] : [])],
    total,
    pending,
    prepaidOpen,
  };
}
