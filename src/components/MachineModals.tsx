import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { useLiveData } from '../data/LiveData';
import { assignMachine, createMachine, updateMachine, useMachineDays, useMachineMonths } from '../data/machines';
import { errorMessage } from '../lib/errors';
import { hours, monthLabel } from '../lib/format';
import {
  MACHINE_ID_PATTERN,
  crewOn,
  machineFitsRole,
  machineTypeOf,
  monthsNewestFirst,
  recordedHours,
  workedDayRows,
} from '../lib/machines';
import {
  MACHINE_TYPE,
  MACHINE_TYPES,
  ROLES,
  machineTitle,
  nameOf,
  type Machine,
  type MachineType,
} from '../lib/model';
import { useToday } from '../lib/useToday';
import { useToast } from './Toasts';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
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
  const { people, machines } = useLiveData();
  const toast = useToast();

  const crew = machine ? crewOn(machine.id, people) : [];
  // Once a machine has a kind — of its own, or from the crew on it — it keeps
  // it: its crew, its service parts and its history were set up for that kind.
  const knownType = machine ? machineTypeOf(machine, people) : null;
  const typeLocked = knownType != null;

  const [id, setId] = useState(machine?.id ?? '');
  const [type, setType] = useState<MachineType>(knownType ?? 'excavator');
  const [name, setName] = useState(machine?.name ?? '');
  const [model, setModel] = useState(machine?.model ?? '');
  const [registrationNo, setRegistrationNo] = useState(machine?.registrationNo ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [active, setActive] = useState(machine?.active ?? true);
  const [meter, setMeter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const details = { type, name, model, registrationNo, notes, active };
    setBusy(true);
    setError(null);
    try {
      if (machine) {
        await updateMachine(machine, details, crew, profile);
        toast.success(`${machine.id} යන්ත්‍රයේ විස්තර සුරැකුණා.`);
      } else {
        const number = id.trim();
        if (!MACHINE_ID_PATTERN.test(number)) {
          throw new Error('යන්ත්‍ර අංකය අකුරු, ඉලක්කම්, - සහ _ පමණක් විය යුතුය (උදා: excavator-01).');
        }
        if (machines.has(number)) throw new Error(`${number} යන්ත්‍ර අංකය දැනටමත් භාවිතා වේ.`);
        const reading = meterNumber(meter);
        if (!Number.isFinite(reading) || reading < 0) throw new Error('මීටර් පැය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.');
        await createMachine(number, details, reading, profile);
        toast.success(`${number} යන්ත්‍රය එකතු කළා.`);
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
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
            hint={typeLocked ? 'වර්ගය එක් වරක් තෝරා පසු වෙනස් කළ නොහැක.' : 'මෙයින් තීරණය වන්නේ කුමන කණ්ඩායමකට යෙදිය හැකිද යන්නයි.'}
          >
            <Select value={type} disabled={typeLocked} onChange={(event) => setType(event.target.value as MachineType)}>
              {MACHINE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {MACHINE_TYPE[value].label} ({MACHINE_TYPE[value].english})
                </option>
              ))}
            </Select>
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
          {!machine && (
            <Field label="දැනට ඇති මීටර් පැය" hint="සේවා කාල ගණනය කරන්නේ මෙතැන් සිටයි.">
              <Input type="number" min="0" step="any" value={meter} onChange={(event) => setMeter(event.target.value)} />
            </Field>
          )}
        </div>

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
  );
}

/** Who is on a machine, and putting someone else on it. */
export function AssignCrewModal({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { profile } = useSession();
  const { crew, people } = useLiveData();
  const toast = useToast();

  const [personId, setPersonId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The live record keeps up with who has just been moved.
  const onMachine = crewOn(machine.id, people);
  const candidates = crew.filter(
    (person) => person.machineId !== machine.id && machineFitsRole(machine, person.role, people),
  );
  const selected = candidates.find((person) => person.id === personId) ?? null;

  async function assign() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await assignMachine(selected, machine, people, profile);
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
  const { people } = useLiveData();
  const today = useToday();
  const month = today.slice(0, 7);

  const months = useMachineMonths(machine.id);
  const days = useMachineDays(machine.id, month);

  const type = machineTypeOf(machine, people);
  const showLoads = type !== 'compressor';
  const showFeet = type !== 'excavator';

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
        <Figure label="මීටරය (මුළු පැය)" value={hours(machine.totalHours)} />
        <Figure label={`මේ මාසය (${monthLabel(month)})`} value={hours(thisMonth?.hours ?? 0)} />
        <Figure label="මාස වාර්තා වල එකතුව" value={hours(recordedHours(all))} />
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
