import { Check, Hammer, Info, Minus, TriangleAlert, Truck, X } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { hours, money, quantity, signedHours } from '../lib/format';
import {
  FILL_LABEL,
  INSPECTION_LABEL,
  ROLES,
  SERVICE,
  dayOffHours,
  dayOnHours,
  lockedSlotCount,
  nameOf,
  serviceAlerts,
  serviceStatus,
  totalFilled,
  type Day,
  type FillItem,
  type Machine,
  type Person,
} from '../lib/model';
import { Button, ValueChip, cx } from './ui';

/**
 * One crew member's day, as the mockup lays it out: පරික්ෂාව on the left,
 * පිරවීම on the right, තොරතුරු underneath.
 */
// Memoised: the dashboard re-renders on every store or crew change, and most
// columns have nothing new to show when it does.
export const CrewColumn = memo(function CrewColumn({
  person,
  day,
  machine,
  prices,
  selected,
  onSelect,
  onInfo,
}: {
  person: Person;
  day: Day;
  machine: Machine | undefined;
  /** Rupees per litre, from the linked store items. */
  prices: Partial<Record<FillItem, number>>;
  selected: boolean;
  /** Given the person's id, so the same function serves every column. */
  onSelect: (personId: string) => void;
  onInfo: (personId: string) => void;
}) {
  const role = ROLES[person.role];
  const alerts = serviceAlerts(machine, role.serviceTasks);

  let dayCost = 0;
  for (const item of role.fillItems) dayCost += totalFilled(day, item) * (prices[item] ?? 0);
  const blastCount = Object.keys(day.blasting.amounts).length;

  return (
    <article
      className={cx(
        '@container flex flex-col rounded-[28px] bg-page-deep/55 p-3 ring-1 transition',
        selected ? 'ring-2 ring-amber-hi' : 'ring-hairline',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(person.id)}
        aria-pressed={selected}
        className="mb-3 flex items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition hover:bg-white/5"
      >
        <span
          className={cx(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            role.tracksBonus ? 'bg-amber-hi/20 text-amber-hi' : 'bg-sky-hi/20 text-sky-hi',
          )}
        >
          {role.tracksBonus ? <Truck className="size-6" /> : <Hammer className="size-6" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-extrabold tracking-[0.2em] text-white/55 uppercase">
            {role.english}
          </span>
          <span className="block truncate text-lg leading-tight font-extrabold">{nameOf(person)}</span>
          <span className="block truncate text-xs text-white/55">{person.machineId || 'යන්ත්‍රයක් පවරා නැත'}</span>
        </span>
        {alerts.length > 0 && (
          <TriangleAlert
            aria-label="සේවා අවවාදය"
            className={cx('size-6 shrink-0', alerts[0].isDue ? 'text-red-300' : 'text-signal')}
          />
        )}
      </button>

      <div className="grid gap-3 @md:grid-cols-2">
        <section className="rounded-3xl p-4 shadow-panel panel-blue">
          <PanelTitle>පරික්ෂාව</PanelTitle>
          <ul className="space-y-1.5">
            {role.inspectionItems.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="flex-1 text-sm font-semibold">{INSPECTION_LABEL[item]}</span>
                <Mark value={day.inspection[item]} />
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-hairline pt-3">
            {role.serviceTasks.map((task) => {
              const status = serviceStatus(machine, task);
              const alert = !!status && (status.isDue || status.isDueSoon);
              return (
                <div key={task} className="flex items-center gap-2">
                  <span className={cx('flex-1 text-[11.5px] leading-snug', alert ? 'font-bold text-signal' : 'text-white/80')}>
                    {SERVICE[task].label}
                  </span>
                  <ValueChip tone={alert ? 'signal' : 'amber'} className="min-w-12 text-xs">
                    {status ? signedHours(status.remaining) : '—'}
                  </ValueChip>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl p-4 shadow-panel panel-sky">
          <PanelTitle trailing={<span className="text-xs font-bold text-white/85">{lockedSlotCount(day)}/{role.fillingSlots}</span>}>
            පිරවීම
          </PanelTitle>
          <Meter label="ON / H" value={dayOnHours(day)} />
          <Meter label="OFF / H" value={dayOffHours(day)} />
          <ul className="mt-3 space-y-2">
            {role.fillItems.map((item) => {
              const litres = totalFilled(day, item);
              const price = prices[item];
              return (
                <li key={item} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{FILL_LABEL[item]}</span>
                  <ValueChip className="min-w-12 text-xs">{litres ? quantity(litres, 'L') : '—'}</ValueChip>
                  <span className="w-[4.75rem] text-right text-[11px] font-bold text-white/90 tabular-nums">
                    {litres && price ? `රු. ${money(litres * price)}` : 'Rs —'}
                  </span>
                </li>
              );
            })}
          </ul>
          {dayCost > 0 && (
            <p className="mt-3 flex justify-between border-t border-white/25 pt-2 text-xs font-bold">
              <span>අද වියදම</span>
              <span className="tabular-nums">රු. {money(dayCost)}</span>
            </p>
          )}
          {role.tracksBlasting && (
            <p className="mt-2 text-xs font-semibold">
              වෙඩි බඩු:{' '}
              {day.blasting.lockedAt ? `OK · අයිතම ${blastCount}` : <span className="text-white/70">තවම නැත</span>}
            </p>
          )}
        </section>
      </div>

      <footer className="mt-3 flex items-center gap-3 px-1">
        <p className="text-sm">
          <span className="text-white/60">{role.tracksBonus ? 'ලෝඩ් ' : 'ආඩි '}</span>
          <span className="font-extrabold text-amber-hi tabular-nums">
            {role.tracksBonus ? day.loads : hours(day.feet)}
          </span>
        </p>
        <Button
          variant="success"
          className="ml-auto rounded-full"
          onClick={() => onInfo(person.id)}
          icon={<Info className="size-4" />}
        >
          තොරතුරු
        </Button>
      </footer>
    </article>
  );
});

function PanelTitle({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center">
      <h3 className="flex-1 text-base font-extrabold">{children}</h3>
      {trailing}
    </div>
  );
}

function Mark({ value }: { value: boolean | undefined }) {
  if (value === true) {
    return (
      <span className="flex size-6 items-center justify-center rounded-md bg-lime-lo text-white" aria-label="හරි">
        <Check className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="flex size-6 items-center justify-center rounded-md bg-alarm text-white" aria-label="වැරදියි">
        <X className="size-4" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="flex size-6 items-center justify-center rounded-md bg-well text-white/45" aria-label="සලකුණු කර නැත">
      <Minus className="size-4" />
    </span>
  );
}

/** The dark meter well, styled after the machine's own hour meter. */
function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-16 text-xs font-bold">{label}</span>
      <span className="flex-1 rounded-lg bg-ink px-3 py-1.5 text-right font-extrabold tracking-wider text-amber-hi tabular-nums">
        {value == null ? '—' : hours(value)}
      </span>
    </div>
  );
}
