import { CalendarDays, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Segmented,
  Select,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useLiveData } from '../data/LiveData';
import { fetchDays } from '../data/machines';
import { errorMessage } from '../lib/errors';
import { addDays, hours, quantity } from '../lib/format';
import {
  FILL_LABEL,
  ROLES,
  dayOffHours,
  dayOnHours,
  nameOf,
  totalFilled,
  workedHours,
  type Day,
} from '../lib/model';
import { useToday } from '../lib/useToday';

type Range = '7' | '30' | '90' | 'custom';

/** ඉතිහාසය — one crew member's recorded days, newest first. */
export function HistoryPage() {
  const { crew, ready } = useLiveData();
  const [params, setParams] = useSearchParams();
  const today = useToday();

  const [range, setRange] = useState<Range>('30');
  const [customFrom, setCustomFrom] = useState(() => addDays(today, -29));
  const [customTo, setCustomTo] = useState(today);

  const personId = params.get('person') ?? crew[0]?.id ?? '';
  const person = crew.find((candidate) => candidate.id === personId) ?? null;
  const from = range === 'custom' ? customFrom : addDays(today, -(Number(range) - 1));
  const to = range === 'custom' ? customTo : today;

  const machineId = person?.machineId ?? '';
  const key = `${machineId}|${from}|${to}`;
  const [loaded, setLoaded] = useState<{ key: string; days: Day[]; error: string | null } | null>(null);

  useEffect(() => {
    if (!machineId) return;
    let live = true;
    fetchDays(machineId, from, to)
      .then((days) => live && setLoaded({ key, days, error: null }))
      .catch((failure) => live && setLoaded({ key, days: [], error: errorMessage(failure) }));
    return () => {
      live = false;
    };
  }, [key, machineId, from, to]);

  if (!ready) return <Loading />;

  const role = person ? ROLES[person.role] : null;
  const current = loaded?.key === key ? loaded : null;
  const days = machineId ? current?.days ?? null : [];

  return (
    <>
      <PageHeader title="ඉතිහාසය" subtitle="පෙර දවස්වල පිරවීම්, මීටර, පරික්ෂාව සහ ලෝඩ් / ආඩි." />

      <Panel tone="deep" className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <Field label="කණ්ඩායම් සාමාජිකයා" className="min-w-56">
          <Select value={personId} onChange={(event) => setParams({ person: event.target.value })}>
            {crew.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {nameOf(candidate)} · {ROLES[candidate.role].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="කාල පරාසය">
          <Segmented<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: 'දින 7' },
              { value: '30', label: 'දින 30' },
              { value: '90', label: 'දින 90' },
              { value: 'custom', label: <CalendarDays className="size-4" aria-label="තෝරන්න" /> },
            ]}
          />
        </Field>
        {range === 'custom' && (
          <>
            <Field label="සිට">
              <Input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} />
            </Field>
            <Field label="දක්වා">
              <Input type="date" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} />
            </Field>
          </>
        )}
      </Panel>

      {!person || !role ? (
        <Panel tone="deep">
          <EmptyState icon={<CalendarDays className="size-7" />} title="කණ්ඩායම් සාමාජිකයෙක් තෝරන්න" />
        </Panel>
      ) : days == null ? (
        <Loading />
      ) : (
        <>
          {current?.error && (
            <div className="mb-4">
              <ErrorNote>{current.error}</ErrorNote>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Total label="දින" value={String(days.length)} />
            <Total label="වැඩ කළ පැය" value={hours(days.reduce((sum, day) => sum + (workedHours(day) ?? 0), 0))} />
            <Total
              label={role.tracksBonus ? 'ලෝඩ්' : 'ආඩි'}
              value={role.tracksBonus ? String(days.reduce((sum, day) => sum + day.loads, 0)) : hours(days.reduce((sum, day) => sum + day.feet, 0))}
            />
            {role.fillItems.map((item) => (
              <Total key={item} label={FILL_LABEL[item]} value={quantity(days.reduce((sum, day) => sum + totalFilled(day, item), 0), 'L')} />
            ))}
          </div>

          <Panel className="p-4 sm:p-5">
            {days.length === 0 ? (
              <EmptyState icon={<CalendarDays className="size-7" />} title="මේ කාලය තුළ වාර්තාවක් නැත" detail="වෙනත් කාල පරාසයක් තෝරන්න." />
            ) : (
              <TableFrame>
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>දිනය</th>
                      <th className={cx(th, 'text-right')}>ON</th>
                      <th className={cx(th, 'text-right')}>OFF</th>
                      <th className={cx(th, 'text-right')}>පැය</th>
                      <th className={cx(th, 'text-right')}>{role.tracksBonus ? 'ලෝඩ්' : 'ආඩි'}</th>
                      {role.fillItems.map((item) => (
                        <th key={item} className={cx(th, 'text-right')}>
                          {FILL_LABEL[item]}
                        </th>
                      ))}
                      <th className={th}>පරික්ෂාව</th>
                      {role.tracksBlasting && <th className={th}>වෙඩි බඩු</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => {
                      const marks = role.inspectionItems.map((item) => day.inspection[item]);
                      const passed = marks.filter((mark) => mark === true).length;
                      const failed = marks.filter((mark) => mark === false).length;
                      const worked = workedHours(day);
                      return (
                        <tr key={day.date} className="border-b border-hairline/60 last:border-0">
                          <td className={cx(td, 'font-bold whitespace-nowrap tabular-nums')}>{day.date}</td>
                          <td className={cx(td, 'text-right tabular-nums')}>{dayOnHours(day) == null ? '—' : hours(dayOnHours(day)!)}</td>
                          <td className={cx(td, 'text-right tabular-nums')}>{dayOffHours(day) == null ? '—' : hours(dayOffHours(day)!)}</td>
                          <td className={cx(td, 'text-right font-bold tabular-nums')}>{worked == null ? '—' : hours(worked)}</td>
                          <td className={cx(td, 'text-right font-bold text-amber-hi tabular-nums')}>
                            {role.tracksBonus ? day.loads : hours(day.feet)}
                          </td>
                          {role.fillItems.map((item) => (
                            <td key={item} className={cx(td, 'text-right tabular-nums')}>
                              {totalFilled(day, item) ? quantity(totalFilled(day, item), 'L') : '—'}
                            </td>
                          ))}
                          <td className={td}>
                            <span className="inline-flex items-center gap-2 text-xs font-bold">
                              <span className="inline-flex items-center gap-0.5 text-lime-hi">
                                <Check className="size-3.5" />
                                {passed}
                              </span>
                              <span className={cx('inline-flex items-center gap-0.5', failed ? 'text-red-300' : 'text-white/40')}>
                                <X className="size-3.5" />
                                {failed}
                              </span>
                              <span className="text-white/45">/ {role.inspectionItems.length}</span>
                            </span>
                          </td>
                          {role.tracksBlasting && (
                            <td className={cx(td, 'text-xs')}>
                              {day.blasting.lockedAt ? `OK · අයිතම ${Object.keys(day.blasting.amounts).length}` : '—'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-well px-4 py-3 ring-1 ring-hairline">
      <p className="truncate text-xs font-semibold text-white/60">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
