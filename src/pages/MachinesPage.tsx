import { Clock, Pencil, Plus, Tractor, Users } from 'lucide-react';
import { useState } from 'react';

import { AssignCrewModal, MachineHoursModal, MachineModal } from '../components/MachineModals';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Loading,
  PageHeader,
  Panel,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useLiveDocs } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { monthRef } from '../data/machines';
import { hours, monthLabel } from '../lib/format';
import { crewOn, machineTypeOf } from '../lib/machines';
import {
  MACHINE_TYPE,
  ROLES,
  monthFrom,
  nameOf,
  serviceAlerts,
  serviceMessage,
  type Machine,
} from '../lib/model';
import { useToday } from '../lib/useToday';

/**
 * යන්ත්‍ර — every machine, with what it is, who is on it, the hours it has
 * worked and where its service stands. The supervisor's phone has the same
 * list; either can set a machine up, put its details right and move a crew
 * member onto it.
 */
export function MachinesPage() {
  const { machines, people, crew, ready } = useLiveData();
  const today = useToday();
  const month = today.slice(0, 7);

  const [editing, setEditing] = useState<Machine | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Machine | null>(null);
  const [viewing, setViewing] = useState<Machine | null>(null);

  // Machines in use first, retired ones after, each by number.
  const list = [...machines.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));
  const monthly = useLiveDocs(
    list.map((machine) => monthRef(machine.id, month)),
    (snapshot) => monthFrom(month, snapshot.data()),
  );

  if (!ready) return <Loading />;

  const hoursThisMonth = (machine: Machine) => monthly[monthRef(machine.id, month).path]?.hours ?? 0;
  const monthTotal = list.reduce((total, machine) => total + hoursThisMonth(machine), 0);
  // Crew whose machine has no record of its own — set up before machines were kept.
  const unlisted = crew.filter((person) => person.machineId && !machines.has(person.machineId));
  // The page may have been told of a machine since it was opened.
  const liveOf = (machine: Machine) => machines.get(machine.id) ?? machine;

  return (
    <>
      <PageHeader
        title="යන්ත්‍ර"
        subtitle="යන්ත්‍රවල විස්තර, ඒවායේ සිටින කණ්ඩායම් සහ වැඩ කර ඇති පැය. සුපවයිසර්ගේ ෆෝනයෙනුත් මෙය කළ හැක."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            නව යන්ත්‍රයක්
          </Button>
        }
      />

      {list.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Tile label="ක්‍රියාත්මක යන්ත්‍ර" value={String(list.filter((machine) => machine.active).length)} />
          <Tile label={`${monthLabel(month)} — මුළු පැය`} value={hours(monthTotal)} />
          <Tile label="යන්ත්‍රයක් සිටින කණ්ඩායම්" value={String(crew.length - unlisted.length)} />
        </div>
      )}

      {unlisted.length > 0 && (
        <p className="mb-5 rounded-control bg-signal/12 px-4 py-3 text-sm font-semibold text-signal ring-1 ring-signal/30">
          {unlisted.map((person) => `${nameOf(person)} (${person.machineId})`).join(', ')} සඳහා යන්ත්‍ර සටහනක් නැත.
          පරිශීලකයින් පිටුවෙන් ඔවුන් සංස්කරණය කර යන්ත්‍රයේ විස්තර එක් කරන්න.
        </p>
      )}

      <Panel className="p-4 sm:p-5">
        {list.length === 0 ? (
          <EmptyState
            icon={<Tractor className="size-7" />}
            title="තවම යන්ත්‍ර නැත"
            detail="යන්ත්‍රයක් එක් කර, එහි විස්තර සහ කණ්ඩායම සටහන් කරන්න."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                නව යන්ත්‍රයක්
              </Button>
            }
          />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>යන්ත්‍රය</th>
                  <th className={th}>වර්ගය</th>
                  <th className={th}>කණ්ඩායම</th>
                  <th className={cx(th, 'text-right')}>මීටරය (පැය)</th>
                  <th className={cx(th, 'text-right')}>මේ මාසය (පැය)</th>
                  <th className={th}>සේවා</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {list.map((machine) => {
                  const type = machineTypeOf(machine, people);
                  const onMachine = crewOn(machine.id, people);
                  const tasks = type ? ROLES[MACHINE_TYPE[type].role].serviceTasks : [];
                  const [alert] = serviceAlerts(machine, tasks);
                  const setUp = tasks.some((task) => machine.serviceDueAt[task] != null);
                  return (
                    <tr
                      key={machine.id}
                      className={cx('border-b border-hairline/60 last:border-0', !machine.active && 'opacity-60')}
                    >
                      <td className={td}>
                        <span className="font-bold">{machine.id}</span>
                        {machine.name && <span className="block text-xs text-white/80">{machine.name}</span>}
                        <span className="block text-xs text-white/55">
                          {[machine.model, machine.registrationNo].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className={td}>
                        {type ? (
                          <Badge tone={type === 'compressor' ? 'ok' : 'amber'}>{MACHINE_TYPE[type].label}</Badge>
                        ) : (
                          <span className="text-white/45">—</span>
                        )}
                        {!machine.active && <Badge className="ml-1.5">විශ්‍රාම ගත්</Badge>}
                      </td>
                      <td className={cx(td, 'text-white/80')}>
                        {onMachine.length === 0 ? <span className="text-white/45">කිසිවෙකු නැත</span> : onMachine.map(nameOf).join(', ')}
                      </td>
                      <td className={cx(td, 'text-right tabular-nums')}>{hours(machine.totalHours)}</td>
                      <td className={cx(td, 'text-right font-bold tabular-nums')}>{hours(hoursThisMonth(machine))}</td>
                      <td className={td}>
                        {!type || tasks.length === 0 ? (
                          <span className="text-white/45">—</span>
                        ) : alert ? (
                          <Badge tone={alert.isDue ? 'out' : 'low'}>{serviceMessage(alert)}</Badge>
                        ) : setUp ? (
                          <Badge tone="ok">සාමාන්‍යයි</Badge>
                        ) : (
                          <Badge>සකසා නැත</Badge>
                        )}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <div className="flex justify-end gap-1">
                          <IconButton label="වැඩ කර ඇති පැය" onClick={() => setViewing(machine)}>
                            <Clock className="size-4" />
                          </IconButton>
                          <IconButton label="කණ්ඩායම" onClick={() => setAssigning(machine)}>
                            <Users className="size-4" />
                          </IconButton>
                          <IconButton label="විස්තර සංස්කරණය" onClick={() => setEditing(machine)}>
                            <Pencil className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/55">
        යන්ත්‍රයක කණ්ඩායමක් යෙදිය හැක්කේ එහි වර්ගයට ගැළපෙන කණ්ඩායමකි — එක්ස්කවේටරයට ඔපරේටර්, කම්පසරයට කම්පසර් කණ්ඩායම.
        කණ්ඩායමක් වෙනත් යන්ත්‍රයකට මාරු කළ විට, කලින් යන්ත්‍රයේ කළ පැය ඒ යන්ත්‍රයේම රැඳේ.
      </p>

      {editing && (
        <MachineModal
          machine={editing === 'new' ? null : liveOf(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {assigning && <AssignCrewModal machine={liveOf(assigning)} onClose={() => setAssigning(null)} />}
      {viewing && <MachineHoursModal machine={liveOf(viewing)} onClose={() => setViewing(null)} />}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card panel-surface px-4 py-3 ring-1 ring-hairline">
      <p className="text-xs text-white/60">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-amber-hi">{value}</p>
    </div>
  );
}
