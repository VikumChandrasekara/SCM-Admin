import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../db';
import {
  linkDocId,
  movementFrom,
  nameOf,
  type MovementType,
  type Person,
  type StockLink,
  type StoreItem,
} from '../lib/model';
import { commit } from './commit';
import { useLiveQuery } from './live';

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

function movement(
  type: MovementType,
  item: { id: string; name: string; unit: string; unitPrice: number },
  delta: number,
  note: string,
  by: Person,
) {
  return {
    type,
    // The price rides along, so the finance view can value the change at
    // what it cost then rather than at whatever the item costs now.
    items: [{ itemId: item.id, name: item.name, unit: item.unit, delta, unitPrice: item.unitPrice }],
    unmatched: [],
    note: note.trim(),
    createdBy: by.id,
    createdByName: nameOf(by),
    createdAt: serverTimestamp(),
  };
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
  await commit(batch);
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
  await commit(batch);
}

export async function deleteItem(item: StoreItem, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'store', item.id));
  batch.set(doc(collection(db, 'storeMovements')), movement('delete', item, -item.quantity, '', by));
  await commit(batch);
}
