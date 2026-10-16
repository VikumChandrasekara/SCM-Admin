import { collection, query, where } from 'firebase/firestore';
import { Banknote, Coins, HandCoins, History, Landmark, TriangleAlert, UserCog, Users, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { CrewColumn } from '../components/CrewColumn';
import { CrewInfoModal } from '../components/CrewInfoModal';
import { DateStepper } from '../components/DateStepper';
import { TargetPanel } from '../components/TargetPanel';
import { Button, EmptyState, Loading, PageHeader, SectionLabel, cx } from '../components/ui';
import { useMonthBills } from '../data/bills';
import { useLiveDoc, useLiveDocs, useLiveQuery } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { useLandownerPayments, useLandownerRates } from '../data/landowner';
import { dayRef, monthRef } from '../data/machines';
import { useMonthSales, useNow } from '../data/sales';
import { db } from '../db';
import { serviceAlertsFor, stockAlerts } from '../lib/alerts';
import { dateTime, money, monthBounds, monthLabel, quantity, rupees } from '../lib/format';
import { LANDOWNER_MATERIALS, landownerShare, type LandownerPayment, type LandownerShare } from '../lib/landowner';
import {
  ROLES,
  SALE_MATERIAL,
  STOCK_LABEL,
  WAGE_BASIS_LABEL,
  dayFrom,
  emptyDay,
  monthFrom,
  nameOf,
  serviceMessage,
  type FillItem,
  type Person,
} from '../lib/model';
import { payFor } from '../lib/pay';
import { useToday } from '../lib/useToday';

export function DashboardPage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const { crew, people, store, machines, ready } = useLiveData();
  // Besides the crews: the landowner, and — for the admin — the supervisors. Admins are not listed.
  const staff = people.filter(
    (person) => person.role === 'landowner' || (person.role === 'supervisor' && profile.role === 'admin'),
  );
  const team = [...crew, ...staff];
  const today = useToday();
  const navigate = useNavigate();
  const now = useNow();
  const landownerRates = useLandownerRates();
  const landownerPayments = useLandownerPayments();

  const [date, setDate] = useState(today);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  const selected = team.find((person) => person.id === selectedId) ?? team[0] ?? null;
  const month = date.slice(0, 7);
  const bounds = monthBounds(month);

  // Every crew member's record for the chosen day.
  const dayRefs = useMemo(
    () => crew.filter((person) => person.machineId).map((person) => dayRef(person.machineId, date)),
    [crew, date],
  );
  const days = useLiveDocs(dayRefs, (snapshot) => dayFrom(date, snapshot.data()));
  const dayOf = (person: Person) =>
    (person.machineId ? days[dayRef(person.machineId, date).path] : undefined) ?? emptyDay(date);

  // The selected person's month — the tally, every day in it, and the bills.
  const machineId = selected?.machineId ?? '';
  const tally = useLiveDoc(machineId ? monthRef(machineId, month) : null, (snapshot) =>
    monthFrom(month, snapshot.data()),
  );
  const monthDays = useLiveQuery(
    machineId ? `month-days:${machineId}:${month}` : null,
    () =>
      query(
        collection(db, 'machines', machineId, 'days'),
        where('date', '>=', bounds.from),
        where('date', '<=', bounds.to),
      ),
    (snapshot) => dayFrom(snapshot.id, snapshot.data()),
  );
  const bills = useMonthBills(month);
  // A driller's loads and bonus are counted from what was sold.
  const sales = useMonthSales(month);

  // Litre prices come from whatever store item each fluid is linked to.
  const prices = useMemo(() => {
    const byItem: Partial<Record<FillItem, number>> = {};
    for (const item of store) {
      if (item.link?.startsWith('fill:')) byItem[item.link.slice(5) as FillItem] = item.unitPrice;
    }
    return byItem;
  }, [store]);

  if (!ready) return <Loading />;

  const monthTally = tally.data ?? monthFrom(month, undefined);
  // The landowner's month: worked out from the month's sales, and whether it was paid.
  const share = sales.data && landownerRates.data ? landownerShare(sales.data, landownerRates.data, now) : null;
  const landownerPaid = landownerPayments.data?.find((entry) => entry.month === month) ?? null;
  const payOf = (person: Person) =>
    payFor(person, [], monthFrom(month, undefined), bills.data ?? [], null, today, sales.data ?? []);
  const pay = selected && selected.role !== 'landowner'
    ? payFor(
        selected,
        monthDays.data ?? [],
        monthTally,
        bills.data ?? [],
        selected.machineId ? dayOf(selected) : null,
        today,
        sales.data ?? [],
      )
    : null;
  const infoPerson = infoId ? crew.find((person) => person.id === infoId) ?? null : null;
  const stock = stockAlerts(store);
  const service = serviceAlertsFor(crew, machines);

  return (
    <>
      <PageHeader
        title="පාලක පුවරුව"
        subtitle={`${monthLabel(month)} · කණ්ඩායම ${team.length} දෙනා`}
        actions={<DateStepper value={date} onChange={setDate} max={today} />}
      />

      {(stock.length > 0 || service.length > 0) && (
        // A tinted strip with a signal rail down its edge, rather than a
        // full bleed of warning yellow: the page has one loud element at a
        // time, and at this width the yellow was the whole top of the screen.
        <div className="mb-5 flex flex-wrap items-center gap-2 overflow-hidden rounded-panel bg-signal/[0.07] px-4 py-3 ring-1 ring-signal/25 [border-left:3px_solid_var(--color-signal)]">
          <TriangleAlert className="size-[18px] shrink-0 text-signal" />
          <span className="mr-1 text-[13px] font-bold tracking-wide text-signal">අවධානය</span>
          {stock.slice(0, 4).map(({ item, status }) => (
            <Link
              key={item.id}
              to="/store"
              className="rounded-full bg-white/[0.07] px-3 py-1 text-[11.5px] font-semibold ring-1 ring-hairline transition hover:bg-white/[0.14]"
            >
              {item.name}: {STOCK_LABEL[status]} ({quantity(item.quantity, item.unit)})
            </Link>
          ))}
          {service.slice(0, 3).map(({ person, status }) => (
            <span
              key={`${person.id}:${status.task}`}
              className="rounded-full bg-white/[0.07] px-3 py-1 text-[11.5px] font-semibold ring-1 ring-hairline"
            >
              {nameOf(person)}: {serviceMessage(status)}
            </span>
          ))}
          {stock.length + service.length > 7 && (
            <span className="text-[11.5px] font-semibold text-white/60">
              +{stock.length + service.length - 7}
            </span>
          )}
        </div>
      )}

      {team.length === 0 ? (
        <div className="rounded-panel panel-surface shadow-panel ring-1 ring-hairline">
          <EmptyState
            icon={<Users className="size-7" />}
            title="තවම කණ්ඩායම් සාමාජිකයින් නැත"
            detail="පරිශීලකයින් පිටුවෙන් ඔපරේටර් හෝ කම්පසර් ගිණුමක් සාදන්න."
            action={permissions.manageUsers && <Button onClick={() => navigate('/users')}>පරිශීලකයින්</Button>}
          />
        </div>
      ) : (
        <>
          <SectionLabel>මුදල් සහ ඉලක්කය</SectionLabel>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {team.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setSelectedId(person.id)}
                aria-pressed={person.id === selected?.id}
                className={cx(
                  'rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 transition',
                  person.id === selected?.id
                    ? 'bg-amber-hi/15 text-amber-hi ring-amber-hi/35'
                    : 'bg-white/[0.05] text-white/70 ring-hairline hover:bg-white/[0.1] hover:text-white',
                )}
              >
                {nameOf(person)}
                <span className="ml-1.5 text-[10.5px] font-medium opacity-65">{ROLES[person.role].english}</span>
              </button>
            ))}
          </div>

          {selected?.role === 'supervisor' && pay && (
            <section className="mb-8 grid gap-4 sm:grid-cols-3">
              <MoneyTile
                icon={<Coins className="size-5" />}
                label="මුදල් ප්‍රමාණය"
                value={pay.gross}
                caption={`මාසික පඩිය ${rupees(selected.dailyWage)}`}
              />
              <MoneyTile
                icon={<HandCoins className="size-5" />}
                label="ණය මුදල් ප්‍රමාණය"
                value={pay.deductions}
                caption="මේ මාසයේ ඇඩ්වාන්ස් + කෑම බිල්පත්"
              />
              <MoneyTile
                icon={<Wallet className="size-5" />}
                label="ලැබිය යුතු මුදල් ප්‍රමාණය"
                value={pay.net}
                caption="උපයා ඇති මුදලින් ණය අඩු කළ පසු"
                emphasis
              />
            </section>
          )}

          {selected?.role === 'landowner' && (
            <LandownerBoxes month={month} share={share} paid={landownerPaid} />
          )}

          {selected && pay && ROLES[selected.role].isCrew && (
            <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)]">
              {/* flex + flex-1 rather than the grid's own stretch: a grid
                  item stretches to the row's height, but its content still
                  hugs the top unless something inside claims the leftover
                  space. These two tiles now grow to fill it, so the column's
                  bottom lands on the target panel's, instead of stopping
                  short with a bare gap underneath. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-col">
                <MoneyTile
                  icon={<Coins className="size-5" />}
                  label="මුදල් ප්‍රමාණය"
                  value={pay.gross}
                  caption={grossCaption(selected, pay)}
                  className="lg:flex-1"
                />
                <MoneyTile
                  icon={<Wallet className="size-5" />}
                  label="ලැබිය යුතු මුදල් ප්‍රමාණය"
                  value={pay.net}
                  caption="උපයා ඇති මුදලින් ණය අඩු කළ පසු"
                  emphasis
                  className="lg:flex-1"
                />
              </div>

              <TargetPanel
                person={selected}
                month={monthTally}
                today={today}
                wageUnits={pay.wageUnits}
                wagePay={pay.wagePay}
                loadPay={pay.loadPay}
                bonusLoads={pay.bonusLoads}
              />

              <div className="grid gap-4 sm:grid-cols-2 lg:flex lg:flex-col">
                <MoneyTile
                  icon={<HandCoins className="size-5" />}
                  label="ණය මුදල් ප්‍රමාණය"
                  value={pay.deductions}
                  caption="මේ මාසයේ ඇඩ්වාන්ස් + කෑම බිල්පත්"
                  className="lg:flex-1"
                />
                <MoneyTile
                  icon={<Banknote className="size-5" />}
                  label="දවසේ මුදල් ප්‍රමාණය"
                  value={pay.dayEarnings}
                  caption={
                    selected.dailyWage > 0
                      ? `පඩිය ${rupees(selected.dailyWage)} ${WAGE_BASIS_LABEL[selected.wageBasis].per} · ${date}`
                      : 'දවසේ පඩිය සකසා නැත'
                  }
                  className="lg:flex-1"
                />
                {/* Fixed-size, not flex-1: a shortcut link, not a stat — the
                    two tiles above absorb the leftover height and this sits
                    at its natural size right after them. */}
                <Link
                  to={`/history?person=${selected.id}`}
                  className="group flex shrink-0 items-center gap-3 rounded-card panel-surface px-4 py-3 ring-1 ring-hairline transition hover:bg-surface-hi"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-signal/15 text-signal ring-1 ring-signal/25">
                    <History className="size-[18px]" />
                  </span>
                  <span className="min-w-0 text-[13px] font-semibold">
                    ඉතිහාසය
                    <span className="block truncate text-[11.5px] font-normal text-white/60">
                      {nameOf(selected)} — පෙර දවස්
                    </span>
                  </span>
                </Link>
              </div>
            </section>
          )}

          <SectionLabel
            trailing={<span className="text-[11.5px] text-white/60 tabular-nums">{date === today ? 'අද' : date}</span>}
          >
            කණ්ඩායම
          </SectionLabel>
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {crew.map((person) => (
              <CrewColumn
                key={person.id}
                person={person}
                day={dayOf(person)}
                machine={machines.get(person.machineId)}
                prices={prices}
                selected={person.id === selected?.id}
                onSelect={setSelectedId}
                onInfo={setInfoId}
              />
            ))}
          </div>
          {staff.length > 0 && (
            <div className="mt-5 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {staff.map((person) => (
                <StaffCard
                  key={person.id}
                  person={person}
                  selected={person.id === selected?.id}
                  onSelect={setSelectedId}
                  facts={
                    person.role === 'landowner'
                      ? [
                          { label: 'ලෝඩ්', value: share ? quantity(share.loads) : '—' },
                          { label: 'ගෙවිය යුතු මුදල', value: share ? `රු. ${money(share.amount)}` : '—' },
                          { label: 'ගෙවීම', value: landownerPaid ? 'ගෙවූ' : 'ගෙවා නැත' },
                        ]
                      : (() => {
                          const figures = payOf(person);
                          return [
                            { label: 'මාසික පඩිය', value: `රු. ${money(figures.gross)}` },
                            { label: 'ණය', value: `රු. ${money(figures.deductions)}` },
                            { label: 'ලැබිය යුතු', value: `රු. ${money(figures.net)}` },
                          ];
                        })()
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {infoPerson && <CrewInfoModal person={infoPerson} date={date} onClose={() => setInfoId(null)} />}
    </>
  );
}

/**
 * A supervisor or the landowner among the team: who they are, and the month in
 * three figures — a supervisor's pay, or what the landowner is owed. Tapping it
 * puts their money boxes at the top, as a crew member's card does.
 */
function StaffCard({
  person,
  facts,
  selected,
  onSelect,
}: {
  person: Person;
  facts: { label: string; value: string }[];
  selected: boolean;
  onSelect: (personId: string) => void;
}) {
  const role = ROLES[person.role];
  return (
    <article
      className={cx(
        'flex flex-col rounded-panel panel-surface p-3 shadow-panel ring-1 transition',
        selected ? 'ring-amber-hi/60' : 'ring-hairline',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(person.id)}
        aria-pressed={selected}
        className="mb-3 flex items-center gap-3 rounded-card px-2 py-1.5 text-left transition hover:bg-white/[0.06]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-grape-hi/15 text-violet-100 ring-1 ring-grape-hi/30">
          {person.role === 'landowner' ? <Landmark className="size-5" /> : <UserCog className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.18em] text-white/55 uppercase">{role.english}</span>
          <span className="block truncate text-[17px] leading-tight font-bold tracking-tight">{nameOf(person)}</span>
          <span className="block truncate text-[11.5px] text-white/55">
            {role.label}
            {person.username && ` · ${person.username}`}
          </span>
        </span>
      </button>
      <dl className="grid grid-cols-3 gap-2 rounded-card bg-well p-3 text-center">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="truncate text-[10.5px] font-semibold text-white/55">{fact.label}</dt>
            <dd className="mt-1 truncate text-[13.5px] font-bold tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

/** The landowner's month: what he is owed, in how many loads, whether it was paid — and by material. */
function LandownerBoxes({
  month,
  share,
  paid,
}: {
  month: string;
  share: LandownerShare | null;
  paid: LandownerPayment | null;
}) {
  return (
    <section className="mb-8 grid gap-4 lg:grid-cols-3">
      <MoneyTile
        icon={<Coins className="size-5" />}
        label="ඉඩම් හිමියාට ගෙවිය යුතු මුදල"
        value={share?.amount ?? 0}
        caption={`${monthLabel(month)} · තහවුරු කළ විකුණුම් වලින්`}
        emphasis
      />
      <FactTile
        icon={<Landmark className="size-5" />}
        label="ලෝඩ් ගණන"
        value={share ? quantity(share.loads) : '—'}
        caption="6/9, සක්කර සහ කෝරි ඩස්ට්"
      />
      <FactTile
        icon={<Wallet className="size-5" />}
        label="ගෙවීම"
        value={paid ? 'ගෙවූ' : 'ගෙවා නැත'}
        caption={
          paid
            ? `${paid.confirmedName}${paid.paidAt ? ` · ${dateTime(paid.paidAt)}` : ''}`
            : 'ඉඩම් හිමි පිටුවෙන් ගෙවූ බව සලකුණු කළ හැක'
        }
      />
      {share && (
        <ul className="rounded-panel panel-surface p-4 text-sm shadow-panel ring-1 ring-hairline lg:col-span-3">
          {LANDOWNER_MATERIALS.map((material) => (
            <li key={material} className="flex items-center gap-3 border-b border-hairline/60 py-2 last:border-0">
              <span className="flex-1 font-semibold">{SALE_MATERIAL[material]}</span>
              <span className="w-24 text-right tabular-nums text-white/70">ලෝඩ් {quantity(share.byMaterial[material].loads)}</span>
              <span className="w-32 text-right font-bold tabular-nums">රු. {money(share.byMaterial[material].amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A box like [MoneyTile], for a figure that is not rupees. */
function FactTile({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="flex min-h-0 flex-col justify-between rounded-panel p-4 shadow-panel panel-grape">
      <p className="flex items-center gap-2.5 text-[12.5px] font-semibold tracking-wide text-white/85">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-white/15 ring-1 ring-white/10">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-3 text-[30px] leading-none font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/70">{caption}</p>
    </div>
  );
}

/** Hours can be fractional; days and loads never are. */
function countOrHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function grossCaption(person: Person, pay: NonNullable<ReturnType<typeof payFor>>): string {
  // A driller paid per load: 6/9 always, the other kinds only when there are some
  // or a rate for them — most months a driller sells little but 6/9.
  const parts = pay.loadPay
    ? pay.loadPay.lines
        .filter((line) => line.label === '6/9' || line.loads > 0 || line.rate > 0)
        .map((line) => `${line.label} ලෝඩ් ${line.loads} × ${money(line.rate)}`)
    : [`${WAGE_BASIS_LABEL[person.wageBasis].unit} ${countOrHours(pay.wageUnits)} × ${money(person.dailyWage)}`];
  if (pay.bonusPay > 0) parts.push(`බෝනස් ${money(pay.bonusPay)}`);
  return parts.join(' + ');
}

function MoneyTile({
  icon,
  label,
  value,
  caption,
  emphasis = false,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  caption: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        // justify-between spreads the three rows apart only once the tile
        // has more height than its content needs — at its natural size
        // (mobile, tablet) this does nothing and the mt-* spacing below
        // still carries it; grown to lg:flex-1, the label stays pinned to
        // the top and the caption to the bottom instead of both drifting
        // toward a lone strip at the top of a tall, empty box.
        'flex min-h-0 flex-col justify-between rounded-panel p-4 shadow-panel panel-grape',
        emphasis && 'ring-1 ring-amber-hi/60',
        className,
      )}
    >
      <p className="flex items-center gap-2.5 text-[12.5px] font-semibold tracking-wide text-white/85">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-white/15 ring-1 ring-white/10">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-3 flex items-baseline gap-1.5 text-[30px] leading-none font-bold tracking-tight tabular-nums">
        <span className="text-[15px] font-medium text-white/60">රු.</span>
        {money(value)}
      </p>
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/70">{caption}</p>
    </div>
  );
}
