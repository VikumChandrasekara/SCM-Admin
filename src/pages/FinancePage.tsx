import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { DataError } from '../components/DataError';
import { MachineRateModal } from '../components/MachineRateModal';
import { RoyaltyModal } from '../components/RoyaltyModal';
import { Button, IconButton, Loading, PageHeader, Panel, SectionLabel, TableFrame, cx, td, th } from '../components/ui';
import { useMonthBills } from '../data/bills';
import { useCrewMonths, useMonthMovements } from '../data/finance';
import { useLandownerRates } from '../data/landowner';
import { useLiveData } from '../data/LiveData';
import { usePayments } from '../data/payments';
import { useRoyaltyRates } from '../data/royalty';
import { useMonthSales, useNow, useSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import {
  EXPENSE_LABEL,
  crewSummaryFor,
  financeFor,
  isMainMaterial,
  type ExpenseCategory,
  type Finance,
  type LedgerKind,
  type MaterialRow,
  type RoyaltyReport,
  type StockRow,
} from '../lib/finance';
import { addMonths, money, monthKey, monthLabel, quantity, rupees } from '../lib/format';
import { ROLES, SALE_MATERIAL, SALE_TYPE, SALE_TYPES, nameOf, type SalesPrices } from '../lib/model';
import { payFor } from '../lib/pay';
import { useToday } from '../lib/useToday';

/**
 * මූල්‍ය — where the month's money came from and where it went, down to the
 * entries behind every figure. Admin only.
 *
 * Income is listed by material; expenses by what they were spent on; and what
 * each material cost is worked out from the two, by load.
 */
export function FinancePage() {
  const { crew, store } = useLiveData();
  const now = useNow();
  const today = useToday();
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [version, setVersion] = useState(0);

  const sales = useMonthSales(month);
  const previousSales = useMonthSales(addMonths(month, -1));
  const bills = useMonthBills(month);
  const movements = useMonthMovements(month);
  const crewMonths = useCrewMonths(crew, month, version);
  const previousCrew = useCrewMonths(crew, addMonths(month, -1), version);
  const prices = useSalesPrices();
  const payments = usePayments();
  const landowner = useLandownerRates();
  const royaltyRates = useRoyaltyRates();

  // Last month's gross, from the same days and loads — no bills, as gross never takes them off.
  // A driller's loads and bonus come from that month's sales, so those are waited for too.
  const previousSalesData = previousSales.data;
  const previousGross =
    previousCrew.data && previousSalesData
      ? previousCrew.data.reduce(
          (total, { person, days, tally }) => total + payFor(person, days, tally, [], null, today, previousSalesData).gross,
          0,
        )
      : null;

  const finance = useMemo(
    () =>
      sales.data &&
      bills.data &&
      movements.data &&
      crewMonths.data &&
      prices.data &&
      payments.data &&
      landowner.data &&
      royaltyRates.data
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
            royaltyRates: royaltyRates.data,
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
      royaltyRates.data,
      store,
      now,
      today,
    ],
  );

  const failure =
    sales.error ?? bills.error ?? movements.error ?? prices.error ?? payments.error ?? landowner.error ?? royaltyRates.error;

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
      ) : !finance || !prices.data ? (
        <Loading />
      ) : (
        <FinanceReport finance={finance} previousGross={previousGross} prices={prices.data} />
      )}
    </>
  );
}

const perLoad = (value: number | null) => (value == null ? '—' : money(value));

function FinanceReport({
  finance,
  previousGross,
  prices,
}: {
  finance: Finance;
  previousGross: number | null;
  prices: SalesPrices;
}) {
  const crew = crewSummaryFor(finance.salaries);
  const change = previousGross ? finance.salaryTotal - previousGross : null;
  const [open, setOpen] = useState<ExpenseCategory | null>(null);
  const [editingMachine, setEditingMachine] = useState(false);
  const { allocation } = finance;

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
        ඩීසල්, ඔයිල්, කරල්, වෙඩි බඩු සහ කොටස් වියදමට ගණන් ගන්නේ ඒවා <b className="text-white/80">භාවිත කළ</b> මාසයේ, භාවිත කළ දවසේ
        මිලට — මිලදී ගත් මාසයේ නොවේ.
        {finance.unmatchedUsage > 0 && (
          <span className="mt-1 block font-semibold text-signal">
            ගබඩා අයිතමයක් නැතිව සටහන් වූ භාවිත {finance.unmatchedUsage}ක් ඇත — ඒවායේ වටිනාකම ගණන් නොගනී, එබැවින් වියදම මෙයට
            වඩා තරමක් වැඩි විය හැක.
          </span>
        )}
      </p>

      {/* ---- income ---- */}
      <section className="mb-8">
        <SectionLabel>ආදායම</SectionLabel>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel className="p-4 sm:p-5">
            <p className="mb-3 text-sm font-bold">ද්‍රව්‍ය අනුව</p>
            {finance.byMaterial.length === 0 ? (
              <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ තහවුරු කළ විකුණුම් නැත.</p>
            ) : (
              <TableFrame>
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>ද්‍රව්‍යය</th>
                      <th className={cx(th, 'text-right')}>බිල්පත්</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ්</th>
                      <th className={cx(th, 'text-right')}>ආදායම</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ් එකකට</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.byMaterial.map((row) => (
                      <tr key={row.material ?? 'none'} className="border-b border-hairline/60">
                        <td className={td}>
                          <MaterialName row={row} />
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>{row.count}</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{quantity(row.loads)}</td>
                        <td className={cx(td, 'text-right font-extrabold text-lime-hi tabular-nums')}>{money(row.amount)}</td>
                        <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{perLoad(row.incomePerLoad)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-hairline font-extrabold">
                      <td className={td}>එකතුව</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {finance.byMaterial.reduce((total, row) => total + row.count, 0)}
                      </td>
                      <td className={cx(td, 'text-right tabular-nums')}>{quantity(allocation.allLoads)}</td>
                      <td className={cx(td, 'text-right text-lime-hi tabular-nums')}>{money(finance.income)}</td>
                      <td className={td} />
                    </tr>
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Panel>

          <Panel className="p-4 sm:p-5">
            <p className="mb-3 text-sm font-bold">ලැබුණු ආකාරය</p>
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
        </div>
      </section>

      {/* ---- expenses ---- */}
      <section className="mb-8">
        <SectionLabel
          trailing={
            <Button variant="secondary" onClick={() => setEditingMachine(true)}>
              යන්ත්‍රයට පැයකට රු. {money(prices.machineHourly)} — වෙනස් කරන්න
            </Button>
          }
        >
          වියදම් — වර්ග අනුව
        </SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.expenseRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ වියදමක් නැත.</p>
          ) : (
            <ul className="space-y-3">
              {finance.expenseRows.map((line) => {
                const share = finance.expenses > 0 ? Math.max(0, (line.value / finance.expenses) * 100) : 0;
                const entries = open === line.key ? finance.ledger.filter((entry) => entry.category === line.key) : [];
                return (
                  <li key={line.key}>
                    <button
                      type="button"
                      aria-expanded={open === line.key}
                      onClick={() => setOpen((current) => (current === line.key ? null : line.key))}
                      className="block w-full rounded-control px-1 py-1 text-left transition hover:bg-black/20"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="flex-1 text-sm font-bold">
                          {line.label}
                          {line.shared && (
                            <span className="ml-2 rounded-full bg-well px-2 py-0.5 text-[10px] font-semibold text-white/65 ring-1 ring-hairline">
                              ලෝඩ් සියල්ලටම බෙදේ
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-white/55">{`${Math.round(share)}%`}</span>
                        <span className="w-28 text-right font-extrabold tabular-nums">{money(line.value)}</span>
                        <ChevronDown
                          className={cx('size-4 shrink-0 text-white/50 transition', open === line.key && 'rotate-180')}
                        />
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-well">
                        <div className="h-full rounded-full bg-amber-hi" style={{ width: `${share}%` }} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/55">{line.detail}</p>
                    </button>
                    {open === line.key && (
                      <div className="mt-2 rounded-control bg-well p-3 ring-1 ring-hairline">
                        {entries.length === 0 ? (
                          <p className="py-2 text-center text-xs text-white/55">සටහන් නැත.</p>
                        ) : (
                          <TableFrame>
                            <table className="w-full min-w-[480px] border-collapse text-xs">
                              <tbody>
                                {entries.map((entry, index) => (
                                  <tr key={index} className="border-b border-hairline/60 last:border-0">
                                    <td className={cx(td, 'whitespace-nowrap text-white/70 tabular-nums')}>{entry.date}</td>
                                    <td className={td}>{entry.description}</td>
                                    <td className={cx(td, 'text-right font-bold tabular-nums')}>{money(entry.expense)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </TableFrame>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
        {editingMachine && <MachineRateModal prices={prices} onClose={() => setEditingMachine(false)} />}
      </section>

      <RoyaltySection royalty={finance.royalty} />

      {/* ---- what each material cost ---- */}
      <section className="mb-8">
        <SectionLabel>ද්‍රව්‍ය අනුව ලාභය</SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.byMaterial.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ තහවුරු කළ විකුණුම් නැත.</p>
          ) : (
            <>
              <TableFrame>
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>ද්‍රව්‍යය</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ්</th>
                      <th className={cx(th, 'text-right')}>ආදායම</th>
                      <th className={cx(th, 'text-right')}>ඩීසල්</th>
                      <th className={cx(th, 'text-right')}>අනෙක් වියදම්</th>
                      <th className={cx(th, 'text-right')}>ලාභය</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ් එකකට වියදම</th>
                      <th className={cx(th, 'text-right')}>ලෝඩ් එකකට ලාභය</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.byMaterial.map((row) => (
                      <tr key={row.material ?? 'none'} className="border-b border-hairline/60">
                        <td className={td}>
                          <MaterialName row={row} />
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>{quantity(row.loads)}</td>
                        <td className={cx(td, 'text-right text-lime-hi tabular-nums')}>{money(row.amount)}</td>
                        <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(row.dieselShare)}</td>
                        <td className={cx(td, 'text-right text-white/75 tabular-nums')}>
                          {isMainMaterial(row.material) ? money(row.otherShare) : '—'}
                        </td>
                        <td className={cx(td, 'text-right font-extrabold tabular-nums', row.profit < 0 && 'text-red-300')}>
                          {money(row.profit)}
                        </td>
                        <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{perLoad(row.costPerLoad)}</td>
                        <td className={cx(td, 'text-right font-bold tabular-nums', (row.profitPerLoad ?? 0) < 0 && 'text-red-300')}>
                          {perLoad(row.profitPerLoad)}
                        </td>
                      </tr>
                    ))}
                    {allocation.unallocated > 0 && (
                      <tr className="border-b border-hairline/60 text-white/60">
                        <td className={td} colSpan={5}>
                          බෙදිය නොහැකි වියදම්
                          <span className="block text-[11px] text-white/45">
                            ඒවා දැරිය යුතු ලෝඩ් මේ මාසයේ ගියේ නැත
                          </span>
                        </td>
                        <td className={cx(td, 'text-right tabular-nums text-red-300')}>− {money(allocation.unallocated)}</td>
                        <td className={td} colSpan={2} />
                      </tr>
                    )}
                    <tr className="border-t border-hairline font-extrabold">
                      <td className={td}>එකතුව</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{quantity(allocation.allLoads)}</td>
                      <td className={cx(td, 'text-right text-lime-hi tabular-nums')}>{money(finance.income)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{money(allocation.sharedTotal)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{money(allocation.otherTotal)}</td>
                      <td className={cx(td, 'text-right tabular-nums', finance.profit < 0 && 'text-red-300')}>{money(finance.profit)}</td>
                      <td className={td} colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </TableFrame>
              <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-white/55">
                <li>
                  <b className="text-white/75">ඩීසල්</b> — ගිය ලෝඩ් {quantity(allocation.allLoads)} සියල්ලටම බෙදේ
                  {allocation.sharedPerLoad != null && <>: ලෝඩ් එකකට රු. {money(allocation.sharedPerLoad)}</>}.
                </li>
                <li>
                  <b className="text-white/75">අනෙක් සියලු වියදම්</b> (පඩි, කෑම, බදු හිමියා, රාජ භාගය, යන්ත්‍රයට, කරල්, ඔයිල්…) —
                  6/9, බෝල්දාස්, C1 ලෝඩ් {quantity(allocation.mainLoads)} ට පමණක් බෙදේ
                  {allocation.otherPerMainLoad != null && <>: ලෝඩ් එකකට රු. {money(allocation.otherPerMainLoad)}</>}. සක්කර සහ කෝරි ඩස්ට්
                  වලට ඩීසල් පමණක් ගැනේ.
                </li>
                <li>ලෝඩ් එකකට වියදම යනු එම ද්‍රව්‍යයේ ලෝඩ් එකක් අවම වශයෙන් විකුණිය යුතු මිලයි (බ්‍රේක්-ඊවන්).</li>
              </ul>
            </>
          )}
        </Panel>
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
              ඩීසල්, ඔයිල්, වෙඩි බඩු සහ කොටස් — ගබඩාවෙන් ගිය දේ, එවකට මිලට. මේවා භාවිත කළ මාසයේ වියදමට ගණන් ගනී; ඉහත වියදම්
              වර්ග මෙයින් ගොඩනැගේ.
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
                      <td className={cx(td, 'text-xs whitespace-nowrap text-white/65')}>
                        {entry.category ? EXPENSE_LABEL[entry.category].label : KIND_LABEL[entry.kind]}
                      </td>
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

/**
 * රාජ භාගය, with the working: the gel and the ammonia the drillers signed off,
 * and each step from there to the rupees. The rates are the admin's to change.
 */
function RoyaltySection({ royalty }: { royalty: RoyaltyReport }) {
  const [editing, setEditing] = useState(false);
  const { rates } = royalty;
  const steps: { label: string; working: string; value: string; strong?: boolean }[] = [
    {
      label: 'ජෙල් කරල්',
      working: `කරල් ${quantity(royalty.shells)} ÷ ${quantity(royalty.shellsPerKg)} (kg 1කට කරල්)`,
      value: `${quantity(royalty.gelKg)} kg`,
    },
    { label: 'ඇමෝනියා', working: '', value: `${quantity(royalty.ammoniaKg)} kg` },
    { label: 'ජෙල් + ඇමෝනියා', working: '', value: `${quantity(royalty.kg)} kg` },
    {
      label: 'කියුබ්',
      working: `× ${quantity(rates.cubesPerKg)} (kg එකකට)`,
      value: quantity(royalty.cubes),
    },
    { label: 'වටිනාකම', working: `× රු. ${money(rates.cubeValue)} (කියුබ් එකකට)`, value: rupees(royalty.worth) },
    { label: 'රාජ භාගය', working: `× ${quantity(rates.percent)}%`, value: rupees(royalty.royalty), strong: true },
  ];

  return (
    <section className="mb-8">
      <SectionLabel
        trailing={
          <Button variant="secondary" onClick={() => setEditing(true)}>
            අනුපාත වෙනස් කරන්න
          </Button>
        }
      >
        රාජ භාගය — ගණනය
      </SectionLabel>
      <Panel className="p-4 sm:p-5">
        <p className="mb-3 text-xs leading-relaxed text-white/60">
          (ජෙල් kg + ඇමෝනියා kg) × {quantity(rates.cubesPerKg)} × රු. {money(rates.cubeValue)} × {quantity(rates.percent)}% —
          කම්පසර් කණ්ඩායම් OK කළ වෙඩි බඩු වාර්තා වලින්. ජෙල් කරල් kg වලට හරවන්නේ ගබඩා අයිතමයේ "kg 1කට කරල් ගණන" අනුවයි.
        </p>
        {royalty.days.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/60">මෙම මාසයේ OK කළ ජෙල් / ඇමෝනියා භාවිතයක් නැත.</p>
        ) : (
          <TableFrame>
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <tbody>
                {steps.map((step) => (
                  <tr key={step.label} className={cx('border-b border-hairline/60 last:border-0', step.strong && 'font-extrabold')}>
                    <td className={td}>{step.label}</td>
                    <td className={cx(td, 'text-xs text-white/60')}>{step.working}</td>
                    <td className={cx(td, 'text-right tabular-nums', step.strong && 'text-amber-hi')}>{step.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
        {royalty.paid > 0 && (
          <p className="mt-3 text-xs text-white/60">
            මෙම මාසයේ රාජ භාගය ලෙස ඇතුළත් කළ බිල්පත් රු. {money(royalty.paid)} — ගෙවූ මුදල පෙන්වයි; වියදමට ගණන් ගන්නේ ඉහත ගණනය
            කළ රාජ භාගයයි.
          </p>
        )}
      </Panel>
      {editing && <RoyaltyModal rates={rates} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** What the ledger calls an entry that is not an expense of any category. */
const KIND_LABEL: Record<LedgerKind, string> = {
  sale: 'විකුණුම',
  payment: 'ණය ගෙවීම',
  machine: 'යන්ත්‍රයට',
  landowner: 'බදු හිමියාට',
  royalty: 'රාජ භාගය',
  bill: 'බිල්පත',
  usage: 'ගබඩා භාවිතය',
  salary: 'වැටුප් ශේෂය',
};

/** A material's name, with whether it is a main one or carries diesel only. */
function MaterialName({ row }: { row: MaterialRow }) {
  if (!row.material) return <span className="text-white/60">ද්‍රව්‍යය සටහන් නොකළ</span>;
  return (
    <>
      <span className="font-bold">{SALE_MATERIAL[row.material]}</span>
      <span className="block text-[11px] text-white/45">
        {isMainMaterial(row.material) ? 'ප්‍රධාන ද්‍රව්‍යය' : 'අමතර — ඩීසල් පමණි'}
      </span>
    </>
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
