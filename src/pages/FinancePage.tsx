import { ChevronLeft, ChevronRight, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { DataError } from '../components/DataError';
import { IconButton, Loading, PageHeader, Panel, SectionLabel, TableFrame, cx, td, th } from '../components/ui';
import { useMonthBills } from '../data/bills';
import { useCrewMonths, useMonthMovements } from '../data/finance';
import { useLandownerRates } from '../data/landowner';
import { useLiveData } from '../data/LiveData';
import { usePayments } from '../data/payments';
import { useMonthSales, useNow, useSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import {
  WORK_AREA_LABEL,
  crewSummaryFor,
  financeFor,
  type AreaCosts,
  type Finance,
  type LedgerKind,
  type StockRow,
} from '../lib/finance';
import { addMonths, money, monthKey, monthLabel, quantity, rupees } from '../lib/format';
import { machineTypeOf } from '../lib/machines';
import { ROLES, SALE_MATERIAL, SALE_TYPE, SALE_TYPES, nameOf, type MachineType } from '../lib/model';
import { payFor } from '../lib/pay';
import { useToday } from '../lib/useToday';

/**
 * මූල්‍ය — where the month's money came from and where it went, down to the
 * entries behind every figure. Admin only.
 */
export function FinancePage() {
  const { crew, store, machines, people } = useLiveData();
  const now = useNow();
  const today = useToday();
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [version, setVersion] = useState(0);

  const sales = useMonthSales(month);
  const bills = useMonthBills(month);
  const movements = useMonthMovements(month);
  const crewMonths = useCrewMonths(crew, month, version);
  const previousCrew = useCrewMonths(crew, addMonths(month, -1), version);
  const prices = useSalesPrices();
  const payments = usePayments();
  const landowner = useLandownerRates();

  // Last month's gross, from the same days and loads — no bills, as gross never takes them off.
  const previousGross = previousCrew.data
    ? previousCrew.data.reduce(
        (total, { person, days, tally }) => total + payFor(person, days, tally, [], null, today).gross,
        0,
      )
    : null;

  // What a use of fuel or parts belongs to is decided by the machine's kind: an
  // excavator's is loading, a compressor's is drilling and blasting.
  const machineKinds = useMemo(() => {
    const kinds = new Map<string, MachineType>();
    for (const machine of machines.values()) {
      const kind = machineTypeOf(machine, people);
      if (kind) kinds.set(machine.id, kind);
    }
    return kinds;
  }, [machines, people]);

  const finance = useMemo(
    () =>
      sales.data && bills.data && movements.data && crewMonths.data && prices.data && payments.data && landowner.data
        ? financeFor({
            month,
            sales: sales.data,
            bills: bills.data,
            movements: movements.data,
            crewMonths: crewMonths.data,
            payments: payments.data,
            store,
            machineHourly: prices.data.machineHourly,
            landownerRates: landowner.data,
            machineKinds,
            now,
            today,
          })
        : null,
    [
      month,
      sales.data,
      bills.data,
      movements.data,
      crewMonths.data,
      prices.data,
      payments.data,
      landowner.data,
      store,
      machineKinds,
      now,
      today,
    ],
  );

  const failure =
    sales.error ?? bills.error ?? movements.error ?? prices.error ?? payments.error ?? landowner.error;

  return (
    <>
      <PageHeader
        title="මූල්‍ය වාර්තාව"
        subtitle="ආදායම් ලැබුණු ආකාරය සහ වියදම් ගිය ආකාරය — එක් එක් ගණනට පිටුපස ඇති සියලු සටහන් සමඟ."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-card bg-well p-1">
              <IconButton label="පෙර මාසය" onClick={() => setMonth((value) => addMonths(value, -1))}>
                <ChevronLeft className="size-5" />
              </IconButton>
              <span className="min-w-36 text-center text-sm font-bold">{monthLabel(month)}</span>
              <IconButton label="ඊළඟ මාසය" disabled={month >= current} onClick={() => setMonth((value) => addMonths(value, 1))}>
                <ChevronRight className="size-5" />
              </IconButton>
            </div>
            <IconButton label="වැටුප් නැවත ගණනය කරන්න" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className="size-5" />
            </IconButton>
          </>
        }
      />

      {failure ? (
        <DataError error={failure} />
      ) : crewMonths.error ? (
        <p className="rounded-xl bg-alarm/30 px-4 py-3 text-sm font-semibold">{errorMessage(crewMonths.error)}</p>
      ) : !finance ? (
        <Loading />
      ) : (
        <FinanceReport finance={finance} previousGross={previousGross} />
      )}
    </>
  );
}

function FinanceReport({ finance, previousGross }: { finance: Finance; previousGross: number | null }) {
  const crew = crewSummaryFor(finance.salaries);
  const change = previousGross ? finance.salaryTotal - previousGross : null;

  // Each kind of work, then the landowner — which together are every expense.
  const expenseLines: { label: string; value: number; detail: string }[] = [
    ...finance.areas.map((area) => ({
      label: WORK_AREA_LABEL[area.area].label,
      value: area.total,
      detail: WORK_AREA_LABEL[area.area].detail,
    })),
    {
      label: 'ඉඩම් හිමියාට කපන ගණන',
      value: finance.landownerTotal,
      detail: `6/9, සක්කර, කෝරි ඩස්ට් ලෝඩ් ${quantity(finance.landownerLoads)} — බිල්පත සෑදූ වේලාවේ ගාස්තුවෙන්`,
    },
  ];

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline icon={<TrendingUp className="size-5" />} label="ආදායම" value={finance.income} tone="income" />
        <Headline icon={<TrendingDown className="size-5" />} label="මුළු වියදම" value={finance.expenses} tone="expense" />
        <Headline
          icon={<Wallet className="size-5" />}
          label={finance.profit >= 0 ? 'ශුද්ධ ලාභය' : 'අලාභය'}
          value={finance.profit}
          tone={finance.profit >= 0 ? 'income' : 'expense'}
          emphasis
        />
        <Headline
          label="තහවුරු වීමට ඇති විකුණුම්"
          value={finance.pending.amount}
          caption={`බිල්පත් ${finance.pending.count} — තහවුරු කළ පසු ආදායමට එකතු වේ`}
        />
      </div>

      <p className="mb-8 max-w-4xl text-xs leading-relaxed text-white/60">
        ඩීසල්, ඔයිල්, වෙඩි බඩු සහ කොටස් වියදමට ගණන් ගන්නේ ඒවා <b className="text-white/80">භාවිත කළ</b> මාසයේ, භාවිත කළ දවසේ
        මිලට — මිලදී ගත් මාසයේ නොවේ. එවිට එක් එක් වැඩයට (ලෝඩ් කිරීම, විදීම සහ පුපුරවීම) තමන්ගේම වියදම පෙන්විය හැක.
        {finance.unmatchedUsage > 0 && (
          <span className="mt-1 block font-semibold text-signal">
            ගබඩා අයිතමයක් නැතිව සටහන් වූ භාවිත {finance.unmatchedUsage}ක් ඇත — ඒවායේ වටිනාකම ගණන් නොගනී, එබැවින් වියදම මෙයට
            වඩා තරමක් වැඩි විය හැක.
          </span>
        )}
      </p>

      <section className="mb-8">
        <SectionLabel>ආදායම සහ ලාභය — ද්‍රව්‍ය අනුව</SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.byMaterial.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ තහවුරු කළ විකුණුම් නැත.</p>
          ) : (
            <>
              <TableFrame>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>ද්‍රව්‍යය</th>
                      <th className={cx(th, 'text-right')}>බිල්පත්</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ්</th>
                      <th className={cx(th, 'text-right')}>ආදායම</th>
                      <th className={cx(th, 'text-right')}>ඉඩම් හිමියාට</th>
                      <th className={cx(th, 'text-right')}>ඉඩම් හිමියාට පසු</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.byMaterial.map((row) => (
                      <tr key={row.material ?? 'none'} className="border-b border-hairline/60">
                        <td className={cx(td, 'font-bold')}>
                          {row.material ? SALE_MATERIAL[row.material] : <span className="text-white/60">ද්‍රව්‍යය සටහන් නොකළ</span>}
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>{row.count}</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{quantity(row.loads)}</td>
                        <td className={cx(td, 'text-right font-bold text-lime-hi tabular-nums')}>{money(row.amount)}</td>
                        <td className={cx(td, 'text-right text-white/75 tabular-nums')}>
                          {row.landownerShare > 0 ? money(row.landownerShare) : '—'}
                        </td>
                        <td className={cx(td, 'text-right font-extrabold tabular-nums')}>{money(row.gross)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-hairline font-extrabold">
                      <td className={td}>එකතුව</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {finance.byMaterial.reduce((total, row) => total + row.count, 0)}
                      </td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {quantity(finance.byMaterial.reduce((total, row) => total + row.loads, 0))}
                      </td>
                      <td className={cx(td, 'text-right text-lime-hi tabular-nums')}>{money(finance.income)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{money(finance.landownerTotal)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{money(finance.income - finance.landownerTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </TableFrame>
              <p className="mt-3 text-[11px] text-white/55">
                "ඉඩම් හිමියාට පසු" = ආදායම − ඉඩම් හිමියාට කපන ගණන. කණ්ඩායම් වැටුප්, යන්ත්‍ර ගාස්තුව, ඩීසල් සහ අනෙක් වියදම් පහත
                වැඩ අනුව පෙන්වයි — ඒවා එක් ද්‍රව්‍යයකට පමණක් අයත් නොවේ.
              </p>
            </>
          )}
        </Panel>
      </section>

      <div className="mb-8 grid gap-5 xl:grid-cols-2">
        <section>
          <SectionLabel>ආදායම ලැබුණු ආකාරය</SectionLabel>
          <Panel className="p-4 sm:p-5">
            <TableFrame>
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={th}>වර්ගය</th>
                    <th className={cx(th, 'text-right')}>බිල්පත්</th>
                    <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
                    <th className={cx(th, 'text-right')}>මුදල</th>
                  </tr>
                </thead>
                <tbody>
                  {SALE_TYPES.map((type) => (
                    <tr key={type} className="border-b border-hairline/60">
                      <td className={cx(td, 'font-bold')}>{SALE_TYPE[type].label}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{finance.incomeByType[type].count}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {quantity(finance.incomeByType[type].quantity)} {SALE_TYPE[type].unit}
                      </td>
                      <td className={cx(td, 'text-right font-extrabold tabular-nums')}>{money(finance.incomeByType[type].amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-hairline/60 text-white/60">
                    <td className={td}>
                      කලින් ගෙවූ — ලෝඩ් තවම නොගිය
                      <span className="block text-[11px] text-white/45">ඉහත ආදායමේ දැනටමත් ඇතුළත්</span>
                    </td>
                    <td className={cx(td, 'text-right tabular-nums')}>{finance.prepaidOpen.count}</td>
                    <td className={td} />
                    <td className={cx(td, 'text-right tabular-nums')}>{money(finance.prepaidOpen.amount)}</td>
                  </tr>
                  <tr className="border-b border-hairline/60 text-white/60">
                    <td className={td}>
                      ණය ගෙවීම් ලැබුණු
                      <span className="block text-[11px] text-white/45">ණය විකුණුම් දැනටමත් ආදායමේ ඇතුළත්</span>
                    </td>
                    <td className={cx(td, 'text-right tabular-nums')}>{finance.creditPayments.count}</td>
                    <td className={td} />
                    <td className={cx(td, 'text-right tabular-nums')}>{money(finance.creditPayments.amount)}</td>
                  </tr>
                  <tr className="border-b border-hairline/60 text-white/60">
                    <td className={td}>තහවුරු වීමට ඇති (ගණන් නොගනී)</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{finance.pending.count}</td>
                    <td className={td} />
                    <td className={cx(td, 'text-right tabular-nums')}>{money(finance.pending.amount)}</td>
                  </tr>
                  <tr className="text-white/60">
                    <td className={td}>අවලංගු වූ (පැය 24 ඉක්මවූ)</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{finance.cancelled.count}</td>
                    <td className={td} />
                    <td className={cx(td, 'text-right tabular-nums line-through')}>{money(finance.cancelled.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </TableFrame>
          </Panel>
        </section>

        <section>
          <SectionLabel>වියදම් ගිය ආකාරය</SectionLabel>
          <Panel className="p-4 sm:p-5">
            <ul className="space-y-3">
              {expenseLines.map((line) => (
                <li key={line.label}>
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 text-sm font-bold">{line.label}</span>
                    <span className="text-xs text-white/55">
                      {finance.expenses > 0 ? `${Math.round((line.value / finance.expenses) * 100)}%` : ''}
                    </span>
                    <span className="w-28 text-right font-extrabold tabular-nums">{money(line.value)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-well">
                    <div
                      className="h-full rounded-full bg-amber-hi"
                      style={{ width: `${finance.expenses > 0 ? (line.value / finance.expenses) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/55">{line.detail}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1.5 border-t border-hairline pt-3 text-sm font-extrabold">
              <p className="flex justify-between text-white/75">
                <span>මුළු ආදායම</span>
                <span className="tabular-nums text-lime-hi">{rupees(finance.income)}</span>
              </p>
              <p className="flex justify-between">
                <span>මුළු වියදම</span>
                <span className="tabular-nums">− {rupees(finance.expenses)}</span>
              </p>
              <p className={cx('flex justify-between border-t border-hairline pt-1.5', finance.profit < 0 && 'text-red-300')}>
                <span>{finance.profit >= 0 ? 'ශුද්ධ ලාභය' : 'අලාභය'}</span>
                <span className="tabular-nums">{rupees(Math.abs(finance.profit))}</span>
              </p>
            </div>
          </Panel>
        </section>
      </div>

      <section className="mb-8">
        <SectionLabel>වියදම් — වැඩ අනුව</SectionLabel>
        <div className="grid gap-5 lg:grid-cols-3">
          {finance.areas.map((area) => (
            <AreaPanel key={area.area} area={area} expenses={finance.expenses} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionLabel>කණ්ඩායම් වැටුප්</SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.salaries.length > 0 && (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <CrewStat label="බෝනස් එකතුව" value={rupees(crew.bonusTotal)} />
                <CrewStat label="ඇඩ්වාන්ස් එකතුව" value={rupees(crew.advanceTotal)} />
                <CrewStat label="කෑම එකතුව" value={rupees(crew.foodTotal)} />
                <CrewStat label="ගෙවිය යුතු ශේෂය එකතුව" value={rupees(crew.netTotal)} />
                <CrewStat label="වැඩ කළ දින" value={quantity(crew.workedDays)} />
                <CrewStat label="වැඩ කළ දිනයකට" value={crew.perWorkedDay != null ? rupees(crew.perWorkedDay) : '—'} />
                <CrewStat
                  label="ඉහළම ඉපයුම"
                  value={crew.highest ? rupees(crew.highest.pay.gross) : '—'}
                  detail={crew.highest ? nameOf(crew.highest.person) : undefined}
                />
                <CrewStat
                  label="අඩුම ඉපයුම"
                  value={crew.lowest ? rupees(crew.lowest.pay.gross) : '—'}
                  detail={crew.lowest ? nameOf(crew.lowest.person) : undefined}
                />
                <CrewStat
                  label="පසුගිය මාසයට වඩා"
                  value={change == null ? '—' : `${change >= 0 ? '+' : '−'}${rupees(Math.abs(change))}`}
                  detail={change == null || !previousGross ? undefined : `${Math.round((change / previousGross) * 100)}%`}
                />
              </div>

              <div className="mb-5">
                <p className="mb-3 text-sm font-bold">යන්ත්‍රය අනුව වැටුප්</p>
                <ul className="space-y-3">
                  {crew.byMachine.map((machine) => {
                    const share = finance.salaryTotal > 0 ? (machine.value / finance.salaryTotal) * 100 : 0;
                    return (
                      <li key={machine.key}>
                        <div className="flex items-baseline gap-2">
                          <span className="flex-1 text-sm font-bold">{machine.label}</span>
                          <span className="text-xs text-white/55">{`${Math.round(share)}%`}</span>
                          <span className="w-28 text-right font-extrabold tabular-nums">{money(machine.value)}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-well">
                          <div className="h-full rounded-full bg-amber-hi" style={{ width: `${share}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {crew.negative.length > 0 && (
                <p className="mb-5 rounded-xl bg-alarm/30 px-4 py-3 text-sm font-semibold">
                  ඇඩ්වාන්ස් සහ කෑම පඩියට වඩා වැඩි: {crew.negative.map((row) => nameOf(row.person)).join(', ')}
                </p>
              )}
            </>
          )}

          {finance.salaries.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">කණ්ඩායම් සාමාජිකයින් නැත.</p>
          ) : (
            <TableFrame>
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={th}>නම</th>
                    <th className={cx(th, 'text-right')}>වැඩ කළ දින</th>
                    <th className={cx(th, 'text-right')}>වැටුප</th>
                    <th className={cx(th, 'text-right')}>බෝනස්</th>
                    <th className={cx(th, 'text-right')}>මුළු වැටුප</th>
                    <th className={cx(th, 'text-right')}>ඇඩ්වාන්ස්</th>
                    <th className={cx(th, 'text-right')}>කෑම</th>
                    <th className={cx(th, 'text-right')}>ගෙවිය යුතු ශේෂය</th>
                  </tr>
                </thead>
                <tbody>
                  {finance.salaries.map(({ person, pay, advances, food }) => (
                    <tr key={person.id} className="border-b border-hairline/60 last:border-0">
                      <td className={td}>
                        <span className="font-bold">{nameOf(person)}</span>
                        <span className="block text-xs text-white/55">
                          {ROLES[person.role].label} · {person.machineId || '—'}
                        </span>
                      </td>
                      <td className={cx(td, 'text-right tabular-nums')}>{pay.workedDays}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{money(pay.wagePay)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{pay.bonusPay > 0 ? money(pay.bonusPay) : '—'}</td>
                      <td className={cx(td, 'text-right font-extrabold tabular-nums')}>{money(pay.gross)}</td>
                      <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(advances)}</td>
                      <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(food)}</td>
                      <td className={cx(td, 'text-right font-extrabold tabular-nums', pay.net < 0 && 'text-red-300')}>
                        {money(pay.net)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-hairline font-extrabold">
                    <td className={td}>එකතුව</td>
                    <td className={td} colSpan={3} />
                    <td className={cx(td, 'text-right tabular-nums')}>{money(finance.salaryTotal)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>
                      {money(finance.salaries.reduce((sum, row) => sum + row.advances, 0))}
                    </td>
                    <td className={cx(td, 'text-right tabular-nums')}>
                      {money(finance.salaries.reduce((sum, row) => sum + row.food, 0))}
                    </td>
                    <td className={cx(td, 'text-right tabular-nums')}>
                      {money(finance.salaries.reduce((sum, row) => sum + row.pay.net, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </TableFrame>
          )}
        </Panel>
      </section>

      <div className="mb-8 grid gap-5 xl:grid-cols-2">
        <section>
          <SectionLabel>මිලදී ගත් තොග</SectionLabel>
          <Panel tone="deep" className="p-4 sm:p-5">
            <p className="mb-3 text-xs text-white/60">
              නව අයිතම සහ තොග එකතු කිරීම්. මේවා මිලදී ගත් මාසයේ වියදමට ගණන් නොගනී — ගබඩාවෙන් භාවිත කළ විට එම මාසයේ වියදමට
              එකතු වේ.
            </p>
            <StockTable rows={finance.purchases} total={finance.purchaseTotal} empty="මෙම මාසයේ මිලදී ගැනීම් නැත." />
          </Panel>
        </section>

        <section>
          <SectionLabel>යන්ත්‍ර සඳහා භාවිත වූ බඩු</SectionLabel>
          <Panel className="p-4 sm:p-5">
            <p className="mb-3 text-xs text-white/60">
              ඩීසල්, ඔයිල්, වෙඩි බඩු සහ කොටස් — ගබඩාවෙන් ගිය දේ, එවකට මිලට. මේවා භාවිත කළ මාසයේ වියදමට ගණන් ගනී; ඉහත වැඩ
              අනුව වියදම් මෙයින් ගොඩනැගේ.
            </p>
            <StockTable rows={finance.usageByMachine} total={finance.usageTotal} empty="මෙම මාසයේ භාවිතයක් නැත." heading="යන්ත්‍රය" />
            {finance.usageByItem.length > 0 && (
              <div className="mt-5">
                <StockTable rows={finance.usageByItem} total={finance.usageTotal} empty="" heading="අයිතමය" />
              </div>
            )}
          </Panel>
        </section>
      </div>

      <section>
        <SectionLabel>ගනුදෙනු ලේඛනය</SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.ledger.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ ගනුදෙනු නැත.</p>
          ) : (
            <TableFrame>
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={th}>දිනය</th>
                    <th className={th}>වර්ගය</th>
                    <th className={th}>විස්තරය</th>
                    <th className={cx(th, 'text-right')}>ආදායම</th>
                    <th className={cx(th, 'text-right')}>වියදම</th>
                  </tr>
                </thead>
                <tbody>
                  {finance.ledger.map((entry, index) => (
                    <tr key={index} className="border-b border-hairline/60 last:border-0">
                      <td className={cx(td, 'whitespace-nowrap text-white/75 tabular-nums')}>{entry.date}</td>
                      <td className={cx(td, 'text-xs whitespace-nowrap text-white/65')}>{KIND_LABEL[entry.kind]}</td>
                      <td className={td}>{entry.description}</td>
                      <td className={cx(td, 'text-right font-bold text-lime-hi tabular-nums')}>
                        {entry.income ? money(entry.income) : ''}
                      </td>
                      <td className={cx(td, 'text-right font-bold tabular-nums')}>{entry.expense ? money(entry.expense) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-hairline font-extrabold">
                    <td className={td} colSpan={3}>
                      එකතුව
                    </td>
                    <td className={cx(td, 'text-right text-lime-hi tabular-nums')}>{money(finance.income)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{money(finance.expenses)}</td>
                  </tr>
                </tbody>
              </table>
            </TableFrame>
          )}
        </Panel>
      </section>
    </>
  );
}

const KIND_LABEL: Record<LedgerKind, string> = {
  sale: 'විකුණුම',
  payment: 'ණය ගෙවීම',
  machine: 'යන්ත්‍රයට',
  landowner: 'ඉඩම් හිමියාට',
  bill: 'බිල්පත',
  usage: 'ගබඩා භාවිතය',
  salary: 'වැටුප් ශේෂය',
};

/** One kind of work, with what it cost line by line — and its share of everything spent. */
function AreaPanel({ area, expenses }: { area: AreaCosts; expenses: number }) {
  const { label, detail } = WORK_AREA_LABEL[area.area];
  return (
    <Panel className="p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold">{label}</p>
          <p className="text-[11px] text-white/55">{detail}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold tabular-nums">{rupees(area.total)}</p>
          <p className="text-[11px] text-white/55">
            {expenses > 0 ? `මුළු වියදමෙන් ${Math.round((area.total / expenses) * 100)}%` : ''}
          </p>
        </div>
      </div>
      {area.lines.length === 0 ? (
        <p className="rounded-control bg-well px-3 py-3 text-center text-xs text-white/55">මෙම මාසයේ වියදමක් නැත.</p>
      ) : (
        <ul className="space-y-3">
          {area.lines.map((line) => (
            <li key={line.key}>
              <div className="flex items-baseline gap-2">
                <span className="flex-1 text-sm font-bold">{line.label}</span>
                <span className="text-xs text-white/55">{`${Math.round((line.value / area.total) * 100)}%`}</span>
                <span className="w-24 text-right font-extrabold tabular-nums">{money(line.value)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-well">
                <div className="h-full rounded-full bg-amber-hi" style={{ width: `${(line.value / area.total) * 100}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-white/55">{line.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function StockTable({
  rows,
  total,
  empty,
  heading = 'අයිතමය',
}: {
  rows: readonly StockRow[];
  total: number;
  empty: string;
  heading?: string;
}) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-white/60">{empty}</p>;
  const estimated = rows.some((row) => row.estimated);
  return (
    <>
      <TableFrame>
        <table className="w-full min-w-[360px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className={th}>{heading}</th>
              <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
              <th className={cx(th, 'text-right')}>වටිනාකම</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-hairline/60 last:border-0">
                <td className={cx(td, 'font-semibold')}>{row.label}</td>
                <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{row.unit ? quantity(row.quantity, row.unit) : '—'}</td>
                <td className={cx(td, 'text-right font-bold tabular-nums')}>
                  {row.estimated && <span title="පැරණි සටහනක් — වත්මන් මිලට">≈ </span>}
                  {money(row.value)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-hairline font-extrabold">
              <td className={td} colSpan={2}>
                එකතුව
              </td>
              <td className={cx(td, 'text-right tabular-nums')}>{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </TableFrame>
      {estimated && <p className="mt-2 text-[11px] text-white/55">≈ — මිල සටහන් නොකළ පැරණි සටහන්, අයිතමයේ වත්මන් මිලට ගණනය කළා.</p>}
    </>
  );
}

function CrewStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-control bg-well px-3 py-2.5 ring-1 ring-hairline">
      <p className="text-[11px] text-white/55">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold tabular-nums">{value}</p>
      {detail && <p className="truncate text-[11px] text-white/55">{detail}</p>}
    </div>
  );
}

function Headline({
  icon,
  label,
  value,
  tone,
  caption,
  emphasis = false,
}: {
  icon?: ReactNode;
  label: string;
  value: number;
  tone?: 'income' | 'expense';
  caption?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-card px-4 py-4 ring-1',
        emphasis ? 'text-ink shadow-control chip-amber ring-transparent' : 'bg-well ring-hairline',
      )}
    >
      <p className={cx('flex items-center gap-2 text-xs font-bold', !emphasis && 'text-white/65')}>
        {icon}
        {label}
      </p>
      <p
        className={cx(
          'mt-1 text-2xl font-extrabold tabular-nums',
          !emphasis && tone === 'income' && 'text-lime-hi',
          !emphasis && tone === 'expense' && 'text-red-200',
        )}
      >
        {rupees(Math.abs(value))}
      </p>
      {caption && <p className={cx('mt-0.5 text-[11px]', emphasis ? 'text-ink/70' : 'text-white/55')}>{caption}</p>}
    </div>
  );
}
