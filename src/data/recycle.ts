import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { useEffect } from 'react';

import { db } from '../db';
import { nameOf, padSaleNumber, saleFrom, saleNumber, type Person } from '../lib/model';
import {
  BIN_KINDS,
  BIN_RETENTION_DAYS,
  binEntryFrom,
  binId,
  binKindsFor,
  type BinEntry,
  type BinKind,
} from '../lib/recycle';
import { auditEntry } from './audit';
import { useLiveQuery } from './live';
import { movement } from './movement';

const DAY_MS = 24 * 60 * 60 * 1000;

export function binRef(kind: BinKind, docId: string) {
  return doc(db, 'recycleBin', binId(kind, docId));
}

/**
 * The bin entry to write in the same transaction that deletes a document.
 * [original] is the document exactly as the server holds it — the rules
 * refuse a copy that differs by a field, which is also what makes a restore
 * safe.
 */
export function binEntryData(
  kind: BinKind,
  docId: string,
  original: DocumentData,
  label: string,
  summary: string,
  by: Person,
) {
  return {
    kind,
    docId,
    data: original,
    label,
    summary,
    deletedBy: by.id,
    deletedByName: nameOf(by),
    deletedAt: serverTimestamp(),
    purgeAt: Timestamp.fromMillis(Date.now() + BIN_RETENTION_DAYS * DAY_MS),
  };
}

/**
 * What [role] sees in the bin — see firestore.rules. The rules decide by the
 * query, so a supervisor asks for just their kinds; and with a filter on
 * `kind` the order is left to the page, which needs no extra index for it.
 */
export function useRecycleBin(role: Person['role']) {
  const kinds = binKindsFor(role);
  return useLiveQuery(
    `recycleBin:${kinds.join(',')}`,
    () => {
      const bin = collection(db, 'recycleBin');
      return kinds.length === BIN_KINDS.length ? query(bin) : query(bin, where('kind', 'in', [...kinds]));
    },
    (snapshot) => binEntryFrom(snapshot.id, snapshot.data()),
  );
}

/** Deletes the entries that have been in the bin their 30 days; returns how many. */
export async function purgeExpiredBin(now = Timestamp.now()): Promise<number> {
  const expired = await getDocs(
    query(collection(db, 'recycleBin'), where('purgeAt', '<=', now), limit(200)),
  );
  if (expired.empty) return 0;
  const batch = writeBatch(db);
  for (const entry of expired.docs) batch.delete(entry.ref);
  await batch.commit();
  return expired.size;
}

/**
 * Purges what has been in the bin its 30 days. Spark has no scheduled
 * functions, so the panel does it when an admin opens it — until then an
 * expired entry is already hidden from the bin and cannot be restored.
 */
export function useBinSweeper(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    // The next time the panel opens tries again.
    purgeExpiredBin().catch(() => {});
  }, [enabled]);
}

const GONE = 'මෙය දැනටමත් ආපසු ගෙන හෝ ස්ථිරවම මකා ඇත.';
const OCCUPIED = 'මෙම හැඳුනුම අංකයෙන් වෙනත් වාර්තාවක් දැනටමත් ඇත — ආපසු ගත නොහැක.';

/** Puts [entry] back where it was deleted from. Admin only. */
export async function restoreEntry(entry: BinEntry, by: Person): Promise<void> {
  switch (entry.kind) {
    case 'bill':
      return restoreBill(entry, by);
    case 'sale':
      return restoreSale(entry, by);
    case 'store':
      return restoreItem(entry, by);
    case 'operator':
      return restoreAccount(entry, by);
  }
}

/**
 * Every restore is a transaction that reads the bin entry on the server
 * first: an attempt that follows one which went through finds the entry gone
 * and says so, rather than restoring twice.
 */
async function restoreBill(entry: BinEntry, by: Person): Promise<void> {
  const ref = doc(db, 'bills', entry.docId);
  const bin = binRef('bill', entry.docId);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(bin);
    if (!stored.exists()) throw new Error(GONE);
    if ((await tx.get(ref)).exists()) throw new Error(OCCUPIED);

    const data = stored.data().data as DocumentData;
    // An advance was taken off the crew member's figure when the bill went;
    // it goes back on — if their account is still there to take it.
    const operator =
      data.category === 'advance' && typeof data.operatorId === 'string'
        ? await tx.get(doc(db, 'operators', data.operatorId))
        : null;

    tx.set(ref, data);
    if (operator?.exists()) tx.update(operator.ref, { advanceAmount: increment(Number(data.amount) || 0) });
    tx.delete(bin);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('bill.restore', 'bill', ref.id, entry.label, entry.summary, by),
    );
  });
}

/**
 * A sale takes its invoice number back. Its pointer is written again, and
 * the month's count with it when it is the newest — the count only ever
 * moves up by one, so a bill whose number is past the next free one waits
 * for the ones before it. A number someone else has been given since is
 * not taken back.
 */
async function restoreSale(entry: BinEntry, by: Person): Promise<void> {
  const ref = doc(db, 'sales', entry.docId);
  const bin = binRef('sale', entry.docId);
  const sale = saleFrom(entry.docId, entry.data);
  const month = sale.date.slice(0, 7);
  const number = sale.number;
  const indexRef = number == null ? null : doc(db, 'saleIndex', `${month}-${number}`);
  const counterRef = doc(db, 'saleCounters', month);

  await runTransaction(db, async (tx) => {
    const stored = await tx.get(bin);
    if (!stored.exists()) throw new Error(GONE);
    if ((await tx.get(ref)).exists()) throw new Error(OCCUPIED);
    const index = indexRef ? await tx.get(indexRef) : null;
    const counter = number == null ? null : await tx.get(counterRef);

    if (number != null && indexRef) {
      if (index?.exists()) throw new Error(`බිල් අංක ${padSaleNumber(number)} දැන් වෙනත් බිල්පතකට දී ඇත — ආපසු ගත නොහැක.`);
      const last: unknown = counter?.data()?.last;
      const counted = typeof last === 'number' ? last : 0;
      if (number > counted + 1) {
        throw new Error(`මුලින් බිල්පත ${padSaleNumber(counted + 1)} ආපසු ගන්න.`);
      }
      tx.set(indexRef, { code: entry.docId });
      if (number === counted + 1) tx.set(counterRef, { last: number, lastCode: entry.docId });
    }

    tx.set(ref, stored.data().data as DocumentData);
    tx.delete(bin);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('sales.restore', 'sale', entry.docId, `බිල්පත ${saleNumber(sale)}`, entry.summary, by),
    );
  });
}

async function restoreItem(entry: BinEntry, by: Person): Promise<void> {
  const ref = doc(db, 'store', entry.docId);
  const bin = binRef('store', entry.docId);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(bin);
    if (!stored.exists()) throw new Error(GONE);
    if ((await tx.get(ref)).exists()) throw new Error(OCCUPIED);

    const data = stored.data().data as DocumentData;
    const item = {
      id: ref.id,
      name: typeof data.name === 'string' ? data.name : entry.label,
      unit: typeof data.unit === 'string' ? data.unit : '',
      unitPrice: typeof data.unitPrice === 'number' ? data.unitPrice : 0,
    };
    const quantity = typeof data.quantity === 'number' ? data.quantity : 0;

    tx.set(ref, data);
    // The count the item comes back with is a count again, in the log.
    tx.set(doc(collection(db, 'storeMovements')), movement('create', item, quantity, 'ආපසු ගත්තා', by));
    tx.delete(bin);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('store.restore', 'store', ref.id, entry.label, entry.summary, by),
    );
  });
}

/** The record comes back, and with it the access — the login itself was never touched. */
async function restoreAccount(entry: BinEntry, by: Person): Promise<void> {
  const ref = doc(db, 'operators', entry.docId);
  const bin = binRef('operator', entry.docId);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(bin);
    if (!stored.exists()) throw new Error(GONE);
    if ((await tx.get(ref)).exists()) throw new Error(OCCUPIED);

    tx.set(ref, stored.data().data as DocumentData);
    tx.delete(bin);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('account.restore', 'operator', ref.id, entry.label, entry.summary, by),
    );
  });
}
