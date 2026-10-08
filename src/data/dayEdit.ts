import { collection, deleteField, doc, increment, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '../db';
import { editError, editLines, fillChanges, planMeters, type DayEdit } from '../lib/dayEdit';
import { addDays } from '../lib/format';
import {
  dayFrom,
  linkDocId,
  nameOf,
  storeItemFrom,
  tallyField,
  usageInStoreUnit,
  type Day,
  type InspectionItem,
  type Person,
  type StockLink,
  type StoreItem,
} from '../lib/model';
import { usageId } from '../lib/usage';
import { auditEntry } from './audit';
import { dayRef, fetchDays, monthRef } from './machines';
import { movement } from './movement';

/** How far either side of a day to look for the readings its own has to sit between. */
const WINDOW_DAYS = 31;

interface StockAdjustment {
  item: StoreItem;
  delta: number;
  slot: number;
}

/**
 * Saves a corrected day. Returns what changed, in the audit log's words.
 *
 * One transaction, so a day is never left half-corrected:
 *
 * - the day itself — meters, ලෝඩ් / අඩි, amounts, marks;
 * - what moves with a meter — the day before's closing, the months' hours and
 *   the machine's own meter (see planMeters);
 * - the months' ලෝඩ් / අඩි, by the difference, as saveTally does;
 * - the store, for an OK'd පිරවීම whose fuel was already drawn: by the
 *   difference, with an entry in the movements. A පිරවීම whose fuel was never
 *   drawn leaves the shelf alone — the stock only moves by what moved.
 *
 * Staff only — firestore.rules lets staff, and no one else, correct a day that
 * has been OK'd; its OK stays.
 */
export async function saveDayEdit(person: Person, date: string, edit: DayEdit, by: Person): Promise<string[]> {
  const invalid = editError(edit);
  if (invalid) throw new Error(invalid);

  const machineId = person.machineId;
  const field = tallyField(person);
  const around = await fetchDays(machineId, addDays(date, -WINDOW_DAYS), addDays(date, WINDOW_DAYS));
  const previousDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const machineRef = doc(db, 'machines', machineId);

  return runTransaction(db, async (tx) => {
    // Every read first: a transaction may not read after it has written.
    const snapshot = await tx.get(dayRef(machineId, date));
    if (!snapshot.exists()) throw new Error('මෙම දිනයේ වාර්තාවක් නැත');
    const previousSnapshot = await tx.get(dayRef(machineId, previousDate));
    const nextSnapshot = await tx.get(dayRef(machineId, nextDate));
    const machine = await tx.get(machineRef);

    const day = dayFrom(date, snapshot.data());
    const previous = previousSnapshot.exists() ? dayFrom(previousDate, previousSnapshot.data()) : null;
    const next = nextSnapshot.exists() ? dayFrom(nextDate, nextSnapshot.data()) : null;
    // The days either side are read again, so a reading entered since is held to as well.
    const window = [
      ...around.filter((other) => ![date, previousDate, nextDate].includes(other.date)),
      ...[previous, next].filter((other): other is Day => other != null),
    ];

    const lines = editLines(day, edit, field);
    if (lines.length === 0) throw new Error('වෙනසක් නැත');

    const planned = planMeters(
      { day, previous, next, around: window, machineHours: machine.data()?.totalHours ?? 0 },
      edit.onHours,
      edit.offHours,
    );
    if (planned.error != null) throw new Error(planned.error);
    const { plan } = planned;

    // Fuel already drawn for an OK'd slot is corrected by the difference.
    const adjustments: StockAdjustment[] = [];
    const changes = fillChanges(day, edit).filter((change) => change.locked);
    for (const slot of new Set(changes.map((change) => change.slot))) {
      const posted = await tx.get(doc(db, 'storeMovements', usageId(machineId, date, `fill${slot}`)));
      if (!posted.exists()) continue;
      const drawn = new Set((posted.data().items as { itemId: string }[] | undefined)?.map((line) => line.itemId));
      for (const change of changes.filter((entry) => entry.slot === slot)) {
        const link = `fill:${change.item}` as StockLink;
        const itemId = linkDocId(link);
        if (!drawn.has(itemId)) continue;
        const itemSnapshot = await tx.get(doc(db, 'store', itemId));
        if (!itemSnapshot.exists()) continue;
        const item = storeItemFrom(itemSnapshot.id, itemSnapshot.data());
        const delta = -(
          usageInStoreUnit(link, item.unit, change.after) - usageInStoreUnit(link, item.unit, change.before)
        );
        if (delta !== 0) adjustments.push({ item, delta, slot });
      }
    }

    // ---- writes ----
    const payload: Record<string, unknown> = { date };
    const slots: Record<string, Record<string, unknown>> = {};
    const slotOf = (number: number) => (slots[String(number)] ??= {});
    if (plan.setOn) slotOf(plan.setOn.slot).onHours = plan.setOn.value;
    for (const change of fillChanges(day, edit)) {
      const slot = slotOf(change.slot);
      slot.amounts = { ...(slot.amounts as Record<string, number> | undefined), [change.item]: change.after };
    }
    if (Object.keys(slots).length > 0) payload.fillings = slots;
    if (plan.setClosing != null) payload.closingHours = plan.setClosing;
    if (edit.tally !== day[field]) payload[field] = edit.tally;
    const marks: Record<string, unknown> = {};
    for (const [item, mark] of Object.entries(edit.inspection) as [InspectionItem, boolean | null][]) {
      if (mark !== (day.inspection[item] ?? null)) marks[item] = mark === null ? deleteField() : mark;
    }
    if (Object.keys(marks).length > 0) payload.inspection = marks;
    tx.set(dayRef(machineId, date), payload, { merge: true });

    if (plan.closePrevious) {
      tx.set(
        dayRef(machineId, plan.closePrevious.date),
        { date: plan.closePrevious.date, closingHours: plan.closePrevious.closingHours },
        { merge: true },
      );
    }

    // The months move by the difference, so re-entering a figure corrects it instead of adding it again.
    const months = new Map<string, Record<string, number>>();
    const bump = (month: string, key: string, by: number) => {
      if (by === 0) return;
      months.set(month, { ...months.get(month), [key]: (months.get(month)?.[key] ?? 0) + by });
    };
    bump(date.slice(0, 7), field, edit.tally - day[field]);
    for (const [month, delta] of plan.monthHours) bump(month, 'hours', delta);
    for (const [month, moves] of months) {
      tx.set(
        monthRef(machineId, month),
        { month, ...Object.fromEntries(Object.entries(moves).map(([key, value]) => [key, increment(value)])) },
        { merge: true },
      );
    }

    if (plan.totalHours != null) tx.set(machineRef, { totalHours: plan.totalHours }, { merge: true });

    for (const { item, delta, slot } of adjustments) {
      tx.update(doc(db, 'store', item.id), {
        quantity: increment(delta),
        updatedAt: serverTimestamp(),
        updatedBy: by.id,
      });
      tx.set(doc(collection(db, 'storeMovements')), {
        ...movement('adjust', item, delta, `ඉතිහාස සංස්කරණය · ${machineId} · ${date} · පිරවීම ${slot}`, by),
        machineId,
        date,
      });
    }

    const stock = adjustments.map(({ item, delta }) => `${item.name} ${delta > 0 ? '+' : ''}${delta} ${item.unit}`);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'day.edit',
        'operator',
        person.id,
        nameOf(person),
        `${date} · ${lines.join(' · ')}${stock.length > 0 ? ` · ගබඩාව: ${stock.join(', ')}` : ''}`,
        by,
      ),
    );
    return lines;
  });
}
