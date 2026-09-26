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
  METRES_PER_FOOT,
  ROLES,
  SIZED_ITEMS,
  SIZED_LABEL,
  STOCK_LABEL,
  blastMetres,
  dayFrom,
  emptyDay,
  nameOf,
  sizeLines,
  stockStatus,
  type BlastItem,
  type SizeQuantities,
  type SizedItem,
  type StoreItem,
} from '../lib/model';
import { useToday } from '../lib/useToday';

/**
 * An amount with its unit. The wire is counted in අඩි, so it also carries the
 * conversion to metres, worked through: `100 ft × 0.3048 = 30.48 m`.
 */
function BlastValue({ item, amount }: { item: BlastItem; amount: number | undefined }) {
  if (amount == null) return <b className="tabular-nums">—</b>;
  const metres = blastMetres(item, amount);
  return (
    <span className="text-right">
      <b className="tabular-nums">{quantity(amount, BLAST[item].unit)}</b>
      {metres != null && (
        <span className="block text-xs font-normal text-white/60 tabular-nums">
          {quantity(amount, 'ft')} × {METRES_PER_FOOT} = {quantity(metres, 'm')}
        </span>
      )}
    </span>
  );
}

/**
 * බිට් and කටු, one line per size: `36 — 4`. Nothing drawn is a dash, like the
 * single-figure items around it.
 */
function SizedLines({ sizes }: { sizes: Partial<Record<SizedItem, SizeQuantities>> }) {
  return (
    <>
      {SIZED_ITEMS.map((item) => {
        const lines = sizeLines(sizes[item]);
        return (
          <li key={item} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/80">{SIZED_LABEL[item]}</span>
              {lines.length === 0 && <b className="tabular-nums">—</b>}
            </div>
            {lines.length > 0 && (
              <ul className="mt-1 space-y-1 pl-3">
                {lines.map(([size, count]) => (
                  <li key={size} className="flex items-center justify-between gap-3 text-white/85">
                    <span>සයිස් {quantity(size)}</span>
                    <b className="tabular-nums">{count}</b>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

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
  const [totals, setTotals] = useState<{
    month: string;
    amounts: Partial<Record<BlastItem, number>>;
    sizes: Partial<Record<SizedItem, SizeQuantities>>;
  } | null>(null);

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
        const sizes: Partial<Record<SizedItem, SizeQuantities>> = {};
        for (const day of lists.flat()) {
          if (!day.blasting.lockedAt) continue;
          for (const item of BLAST_ITEMS) {
            const value = day.blasting.amounts[item];
            if (value) amounts[item] = (amounts[item] ?? 0) + value;
          }
          for (const item of SIZED_ITEMS) {
            for (const [size, count] of Object.entries(day.blasting.sizes[item] ?? {})) {
              const bucket = (sizes[item] ??= {});
              bucket[size] = (bucket[size] ?? 0) + count;
            }
          }
        }
        setTotals({ month, amounts, sizes });
      })
      .catch(() => live && setTotals({ month, amounts: {}, sizes: {} }));
    return () => {
      live = false;
    };
  }, [drillers, month, signedOff]);

  if (!ready) return <Loading />;

  const explosives = store.filter((item) => item.link?.startsWith('blast:'));
  const monthTotals = totals?.month === month ? totals.amounts : null;
  const monthSizes = totals?.month === month ? totals.sizes : {};

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
                      <BlastValue item={item} amount={sheet.amounts[item]} />
                    </li>
                  ))}
                  <SizedLines sizes={sheet.sizes} />
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
                    <BlastValue item={item} amount={monthTotals[item] ?? 0} />
                  </li>
                ))}
                {SIZED_ITEMS.map((item) => (
                  <li key={item} className="rounded-xl bg-well px-3 py-2 text-sm">
                    <span>{SIZED_LABEL[item]}</span>
                    {sizeLines(monthSizes[item]).length === 0 ? (
                      <b className="float-right tabular-nums">—</b>
                    ) : (
                      <ul className="mt-1 space-y-1 pl-3 text-white/85">
                        {sizeLines(monthSizes[item]).map(([size, count]) => (
                          <li key={size} className="flex items-center justify-between gap-3">
                            <span>සයිස් {quantity(size)}</span>
                            <b className="tabular-nums">{count}</b>
                          </li>
                        ))}
                      </ul>
                    )}
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
