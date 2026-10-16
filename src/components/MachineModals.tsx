import { Check, Pencil, Plus, RotateCcw, Settings2, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { useLiveData } from '../data/LiveData';
import { createMachineType, deleteMachineType, restoreMachineType, updateMachineType } from '../data/machineTypes';
import {
  assignMachine,
  createMachine,
  deleteMachine,
  updateMachine,
  useMachineDays,
  useMachineMonths,
} from '../data/machines';
import { errorMessage } from '../lib/errors';
import { hours, monthLabel } from '../lib/format';
import {
  MACHINE_ID_PATTERN,
  crewOn,
  machineFitsRole,
  machineKindOf,
  machineTypeOf,
  meterError,
  monthsNewestFirst,
  recordedHours,
  workedDayRows,
} from '../lib/machines';
import {
  MACHINE_KINDS,
  MACHINE_KIND_LABEL,
  FUEL_LABEL,
  FUEL_TYPES,
  METER_UNITS,
  METER_UNIT_LABEL,
  RATE_BASES,
  RATE_BASIS_LABEL,
  ROLES,
  machineTitle,
  machineTypeDef,
  machineTypeForRole,
  meterReading,
  nameOf,
  pickableTypes,
  type FuelType,
  type Machine,
  type MachineKind,
  type MachineType,
  type MachineTypeDef,
  type MeterUnit,
  type RateBasis,
} from '../lib/model';
import { useToday } from '../lib/useToday';
import { useToast } from './Toasts';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  SectionLabel,
  Segmented,
  Select,
  TableFrame,
  Textarea,
  ValueChip,
  cx,
  td,
  th,
} from './ui';

function meterNumber(value: string): number {
  return value.trim() === '' ? 0 : Number(value);
}

/** A machine's details: set a new one up, or put an existing one right. */
export function MachineModal({ machine, onClose }: { machine: Machine | null; onClose: () => void }) {
  const { profile } = useSession();
  const { people, machines, machineTypes } = useLiveData();
  const toast = useToast();
  const [managingTypes, setManagingTypes] = useState(false);

  const crew = machine ? crewOn(machine.id, people) : [];
  // The type it has now — its own, or read from the crew on it — is where the
  // form starts. It can be changed, to one that suits the crew on it.
  const knownType = machine ? machineTypeOf(machine, people) : null;

  const [id, setId] = useState(machine?.id ?? '');
  const [type, setType] = useState<MachineType>(knownType ?? 'excavator');
  const [name, setName] = useState(machine?.name ?? '');
  const [model, setModel] = useState(machine?.model ?? '');
  const [registrationNo, setRegistrationNo] = useState(machine?.registrationNo ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [active, setActive] = useState(machine?.active ?? true);
  // A machine with a crew on it counts hours; a vehicle with none — a lorry —
  // more likely counts kilometres. Until the unit is picked by hand it follows
  // the type, and a machine already set up keeps the one it has.
  const [unit, setUnit] = useState<MeterUnit>(machine?.meterUnit ?? 'h');
  const [unitPicked, setUnitPicked] = useState(false);
  // What the machine is charged, and per what. Empty says nothing: a rate is not set, or not changed.
  const [rate, setRate] = useState(machine?.rate != null ? String(machine.rate) : '');
  const [rateBasis, setRateBasis] = useState<RateBasis>(machine?.rateBasis ?? 'hour');
  // A new machine is taken to run on diesel; one set up before fuel was kept has none until it is said.
  const [fuel, setFuel] = useState<FuelType | ''>(machine ? (machine.fuel ?? '') : 'diesel');
  const [meter, setMeter] = useState(machine ? String(machine.totalHours) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickType(next: MachineType) {
    setType(next);
    // A new machine starts with what its type counts; once picked by hand the unit stays.
    if (!machine && !unitPicked) setUnit(machineTypeDef(machineTypes, next).meterUnit);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const details = {
      type,
      meterUnit: unit,
      fuel: fuel || undefined,
      rate: rate.trim() === '' ? undefined : Number(rate),
      rateBasis,
      name,
      model,
      registrationNo,
      notes,
      active,
    };
    setBusy(true);
    setError(null);
    try {
      if (machine) {
        const reading = meter.trim() !== '' ? Number(meter) : undefined;
        await updateMachine(machine, details, crew, machineTypes, profile, reading);
        toast.success(`${machine.id} යන්ත්‍රයේ විස්තර සුරැකුණා.`);
      } else {
        const number = id.trim();
        if (!MACHINE_ID_PATTERN.test(number)) {
          throw new Error('යන්ත්‍ර අංකය අකුරු, ඉලක්කම්, - සහ _ පමණක් විය යුතුය (උදා: excavator-01).');
        }
        if (machines.has(number)) throw new Error(`${number} යන්ත්‍ර අංකය දැනටමත් භාවිතා වේ.`);
        const reading = meterNumber(meter);
        const bad = meterError(reading);
        if (bad) throw new Error(bad);
        await createMachine(number, details, reading, machineTypes, profile);
        toast.success(`${number} යන්ත්‍රය එකතු කළා.`);
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  // A machine with a crew on it can only be of a type that crew works.
  const crewKind = crew.length > 0 ? machineTypeForRole(crew[0].role) : null;
  const typeChoices = pickableTypes(machineTypes, type).filter((choice) => !crewKind || choice.kind === crewKind);
  if (!typeChoices.some((choice) => choice.id === type)) typeChoices.push(machineTypeDef(machineTypes, type));

  return (
    <>
    <Modal
      open
      title={machine ? `${machine.id} — විස්තර` : 'නව යන්ත්‍රයක්'}
      subtitle={machine ? 'යන්ත්‍රයේ විස්තර සංස්කරණය' : 'යන්ත්‍රය සහ එහි විස්තර එකතු කරන්න. කණ්ඩායමක් පසුව යෙදිය හැක.'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="machine-form" busy={busy}>
            {machine ? 'සුරකින්න' : 'යන්ත්‍රය එකතු කරන්න'}
          </Button>
        </>
      }
    >
      <form id="machine-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="යන්ත්‍ර අංකය" hint={machine ? 'අංකය වෙනස් කළ නොහැක.' : 'උදා: excavator-01 · එක් වරක් දුන් පසු වෙනස් නොවේ.'}>
            <Input
              required
              autoFocus={!machine}
              disabled={!!machine}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="excavator-01"
              value={id}
              onChange={(event) => setId(event.target.value)}
            />
          </Field>
          <Field
            label="වර්ගය"
            hint={
              crew.length > 0
                ? 'කණ්ඩායමක් සිටින නිසා, ඔවුන්ට ගැළපෙන වර්ග පමණක් පෙන්වයි.'
                : 'මෙයින් තීරණය වන්නේ කුමන කණ්ඩායමකට යෙදිය හැකිද යන්නයි.'
            }
          >
            <div className="flex gap-2">
              <Select
                className="min-w-0 flex-1"
                value={type}
                onChange={(event) => pickType(event.target.value)}
              >
                {typeChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                    {choice.english && ` (${choice.english})`}
                  </option>
                ))}
              </Select>
              {profile.role === 'admin' && (
                <IconButton label="වර්ග එකතු කිරීම / සංස්කරණය" onClick={() => setManagingTypes(true)}>
                  <Settings2 className="size-4" />
                </IconButton>
              )}
            </div>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="නම" hint="අංකයට අමතරව යන්ත්‍රය හඳුන්වන නමක් (විකල්ප).">
            <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="මාදිලිය" hint="නිෂ්පාදකයා සහ මාදිලිය — උදා: CAT 320D.">
            <Input value={model} maxLength={100} onChange={(event) => setModel(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ලියාපදිංචි / සීරීස් අංකය">
            <Input value={registrationNo} maxLength={40} onChange={(event) => setRegistrationNo(event.target.value)} />
          </Field>
          <Field label="ඉන්ධන වර්ගය" hint="යන්ත්‍රය ධාවනය වන්නේ පෙට්‍රල් ද ඩීසල් ද යන්න.">
            <Select value={fuel} onChange={(event) => setFuel(event.target.value as FuelType | '')}>
              <option value="">— තෝරා නැත —</option>
              {FUEL_TYPES.map((value) => (
                <option key={value} value={value}>
                  {FUEL_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="දැනට ඇති මීටරය"
          hint={
            machine && crew.length > 0
              ? 'මීටරය අතින් නිවැරදි කළ හැක. කණ්ඩායම ඇතුළත් කරන ඊළඟ කියවීමෙන් එය නැවත යාවත්කාලීන වේ.'
              : unit === 'km'
                ? 'වාහනයේ කිලෝමීටර් මීටරයේ දැනට පෙන්වන අගය.'
                : 'සේවා කාල ගණනය කරන්නේ මෙතැන් සිටයි.'
          }
        >
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1"
              type="number"
              min="0"
              step="any"
              value={meter}
              onChange={(event) => setMeter(event.target.value)}
            />
            <Segmented
              value={unit}
              onChange={(value) => {
                setUnit(value);
                setUnitPicked(true);
              }}
              options={METER_UNITS.map((value) => ({ value, label: METER_UNIT_LABEL[value] }))}
            />
          </div>
        </Field>

        <Field
          label="යන්ත්‍රයට ගාස්තුව (රු.)"
          hint={`මෙම යන්ත්‍රයේ කණ්ඩායම වැඩ කළ ${RATE_BASIS_LABEL[rateBasis].unit} ගණන × මෙම ගාස්තුව, මූල්‍ය වාර්තාවේ වියදමක් ලෙස අඩු වේ.${
            machine && machine.rate == null ? ' තවම නොදුන් නම් පැරණි පැයකට ගාස්තුව භාවිතා වේ.' : ''
          }`}
        >
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            <Segmented
              value={rateBasis}
              onChange={setRateBasis}
              options={RATE_BASES.map((value) => ({ value, label: RATE_BASIS_LABEL[value].per }))}
            />
          </div>
        </Field>

        <Field label="සටහන්">
          <Textarea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        {machine && (
          <Field
            label="තත්ත්වය"
            hint={
              active
                ? undefined
                : 'විශ්‍රාම ගත් යන්ත්‍රයට අලුතින් කිසිවෙකු යෙදිය නොහැක. පැරණි වාර්තා සියල්ල රැඳේ.'
            }
          >
            <Segmented
              value={active ? 'on' : 'off'}
              onChange={(value) => setActive(value === 'on')}
              options={[
                { value: 'on', label: 'ක්‍රියාත්මකයි' },
                { value: 'off', label: 'විශ්‍රාම ගත්' },
              ]}
            />
          </Field>
        )}

        {machine && !active && crew.length > 0 && (
          <p className="rounded-control bg-signal/12 px-3 py-2 text-xs font-semibold text-signal ring-1 ring-signal/30">
            {crew.map(nameOf).join(', ')} තවමත් මෙම යන්ත්‍රයේ සිටී. ඔවුන් වෙනත් යන්ත්‍රයකට යොදන්න.
          </p>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
    {managingTypes && (
      <MachineTypesModal
        onClose={() => setManagingTypes(false)}
        onCreated={(id, made) => {
          // Only a machine with no crew on it can take a type just added.
          if (crew.length > 0) return;
          setType(id);
          if (!unitPicked) setUnit(made.meterUnit);
        }}
      />
    )}
    </>
  );
}

/**
 * The machine types: those built in, and those an admin adds, renames and
 * removes — a lorry, a loader, whatever the yard runs. What a type behaves like
 * is chosen once, when it is added.
 */
export function MachineTypesModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Told the id and behaviour of a type just added, so a form can pick it. */
  onCreated?: (id: string, made: { kind: MachineKind; meterUnit: MeterUnit }) => void;
}) {
  const { profile } = useSession();
  const { machineTypes, machines, people } = useLiveData();
  const toast = useToast();

  const [label, setLabel] = useState('');
  const [english, setEnglish] = useState('');
  const [kind, setKind] = useState<MachineKind>('none');
  // What a no-crew vehicle's meter counts: kilometres, unless it is picked otherwise.
  const [typeUnit, setTypeUnit] = useState<MeterUnit>('km');
  const [typeUnitPicked, setTypeUnitPicked] = useState(false);
  const [editing, setEditing] = useState<
    { id: string; label: string; english: string; kind: MachineKind; meterUnit: MeterUnit } | null
  >(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const meterUnit = typeUnit;
      const id = await createMachineType(label, english, kind, machineTypes, profile, meterUnit);
      toast.success(`${label.trim()} වර්ගය එකතු කළා.`);
      setLabel('');
      setEnglish('');
      onCreated?.(id, { kind, meterUnit });
    });
  }

  function save(type: MachineTypeDef) {
    if (!editing) return;
    void run(async () => {
      await updateMachineType(type, editing, machineTypes, machines.values(), people, profile);
      toast.success(`${editing.label.trim()} වර්ගය සුරැකුණා.`);
      setEditing(null);
    });
  }

  function restore(type: MachineTypeDef) {
    void run(async () => {
      await restoreMachineType(type, profile);
      toast.success(`${type.label} වර්ගය ආපසු ගත්තා.`);
    });
  }

  function remove(type: MachineTypeDef) {
    void run(async () => {
      await deleteMachineType(type, profile);
      toast.success(`${type.label} වර්ගය මැකුවා.`);
      setRemoving(null);
    });
  }

  return (
    <Modal
      open
      title="යන්ත්‍ර වර්ග"
      subtitle="ඕනෑම වාහනයක් — ට්‍රක්, ලෝඩරය, රෝලරය... — වර්ගයක් ලෙස එකතු කරන්න."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          වසන්න
        </Button>
      }
    >
      <SectionLabel>දැනට ඇති වර්ග</SectionLabel>
      <ul className="mb-6 divide-y divide-hairline/60 rounded-card bg-well text-sm">
        {pickableTypes(machineTypes).map((type) => {
          const isEditing = editing?.id === type.id;
          return (
            <li key={type.id} className="px-4 py-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      autoFocus
                      className="min-w-[8rem] flex-1"
                      maxLength={40}
                      value={editing.label}
                      onChange={(event) => setEditing({ ...editing, label: event.target.value })}
                    />
                    <Input
                      className="min-w-[8rem] flex-1"
                      maxLength={40}
                      placeholder="English (optional)"
                      value={editing.english}
                      onChange={(event) => setEditing({ ...editing, english: event.target.value })}
                    />
                  </div>
                  <Select
                    value={editing.kind}
                    disabled={type.builtIn}
                    onChange={(event) => setEditing({ ...editing, kind: event.target.value as MachineKind })}
                  >
                    {MACHINE_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {MACHINE_KIND_LABEL[value]}
                      </option>
                    ))}
                  </Select>
                  <Segmented
                    value={editing.meterUnit}
                    onChange={(value) => setEditing({ ...editing, meterUnit: value })}
                    options={METER_UNITS.map((value) => ({ value, label: `මීටරය: ${METER_UNIT_LABEL[value]}` }))}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setEditing(null)}>
                      අවලංගු
                    </Button>
                    <Button busy={busy} icon={<Check className="size-4" />} onClick={() => save(type)}>
                      සුරකින්න
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {type.label}
                      {type.english && <span className="font-normal text-white/60"> ({type.english})</span>}
                    </p>
                    <p className="text-xs text-white/55">
                      {MACHINE_KIND_LABEL[type.kind]}
                      {type.meterUnit === 'km' && ' · මීටරය km'}
                    </p>
                  </div>
                  {removing === type.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-white/70">මකන්නද?</span>
                      <Button variant="danger" busy={busy} onClick={() => remove(type)}>
                        ඔව්
                      </Button>
                      <Button variant="secondary" onClick={() => setRemoving(null)}>
                        නැත
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <IconButton
                        label="වර්ගය සංස්කරණය"
                        onClick={() => {
                          setRemoving(null);
                          setEditing({
                            id: type.id,
                            label: type.label,
                            english: type.english,
                            kind: type.kind,
                            meterUnit: type.meterUnit,
                          });
                        }}
                      >
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label="වර්ගය මකන්න"
                        onClick={() => {
                          setEditing(null);
                          setRemoving(type.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {[...machineTypes.values()].some((type) => type.hidden) && (
        <>
          <SectionLabel>ඉවත් කළ වර්ග</SectionLabel>
          <ul className="mb-6 divide-y divide-hairline/60 rounded-card bg-well text-sm">
            {[...machineTypes.values()]
              .filter((type) => type.hidden)
              .map((type) => (
                <li key={type.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 font-semibold text-white/70">{type.label}</span>
                  <Button variant="secondary" busy={busy} icon={<RotateCcw className="size-4" />} onClick={() => restore(type)}>
                    ආපසු ගන්න
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}

      <SectionLabel>නව වර්ගයක්</SectionLabel>
      <form onSubmit={add} className="space-y-4 rounded-card bg-well p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="නම">
            <Input required maxLength={40} placeholder="උදා: ට්‍රක් රථය" value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label="English" hint="විකල්ප.">
            <Input maxLength={40} placeholder="Truck" value={english} onChange={(event) => setEnglish(event.target.value)} />
          </Field>
        </div>
        <Field
          label="ක්‍රියා කරන ආකාරය"
          hint="කණ්ඩායමක් යෙදිය හැක්කේද, සේවා කොටස් ගණන් කරන්නේ කුමක් සඳහාද යන්න මෙයින් තීරණය වේ. එක් වරක් දුන් පසු වෙනස් නොවේ."
        >
          <Select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as MachineKind;
              setKind(next);
              // Until picked by hand, a vehicle with no crew counts kilometres and a crewed machine hours.
              if (!typeUnitPicked) setTypeUnit(next === 'none' ? 'km' : 'h');
            }}
          >
            {MACHINE_KINDS.map((value) => (
              <option key={value} value={value}>
                {MACHINE_KIND_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="මීටරය බලන්නේ"
          hint="මෙම වර්ගයේ යන්ත්‍ර / වාහනවල මීටරය ගණන් කරන්නේ කිලෝමීටර් ද පැය ද යන්න. එක් එක් යන්ත්‍රයේදී වෙනස් කළ හැක."
        >
          <Segmented
            value={typeUnit}
            onChange={(value) => {
              setTypeUnit(value);
              setTypeUnitPicked(true);
            }}
            options={METER_UNITS.map((value) => ({ value, label: METER_UNIT_LABEL[value] }))}
          />
        </Field>
        <Button type="submit" icon={<Plus className="size-4" />} busy={busy && !editing && !removing}>
          වර්ගය එකතු කරන්න
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/** Removing a machine — its record and all its hours — for good. */
export function DeleteMachineModal({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { profile } = useSession();
  const { people } = useLiveData();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onMachine = crewOn(machine.id, people);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteMachine(machine, onMachine, profile);
      toast.success(`${machine.id} යන්ත්‍රය මැකුවා.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={`${machine.id} මකන්නද?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button variant="danger" busy={busy} disabled={onMachine.length > 0} onClick={() => void remove()}>
            මකන්න
          </Button>
        </>
      }
    >
      <p className="text-sm text-white/80">
        යන්ත්‍රය සහ එහි වැඩ කළ පැය (මීටරය {meterReading(machine.totalHours, machine.meterUnit)}) සියල්ල සදහටම මැකේ. ආපසු ගත නොහැක.
      </p>
      {onMachine.length > 0 && (
        <p className="mt-3 rounded-control bg-signal/12 px-3 py-2 text-sm font-semibold text-signal ring-1 ring-signal/30">
          {onMachine.map(nameOf).join(', ')} තවමත් මෙම යන්ත්‍රයේ සිටී. ඔවුන්ව වෙනත් යන්ත්‍රයකට මාරු කරන්න.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/** Who is on a machine, and putting someone else on it. */
export function AssignCrewModal({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { profile } = useSession();
  const { crew, people, machineTypes } = useLiveData();
  const toast = useToast();

  const [personId, setPersonId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The live record keeps up with who has just been moved.
  const onMachine = crewOn(machine.id, people);
  const candidates = crew.filter(
    (person) => person.machineId !== machine.id && machineFitsRole(machine, person.role, people, machineTypes),
  );
  const selected = candidates.find((person) => person.id === personId) ?? null;

  async function assign() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await assignMachine(selected, machine, people, machineTypes, profile);
      toast.success(`${nameOf(selected)} ${machine.id} යන්ත්‍රයට යෙදුවා.`);
      setPersonId('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`${machine.id} — කණ්ඩායම`}
      subtitle={machineTitle(machine)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          වසන්න
        </Button>
      }
    >
      <SectionLabel>දැන් මෙම යන්ත්‍රයේ</SectionLabel>
      <ul className="mb-6 space-y-2 rounded-card bg-well p-4 text-sm">
        {onMachine.length === 0 && <li className="text-white/55">කිසිවෙකු නැත.</li>}
        {onMachine.map((person) => (
          <li key={person.id} className="flex items-center justify-between gap-2">
            <span className="font-semibold">{nameOf(person)}</span>
            <Badge tone={person.role === 'compressor' ? 'ok' : 'amber'}>{ROLES[person.role].label}</Badge>
          </li>
        ))}
      </ul>

      <SectionLabel>කණ්ඩායම් සාමාජිකයෙක් යොදන්න</SectionLabel>
      {!machine.active ? (
        <p className="rounded-control bg-signal/12 px-3 py-2 text-sm font-semibold text-signal ring-1 ring-signal/30">
          මෙම යන්ත්‍රය විශ්‍රාම ගෙන ඇත. අලුතින් කිසිවෙකු යෙදීමට පළමුව එය නැවත ක්‍රියාත්මක කරන්න.
        </p>
      ) : (
        <div className="space-y-3 rounded-card bg-well p-4">
          <Field
            label="කණ්ඩායම් සාමාජිකයා"
            hint="දැනට සිටි යන්ත්‍රයේ කළ පැය ඒ යන්ත්‍රයේම රැඳේ; මෙතැන් සිට කරන පැය මෙම යන්ත්‍රයට එකතු වේ."
          >
            <Select value={personId} onChange={(event) => setPersonId(event.target.value)}>
              <option value="">— තෝරන්න —</option>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {nameOf(person)} · {ROLES[person.role].label} · දැන්: {person.machineId || '—'}
                </option>
              ))}
            </Select>
          </Field>
          {candidates.length === 0 && (
            <p className="text-xs text-white/55">මෙම යන්ත්‍රයට යෙදිය හැකි වෙනත් කණ්ඩායම් සාමාජිකයෙක් නැත.</p>
          )}
          <Button icon={<UserPlus className="size-4" />} disabled={!selected} busy={busy} onClick={() => void assign()}>
            මෙම යන්ත්‍රයට යොදන්න
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/** වැඩ කර ඇති පැය — what a machine has worked, by month and by day. */
export function MachineHoursModal({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { people, machineTypes } = useLiveData();
  const today = useToday();
  const month = today.slice(0, 7);

  const months = useMachineMonths(machine.id);
  const days = useMachineDays(machine.id, month);

  // Loads are an excavator's tally and feet a compressor's; a machine of a
  // type with no crew has neither.
  const kind = machineKindOf(machine, people, machineTypes);
  const showLoads = kind == null || kind === 'excavator';
  const showFeet = kind == null || kind === 'compressor';

  const all = months.data ?? [];
  const rows = monthsNewestFirst(all);
  const thisMonth = all.find((entry) => entry.month === month);
  const dayRows = workedDayRows(days.data ?? []);
  const waiting = months.data === undefined && !months.error;

  return (
    <Modal
      open
      size="lg"
      title={`${machine.id} — වැඩ කර ඇති පැය`}
      subtitle={machineTitle(machine)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          වසන්න
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label={machine.meterUnit === 'km' ? 'මීටරය (කිලෝමීටර්)' : 'මීටරය (මුළු පැය)'}
          value={meterReading(machine.totalHours, machine.meterUnit)}
        />
        <Figure label={`මේ මාසය (${monthLabel(month)})`} value={meterReading(thisMonth?.hours ?? 0, machine.meterUnit)} />
        <Figure label="මාස වාර්තා වල එකතුව" value={meterReading(recordedHours(all), machine.meterUnit)} />
      </div>
      <p className="mt-2 px-1 text-xs text-white/55">
        පැය ගණනය වන්නේ ඊළඟ උදේ ON මීටරය ඇතුළත් කළ විට දවස වැසෙන ආකාරයටයි — එබැවින් අද දවසේ පැය හෙට සම්පූර්ණ වේ. මීටරය
        යන්ත්‍රය ආරම්භයේ සිට දැනට පෙන්වන මුළු පැයයි.
      </p>

      <div className="mt-6">
        <SectionLabel>මාසය අනුව</SectionLabel>
        {waiting ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="rounded-card bg-well p-4 text-sm text-white/55">තවම වාර්තා වූ පැය නැත.</p>
        ) : (
          <TableFrame>
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>මාසය</th>
                  <th className={cx(th, 'text-right')}>පැය</th>
                  {showLoads && <th className={cx(th, 'text-right')}>ලෝඩ්</th>}
                  {showFeet && <th className={cx(th, 'text-right')}>අඩි</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month} className="border-b border-hairline/60 last:border-0">
                    <td className={td}>{monthLabel(row.month)}</td>
                    <td className={cx(td, 'text-right font-bold tabular-nums')}>{hours(row.hours)}</td>
                    {showLoads && <td className={cx(td, 'text-right tabular-nums')}>{row.loads || '—'}</td>}
                    {showFeet && <td className={cx(td, 'text-right tabular-nums')}>{row.feet ? hours(row.feet) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </div>

      <div className="mt-6">
        <SectionLabel trailing={<span className="text-xs text-white/55">{monthLabel(month)}</span>}>
          මේ මාසයේ දවස් වලින්
        </SectionLabel>
        {days.data === undefined && !days.error ? (
          <Loading />
        ) : dayRows.length === 0 ? (
          <p className="rounded-card bg-well p-4 text-sm text-white/55">මේ මාසයේ සම්පූර්ණ වූ දවසක් තවම නැත.</p>
        ) : (
          <TableFrame>
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>දිනය</th>
                  <th className={cx(th, 'text-right')}>ON</th>
                  <th className={cx(th, 'text-right')}>OFF</th>
                  <th className={cx(th, 'text-right')}>පැය</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => (
                  <tr key={row.date} className="border-b border-hairline/60 last:border-0">
                    <td className={td}>{row.date}</td>
                    <td className={cx(td, 'text-right tabular-nums text-white/80')}>{hours(row.on)}</td>
                    <td className={cx(td, 'text-right tabular-nums text-white/80')}>{hours(row.off)}</td>
                    <td className={cx(td, 'text-right font-bold tabular-nums')}>{hours(row.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </div>
    </Modal>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-well p-4">
      <p className="text-xs text-white/60">{label}</p>
      <p className="mt-1.5">
        <ValueChip className="text-lg">{value}</ValueChip>
      </p>
    </div>
  );
}
