import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';

import {
  BIN_KINDS,
  BIN_RETENTION_DAYS,
  binDaysLeft,
  binEntryFrom,
  binExpired,
  binId,
  binKindsFor,
  canRestoreEntry,
} from '../src/lib/recycle';

const DAY = 24 * 60 * 60 * 1000;
const deletedAt = new Date('2026-10-01T06:00:00Z');

const entry = (overrides: Record<string, unknown> = {}) =>
  binEntryFrom('sale__BLKA2345', {
    kind: 'sale',
    docId: 'BLKA2345',
    data: { code: 'BLKA2345', amount: 19500 },
    label: 'බිල්පත 001',
    summary: 'Silva',
    deletedBy: 'admin1',
    deletedByName: 'Pivithuru',
    deletedAt: Timestamp.fromDate(deletedAt),
    purgeAt: Timestamp.fromMillis(deletedAt.getTime() + BIN_RETENTION_DAYS * DAY),
    ...overrides,
  });

describe('the recycle bin', () => {
  it('names an entry by what it holds, which is how the rules find it', () => {
    expect(binId('sale', 'BLKA2345')).toBe('sale__BLKA2345');
    expect(binId('operator', 'uid1')).toBe('operator__uid1');
  });

  it('reads an entry whole, the deleted document untouched', () => {
    const read = entry();
    expect(read).toMatchObject({
      kind: 'sale',
      docId: 'BLKA2345',
      label: 'බිල්පත 001',
      deletedByName: 'Pivithuru',
    });
    expect(read.data).toEqual({ code: 'BLKA2345', amount: 19500 });
    expect(read.deletedAt).toEqual(deletedAt);
  });

  it('keeps an entry for 30 days — then it is gone, purged or not', () => {
    const read = entry();
    expect(BIN_RETENTION_DAYS).toBe(30);
    expect(binExpired(read, deletedAt.getTime() + 29 * DAY)).toBe(false);
    expect(binExpired(read, deletedAt.getTime() + 30 * DAY - 1)).toBe(false);
    expect(binExpired(read, deletedAt.getTime() + 30 * DAY)).toBe(true);
    expect(binExpired(read, deletedAt.getTime() + 45 * DAY)).toBe(true);
  });

  it('counts whole days left, the last one still reading 1', () => {
    const read = entry();
    expect(binDaysLeft(read, deletedAt.getTime())).toBe(30);
    expect(binDaysLeft(read, deletedAt.getTime() + 10 * DAY)).toBe(20);
    expect(binDaysLeft(read, deletedAt.getTime() + 29 * DAY + 3_600_000)).toBe(1);
    expect(binDaysLeft(read, deletedAt.getTime() + 31 * DAY)).toBe(0);
  });

  it('counts from the day it was deleted when no purge time was written', () => {
    const read = entry({ purgeAt: undefined });
    expect(read.purgeAt?.getTime()).toBe(deletedAt.getTime() + 30 * DAY);
  });

  it('shows each role its own kinds: the admin all, a supervisor the bills and store items, a crew none', () => {
    expect(binKindsFor('admin')).toEqual(BIN_KINDS);
    expect(binKindsFor('supervisor')).toEqual(['sale', 'bill', 'store']);
    expect(binKindsFor('operator')).toEqual([]);
    expect(binKindsFor('compressor')).toEqual([]);
  });

  it('lets the admin restore anything, a supervisor a store item or a bill of their own', () => {
    const admin = { id: 'admin1', role: 'admin' } as const;
    const supervisor = { id: 'sup1', role: 'supervisor' } as const;
    const crew = { id: 'op1', role: 'operator' } as const;
    const bill = (createdBy: string) => entry({ kind: 'bill', data: { createdBy } });

    for (const kind of ['sale', 'bill', 'store', 'operator']) {
      expect(canRestoreEntry(entry({ kind }), admin)).toBe(true);
      expect(canRestoreEntry(entry({ kind }), crew)).toBe(false);
    }
    expect(canRestoreEntry(entry({ kind: 'store' }), supervisor)).toBe(true);
    expect(canRestoreEntry(bill('sup1'), supervisor)).toBe(true);
    expect(canRestoreEntry(bill('admin1'), supervisor)).toBe(false);
    expect(canRestoreEntry(entry({ kind: 'sale', data: { createdBy: 'sup1' } }), supervisor)).toBe(true);
    expect(canRestoreEntry(entry({ kind: 'sale', data: { createdBy: 'admin1' } }), supervisor)).toBe(false);
    expect(canRestoreEntry(entry({ kind: 'operator' }), supervisor)).toBe(false);
  });

  it('falls back on safe values for an entry missing its fields', () => {
    const read = binEntryFrom('x', {});
    expect(read.kind).toBe('bill');
    expect(read.data).toEqual({});
    expect(read.label).toBe('');
    expect(binExpired(read)).toBe(false);
    expect(binDaysLeft(read)).toBe(30);
  });
});
