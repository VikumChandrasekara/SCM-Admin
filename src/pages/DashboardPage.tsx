import { collection, query, where } from 'firebase/firestore';
import {
  Banknote,
  Bomb,
  Coins,
  Droplets,
  FileText,
  HandCoins,
  History,
  Package,
  ReceiptText,
  TriangleAlert,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { BillModal } from '../components/BillModal';
import { CrewColumn } from '../components/CrewColumn';
import { CrewInfoModal } from '../components/CrewInfoModal';
import { DateStepper } from '../components/DateStepper';
import { TargetPanel } from '../components/TargetPanel';
import { Button, EmptyState, Loading, PageHeader, SectionLabel, cx } from '../components/ui';
import { useMonthBills } from '../data/bills';
import { useLiveDoc, useLiveDocs, useLiveQuery } from '../data/live';
import { useLiveData } from '../data/LiveData';
import { dayRef, monthRef } from '../data/machines';
import { db } from '../db';
import { serviceAlertsFor, stockAlerts } from '../lib/alerts';
import { money, monthBounds, monthLabel, quantity, rupees } from '../lib/format';
import {
  BILL,
  ROLES,
  STOCK_LABEL,
  dayFrom,
  emptyDay,
  monthFrom,
  nameOf,
  serviceMessage,
  type BillCategory,
  type FillItem,
  type Person,
} from '../lib/model';
import { payFor } from '../lib/pay';
import { useToday } from '../lib/useToday';

export function DashboardPage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const { crew, store, machines, ready } = useLiveData();
  const today = useToday();
  const navigate = useNavigate();

  const [date, setDate] = useState(today);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [billCategory, setBillCategory] = useState<BillCategory | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  const selected = crew.find((person) => person.id === selectedId) ?? crew[0] ?? null;
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
  const pay = selected
    ? payFor(selected, monthDays.data ?? [], monthTally, bills.data ?? [], selected.machineId ? dayOf(selected) : null)
    : null;
  const infoPerson = infoId ? crew.find((person) => person.id === infoId) ?? null : null;
  const stock = stockAlerts(store);
  const service = serviceAlertsFor(crew, machines);

  return (
    <>
      <PageHeader
        title="පාලක පුවරුව"
        subtitle={`${monthLabel(month)} · කණ්ඩායම ${crew.length} දෙනා`}
        actions={<DateStepper value={date} onChange={setDate} max={today} />}
      />

      {(stock.length > 0 || service.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-ink shadow-panel chip-signal">
          <TriangleAlert className="size-5 shrink-0" />
          <span className="mr-1 text-sm font-extrabold">අවධානය</span>
          {stock.slice(0, 4).map(({ item, status }) => (
            <Link key={item.id} to="/store" className="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold hover:bg-ink/20">
              {item.name}: {STOCK_LABEL[status]} ({quantity(item.quantity, item.unit)})
            </Link>
          ))}
          {service.slice(0, 3).map(({ person, status }) => (
            <span key={person.id} className="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold">
              {nameOf(person)}: {serviceMessage(status)}
            </span>
          ))}
          {stock.length + service.length > 7 && <span className="text-xs font-bold">+{stock.length + service.length - 7}</span>}
        </div>
      )}

      <QuickActions
        canManageUsers={permissions.manageUsers}
        onNavigate={(path) => navigate(path)}
        onBill={setBillCategory}
      />

      {crew.length === 0 ? (
        <div className="rounded-[26px] bg-page-deep/60 ring-1 ring-hairline">
          <EmptyState
            icon={<Users className="size-7" />}
            title="තවම කණ්ඩායම් සාමාජිකයින් නැත"
            detail="පරිශීලකයින් පිටුවෙන් ඔපරේටර් හෝ කම්පසර් ගිණුමක් සාදන්න."
            action={permissions.manageUsers && <Button onClick={() => navigate('/users')}>පරිශීලකයින්</Button>}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold tracking-[0.14em] text-white/60 uppercase">මුදල් සහ ඉලක්කය</span>
            {crew.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setSelectedId(person.id)}
                className={cx(
                  'rounded-full px-3.5 py-1.5 text-sm font-bold transition',
                  person.id === selected?.id ? 'chip-amber text-ink shadow-control' : 'bg-well text-white/80 hover:bg-black/30',
                )}
              >
                {nameOf(person)}
                <span className="ml-1.5 text-[11px] font-semibold opacity-70">{ROLES[person.role].english}</span>
              </button>
            ))}
          </div>

          {selected && pay && (
            <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)]">
              <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <MoneyTile
                  icon={<Coins className="size-5" />}
                  label="මුදල් ප්‍රමාණය"
                  value={pay.gross}
                  caption={grossCaption(selected, pay)}
                />
                <MoneyTile
                  icon={<Wallet className="size-5" />}
                  label="ලැබිය යුතු මුදල් ප්‍රමාණය"
                  value={pay.net}
                  caption="උපයා ඇති මුදලින් ණය අඩු කළ පසු"
                  emphasis
                />
              </div>

              <TargetPanel person={selected} month={monthTally} today={today} />

              <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <MoneyTile
                  icon={<HandCoins className="size-5" />}
                  label="ණය මුදල් ප්‍රමාණය"
                  value={pay.deductions}
                  caption="මේ මාසයේ ඇඩ්වාන්ස් + කෑම බිල්පත්"
                />
                <MoneyTile
                  icon={<Banknote className="size-5" />}
                  label="දවසේ මුදල් ප්‍රමාණය"
                  value={pay.dayEarnings}
                  caption={selected.dailyWage > 0 ? `දවසේ පඩිය ${rupees(selected.dailyWage)} · ${date}` : 'දවසේ පඩිය සකසා නැත'}
                />
                <Link
                  to={`/history?person=${selected.id}`}
                  className="group flex items-center gap-3 rounded-2xl bg-well px-4 py-3 hover:bg-black/30"
                >
                  <span className="relative flex h-11 w-12 items-end justify-center">
                    <span className="absolute inset-0 bg-signal [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
                    <History className="relative mb-1 size-4 text-ink" />
                  </span>
                  <span className="text-sm font-bold">
                    ඉතිහාසය
                    <span className="block text-xs font-normal text-white/60">{nameOf(selected)} — පෙර දවස්</span>
                  </span>
                </Link>
              </div>
            </section>
          )}

          <SectionLabel trailing={<span className="text-xs text-white/55">{date === today ? 'අද' : date}</span>}>
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
        </>
      )}

      {billCategory && (
        <BillModal
          category={billCategory}
          personId={BILL[billCategory].deduction ? selected?.id ?? null : null}
          date={date}
          onClose={() => setBillCategory(null)}
        />
      )}
      {infoPerson && <CrewInfoModal person={infoPerson} date={date} onClose={() => setInfoId(null)} />}
    </>
  );
}

function grossCaption(person: Person, pay: NonNullable<ReturnType<typeof payFor>>): string {
  const parts = [`දින ${pay.workedDays} × ${money(person.dailyWage)}`];
  if (pay.bonusPay > 0) parts.push(`බෝනස් ${money(pay.bonusPay)}`);
  if (pay.feetPay > 0) parts.push(`ආඩි ${money(pay.feetPay)}`);
  return parts.join(' + ');
}

function MoneyTile({
  icon,
  label,
  value,
  caption,
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cx('rounded-[22px] p-4 shadow-panel panel-grape', emphasis && 'ring-2 ring-amber-hi/70')}>
      <p className="flex items-center gap-2 text-sm font-bold text-white/90">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-[28px] leading-none font-extrabold tabular-nums">
        <span className="mr-1 text-base font-bold text-white/70">රු.</span>
        {money(value)}
      </p>
      <p className="mt-2 text-xs text-white/70">{caption}</p>
    </div>
  );
}

interface Action {
  label: string;
  icon: LucideIcon;
  className: string;
  onClick: () => void;
}

/** The mockup's top row, in its own colours. */
function QuickActions({
  canManageUsers,
  onNavigate,
  onBill,
}: {
  canManageUsers: boolean;
  onNavigate: (path: string) => void;
  onBill: (category: BillCategory) => void;
}) {
  const pages: Action[] = [
    { label: 'බිල්', icon: ReceiptText, className: 'bg-white text-ink', onClick: () => onNavigate('/bills') },
    { label: 'වෙඩි බඩු', icon: Bomb, className: 'chip-signal text-ink', onClick: () => onNavigate('/explosives') },
    { label: 'ගබඩාව', icon: Package, className: 'chip-amber text-ink', onClick: () => onNavigate('/store') },
    ...(canManageUsers
      ? [{ label: 'පරිශීලකයින්', icon: Users, className: 'bg-[#c0504d] text-white', onClick: () => onNavigate('/users') }]
      : []),
    { label: 'ඉතිහාසය', icon: History, className: 'bg-[#cbbde9] text-ink', onClick: () => onNavigate('/history') },
  ];
  const bills: (Action & { category: BillCategory })[] = [
    { category: 'advance', label: 'Advance', icon: HandCoins, className: 'bg-[#4f81bd] text-white', onClick: () => onBill('advance') },
    { category: 'food', label: 'Food', icon: UtensilsCrossed, className: 'bg-[#9bbb59] text-ink', onClick: () => onBill('food') },
    { category: 'water', label: 'Water bill', icon: Droplets, className: 'bg-[#b7dee8] text-ink', onClick: () => onBill('water') },
    { category: 'other', label: 'වෙනත්', icon: FileText, className: 'bg-[#d0d0d0] text-ink', onClick: () => onBill('other') },
  ];

  const render = (action: Action) => (
    <button
      key={action.label}
      type="button"
      onClick={action.onClick}
      className={cx(
        'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold shadow-control ring-1 ring-black/10 transition hover:brightness-105 active:scale-[0.97]',
        action.className,
      )}
    >
      <action.icon className="size-4" />
      {action.label}
    </button>
  );

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {pages.map(render)}
      <span className="mx-1 hidden h-7 w-px bg-hairline sm:block" />
      <span className="text-xs font-bold text-white/55">බිල්පතක් එකතු කරන්න:</span>
      {bills.map(render)}
    </div>
  );
}
