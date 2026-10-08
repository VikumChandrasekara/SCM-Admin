import type { DocumentData } from 'firebase/firestore';

import { toDate, type Person } from './model';

// The recycle bin: what is deleted from the panel is not gone at once. An
// exact copy of the document goes into `recycleBin` in the same write that
// removes it, stays restorable for [BIN_RETENTION_DAYS], and is then purged.
// firestore.rules is what holds the copy to being exact, so a restore can
// only ever put back what was taken out.

export const BIN_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BinKind = 'bill' | 'sale' | 'store' | 'operator';

export const BIN_KINDS: readonly BinKind[] = ['sale', 'bill', 'store', 'operator'];

/** What each kind is called, and the collection it is restored into. */
export const BIN_KIND: Record<BinKind, { label: string; collection: string }> = {
  sale: { label: 'විකුණුම් බිල්පත', collection: 'sales' },
  bill: { label: 'බිල්පත', collection: 'bills' },
  store: { label: 'ගබඩා අයිතමය', collection: 'store' },
  operator: { label: 'ගිණුම', collection: 'operators' },
};

/**
 * The kinds [role] sees in the bin: the admin all of them, a supervisor the
 * sales, bills and store items — what they may delete — and a crew none.
 */
export function binKindsFor(role: Person['role']): readonly BinKind[] {
  if (role === 'admin') return BIN_KINDS;
  return role === 'supervisor' ? ['sale', 'bill', 'store'] : [];
}

/**
 * Whether [person] may put [entry] back. firestore.rules' `mayRestore` says
 * the same, so the page offers no button the server would refuse: the admin
 * anything, a supervisor a store item or a bill or sale they wrote themselves.
 */
export function canRestoreEntry(entry: BinEntry, person: Pick<Person, 'id' | 'role'>): boolean {
  if (person.role === 'admin') return true;
  if (person.role !== 'supervisor') return false;
  return (
    entry.kind === 'store' ||
    ((entry.kind === 'bill' || entry.kind === 'sale') && entry.data.createdBy === person.id)
  );
}

/** The bin entry's id — fixed by what it holds, which is what lets the rules find it. */
export function binId(kind: BinKind, docId: string): string {
  return `${kind}__${docId}`;
}

export interface BinEntry {
  id: string;
  kind: BinKind;
  /** The id of the deleted document in its own collection. */
  docId: string;
  /** The deleted document, field for field. */
  data: DocumentData;
  /** What it was called — "බිල්පත 002", an item's name, a person's name. */
  label: string;
  /** A line of what it said, so it can be told apart without opening it. */
  summary: string;
  deletedBy: string;
  deletedByName: string;
  deletedAt: Date | null;
  /** When it is purged for good. */
  purgeAt: Date | null;
}

export function binEntryFrom(id: string, data: DocumentData): BinEntry {
  const kind = BIN_KINDS.find((candidate) => candidate === data.kind) ?? 'bill';
  const deletedAt = toDate(data.deletedAt);
  return {
    id,
    kind,
    docId: typeof data.docId === 'string' ? data.docId : '',
    data: (data.data ?? {}) as DocumentData,
    label: typeof data.label === 'string' ? data.label : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    deletedBy: typeof data.deletedBy === 'string' ? data.deletedBy : '',
    deletedByName: typeof data.deletedByName === 'string' ? data.deletedByName : '',
    deletedAt,
    // The time the purge goes by, as written: firestore.rules keeps it
    // within a day of 30 days out. Counted from deletedAt when it is missing.
    purgeAt: toDate(data.purgeAt) ?? (deletedAt ? new Date(deletedAt.getTime() + BIN_RETENTION_DAYS * DAY_MS) : null),
  };
}

/** Whether [entry] has been in the bin its 30 days — and is gone as far as anyone is concerned. */
export function binExpired(entry: BinEntry, now = Date.now()): boolean {
  return entry.purgeAt != null && entry.purgeAt.getTime() <= now;
}

/** Whole days left to restore [entry] in, counted up — the last day still reads 1. */
export function binDaysLeft(entry: BinEntry, now = Date.now()): number {
  if (!entry.purgeAt) return BIN_RETENTION_DAYS;
  return Math.max(0, Math.ceil((entry.purgeAt.getTime() - now) / DAY_MS));
}
