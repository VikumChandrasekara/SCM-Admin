import { describe, expect, it } from 'vitest';

import { movementFrom, type Movement } from '../src/lib/model';
import { deltaFor, historyRows, pageDelta } from '../src/lib/storeHistory';

const move = (id: string, type: Movement['type'], lines: Array<[string, number]>): Movement =>
  movementFrom(id, {
    type,
    items: lines.map(([itemId, delta]) => ({ itemId, name: itemId, unit: 'L', delta, unitPrice: 300 })),
    createdBy: 'u1',
    createdByName: 'u1',
  });

describe('an item’s history', () => {
  // Newest first: used 20, recounted (+5), restocked 100, used 45 — the item holds 140 now,
  // so the newest change ends at 140 and the oldest began at 100.
  const log = [
    move('m4', 'usage', [['diesel', -20]]),
    move('m3', 'adjust', [['diesel', 5]]),
    move('m2', 'restock', [['diesel', 100]]),
    move('m1', 'usage', [['diesel', -45], ['oil', -2]]),
  ];

  it('counts only what moved this item, from a movement that moved several', () => {
    expect(deltaFor(log[3], 'diesel')).toBe(-45);
    expect(deltaFor(log[3], 'oil')).toBe(-2);
    expect(deltaFor(log[3], 'rope')).toBe(0);
  });

  it('works the count before and after each change back from what is held now', () => {
    const rows = historyRows(log, 'diesel', 140, 0);
    expect(rows.map((row) => [row.delta, row.before, row.after])).toEqual([
      [-20, 160, 140],
      [5, 155, 160],
      [100, 55, 155],
      [-45, 100, 55],
    ]);
  });

  it('starts a later page from what the pages before it added up to', () => {
    const first = log.slice(0, 2);
    const second = log.slice(2);
    expect(pageDelta(first, 'diesel')).toBe(-15);
    // The first page ends at 160 (before its older change); the second carries on from there.
    const rows = historyRows(second, 'diesel', 140, pageDelta(first, 'diesel'));
    expect(rows.map((row) => [row.before, row.after])).toEqual([
      [55, 155],
      [100, 55],
    ]);
  });

  it('leaves the counts blank rather than wrong when the earlier pages are not known', () => {
    const rows = historyRows(log, 'diesel', 140, null);
    expect(rows.every((row) => row.before === null && row.after === null)).toBe(true);
    expect(rows.map((row) => row.delta)).toEqual([-20, 5, 100, -45]);
  });

  it('keeps fractions tidy', () => {
    const rows = historyRows([move('a', 'usage', [['x', -0.1]]), move('b', 'usage', [['x', -0.2]])], 'x', 0.3, 0);
    expect(rows.map((row) => row.after)).toEqual([0.3, 0.4]);
    expect(rows.map((row) => row.before)).toEqual([0.4, 0.6]);
  });
});
