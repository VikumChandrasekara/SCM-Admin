import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../db';
import { linkDocId, movementFrom, type Person, type StockLink, type StoreItem } from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';
import { movement } from './movement';
import { binEntryData, binRef } from './recycle';

/** The most recent changes to any count, newest first. */
export function useMovements(count = 80) {
  return useLiveQuery(
    `movements:${count}`,
    () => query(collection(db, 'storeMovements'), orderBy('createdAt', 'desc'), limit(count)),
    (snapshot) => movementFrom(snapshot.id, snapshot.data()),
  );
}

export interface ItemInput {
  name: string;
  unit: string;
  minQuantity: number;
  unitPrice: number;
  note: string;
}

/** Admin only. A linked item takes the fixed id its link dictates. */
export async function createItem(
  input: ItemInput & { quantity: number; link: StockLink | null },
  by: Person,
): Promise<void> {
  const ref = input.link ? doc(db, 'store', linkDocId(input.link)) : doc(collection(db, 'store'));
  if (input.link && (await getDoc(ref)).exists()) {
    throw new Error('මෙම භාවිතයට දැනටමත් ගබඩා අයිතමයක් සම්බන්ධ කර ඇත.');
  }

  const name = input.name.trim();
  const unit = input.unit.trim();
  const batch = writeBatch(db);
  batch.set(ref, {
    name,
    unit,
    quantity: input.quantity,
    minQuantity: input.minQuantity,
    unitPrice: input.unitPrice,
    link: input.link,
    note: input.note.trim(),
    createdAt: serverTimestamp(),
    // The opening count is a count: usage recorded before now is already in it.
    countedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: by.id,
  });
  batch.set(
    doc(collection(db, 'storeMovements')),
    movement('create', { id: ref.id, name, unit, unitPrice: input.unitPrice }, input.quantity, '', by),
  );
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('store.create', 'store', ref.id, name, `ආරම්භක ප්‍රමාණය ${input.quantity} ${unit}`, by),
  );
  await commit(batch);
}

/** What changed between the stored item and the fields about to be saved. */
function itemDiff(before: StoreItem, input: ItemInput): string {
  const lines: string[] = [];
  const name = input.name.trim();
  if (name && name !== before.name) lines.push(`නම: ${before.name} → ${name}`);
  const unit = input.unit.trim();
  if (unit !== before.unit) lines.push(`ඒකකය: ${before.unit || '—'} → ${unit || '—'}`);
  if (input.minQuantity !== before.minQuantity) lines.push(`අවම ප්‍රමාණය: ${before.minQuantity} → ${input.minQuantity}`);
  if (input.unitPrice !== before.unitPrice) lines.push(`ඒකක මිල: රු.${before.unitPrice} → රු.${input.unitPrice}`);
  return lines.length > 0 ? lines.join(' · ') : 'වෙනසක් නැත';
}

/** Admin only: everything but the count and the link. */
export async function updateItem(item: StoreItem, input: ItemInput, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'store', item.id), {
    name: input.name.trim(),
    unit: input.unit.trim(),
    minQuantity: input.minQuantity,
    unitPrice: input.unitPrice,
    note: input.note.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: by.id,
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('store.update', 'store', item.id, item.name, itemDiff(item, input), by),
  );
  await commit(batch);
}

export type StockChange = 'restock' | 'use' | 'adjust';

/**
 * Supervisors and admins. Restock and use move the count by an amount; a
 * recount sets it outright and stamps when the shelf was counted.
 */
export async function changeStock(
  item: StoreItem,
  change: StockChange,
  amount: number,
  note: string,
  by: Person,
): Promise<void> {
  const ref = doc(db, 'store', item.id);
  const batch = writeBatch(db);
  let delta: number;

  if (change === 'adjust') {
    delta = amount - item.quantity;
    batch.update(ref, {
      quantity: amount,
      countedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: by.id,
    });
  } else {
    delta = change === 'restock' ? amount : -amount;
    // An increment, so two people changing the same count at once both land.
    batch.update(ref, { quantity: increment(delta), updatedAt: serverTimestamp(), updatedBy: by.id });
  }

  batch.set(doc(collection(db, 'storeMovements')), movement(change, item, delta, note, by));
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('store.stock', 'store', item.id, item.name, stockSummary(change, item, amount, delta, note), by),
  );
  await commit(batch);
}

/** The audit line for a change to a count: what it was, and what it became. */
function stockSummary(change: StockChange, item: StoreItem, amount: number, delta: number, note: string): string {
  const what =
    change === 'restock'
      ? `තොගය එකතු කළා +${amount} ${item.unit}`
      : change === 'use'
        ? `භාවිත කළා −${amount} ${item.unit}`
        : `නැවත ගණන් කළා ${item.quantity} → ${amount} ${item.unit}`;
  const after = change === 'adjust' ? amount : item.quantity + delta;
  return `${what} · දැන් ${after} ${item.unit}${note.trim() ? ` · ${note.trim()}` : ''}`;
}

/**
 * Moves the item to the recycle bin for 30 days. A transaction, reading the
 * item as the server holds it: the bin's copy has to match it field for
 * field, and a repeat after a dropped line finds it already gone.
 */
export async function deleteItem(item: StoreItem, by: Person): Promise<void> {
  const ref = doc(db, 'store', item.id);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(ref);
    if (!stored.exists()) return;

    const summary = `ඉතිරිව තිබූ ප්‍රමාණය ${item.quantity} ${item.unit}`;
    tx.set(binRef('store', item.id), binEntryData('store', item.id, stored.data(), item.name, summary, by));
    tx.delete(ref);
    tx.set(doc(collection(db, 'storeMovements')), movement('delete', item, -item.quantity, '', by));
    tx.set(doc(collection(db, 'auditLog')), auditEntry('store.delete', 'store', item.id, item.name, summary, by));
  });
}
