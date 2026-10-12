import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import type { Person } from '../lib/model';
import { royaltyRatesFrom, type RoyaltyRates } from '../lib/royalty';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveDoc } from './live';

const ratesRef = () => doc(db, 'settings', 'royalty');

/**
 * What the රාජ භාගය is worked out at — the cubes a kilo brings down, what a
 * cube is worth, and the share paid. The defaults until staff set them.
 */
export function useRoyaltyRates() {
  return useLiveDoc(ratesRef(), (snapshot) => royaltyRatesFrom(snapshot.data()));
}

/** Admin only. Applies to every month's report: the royalty is worked out afresh from the sheets each time. */
export async function saveRoyaltyRates(rates: RoyaltyRates, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.set(ratesRef(), { ...rates, updatedAt: serverTimestamp(), updatedBy: by.id });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'royalty.rates',
      'settings',
      'royalty',
      'රාජ භාගය',
      `kg එකකට කියුබ් ${rates.cubesPerKg} · කියුබ් එකක් රු.${rates.cubeValue} · රාජ භාගය ${rates.percent}%`,
      by,
    ),
  );
  await commit(batch);
}
