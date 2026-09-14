import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore';

import { db } from '../db';
import { emailFor, provisioningAuth } from '../firebase';
import { ROLES, SERVICE, type Machine, type Person, type RoleId } from '../lib/model';
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
  ratePerFoot: number;
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
    ratePerFoot: fields.role === 'compressor' ? fields.ratePerFoot : 0,
  };
}

export async function createAccount(
  fields: UserFields & { username: string; password: string; meterHours: number },
  machines: Map<string, Machine>,
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
      leaveDays: 0,
      advanceAmount: 0,
      bonusTotal: 0,
      createdAt: serverTimestamp(),
    });
    addMachineIfNew(batch, fields, machines, fields.meterHours);
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
    leaveDays: number;
    advanceAmount: number;
    bonusTotal: number;
    /** Only read when the person is moved onto a machine that is new. */
    meterHours: number;
  },
  machines: Map<string, Machine>,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'operators', person.id), {
    ...recordFields(fields),
    leaveDays: fields.leaveDays,
    advanceAmount: fields.advanceAmount,
    bonusTotal: fields.bonusTotal,
  });
  addMachineIfNew(batch, fields, machines, fields.meterHours);
  await commit(batch);
}

export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const secondary = provisioningAuth();
  const credential = await signInWithEmailAndPassword(secondary, emailFor(username), currentPassword);
  try {
    await updatePassword(credential.user, newPassword);
  } finally {
    await signOut(secondary).catch(() => {});
  }
}

/**
 * Removes the record, which ends the account's access at once. With the
 * current password the login is deleted too, freeing the username.
 */
export async function removeAccount(person: Person, currentPassword: string | null): Promise<void> {
  if (!currentPassword) {
    await deleteDoc(doc(db, 'operators', person.id));
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
    await deleteDoc(doc(db, 'operators', person.id));
    await deleteUser(credential.user);
  } finally {
    await signOut(secondary).catch(() => {});
  }
}
