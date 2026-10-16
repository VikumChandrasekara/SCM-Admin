import { collection, deleteField, doc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import { crewOn, typeNameError } from '../lib/machines';
import {
  MACHINE_KINDS,
  MACHINE_KIND_LABEL,
  METER_UNITS,
  machineTypeDefFrom,
  machineTypeForRole,
  nameOf,
  type Machine,
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
 * Adds a machine type and returns its id. What it behaves like and what its
 * meter counts can be put right later — see [updateMachineType].
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

/** What can be put right about a machine type. */
export interface MachineTypeChanges {
  label: string;
  english: string;
  kind: MachineKind;
  meterUnit: MeterUnit;
}

/**
 * Puts a machine type right — its names, what it behaves like and what its
 * meter counts — at any time. The excavator and the compressor can have their
 * names and meter unit changed too; what they behave like stays, as crew
 * accounts are tied to the two. A change of behaviour is refused while a crew
 * member is on a machine of the type that the new behaviour would not suit.
 */
export async function updateMachineType(
  type: MachineTypeDef,
  next: MachineTypeChanges,
  types: MachineTypes,
  machines: Iterable<Machine>,
  people: readonly Person[],
  by: Person,
): Promise<void> {
  const problem = typeNameError(next.label, next.english);
  if (problem) throw new Error(problem);
  if (!MACHINE_KINDS.includes(next.kind)) throw new Error('වර්ගය ක්‍රියා කරන ආකාරය තෝරන්න.');
  if (!METER_UNITS.includes(next.meterUnit)) throw new Error('මීටරය ගණන් කරන්නේ පැය ද කිලෝමීටර් ද යන්න තෝරන්න.');
  if (nameTaken(types, next.label, type.id)) throw new Error(`${next.label.trim()} නමින් වර්ගයක් දැනටමත් ඇත.`);

  const label = next.label.trim();
  const english = next.english.trim();
  if (next.kind !== type.kind) {
    if (type.builtIn) throw new Error('මෙම වර්ගයේ ක්‍රියා කරන ආකාරය වෙනස් කළ නොහැක.');
    for (const machine of machines) {
      if (machine.type !== type.id) continue;
      const unsuited = crewOn(machine.id, people).find((person) => machineTypeForRole(person.role) !== next.kind);
      if (unsuited) {
        throw new Error(
          `${machine.id} යන්ත්‍රයේ ${nameOf(unsuited)} සිටී — නව ක්‍රියා කරන ආකාරයට ඔවුන් නොගැළපේ. ඔවුන්ව වෙනත් යන්ත්‍රයකට මාරු කර නැවත උත්සාහ කරන්න.`,
        );
      }
    }
  }

  const changes = [
    label !== type.label ? `නම: ${type.label} → ${label}` : '',
    english !== type.english ? `English: ${type.english || '—'} → ${english || '—'}` : '',
    next.kind !== type.kind ? `ක්‍රියා කරන ආකාරය: ${MACHINE_KIND_LABEL[type.kind]} → ${MACHINE_KIND_LABEL[next.kind]}` : '',
    next.meterUnit !== type.meterUnit ? `මීටරය: ${type.meterUnit} → ${next.meterUnit}` : '',
  ].filter(Boolean);
  if (changes.length === 0) return;

  const batch = writeBatch(db);
  const ref = doc(db, 'machineTypes', type.id);
  // A built-in type is not stored until it is changed; its record holds only
  // what differs from how it comes, so a record is merged, not replaced.
  if (type.builtIn) batch.set(ref, { label, english, meterUnit: next.meterUnit }, { merge: true });
  else batch.update(ref, { label, english, kind: next.kind, meterUnit: next.meterUnit });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeUpdate', 'machine', type.id, label, changes.join(' · '), by),
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
  if (type.builtIn) batch.set(doc(db, 'machineTypes', type.id), { hidden: true }, { merge: true });
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
  // Only the removal is taken back; any name or unit it was given stays.
  batch.update(doc(db, 'machineTypes', type.id), { hidden: deleteField() });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('machine.typeCreate', 'machine', type.id, type.label, `${type.label} ආපසු ගත්තා`, by),
  );
  await commit(batch);
}
