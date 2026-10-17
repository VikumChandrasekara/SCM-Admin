import { describe, expect, it } from 'vitest';

import { stockAlerts } from '../src/lib/alerts';
import { DIRECT_LINKS, storeItemFrom, type StoreItem } from '../src/lib/model';

const item = (id: string, overrides: Partial<StoreItem> = {}): StoreItem => ({
  id,
  name: id,
  unit: 'L',
  quantity: 0,
  minQuantity: 5,
  unitPrice: 300,
  piecesPerKg: null,
  link: null,
  note: '',
  direct: false,
  usedQuantity: 0,
  usedAmount: 0,
  createdAt: null,
  countedAt: null,
  updatedAt: null,
  ...overrides,
});

describe('items bought and used straight away', () => {
  it('are read from the stored flag, and an item without one is stocked as before', () => {
    expect(storeItemFrom('a', { name: 'Petrol', direct: true }).direct).toBe(true);
    expect(storeItemFrom('b', { name: 'Grease' }).direct).toBe(false);
    expect(storeItemFrom('c', { name: 'Grease', direct: 'yes' }).direct).toBe(false);
  });

  it('are never out of stock — no alert for what has no shelf', () => {
    const store = [
      item('fill-diesel', { direct: true, quantity: -40 }),
      item('petrol', { direct: true }),
      item('rope', { quantity: 0 }),
      item('wire', { quantity: 3 }),
    ];
    expect(stockAlerts(store).map((alert) => [alert.item.id, alert.status])).toEqual([
      ['rope', 'out'],
      ['wire', 'low'],
    ]);
  });

  it('are the fluids a crew draws on the day: diesel, both engine oils and hydraulic', () => {
    expect([...DIRECT_LINKS]).toEqual(['fill:diesel', 'fill:engineOil', 'fill:compressorOil', 'fill:hydraulic']);
  });
});
