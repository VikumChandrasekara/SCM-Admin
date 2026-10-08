import { collection, doc, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import {
  LANDOWNER_MATERIALS,
  landownerPaymentFrom,
  landownerRateFrom,
  type LandownerPayment,
  type LandownerRate,
  type LandownerShare,
  type MaterialRates,
} from '../lib/landowner';
import { SALE_MATERIAL, nameOf, type Person } from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

/**
 * Every setting of the landowner's per-load figures, newest first. Staff only
 * — see firestore.rules — as the finance page and the supervisor app are.
 */
export function useLandownerRates() {
  return useLiveQuery(
    'landownerRates',
    () => query(collection(db, 'landownerRates'), orderBy('at', 'desc')),
    (snapshot) => landownerRateFrom(snapshot.id, snapshot.data()),
  );
}

/** The months marked as paid, each with who confirmed it and their signature. */
export function useLandownerPayments() {
  return useLiveQuery(
    'landownerPayments',
    () => query(collection(db, 'landownerPayments'), orderBy('month', 'desc')),
    (snapshot) => landownerPaymentFrom(snapshot.id, snapshot.data()),
  );
}

/**
 * What changed, in the audit log's words — plain figures, as the phone writes
 * them (AuditText.landownerRates). The first setting lists all three.
 */
export function ratesSummary(before: MaterialRates | null, after: MaterialRates): string {
  if (before == null) {
    return `${LANDOWNER_MATERIALS.map((material) => `${SALE_MATERIAL[material]} රු.${after[material]}`).join(' · ')} (පළමු වතාව)`;
  }
  const changed = LANDOWNER_MATERIALS.filter((material) => before[material] !== after[material]);
  return changed.length === 0
    ? 'වෙනසක් නැත'
    : changed.map((material) => `${SALE_MATERIAL[material]} රු.${before[material]} → රු.${after[material]}`).join(' · ');
}

/**
 * Sets the per-load figures from now on. The old ones are kept as an entry of
 * their own and nothing is ever rewritten, so a closed month keeps the figures
 * it was worked out at; the audit log gets its line in the same write.
 */
export async function saveLandownerRates(
  rates: MaterialRates,
  previous: MaterialRates | null,
  by: Person,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'landownerRates')), {
    rates,
    previousRates: previous,
    setBy: by.id,
    setByName: nameOf(by),
    at: serverTimestamp(),
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('landowner.rate', 'settings', 'landowner', 'ඉඩම් හිමියා', ratesSummary(previous, rates), by),
  );
  await commit(batch);
}

/**
 * Marks [month]'s amount as paid, keeping what it came to, the name of whoever
 * confirmed it and their signature. A month can be marked once: the entry's id
 * is the month, so a second mark is refused.
 */
export async function markLandownerPaid(
  month: string,
  share: LandownerShare,
  confirmedName: string,
  signature: string,
  by: Person,
): Promise<void> {
  const name = confirmedName.trim();
  const batch = writeBatch(db);
  batch.set(doc(db, 'landownerPayments', month), {
    month,
    amount: share.amount,
    loads: share.loads,
    byMaterial: share.byMaterial,
    confirmedName: name,
    signature,
    markedBy: by.id,
    markedByName: nameOf(by),
    paidAt: serverTimestamp(),
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'landowner.paid',
      'settings',
      month,
      'ඉඩම් හිමියා',
      `${month} · රු.${share.amount} · ලෝඩ් ${share.loads} · තහවුරු කළේ ${name}`,
      by,
    ),
  );
  await commit(batch);
}

/** The admin takes a mark back — a mistake. The audit log keeps what it said. */
export async function unmarkLandownerPaid(payment: LandownerPayment, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'landownerPayments', payment.month));
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'landowner.unpaid',
      'settings',
      payment.month,
      'ඉඩම් හිමියා',
      `${payment.month} · රු.${payment.amount} ගෙවූ බව ඉවත් කළා (තහවුරු කළේ ${payment.confirmedName})`,
      by,
    ),
  );
  await commit(batch);
}

export type { LandownerPayment, LandownerRate };
