import { serverTimestamp } from 'firebase/firestore';

import { nameOf, type MovementType, type Person } from '../lib/model';

/** One entry for `storeMovements`: a change to an item's count, and who made it. */
export function movement(
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
