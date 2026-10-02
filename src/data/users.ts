import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore';

import { db } from '../db';
import { emailFor, provisioningAuth } from '../firebase';
import {
  ROLES,
  SERVICE,
  WAGE_BASIS_LABEL,
  nameOf,
  type Machine,
  type Person,
  type RoleId,
  type WageBasis,
} from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';

/**
 * Account management on the Spark plan.
 *
 * Without the Admin SDK the only way to create a login is to sign up as it,
 * which happens on a separate in-memory session (see provisioningAuth) so
 * the admin stays signed in. What grants access is the operator record the
 * admin writes next — firestore.rules lets nobody in without one — so
 * removing that record is what removing an account means. The login itself
 * can only be deleted, or its password changed, by signing in as it, which
 * needs its current password.
 */

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export interface UserFields {
  name: string;
  role: RoleId;
  machineId: string;
  dailyWage: number;
  /** What the daily wage is paid for: a day, an hour, a foot or a load. */
  wageBasis: WageBasis;
}

/** A crew member's machine, set up the first time someone is put on it. */
function addMachineIfNew(
  batch: WriteBatch,
  fields: UserFields,
  machines: Map<string, Machine>,
  meterHours: number,
) {
  if (!ROLES[fields.role].isCrew || !fields.machineId || machines.has(fields.machineId)) return;
  batch.set(doc(db, 'machines', fields.machineId), {
    totalHours: meterHours,
    // Every part counts from the meter as it stands today.
    serviceDueAt: Object.fromEntries(
      ROLES[fields.role].serviceTasks.map((task) => [task, meterHours + SERVICE[task].interval]),
    ),
  });
}

function recordFields(fields: UserFields) {
  const crew = ROLES[fields.role].isCrew;
  return {
    name: fields.name.trim(),
    role: fields.role,
    machineId: crew ? fields.machineId.trim() : '',
    dailyWage: crew ? fields.dailyWage : 0,
    wageBasis: crew ? fields.wageBasis : 'day',
  };
}

/** What changed between the stored account and the fields about to be saved. */
function accountDiff(before: Person, fields: UserFields & { advanceAmount: number }): string {
  const lines: string[] = [];
  const name = fields.name.trim();
  if (name && name !== before.name) lines.push(`නම: ${before.name || '—'} → ${name}`);
  if (fields.role !== before.role) lines.push(`කාණ්ඩය: ${ROLES[before.role].label} → ${ROLES[fields.role].label}`);
  const crew = ROLES[fields.role].isCrew;
  const machineId = crew ? fields.machineId.trim() : '';
  if (machineId !== before.machineId) lines.push(`යන්ත්‍රය: ${before.machineId || '—'} → ${machineId || '—'}`);
  const dailyWage = crew ? fields.dailyWage : 0;
  if (dailyWage !== before.dailyWage || fields.wageBasis !== before.wageBasis) {
    lines.push(
      `පඩිය: රු.${before.dailyWage} (${WAGE_BASIS_LABEL[before.wageBasis].per}) → රු.${dailyWage} (${WAGE_BASIS_LABEL[fields.wageBasis].per})`,
    );
  }
  if (fields.advanceAmount !== before.advanceAmount) {
    lines.push(`ඇඩ්වාන්ස්: රු.${before.advanceAmount} → රු.${fields.advanceAmount}`);
  }
  return lines.length > 0 ? lines.join(' · ') : 'වෙනසක් නැත';
}

export async function createAccount(
  fields: UserFields & { username: string; password: string; meterHours: number },
  machines: Map<string, Machine>,
  by: Person,
): Promise<void> {
  const secondary = provisioningAuth();
  const credential = await createUserWithEmailAndPassword(
    secondary,
    emailFor(fields.username),
    fields.password,
  );

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'operators', credential.user.uid), {
      ...recordFields(fields),
      username: fields.username.trim().toLowerCase(),
      advanceAmount: 0,
      createdAt: serverTimestamp(),
    });
    addMachineIfNew(batch, fields, machines, fields.meterHours);
    batch.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'account.create',
        'operator',
        credential.user.uid,
        fields.name.trim(),
        `${ROLES[fields.role].label} · පරිශීලක නාමය ${fields.username.trim().toLowerCase()}`,
        by,
      ),
    );
    await batch.commit();
  } catch (error) {
    // A login without a record could never be used, and its username could
    // never be taken again — so take it back out.
    await deleteUser(credential.user).catch(() => {});
    throw error;
  } finally {
    await signOut(secondary).catch(() => {});
  }
}

export async function updateAccount(
  person: Person,
  fields: UserFields & {
    advanceAmount: number;
    /** Only read when the person is moved onto a machine that is new. */
    meterHours: number;
  },
  machines: Map<string, Machine>,
  by: Person,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'operators', person.id), {
    ...recordFields(fields),
    advanceAmount: fields.advanceAmount,
  });
  addMachineIfNew(batch, fields, machines, fields.meterHours);
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('account.update', 'operator', person.id, nameOf(person), accountDiff(person, fields), by),
  );
  await commit(batch);
}

export async function changePassword(
  person: Person,
  currentPassword: string,
  newPassword: string,
  by: Person,
): Promise<void> {
  const secondary = provisioningAuth();
  const credential = await signInWithEmailAndPassword(secondary, emailFor(person.username), currentPassword);
  try {
    await updatePassword(credential.user, newPassword);
    const batch = writeBatch(db);
    batch.set(
      doc(collection(db, 'auditLog')),
      auditEntry('account.password', 'operator', person.id, nameOf(person), 'මුරපදය වෙනස් කළා', by),
    );
    await batch.commit();
  } finally {
    await signOut(secondary).catch(() => {});
  }
}

/**
 * Removes the record, which ends the account's access at once. With the
 * current password the login is deleted too, freeing the username.
 */
export async function removeAccount(
  person: Person,
  currentPassword: string | null,
  by: Person,
): Promise<void> {
  if (!currentPassword) {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'operators', person.id));
    batch.set(
      doc(collection(db, 'auditLog')),
      auditEntry('account.remove', 'operator', person.id, nameOf(person), 'ප්‍රවේශය ඉවත් කළා', by),
    );
    await batch.commit();
    return;
  }

  const secondary = provisioningAuth();
  // Signing in first proves the password before anything is removed.
  const credential = await signInWithEmailAndPassword(
    secondary,
    emailFor(person.username),
    currentPassword,
  );
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'operators', person.id));
    batch.set(
      doc(collection(db, 'auditLog')),
      auditEntry('account.remove', 'operator', person.id, nameOf(person), 'ගිණුම සම්පූර්ණයෙන් මැකුවා', by),
    );
    await batch.commit();
    await deleteUser(credential.user);
  } finally {
    await signOut(secondary).catch(() => {});
  }
}
