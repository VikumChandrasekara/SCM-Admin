import { RotateCcw, Save, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { useLiveDoc } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { dayRef, resetService, saveFigures, saveTally } from '../data/machines';
import { errorMessage } from '../lib/errors';
import { hours, quantity, rupees, signedHours } from '../lib/format';
import {
  PAY_BASIS_LABEL,
  ROLES,
  SERVICE,
  dayFrom,
  nameOf,
  paidPerLoad,
  rateOf,
  serviceStatus,
  tallyField,
  type Person,
  type ServiceTask,
} from '../lib/model';
import { useToast } from './Toasts';
import { Button, Field, Input, Modal, SectionLabel, ValueChip, cx } from './ui';

/** තොරතුරු — one crew member's figures, and what staff may set on them. */
export function CrewInfoModal({ person, date, onClose }: { person: Person; date: string; onClose: () => void }) {
  const { profile } = useSession();
  const { machines, peopleById, store } = useLiveData();
  const toast = useToast();
  const permissions = permissionsFor(profile);

  // The list handed us a snapshot; the live record keeps up with edits.
  const live = peopleById.get(person.id) ?? person;
  const role = ROLES[live.role];
  const machine = machines.get(live.machineId);
  const day = useLiveDoc(live.machineId ? dayRef(live.machineId, date) : null, (snapshot) =>
    dayFrom(date, snapshot.data()),
  );

  const [leave, setLeave] = useState(String(live.leaveDays));
  const [advance, setAdvance] = useState(String(live.advanceAmount));
  const [receivable, setReceivable] = useState(String(live.receivableAmount));
  const [bonus, setBonus] = useState(String(live.bonusTotal));
  const [tally, setTally] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ServiceTask | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Loads for an excavator crew and for a compressor crew paid per load, අඩි
  // for the rest.
  const field = tallyField(live);
  const whole = field === 'loads';
  const storedTally = day.data ? day.data[field] : 0;

  /** The store item fitted for [task], when the store stocks one. */
  const partFor = (task: ServiceTask) => store.find((item) => item.link === `service:${task}`) ?? null;
  const confirmingPart = confirming ? partFor(confirming) : null;

  async function run(key: string, action: () => Promise<void>, done: string): Promise<boolean> {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      return true;
    } catch (failure) {
      toast.error(errorMessage(failure));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function saveInfo() {
    const figures = {
      leaveDays: Number(leave),
      advanceAmount: Number(advance),
      receivableAmount: Number(receivable),
      bonusTotal: Number(bonus),
    };
    if (Object.values(figures).some((value) => !Number.isFinite(value) || value < 0)) {
      toast.error('අගයන් ඍණ නොවන සංඛ්‍යා විය යුතුය.');
      return;
    }
    void run('info', () => saveFigures(live.id, { ...figures, leaveDays: Math.round(figures.leaveDays) }), 'තොරතුරු සුරැකුණා.');
  }

  function saveDayTally() {
    const value = Number(tally);
    if (tally == null || !Number.isFinite(value) || value < 0) return;
    void run(
      'tally',
      () => saveTally(live.machineId, date, field, whole ? Math.round(value) : value),
      `${whole ? 'ලෝඩ්' : 'අඩි'} ගණන සුරැකුණා.`,
    ).then((saved) => saved && setTally(null));
  }

  function confirmService(task: ServiceTask) {
    if (!machine) return;
    const part = partFor(task);
    void run(
      task,
      () => resetService(machine, task, part, live, profile),
      `${SERVICE[task].short} — ඊළඟ මාරුව පැය ${hours(machine.totalHours + SERVICE[task].interval)} දී.` +
        (part ? ` ගබඩාවෙන් ${part.name} 1ක් අඩු කළා.` : ''),
    ).then(() => setConfirming(null));
  }

  return (
    <Modal
      open
      size="lg"
      title={nameOf(live)}
      subtitle={`${role.label} · ${live.machineId || 'යන්ත්‍රයක් නැත'}${machine ? ` · මීටරය පැය ${hours(machine.totalHours)}` : ''}`}
      onClose={onClose}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <SectionLabel>තොරතුරු</SectionLabel>
          <div className="space-y-3 rounded-card bg-well p-4">
            <Field label="නිවාඩු ගත් දින ගණන">
              <Input type="number" min="0" step="1" value={leave} onChange={(event) => setLeave(event.target.value)} />
            </Field>
            <Field label="ඇඩ්වාන්ස් ගණන (රු.)" hint="ඇඩ්වාන්ස් බිල්පත් එකතු කරන විට මෙය ස්වයංක්‍රීයව වැඩි වේ.">
              <Input type="number" min="0" step="any" value={advance} onChange={(event) => setAdvance(event.target.value)} />
            </Field>
            <Field
              label="ලැබිය යුතු මුදල (රු.)"
              hint={
                Number(receivable) > 0
                  ? `ඇඩ්වාන්ස් අඩු කළ පසු කණ්ඩායමට පෙනෙන්නේ: ${rupees(Number(receivable) - Number(advance))}`
                  : 'අගයක් දමන තුරු කණ්ඩායමට මෙය නොපෙනේ.'
              }
            >
              <Input type="number" min="0" step="any" value={receivable} onChange={(event) => setReceivable(event.target.value)} />
            </Field>
            {role.tracksBonus && (
              <Field label="බෝනස් මුදල් එකතුව (රු.)">
                <Input type="number" min="0" step="any" value={bonus} onChange={(event) => setBonus(event.target.value)} />
              </Field>
            )}
            <Button icon={<Save className="size-4" />} busy={busy === 'info'} onClick={saveInfo} className="w-full">
              තොරතුරු සුරකින්න
            </Button>
          </div>

          <SectionLabel>
            <span className="mt-5 block">පඩි ගාස්තු</span>
          </SectionLabel>
          <div className="space-y-2 rounded-card bg-well p-4 text-sm">
            <p className="flex justify-between">
              <span className="text-white/70">දවසේ පඩිය</span>
              <b>{live.dailyWage > 0 ? rupees(live.dailyWage) : '—'}</b>
            </p>
            {!role.tracksBonus && (
              <p className="flex justify-between">
                <span className="text-white/70">
                  {paidPerLoad(live) ? 'ලෝඩ් එකක ගාස්තුව' : 'අඩියක ගාස්තුව'}
                </span>
                <b>{rateOf(live) > 0 ? `${rupees(rateOf(live))} (${PAY_BASIS_LABEL[live.payBasis].per})` : '—'}</b>
              </p>
            )}
            {permissions.setRates && (
              <Link to="/users" className="inline-block pt-1 text-xs font-bold text-amber-hi hover:underline">
                පරිශීලකයින් පිටුවෙන් වෙනස් කරන්න →
              </Link>
            )}
          </div>
        </div>

        <div>
          <SectionLabel trailing={<span className="text-xs text-white/55">{date}</span>}>
            {whole ? 'පැටවූ ලෝඩ් ගණන' : 'අඩි ගණන'}
          </SectionLabel>
          <div className="flex items-end gap-2 rounded-card bg-well p-4">
            <Field label="මෙම දිනයට" className="flex-1">
              <Input
                type="number"
                min="0"
                step={whole ? '1' : 'any'}
                value={tally ?? String(storedTally)}
                onChange={(event) => setTally(event.target.value)}
                disabled={!live.machineId}
              />
            </Field>
            <Button
              busy={busy === 'tally'}
              disabled={tally == null || Number(tally) === storedTally}
              onClick={saveDayTally}
            >
              සුරකින්න
            </Button>
          </div>
          <p className="mt-2 px-1 text-xs text-white/55">
            මෙය සකසන්නේ සුපවයිසර් / පරිපාලක පමණි — මාසයේ එකතුව වෙනස වන ප්‍රමාණයෙන් යාවත්කාලීන වේ.
          </p>

          <SectionLabel>
            <span className="mt-5 block">සේවා</span>
          </SectionLabel>
          <ul className="space-y-2 rounded-card bg-well p-4">
            {role.serviceTasks.map((task) => {
              const status = serviceStatus(machine, task);
              const alert = !!status && (status.isDue || status.isDueSoon);
              return (
                <li key={task} className="flex items-center gap-2">
                  <Wrench className={cx('size-4 shrink-0', alert ? 'text-signal' : 'text-white/55')} />
                  <span className="flex-1 text-sm">{SERVICE[task].short}</span>
                  <ValueChip tone={alert ? 'signal' : 'amber'} className="text-xs">
                    {status ? signedHours(status.remaining) : '—'}
                  </ValueChip>
                  {machine &&
                    (confirming === task ? (
                      <Button size="sm" variant="success" busy={busy === task} onClick={() => confirmService(task)}>
                        තහවුරු කරන්න
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => setConfirming(task)}
                      >
                        මාරු කළා
                      </Button>
                    ))}
                </li>
              );
            })}
            {confirming && (
              <li className="rounded-xl bg-black/20 px-3 py-2 text-xs text-white/80">
                {confirmingPart
                  ? `තහවුරු කළ විට ගබඩාවෙන් ${confirmingPart.name} 1ක් අඩු වේ (දැනට ${quantity(confirmingPart.quantity, confirmingPart.unit)}).`
                  : 'ගබඩාවේ මෙම කොටසට සම්බන්ධ අයිතමයක් නැත — තොගය අඩු නොවේ.'}{' '}
                <button type="button" className="font-bold text-amber-hi hover:underline" onClick={() => setConfirming(null)}>
                  අවලංගු
                </button>
              </li>
            )}
            {role.serviceTasks.length > 0 && (
              <li className="pt-1 text-xs text-white/55">
                "මාරු කළා" එබූ විට, ඊළඟ මාරුව දැනට ඇති මීටරයට පැය {SERVICE.engineOil.interval} /{' '}
                {SERVICE.hydraulicFilter.interval} කට පසු යොදයි.
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
