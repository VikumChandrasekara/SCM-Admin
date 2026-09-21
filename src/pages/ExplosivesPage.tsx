import { Bomb, Lock, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DateStepper } from '../components/DateStepper';
import { StockChangeModal } from '../components/StockModals';
import {
  Badge,
  EmptyState,
  IconButton,
  Loading,
  PageHeader,
  Panel,
  SectionLabel,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useLiveDocs } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { dayRef, fetchDays } from '../data/machines';
import { dateTime, monthBounds, monthLabel, quantity } from '../lib/format';
import {
  BLAST,
  BLAST_ITEMS,
  ROLES,
  STOCK_LABEL,
  dayFrom,
  emptyDay,
  nameOf,
  stockStatus,
  type BlastItem,
  type StoreItem,
} from '../lib/model';
import { useToday } from '../lib/useToday';

/** වෙඩි බඩු — what each compressor crew drew, the month's totals, and the stock left. */
export function ExplosivesPage() {
  const { crew, store, ready } = useLiveData();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [restocking, setRestocking] = useState<StoreItem | null>(null);

  const drillers = useMemo(() => crew.filter((person) => ROLES[person.role].tracksBlasting), [crew]);
  const refs = useMemo(
    () => drillers.filter((person) => person.machineId).map((person) => dayRef(person.machineId, date)),
    [drillers, date],
  );
  const days = useLiveDocs(refs, (snapshot) => dayFrom(date, snapshot.data()));

  const month = date.slice(0, 7);
  const [totals, setTotals] = useState<{ month: string; amounts: Partial<Record<BlastItem, number>> } | null>(null);

  // The month is read again whenever a sheet on the day in view is OK'd, so
  // the totals take it in straight away.
  const signedOff = Object.values(days)
    .map((day) => day.blasting.lockedAt?.getTime() ?? 0)
    .join('|');

  useEffect(() => {
    let live = true;
    const { from, to } = monthBounds(month);
    Promise.all(
      drillers.filter((person) => person.machineId).map((person) => fetchDays(person.machineId, from, to)),
    )
      .then((lists) => {
        if (!live) return;
        const amounts: Partial<Record<BlastItem, number>> = {};
        for (const day of lists.flat()) {
          if (!day.blasting.lockedAt) continue;
          for (const item of BLAST_ITEMS) {
            const value = day.blasting.amounts[item];
            if (value) amounts[item] = (amounts[item] ?? 0) + value;
          }
        }
        setTotals({ month, amounts });
      })
      .catch(() => live && setTotals({ month, amounts: {} }));
    return () => {
      live = false;
    };
  }, [drillers, month, signedOff]);

  if (!ready) return <Loading />;

  const explosives = store.filter((item) => item.link?.startsWith('blast:'));
  const monthTotals = totals?.month === month ? totals.amounts : null;

  return (
    <>
      <PageHeader
        title="වෙඩි බඩු"
        subtitle="කම්පසර් කණ්ඩායම් ලබාගත් පුපුරණ ද්‍රව්‍ය. OK කළ වාර්තා නැවත වෙනස් කළ නොහැක."
        actions={<DateStepper value={date} onChange={setDate} max={today} />}
      />

      {drillers.length === 0 ? (
        <Panel tone="deep">
          <EmptyState icon={<Bomb className="size-7" />} title="කම්පසර් කණ්ඩායම් නැත" />
        </Panel>
      ) : (
        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {drillers.map((person) => {
            const day = (person.machineId ? days[dayRef(person.machineId, date).path] : undefined) ?? emptyDay(date);
            const sheet = day.blasting;
            return (
              <Panel key={person.id} className="p-5">
                <div className="mb-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-extrabold">{nameOf(person)}</p>
                    <p className="text-xs text-white/60">{person.machineId || '—'}</p>
                  </div>
                  {sheet.lockedAt ? (
                    <Badge tone="ok">
                      <Lock className="size-3" /> OK · {dateTime(sheet.lockedAt).slice(11)}
                    </Badge>
                  ) : (
                    <Badge tone={Object.keys(sheet.amounts).length ? 'low' : 'muted'}>තවම OK කර නැත</Badge>
                  )}
                </div>
                <ul className="space-y-1.5 rounded-card bg-well p-3">
                  {BLAST_ITEMS.map((item) => (
                    <li key={item} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white/80">{BLAST[item].label}</span>
                      <b className="tabular-nums">
                        {sheet.amounts[item] != null ? quantity(sheet.amounts[item]!, BLAST[item].unit) : '—'}
                      </b>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionLabel trailing={<span className="text-xs text-white/55">{monthLabel(month)}</span>}>මාසයේ එකතුව</SectionLabel>
          <Panel tone="deep" className="p-4">
            {monthTotals == null ? (
              <Loading />
            ) : (
              <ul className="space-y-2">
                {BLAST_ITEMS.map((item) => (
                  <li key={item} className="flex items-center justify-between gap-3 rounded-xl bg-well px-3 py-2 text-sm">
                    <span>{BLAST[item].label}</span>
                    <b className="tabular-nums">{quantity(monthTotals[item] ?? 0, BLAST[item].unit)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div>
          <SectionLabel>ගබඩාවේ ඉතිරි</SectionLabel>
          <Panel tone="deep" className="p-4">
            {explosives.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/60">
                ගබඩාවේ වෙඩි බඩු අයිතම නැත. ගබඩා පිටුවෙන් "වෙඩි බඩු" භාවිතයට සම්බන්ධ අයිතම එකතු කරන්න.
              </p>
            ) : (
              <TableFrame>
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>අයිතමය</th>
                      <th className={cx(th, 'text-right')}>ඉතිරි</th>
                      <th className={th}>තත්වය</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {explosives.map((item) => {
                      const status = stockStatus(item);
                      return (
                        <tr key={item.id} className="border-b border-hairline/60 last:border-0">
                          <td className={cx(td, 'font-bold')}>{item.name}</td>
                          <td className={cx(td, 'text-right font-extrabold tabular-nums')}>{quantity(item.quantity, item.unit)}</td>
                          <td className={td}>
                            <Badge tone={status}>{STOCK_LABEL[status]}</Badge>
                          </td>
                          <td className={cx(td, 'text-right')}>
                            <IconButton label="තොග එකතු කරන්න" onClick={() => setRestocking(item)}>
                              <Plus className="size-4" />
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Panel>
        </div>
      </div>

      {restocking && <StockChangeModal item={restocking} onClose={() => setRestocking(null)} />}
    </>
  );
}
