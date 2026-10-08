import { collection, doc, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import { landownerRateFrom, type LandownerRate } from '../lib/landowner';
import { nameOf, type Person } from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

/**
 * Every setting of the landowner's per-load figure, newest first. Staff only
 * — see firestore.rules — as the finance page and the supervisor app are.
 */
export function useLandownerRates() {
  return useLiveQuery(
    'landownerRates',
    () => query(collection(db, 'landownerRates'), orderBy('at', 'desc')),
    (snapshot) => landownerRateFrom(snapshot.id, snapshot.data()),
  );
}

/**
 * Sets the per-load figure from now on. The old one is kept as an entry of
 * its own and nothing is ever rewritten, so a closed month keeps the figure it
 * was worked out at; the audit log gets its line in the same write.
 */
export async function saveLandownerRate(rate: number, previous: number | null, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'landownerRates')), {
    rate,
    previousRate: previous,
    setBy: by.id,
    setByName: nameOf(by),
    at: serverTimestamp(),
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'landowner.rate',
      'settings',
      'landowner',
      'ඉඩම් හිමියා',
      // Plain figures, as the phone writes them (AuditText.landownerRate).
      previous == null ? `ලෝඩ් එකකට රු.${rate} (පළමු වතාව)` : `ලෝඩ් එකකට රු.${previous} → රු.${rate}`,
      by,
    ),
  );
  await commit(batch);
}

export type { LandownerRate };
