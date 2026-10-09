import { collection, query, where } from 'firebase/firestore';
import { Pencil, RotateCcw, Save, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { useMonthBills } from '../data/bills';
import { useLiveDoc, useLiveQuery } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { dayRef, markLeaveWorked, monthRef, resetService, saveFigures, saveTally, setServiceDue } from '../data/machines';
import { db } from '../db';
import { errorMessage } from '../lib/errors';
import { hours, monthBounds, quantity, rupees, signedHours } from '../lib/format';
import {
  ROLES,
  SERVICE,
  WAGE_BASES,
  WAGE_BASIS_LABEL,
  dayFrom,
  dayWorked,
  isPartTask,
  monthFrom,
  nameOf,
  serviceDoneLabel,
  serviceNextLabel,
  serviceStatus,
  tallyField,
  type Person,
  type ServiceTask,
  type WageBasis,
} from '../lib/model';
import { payFor } from '../lib/pay';
import { leaveDatesFor } from '../lib/target';
import { useToday } from '../lib/useToday';
import { useToast } from './Toasts';
import { Button, Field, IconButton, Input, Modal, SectionLabel, Select, ValueChip, cx } from './ui';

/** තොරතුරු — one crew member's figures, and what staff may set on them. */
export function CrewInfoModal({ person, date, onClose }: { person: Person; date: string; onClose: () => void }) {
  const { profile } = useSession();
  const { machines, peopleById, store } = useLiveData();
  const toast = useToast();
  const permissions = permissionsFor(profile);
  const today = useToday();

  // The list handed us a snapshot; the live record keeps up with edits.
  const live = peopleById.get(person.id) ?? person;
  const role = ROLES[live.role];
  const machine = machines.get(live.machineId);
  const day = useLiveDoc(live.machineId ? dayRef(live.machineId, date) : null, (snapshot) =>
    dayFrom(date, snapshot.data()),
  );

  // ලැබිය යුතු මුදල and නිවාඩු ගත් දින ගණන are worked out here, the same way
  // the operator app works them out — never typed in, never stored.
  const month = today.slice(0, 7);
  const bounds = monthBounds(month);
  const monthTally = useLiveDoc(live.machineId ? monthRef(live.machineId, month) : null, (snapshot) =>
    monthFrom(month, snapshot.data()),
  );
  const monthDays = useLiveQuery(
    live.machineId ? `crew-info-days:${live.machineId}:${month}` : null,
    () =>
      query(
        collection(db, 'machines', live.machineId, 'days'),
        where('date', '>=', bounds.from),
        where('date', '<=', bounds.to),
      ),
    (snapshot) => dayFrom(snapshot.id, snapshot.data()),
  );
  const bills = useMonthBills(month);
  const pay =
    monthDays.data && bills.data
      ? payFor(live, monthDays.data, monthTally.data ?? monthFrom(month, undefined), bills.data, day.data ?? null, today)
      : null;

  const [advance, setAdvance] = useState(String(live.advanceAmount));
  const [wage, setWage] = useState(live.dailyWage ? String(live.dailyWage) : '');
  const [wageBasis, setWageBasis] = useState<WageBasis>(live.wageBasis);
  const [tally, setTally] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ServiceTask | null>(null);
  /** The service whose next due meter is being typed in, and what is typed so far. */
  const [dueDraft, setDueDraft] = useState<{ task: ServiceTask; reading: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The leave day being marked worked, and the ON meter typed for it so far. */
  const [leaveDraft, setLeaveDraft] = useState<{ date: string; reading: string } | null>(null);
  const leaveDates = monthDays.data
    ? leaveDatesFor(
        month,
        today,
        monthDays.data.filter(dayWorked).map((entry) => entry.date),
      )
    : [];

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
    const advanceAmount = Number(advance);
    const rate = wage.trim() === '' ? 0 : Number(wage);
    if ([advanceAmount, rate].some((value) => !Number.isFinite(value) || value < 0)) {
      toast.error('අගයන් ඍණ නොවන සංඛ්‍යා විය යුතුය.');
      return;
    }
    void run(
      'info',
      () => saveFigures(live, { advanceAmount, dailyWage: rate, wageBasis }, profile),
      'තොරතුරු සුරැකුණා.',
    );
  }

  function saveDayTally() {
    const value = Number(tally);
    if (tally == null || !Number.isFinite(value) || value < 0) return;
    void run(
      'tally',
      () => saveTally(live.machineId, date, field, whole ? Math.round(value) : value, live, profile),
      `${whole ? 'ලෝඩ්' : 'අඩි'} ගණන සුරැකුණා.`,
    ).then((saved) => saved && setTally(null));
  }

  // Marking a leave day worked is confirmed here, in the list, with the ON
  // meter the crew read off the dash that day — left empty, the day is only
  // marked and the meter and the month's hours stay as they were.
  function markLeave(leaveDate: string, reading: string) {
    const typed = reading.trim();
    const onHours = typed === '' ? null : Number(typed);
    if (onHours != null && (!Number.isFinite(onHours) || onHours < 0)) {
      toast.error('ON මීටරය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.');
      return;
    }
    void run(
      `leave:${leaveDate}`,
      () => markLeaveWorked(live, leaveDate, profile, onHours),
      `${leaveDate} වැඩ කළ දිනයක් ලෙස සටහන් කළා.` + (onHours == null ? '' : ` ON මීටරය ${hours(onHours)}.`),
    ).then((saved) => saved && setLeaveDraft(null));
  }

  function confirmService(task: ServiceTask) {
    if (!machine) return;
    const part = partFor(task);
    void run(
      task,
      () => resetService(machine, task, part, live, profile),
      `${SERVICE[task].short} — ${serviceNextLabel(task)} පැය ${hours(machine.totalHours + SERVICE[task].interval)} දී.` +
        (part ? ` ගබඩාවෙන් ${part.name} 1ක් අඩු කළා.` : ''),
    ).then(() => setConfirming(null));
  }

  // The meter reading a service next falls due at, typed in by hand: how a
  // machine whose 10,000 hour service was never set up gets one, and how one
  // whose real last service was at another reading is put right.
  function saveDue(task: ServiceTask, reading: string) {
    if (!machine) return;
    const dueAt = Number(reading);
    if (reading.trim() === '' || !Number.isFinite(dueAt) || dueAt < 0) {
      toast.error('මීටර් පැය ඍණ නොවන සංඛ්‍යාවක් විය යුතුය.');
      return;
    }
    void run(
      `due:${task}`,
      () => setServiceDue(machine, task, dueAt, profile),
      `${SERVICE[task].short} — ${serviceNextLabel(task)} පැය ${hours(dueAt)} දී.`,
    ).then((saved) => saved && setDueDraft(null));
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
            <Field label="ඇඩ්වාන්ස් ගණන (රු.)" hint="ඇඩ්වාන්ස් බිල්පත් එකතු කරන විට මෙය ස්වයංක්‍රීයව වැඩි වේ.">
              <Input type="number" min="0" step="any" value={advance} onChange={(event) => setAdvance(event.target.value)} />
            </Field>
            <Field label="පඩිය ගණනය කරන්නේ" hint="වැඩ කළ දින, යන්ත්‍රය ධාවනය වූ පැය, අඩි, හෝ ලෝඩ් ගණනින්.">
              <Select value={wageBasis} onChange={(event) => setWageBasis(event.target.value as WageBasis)}>
                {WAGE_BASES.map((id) => (
                  <option key={id} value={id}>
                    {WAGE_BASIS_LABEL[id].per}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`පඩිය (රු.) — ${WAGE_BASIS_LABEL[wageBasis].per}`} hint="මාසයේ මුදල් ගණනයටත්, යෙදුමේ දවසේ පඩිය පෙන්වීමටත් යොදයි.">
              <Input type="number" min="0" step="any" value={wage} onChange={(event) => setWage(event.target.value)} />
            </Field>
            <Button icon={<Save className="size-4" />} busy={busy === 'info'} onClick={saveInfo} className="w-full">
              තොරතුරු සුරකින්න
            </Button>
          </div>

          <SectionLabel>
            <span className="mt-5 block">මේ මාසය — ස්වයංක්‍රීයව ගණනය කළ</span>
          </SectionLabel>
          <div className="space-y-2 rounded-card bg-well p-4 text-sm">
            <p className="flex justify-between">
              <span className="text-white/70">නිවාඩු ගත් දින ගණන</span>
              <b>{pay ? pay.leaveDays : '—'}</b>
            </p>
            <p className="flex justify-between">
              <span className="text-white/70">වැඩ කළ දින</span>
              <b>{pay ? pay.workedDays : '—'}</b>
            </p>
            <p className="flex justify-between border-t border-hairline pt-2">
              <span className="font-semibold text-white/85">ලැබිය යුතු මුදල</span>
              <b className={cx('font-extrabold', pay && pay.net < 0 && 'text-red-300')}>
                {pay ? rupees(pay.net) : '—'}
              </b>
            </p>
            {permissions.setRates && (
              <Link to="/users" className="inline-block pt-1 text-xs font-bold text-amber-hi hover:underline">
                පරිශීලකයින් පිටුවෙන් වෙනස් කරන්න →
              </Link>
            )}
          </div>
          <SectionLabel>
            <span className="mt-5 block">නිවාඩු දින</span>
          </SectionLabel>
          <div className="space-y-2 rounded-card bg-well p-4 text-sm">
            {leaveDates.length === 0 && <p className="text-white/55">මේ මාසයේ නිවාඩු දින නැත.</p>}
            {leaveDates.map((leaveDate) =>
              leaveDraft?.date === leaveDate ? (
                <div key={leaveDate} className="space-y-2 rounded-xl bg-black/20 p-3">
                  <p className="font-semibold">{leaveDate} — වැඩ කළ දිනයක් ලෙස සටහන් කරන්නද?</p>
                  <Field
                    label="ON මීටරය (පැය)"
                    hint={
                      (machine ? `යන්ත්‍රයේ මීටරය දැනට ${hours(machine.totalHours)}. ` : '') +
                      'ඇතුළත් කළොත් කලින් දවස වසා මාසයේ පැය වැඩි වේ; හිස්ව තැබුවොත් මීටරය වෙනස් නොවේ.'
                    }
                  >
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      autoFocus
                      value={leaveDraft.reading}
                      onChange={(event) => setLeaveDraft({ date: leaveDate, reading: event.target.value })}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setLeaveDraft(null)}>
                      අවලංගු
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      busy={busy === `leave:${leaveDate}`}
                      onClick={() => markLeave(leaveDate, leaveDraft.reading)}
                    >
                      සටහන් කරන්න
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={leaveDate} className="flex items-center justify-between gap-2">
                  <span>{leaveDate}</span>
                  <Button size="sm" variant="secondary" onClick={() => setLeaveDraft({ date: leaveDate, reading: '' })}>
                    වැඩ කළා
                  </Button>
                </div>
              ),
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
                <li key={task} className="space-y-2">
                  {/* Wraps rather than squeezing the name: with the pencil, the chip and the
                      button this row is wider than the column. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <Wrench className={cx('size-4 shrink-0', alert ? 'text-signal' : 'text-white/55')} />
                    <span className="min-w-[7rem] flex-1 text-sm">{SERVICE[task].short}</span>
                    <ValueChip tone={alert ? 'signal' : 'amber'} className="text-xs">
                      {status ? signedHours(status.remaining) : '—'}
                    </ValueChip>
                    {machine && (
                      <IconButton
                        label={`${serviceNextLabel(task)} මීටරය සකසන්න`}
                        className="size-7"
                        onClick={() =>
                          setDueDraft({ task, reading: String(machine.serviceDueAt[task] ?? '') })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                    )}
                    {machine &&
                      (confirming === task ? (
                        <Button
                          size="sm"
                          variant="success"
                          className="ml-auto"
                          busy={busy === task}
                          onClick={() => confirmService(task)}
                        >
                          තහවුරු කරන්න
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="ml-auto"
                          icon={<RotateCcw className="size-3.5" />}
                          onClick={() => setConfirming(task)}
                        >
                          {serviceDoneLabel(task)}
                        </Button>
                      ))}
                  </div>
                  {machine && dueDraft?.task === task && (
                    <div className="space-y-2 rounded-xl bg-black/20 p-3">
                      <Field
                        label={`${serviceNextLabel(task)} කළ යුතු මීටරය (පැය)`}
                        hint={`යන්ත්‍රයේ මීටරය දැනට ${hours(machine.totalHours)}. අවසන් වරට කළ මීටරයට පැය ${SERVICE[task].interval} ක් එකතු කර ඇතුළත් කරන්න.`}
                      >
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          autoFocus
                          value={dueDraft.reading}
                          onChange={(event) => setDueDraft({ task, reading: event.target.value })}
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setDueDraft(null)}>
                          අවලංගු
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          busy={busy === `due:${task}`}
                          onClick={() => saveDue(task, dueDraft.reading)}
                        >
                          සුරකින්න
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {confirming && (
              <li className="rounded-xl bg-black/20 px-3 py-2 text-xs text-white/80">
                {!isPartTask(confirming)
                  ? `තහවුරු කළ විට ${serviceNextLabel(confirming)} පැය ${hours((machine?.totalHours ?? 0) + SERVICE[confirming].interval)} දී යොදයි.`
                  : confirmingPart
                    ? `තහවුරු කළ විට ගබඩාවෙන් ${confirmingPart.name} 1ක් අඩු වේ (දැනට ${quantity(confirmingPart.quantity, confirmingPart.unit)}).`
                    : 'ගබඩාවේ මෙම කොටසට සම්බන්ධ අයිතමයක් නැත — තොගය අඩු නොවේ.'}{' '}
                <button type="button" className="font-bold text-amber-hi hover:underline" onClick={() => setConfirming(null)}>
                  අවලංගු
                </button>
              </li>
            )}
            {role.serviceTasks.length > 0 && (
              <li className="pt-1 text-xs text-white/55">
                "මාරු කළා" / "සේවාව කළා" එබූ විට, ඊළඟ වාරය දැනට ඇති මීටරයට පැය {SERVICE.engineOil.interval} /{' '}
                {SERVICE.hydraulicFilter.interval} / {SERVICE.majorService.interval} කට පසු යොදයි. පැන්සල් අයිකනයෙන්
                ඊළඟ වාරයේ මීටරය අතින් සකසන්න.
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
