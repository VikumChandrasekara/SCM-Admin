import { collection, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';

import { db } from '../db';
import { auditEntryFrom, nameOf, type AuditAction, type AuditEntry, type Person } from '../lib/model';
import { useLiveQuery } from './live';

/**
 * One entry for `auditLog` — written into the same batch or transaction as
 * the change it describes, the way [movement] is for `storeMovements`, so it
 * can never be recorded without the write it is about.
 */
export function auditEntry(
  action: AuditAction,
  entityType: AuditEntry['entityType'],
  entityId: string,
  entityLabel: string,
  summary: string,
  by: Person,
) {
  return {
    action,
    entityType,
    entityId,
    entityLabel,
    summary,
    createdBy: by.id,
    createdByName: nameOf(by),
    createdAt: serverTimestamp(),
  };
}

/** The most recent admin-panel changes, newest first. Admin only — see firestore.rules. */
export function useAuditLog(count = 100) {
  return useLiveQuery(
    `auditLog:${count}`,
    () => query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(count)),
    (snapshot) => auditEntryFrom(snapshot.id, snapshot.data()),
  );
}
