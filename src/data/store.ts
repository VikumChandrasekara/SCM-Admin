import {
  collection,
  doc,
  getDoc,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { db } from '../db';
import { linkDocId, movementFrom, storeItemFrom, type Person, type StockLink, type StoreItem } from '../lib/model';
import type { LinkPlan } from '../lib/storeLink';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLivePages } from './live';
import { movement } from './movement';
import { binEntryData, binRef } from './recycle';

/**
 * Every change to any count, newest first, a page of 100 at a time. The log
 * grows for ever, so only the page on screen is read.
 */
export function useMovements() {
  return useLivePages(
    'movements',
    () => query(collection(db, 'storeMovements'), orderBy('createdAt', 'desc')),
    (snapshot) => movementFrom(snapshot.id, snapshot.data()),
  );
}

export interface ItemInput {
  name: string;
  unit: string;
  minQuantity: number;
  unitPrice: number;
  /** How many make a kilo, for an item delivered by weight but counted in pieces; null for any other. */
  piecesPerKg: number | null;
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
    piecesPerKg: input.piecesPerKg,
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
  if (input.piecesPerKg !== before.piecesPerKg) {
    lines.push(`kg එකක ගණන: ${before.piecesPerKg ?? '—'} → ${input.piecesPerKg ?? '—'}`);
  }
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
    piecesPerKg: input.piecesPerKg,
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

export type LinkResult = 'adopted' | 'created' | 'present';

/**
 * Gives the use in [plan] an item to draw from, without anyone choosing one —
 * see storeLink.ts for why a link cannot simply be added to an item.
 *
 * One transaction. If the use already has its item (another session got there
 * first) nothing is written. Otherwise the plan's item is moved to the id the
 * link fixes, count and price and all, and the old one goes to the recycle bin
 * for 30 days, where it can be put back; with no such item a new one is made
 * at 0. Either way the count stays what it was, so nothing is logged as stock
 * coming or going — only in the audit trail, which says what was done.
 */
export async function linkStoreItem(plan: LinkPlan, by: Person): Promise<LinkResult> {
  const { option } = plan;
  const target = doc(db, 'store', linkDocId(option.link));
  const used = `${option.group} · ${option.label}`;

  try {
    return await linkInTransaction(target, used, plan, by);
  } catch (failure) {
    // Two sessions at once: the rules refuse the second one's writes to what the
    // first has just made, rather than letting it retry and find it there.
    if ((failure as { code?: string }).code === 'permission-denied' && (await getDoc(target)).exists()) {
      return 'present';
    }
    throw failure;
  }
}

function linkInTransaction(
  target: ReturnType<typeof doc>,
  used: string,
  { option, adopt }: LinkPlan,
  by: Person,
): Promise<LinkResult> {
  return runTransaction(db, async (tx): Promise<LinkResult> => {
    // Every read first: a transaction may not read after it has written.
    if ((await tx.get(target)).exists()) return 'present';
    const sourceRef = adopt ? doc(db, 'store', adopt.id) : null;
    const source = sourceRef ? await tx.get(sourceRef) : null;

    if (adopt && sourceRef && source?.exists() && !source.data().link) {
      // As the server holds it now, not as the panel last saw it.
      const stored = storeItemFrom(source.id, source.data());
      tx.set(target, {
        name: stored.name,
        unit: stored.unit,
        quantity: stored.quantity,
        minQuantity: stored.minQuantity,
        unitPrice: stored.unitPrice,
        piecesPerKg: stored.piecesPerKg,
        link: option.link,
        note: stored.note,
        createdAt: source.data().createdAt ?? serverTimestamp(),
        countedAt: source.data().countedAt ?? null,
        updatedAt: serverTimestamp(),
        updatedBy: by.id,
      });
      const summary = `ඉතිරිව තිබූ ප්‍රමාණය ${stored.quantity} ${stored.unit} · ${used} සඳහා මාරු කළා`;
      tx.set(binRef('store', adopt.id), binEntryData('store', adopt.id, source.data(), stored.name, summary, by));
      tx.delete(sourceRef);
      tx.set(
        doc(collection(db, 'auditLog')),
        auditEntry('store.link', 'store', target.id, stored.name, `${used} සඳහා සම්බන්ධ කළා — ${stored.quantity} ${stored.unit} සමඟ`, by),
      );
      return 'adopted';
    }

    tx.set(target, {
      name: option.label,
      unit: option.unit,
      quantity: 0,
      minQuantity: 0,
      unitPrice: 0,
      piecesPerKg: null,
      link: option.link,
      note: '',
      createdAt: serverTimestamp(),
      // Not counted yet, so what the crews use from now on is drawn from it.
      countedAt: null,
      updatedAt: serverTimestamp(),
      updatedBy: by.id,
    });
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('store.link', 'store', target.id, option.label, `${used} සඳහා ගබඩා අයිතමයක් නොතිබූ නිසා නව අයිතමයක් සෑදුවා — ප්‍රමාණය 0`, by),
    );
    return 'created';
  });
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
