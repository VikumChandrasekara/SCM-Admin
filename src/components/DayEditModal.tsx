import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveDayEdit } from '../data/dayEdit';
import { useLiveData } from '../data/LiveData';
import { fetchDays } from '../data/machines';
import { draftOf, editError, editLines, neighboursOf, planMeters, type DayEdit } from '../lib/dayEdit';
import { errorMessage } from '../lib/errors';
import { addDays, hours } from '../lib/format';
import {
  FILL_LABEL,
  INSPECTION_LABEL,
  ROLES,
  dayOnHours,
  nameOf,
  tallyField,
  type Day,
  type FillItem,
  type InspectionItem,
  type Person,
} from '../lib/model';
import { useToast } from './Toasts';
import { Badge, Button, ErrorNote, Field, Input, Loading, Modal, SectionLabel, Select, cx } from './ui';

type Mark = '' | 'yes' | 'no';

const WINDOW_DAYS = 31;

/** An input's text as a figure: empty is none, anything unreadable is NaN. */
const figure = (text: string): number | null => (text.trim() === '' ? null : Number(text));

const markOf = (mark: boolean | null | undefined): Mark => (mark === true ? 'yes' : mark === false ? 'no' : '');

/**
 * දවසක් සංස්කරණය — one recorded day put right: its meters, ලෝඩ් / අඩි, the
 * amounts filled and the inspection marks. Open to the supervisor and the
 * admin; firestore.rules lets no one else touch an OK'd පිරවීම. What else
 * moves with a figure — the day before's closing meter, the month's hours, the
 * store — is worked out and written with it (see data/dayEdit.ts).
 */
export function DayEditModal({
  person,
  day,
  onClose,
  onSaved,
}: {
  person: Person;
  day: Day;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useSession();
  const { machines } = useLiveData();
  const toast = useToast();
  const role = ROLES[person.role];
  const field = tallyField(person);
  const machineHours = machines.get(person.machineId)?.totalHours ?? 0;

  // The days around it: the readings this day's own have to sit between.
  const [around, setAround] = useState<Day[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchDays(person.machineId, addDays(day.date, -WINDOW_DAYS), addDays(day.date, WINDOW_DAYS)).then(
      (days) => live && setAround(days),
      () => live && setAround([]),
    );
    return () => {
      live = false;
    };
  }, [person.machineId, day.date]);

  const start = useMemo(() => draftOf(day, field, role), [day, field, role]);
  const [on, setOn] = useState(start.onHours == null ? '' : String(start.onHours));
  const [off, setOff] = useState(start.offHours == null ? '' : String(start.offHours));
  const [tally, setTally] = useState(String(start.tally));
  const [amounts, setAmounts] = useState<Record<number, Partial<Record<FillItem, string>>>>(() =>
    Object.fromEntries(
      day.fillings.map((filling) => [
        filling.slot,
        Object.fromEntries(
          role.fillItems.map((item) => [item, filling.amounts[item] == null ? '' : String(filling.amounts[item])]),
        ),
      ]),
    ),
  );
  const [marks, setMarks] = useState<Partial<Record<InspectionItem, Mark>>>(() =>
    Object.fromEntries(role.inspectionItems.map((item) => [item, markOf(day.inspection[item])])),
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { next } = neighboursOf(around ?? [], day.date);
  // The OFF is the next morning's ON whenever there is one.
  const offFollowsNext = next != null && dayOnHours(next) != null;

  const edit: DayEdit = {
    onHours: figure(on),
    offHours: figure(off),
    tally: figure(tally) ?? 0,
    fillings: Object.fromEntries(
      day.fillings.map((filling) => [
        filling.slot,
        Object.fromEntries(
          role.fillItems
            .map((item) => [item, figure(amounts[filling.slot]?.[item] ?? '')] as const)
            .filter(([, value]) => value != null),
        ),
      ]),
    ),
    inspection: Object.fromEntries(
      role.inspectionItems.map((item) => [item, marks[item] === 'yes' ? true : marks[item] === 'no' ? false : null]),
    ),
  };

  const readable = [edit.onHours, edit.offHours, edit.tally, ...Object.values(edit.fillings).flatMap(Object.values)].every(
    (value) => value == null || !Number.isNaN(value),
  );
  const lines = readable ? editLines(day, edit, field) : [];

  // What the edit would be refused for, worked out as it is typed.
  let problem: string | null = null;
  let moves: [string, number][] = [];
  if (!readable) {
    problem = 'අගයන් අංක විය යුතුය';
  } else {
    problem = editError(edit);
    if (!problem && around) {
      const { previous, next: following } = neighboursOf(around, day.date);
      const planned = planMeters({ day, previous, next: following, around, machineHours }, edit.onHours, edit.offHours);
      problem = planned.error ?? null;
      if (planned.plan) moves = [...planned.plan.monthHours].filter(([, delta]) => delta !== 0);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problem || lines.length === 0) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await saveDayEdit(person, day.date, edit, profile);
      toast.success(`${day.date} සටහන් යාවත්කාලීන කළා.`);
      onSaved();
    } catch (failure) {
      setSubmitError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="දවස සංස්කරණය"
      subtitle={`${nameOf(person)} · ${role.label} · ${day.date}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="day-edit-form" busy={busy} disabled={lines.length === 0 || problem != null || !around}>
            සුරකින්න
          </Button>
        </>
      }
    >
      {!around ? (
        <Loading />
      ) : (
        <form id="day-edit-form" onSubmit={submit} className="space-y-6">
          <section>
            <SectionLabel>මීටර සහ {field === 'loads' ? 'ලෝඩ්' : 'අඩි'}</SectionLabel>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="ON මීටරය">
                <Input type="number" inputMode="decimal" step="any" min="0" value={on} onChange={(event) => setOn(event.target.value)} />
              </Field>
              <Field
                label="OFF මීටරය"
                hint={offFollowsNext ? 'පසු දවසේ ON මීටරයයි — එය වෙනස් කිරීමට පසු දවස සංස්කරණය කරන්න.' : undefined}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={off}
                  disabled={offFollowsNext}
                  onChange={(event) => setOff(event.target.value)}
                />
              </Field>
              <Field label={field === 'loads' ? 'ලෝඩ් ගණන' : 'අඩි ගණන'}>
                <Input
                  type="number"
                  inputMode="decimal"
                  step={field === 'loads' ? '1' : 'any'}
                  min="0"
                  value={tally}
                  onChange={(event) => setTally(event.target.value)}
                />
              </Field>
            </div>
          </section>

          <section>
            <SectionLabel>පිරවීම් (ලීටර්)</SectionLabel>
            {day.fillings.length === 0 ? (
              <p className="text-sm text-white/60">මේ දවසේ පිරවීමක් සටහන් වී නැත.</p>
            ) : (
              <div className="space-y-3">
                {day.fillings.map((filling) => (
                  <div key={filling.slot} className="rounded-card bg-well p-3 ring-1 ring-hairline">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      පිරවීම {filling.slot}
                      {filling.lockedAt && (
                        <Badge tone="muted">
                          <Lock className="size-3" />
                          OK කළා
                        </Badge>
                      )}
                    </div>
                    <div className={cx('grid gap-3', role.fillItems.length > 3 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
                      {role.fillItems.map((item) => (
                        <Field key={item} label={FILL_LABEL[item]}>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            value={amounts[filling.slot]?.[item] ?? ''}
                            onChange={(event) =>
                              setAmounts({
                                ...amounts,
                                [filling.slot]: { ...amounts[filling.slot], [item]: event.target.value },
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-white/60">
                  OK කළ පිරවීමක ප්‍රමාණය වෙනස් කළොත්, ඒ ඩීසල් / ඔයිල් කලින් ගබඩාවෙන් අඩු වී තිබුණා නම් ගබඩා තොගය වෙනසට ගැලපේ.
                </p>
              </div>
            )}
          </section>

          <section>
            <SectionLabel>පරික්ෂාව</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              {role.inspectionItems.map((item) => (
                <Field key={item} label={INSPECTION_LABEL[item]}>
                  <Select value={marks[item] ?? ''} onChange={(event) => setMarks({ ...marks, [item]: event.target.value as Mark })}>
                    <option value="">— සටහනක් නැත</option>
                    <option value="yes">✓ හරි</option>
                    <option value="no">✗ අඩුපාඩුවක්</option>
                  </Select>
                </Field>
              ))}
            </div>
            {role.tracksBlasting && <p className="mt-3 text-xs text-white/60">වෙඩි බඩු පත්‍රිකාව මෙතැනින් වෙනස් කළ නොහැක.</p>}
          </section>

          {problem && <ErrorNote>{problem}</ErrorNote>}
          {submitError && <ErrorNote>{submitError}</ErrorNote>}

          {lines.length > 0 && !problem && (
            <section className="rounded-card bg-well p-3 ring-1 ring-hairline">
              <p className="mb-1.5 text-xs font-bold tracking-wide text-white/60 uppercase">සුරැකෙන වෙනස්කම්</p>
              <ul className="space-y-0.5 text-sm">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {moves.length > 0 && (
                <p className="mt-2 text-xs text-white/55">
                  මාසික පැය ගැලපේ:{' '}
                  {moves.map(([month, delta]) => `${month} ${delta > 0 ? '+' : '−'}${hours(Math.abs(delta))}`).join(', ')} — කලින් දවසේ OFF
                  සහ යන්ත්‍රයේ මීටරයත් ඒ සමඟ ගැලපේ.
                </p>
              )}
            </section>
          )}
        </form>
      )}
    </Modal>
  );
}
