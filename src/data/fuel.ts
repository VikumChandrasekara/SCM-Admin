import {
  Timestamp,
  collection,
  doc,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from '../db';
import { dateKey, monthBounds, parseDateKey, quantity as quantityText, rupees } from '../lib/format';
import { fuelRecordFrom, nameOf, type FuelRecord, type Person, type StoreItem } from '../lib/model';
import { auditEntry } from './audit';
import { useLivePages, useLiveQuery } from './live';

/** Records are listed 50 at a time, newest first. */
export const FUEL_PAGE_SIZE = 50;

/** One item's records, newest first, a page of 50 at a time — only the page on screen is read. */
export function useFuelRecords(itemId: string) {
  return useLivePages(
    `fuel:${itemId}`,
    () => query(collection(db, 'fuelRecords'), where('itemId', '==', itemId), orderBy('at', 'desc')),
    (snapshot) => fuelRecordFrom(snapshot.id, snapshot.data()),
    FUEL_PAGE_SIZE,
  );
}

/** Every record dated in `yyyy-MM`, newest first — what the finance page counts as an expense. */
export function useMonthFuelRecords(month: string) {
  return useLiveQuery(
    `fuel-in:${month}`,
    () => {
      const { from, to } = monthBounds(month);
      const start = parseDateKey(from);
      const end = parseDateKey(to);
      end.setDate(end.getDate() + 1);
      // A range and an order on the one field — no composite index.
      return query(
        collection(db, 'fuelRecords'),
        where('at', '>=', Timestamp.fromDate(start)),
        where('at', '<', Timestamp.fromDate(end)),
        orderBy('at', 'desc'),
      );
    },
    (snapshot) => fuelRecordFrom(snapshot.id, snapshot.data()),
  );
}

export interface FuelInput {
  quantity: number;
  unitPrice: number;
  /** When it was bought and used. */
  at: Date;
  note: string;
}

/** What a record is worth — the same product the rules check. */
export const fuelAmount = (input: Pick<FuelInput, 'quantity' | 'unitPrice'>) => input.quantity * input.unitPrice;

function summaryOf(unit: string, input: FuelInput): string {
  const note = input.note.trim();
  return `${quantityText(input.quantity, unit)} × ${rupees(input.unitPrice)} = ${rupees(fuelAmount(input))} · ${dateKey(input.at)}${
    note ? ` · ${note}` : ''
  }`;
}

/** Adds a record to [item], and moves the item's running totals with it — in one write. */
export async function addFuelRecord(item: StoreItem, input: FuelInput, by: Person): Promise<void> {
  const record = doc(collection(db, 'fuelRecords'));
  const itemRef = doc(db, 'store', item.id);
  const amount = fuelAmount(input);

  await runTransaction(db, async (tx) => {
    if (!(await tx.get(itemRef)).exists()) throw new Error('මෙම අයිතමය ඉවත් කර ඇත.');
    tx.set(record, {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      amount,
      at: Timestamp.fromDate(input.at),
      date: dateKey(input.at),
      note: input.note.trim(),
      createdAt: serverTimestamp(),
      createdBy: by.id,
      createdByName: nameOf(by),
    });
    tx.update(itemRef, {
      usedQuantity: increment(input.quantity),
      usedAmount: increment(amount),
      updatedAt: serverTimestamp(),
      updatedBy: by.id,
    });
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('store.fuelAdd', 'store', item.id, item.name, summaryOf(item.unit, input), by),
    );
  });
}

/** Puts a record right — how much, at what price, when — and the item's totals with it. */
export async function updateFuelRecord(record: FuelRecord, input: FuelInput, by: Person): Promise<void> {
  const recordRef = doc(db, 'fuelRecords', record.id);
  const itemRef = doc(db, 'store', record.itemId);
  const amount = fuelAmount(input);

  await runTransaction(db, async (tx) => {
    const itemSnapshot = await tx.get(itemRef);
    const stored = await tx.get(recordRef);
    if (!stored.exists()) throw new Error('මෙම සටහන ඉවත් කර ඇත.');
    // As the server holds it now, so a repeat or a second editor moves the totals by what really changed.
    const before = fuelRecordFrom(stored.id, stored.data());

    tx.update(recordRef, {
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      amount,
      at: Timestamp.fromDate(input.at),
      date: dateKey(input.at),
      note: input.note.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: by.id,
    });
    if (itemSnapshot.exists()) {
      tx.update(itemRef, {
        usedQuantity: increment(input.quantity - before.quantity),
        usedAmount: increment(amount - before.amount),
        updatedAt: serverTimestamp(),
        updatedBy: by.id,
      });
    }
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'store.fuelUpdate',
        'store',
        record.itemId,
        record.itemName,
        `${summaryOf(record.unit, {
          quantity: before.quantity,
          unitPrice: before.unitPrice,
          at: before.at ?? input.at,
          note: before.note,
        })}  →  ${summaryOf(record.unit, input)}`,
        by,
      ),
    );
  });
}

/** Removes a record, and takes it out of the item's totals. */
export async function deleteFuelRecord(record: FuelRecord, by: Person): Promise<void> {
  const recordRef = doc(db, 'fuelRecords', record.id);
  const itemRef = doc(db, 'store', record.itemId);

  await runTransaction(db, async (tx) => {
    const itemSnapshot = await tx.get(itemRef);
    const stored = await tx.get(recordRef);
    // A repeat after a dropped line finds it already gone.
    if (!stored.exists()) return;
    const before = fuelRecordFrom(stored.id, stored.data());

    tx.delete(recordRef);
    if (itemSnapshot.exists()) {
      tx.update(itemRef, {
        usedQuantity: increment(-before.quantity),
        usedAmount: increment(-before.amount),
        updatedAt: serverTimestamp(),
        updatedBy: by.id,
      });
    }
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'store.fuelDelete',
        'store',
        record.itemId,
        record.itemName,
        summaryOf(record.unit, {
          quantity: before.quantity,
          unitPrice: before.unitPrice,
          at: before.at ?? new Date(),
          note: before.note,
        }),
        by,
      ),
    );
  });
}
