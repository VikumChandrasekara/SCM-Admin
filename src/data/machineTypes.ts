import { collection, doc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import { typeNameError } from '../lib/machines';
import {
  MACHINE_KINDS,
  METER_UNITS,
  machineTypeDefFrom,
  type MeterUnit,
  type MachineKind,
  type MachineTypeDef,
  type MachineTypes,
  type Person,
} from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

/**
 * The machine types an admin has added — a lorry, a loader, whatever the yard
 * runs. The excavator and the compressor are built in and are not stored,
 * unless one has been removed: that is kept as `{hidden: true}`.
 *
 * Read on its own, and kept out of what the panel waits on to open: until it
 * arrives, or if it cannot be read, the built-in types are all there is.
 */
export function useAddedMachineTypes() {
  return useLiveQuery(
    'machineTypes',
    () => collection(db, 'machineTypes'),
    (snapshot) => machineTypeDefFrom(snapshot.id, snapshot.data()),
  );
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function nameTaken(types: MachineTypes, label: string, exceptId: string): boolean {
  return [...types.values()].some((type) => !type.hidden && type.id !== exceptId && sameName(type.label, label));
}

/**
 * Adds a machine type and returns its id. What it behaves like is fixed here —
 * its crew, its service parts and the machines made of it are all set up for
 * that kind, so the rules let only its names change afterwards.
 */
export async function createMachineType(
  label: string,
  english: string,
  kind: MachineKind,
  types: MachineTypes,
  by: Person,
  /** What the meter of a machine of this type counts to begin with. */
  meterUnit: MeterUnit = 'h',
): Promise<string> {
  const problem = typeNameError(label, english);
  if (problem) throw new Error(problem);
  if (!MACHINE_KINDS.includes(kind)) throw new Error('වර්ගය ක්‍රියා කරන ආකාරය තෝරන්න.');
  if (!METER_UNITS.includes(meterUnit)) throw new Error('මීටරය ගණන් කරන්නේ පැය ද කිලෝමීටර් ද යන්න තෝරන්න.');
  if (nameTaken(types, label, '')) throw new Error(`${label.trim()} නමින් වර්ගයක් දැනටමත් ඇත.`);

  const ref = doc(collection(db, 'machineTypes'));
  const batch = writeBatch(db);
  batch.set(ref, { label: label.trim(), english: english.trim(), kind, meterUnit });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeCreate', 'machine', ref.id, label.trim(), label.trim(), by),
  );
  await commit(batch);
  return ref.id;
}

/** Renames a machine type. The names are all that can change. */
export async function renameMachineType(
  type: MachineTypeDef,
  label: string,
  english: string,
  types: MachineTypes,
  by: Person,
): Promise<void> {
  if (type.builtIn) throw new Error('මෙම වර්ගය වෙනස් කළ නොහැක.');
  const problem = typeNameError(label, english);
  if (problem) throw new Error(problem);
  if (nameTaken(types, label, type.id)) throw new Error(`${label.trim()} නමින් වර්ගයක් දැනටමත් ඇත.`);
  if (label.trim() === type.label && english.trim() === type.english) return;

  const batch = writeBatch(db);
  batch.update(doc(db, 'machineTypes', type.id), { label: label.trim(), english: english.trim() });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeUpdate', 'machine', type.id, label.trim(), `${type.label} → ${label.trim()}`, by),
  );
  await commit(batch);
}

/**
 * Removes a machine type. Refused while a machine is of it — read from the
 * server, not the panel's copy, so a machine just added elsewhere counts.
 */
export async function deleteMachineType(type: MachineTypeDef, by: Person): Promise<void> {
  const using = await getDocs(query(collection(db, 'machines'), where('type', '==', type.id), limit(1)));
  if (!using.empty) {
    throw new Error(`${using.docs[0].id} යන්ත්‍රය මෙම වර්ගයේ ය. ඒ යන්ත්‍ර මැකීමෙන් හෝ වෙනත් වර්ගයකට මාරු කිරීමෙන් පසු නැවත උත්සාහ කරන්න.`);
  }

  const batch = writeBatch(db);
  // An added type is deleted. A built-in one is not stored, so removing it is
  // a record that it is hidden — which restoring takes away again.
  if (type.builtIn) batch.set(doc(db, 'machineTypes', type.id), { hidden: true });
  else batch.delete(doc(db, 'machineTypes', type.id));
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeDelete', 'machine', type.id, type.label, type.label, by),
  );
  await commit(batch);
}

/** Brings a built-in type back that was removed. */
export async function restoreMachineType(type: MachineTypeDef, by: Person): Promise<void> {
  if (!type.builtIn || !type.hidden) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'machineTypes', type.id));
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeCreate', 'machine', type.id, type.label, `${type.label} ආපසු ගත්තා`, by),
  );
  await commit(batch);
}
