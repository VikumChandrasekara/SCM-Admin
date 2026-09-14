import { ChevronLeft, ChevronRight, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { DataError } from '../components/DataError';
import { IconButton, Loading, PageHeader, Panel, SectionLabel, TableFrame, cx, td, th } from '../components/ui';
import { useMonthBills } from '../data/bills';
import { useCrewMonths, useMonthMovements } from '../data/finance';
import { useLiveData } from '../data/LiveData';
import { useMonthSales, useNow } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { financeFor, type Finance, type LedgerKind, type StockRow } from '../lib/finance';
import { addMonths, money, monthKey, monthLabel, quantity, rupees } from '../lib/format';
import { BILL, BILL_CATEGORIES, ROLES, SALE_TYPE, SALE_TYPES, nameOf } from '../lib/model';

/**
 * මූල්‍ය — where the month's money came from and where it went, down to the
 * entries behind every figure. Admin only.
 */
export function FinancePage() {
  const { crew, store } = useLiveData();
  const now = useNow();
  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [version, setVersion] = useState(0);

  const sales = useMonthSales(month);
  const bills = useMonthBills(month);
  const movements = useMonthMovements(month);
  const crewMonths = useCrewMonths(crew, month, version);

  const finance = useMemo(
    () =>
      sales.data && bills.data && movements.data && crewMonths.data
        ? financeFor({
            month,
            sales: sales.data,
            bills: bills.data,
            movements: movements.data,
            crewMonths: crewMonths.data,
            store,
            now,
          })
        : null,
    [month, sales.data, bills.data, movements.data, crewMonths.data, store, now],
  );

  const failure = sales.error ?? bills.error ?? movements.error;

  return (
    <>
      <PageHeader
        title="මූල්‍ය වාර්තාව"
        subtitle="ආදායම් ලැබුණු ආකාරය සහ වියදම් ගිය ආකාරය — එක් එක් ගණනට පිටුපස ඇති සියලු සටහන් සමඟ."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-2xl bg-well p-1">
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
        <FinanceReport finance={finance} />
      )}
    </>
  );
}

function FinanceReport({ finance }: { finance: Finance }) {
  const expenseLines: { label: string; value: number; detail: string }[] = [
    { label: 'කණ්ඩායම් වැටුප්', value: finance.salaryTotal, detail: 'දවසේ පඩිය, බෝනස් සහ ආඩි — ඇඩ්වාන්ස් සහ කෑම ඇතුළුව' },
    { label: 'ගබඩා මිලදී ගැනීම්', value: finance.purchaseTotal, detail: 'නව අයිතම සහ තොග එකතු කිරීම්' },
    ...BILL_CATEGORIES.filter((category) => finance.siteBills[category] > 0).map((category) => ({
      label: `${BILL[category].label} බිල්පත්`,
      value: finance.siteBills[category],
      detail: BILL[category].deduction ? 'කිසිවෙකුගේ පඩියට අය නොකළ' : 'අඩවි වියදම්',
    })),
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
            <p className="mt-4 flex justify-between border-t border-hairline pt-3 text-sm font-extrabold">
              <span>මුළු වියදම</span>
              <span className="tabular-nums">{rupees(finance.expenses)}</span>
            </p>
          </Panel>
        </section>
      </div>

      <section className="mb-8">
        <SectionLabel>කණ්ඩායම් වැටුප්</SectionLabel>
        <Panel className="p-4 sm:p-5">
          {finance.salaries.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/60">කණ්ඩායම් සාමාජිකයින් නැත.</p>
          ) : (
            <TableFrame>
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={th}>නම</th>
                    <th className={cx(th, 'text-right')}>වැඩ කළ දින</th>
                    <th className={cx(th, 'text-right')}>දවසේ පඩිය</th>
                    <th className={cx(th, 'text-right')}>බෝනස් / ආඩි</th>
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
                      <td className={cx(td, 'text-right tabular-nums')}>{money(pay.bonusPay + pay.feetPay)}</td>
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
          <SectionLabel>ගබඩා මිලදී ගැනීම්</SectionLabel>
          <Panel className="p-4 sm:p-5">
            <StockTable rows={finance.purchases} total={finance.purchaseTotal} empty="මෙම මාසයේ මිලදී ගැනීම් නැත." />
          </Panel>
        </section>

        <section>
          <SectionLabel>යන්ත්‍ර සඳහා භාවිත වූ බඩු</SectionLabel>
          <Panel tone="deep" className="p-4 sm:p-5">
            <p className="mb-3 text-xs text-white/60">
              ඩීසල්, ඔයිල්, වෙඩි බඩු සහ කොටස් — ගබඩාවෙන් ගිය දේ, එවකට මිලට. මේවා මිලදී ගත් විට දැනටමත් වියදමට එකතු වී
              ඇති නිසා මුළු වියදමට නැවත එකතු නොකරයි.
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
  bill: 'බිල්පත',
  purchase: 'ගබඩා මිලදී ගැනීම',
  salary: 'වැටුප් ශේෂය',
};

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
        'rounded-2xl px-4 py-4 ring-1',
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
