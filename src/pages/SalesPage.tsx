import { ChevronLeft, ChevronRight, Plus, ShoppingCart, Tag, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { DataError } from '../components/DataError';
import { PricesModal } from '../components/PricesModal';
import { SaleModal } from '../components/SaleModal';
import { SaleReceiptModal, SaleStatusBadge } from '../components/SaleReceipt';
import {
  Button,
  EmptyState,
  IconButton,
  Loading,
  PageHeader,
  Panel,
  Segmented,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useMonthSales, useNow, useSalesPrices } from '../data/sales';
import { addMonths, dateTime, money, monthKey, monthLabel, quantity, rupees } from '../lib/format';
import { SALE_STATUS, SALE_TYPE, formatSaleCode, saleNumber, saleStatus, type Sale, type SaleStatus } from '../lib/model';

type Filter = 'all' | SaleStatus;

export function SalesPage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const now = useNow();

  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [editingPrices, setEditingPrices] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);

  const prices = useSalesPrices();
  const sales = useMonthSales(month);
  const all = sales.data ?? [];
  const statusOf = (sale: Sale) => saleStatus(sale, now);
  const shown = filter === 'all' ? all : all.filter((sale) => statusOf(sale) === filter);

  const totalOf = (status: SaleStatus) => {
    const list = all.filter((sale) => statusOf(sale) === status);
    return { count: list.length, amount: list.reduce((sum, sale) => sum + sale.amount, 0) };
  };
  const verified = totalOf('verified');
  const pending = totalOf('pending');
  const cancelled = totalOf('cancelled');

  return (
    <>
      <PageHeader
        title="විකුණුම්"
        subtitle="කියුබ් සහ ට්‍රැක්ටර් ලෝඩ් බිල්පත්. QR එක ස්කෑන් කර තහවුරු කළ පසු පමණක් ආදායමක් ලෙස ගණන් වේ; පැය 24ක් ඇතුළත තහවුරු නොකළ බිල්පත් අවලංගු වේ."
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
            {permissions.addSales && (
              <Button icon={<Plus className="size-4" />} disabled={!prices.data} onClick={() => setCreating(true)}>
                නව බිල්පතක්
              </Button>
            )}
          </>
        }
      />

      {prices.data === null ? (
        <Panel tone="deep" className="mb-6 flex flex-wrap items-center gap-3 p-4">
          <TriangleAlert className="size-5 text-signal" />
          <p className="flex-1 text-sm font-bold text-signal">
            කියුබ් එකක සහ ට්‍රැක්ටර් ලෝඩ් එකක මිල තවම සකසා නැත — බිල්පත් සෑදීමට පෙර සකසන්න.
          </p>
          {permissions.setSalePrices && <Button onClick={() => setEditingPrices(true)}>මිල සකසන්න</Button>}
        </Panel>
      ) : (
        prices.data && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Tag className="size-4 text-white/60" />
            <span className="rounded-full bg-well px-3 py-1.5 text-sm font-bold ring-1 ring-hairline">
              කියුබ් එකක් <span className="text-amber-hi tabular-nums">{rupees(prices.data.cubePrice)}</span>
            </span>
            <span className="rounded-full bg-well px-3 py-1.5 text-sm font-bold ring-1 ring-hairline">
              ට්‍රැක්ටර් ලෝඩ් එකක් <span className="text-amber-hi tabular-nums">{rupees(prices.data.tractorPrice)}</span>
            </span>
            {permissions.setSalePrices && (
              <Button variant="ghost" size="sm" onClick={() => setEditingPrices(true)}>
                මිල වෙනස් කරන්න
              </Button>
            )}
          </div>
        )
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="ආදායම (තහවුරුයි)" value={rupees(verified.amount)} detail={`බිල්පත් ${verified.count}`} tone="ok" />
        <Tile label="තහවුරු වීමට ඇති" value={rupees(pending.amount)} detail={`බිල්පත් ${pending.count}`} tone="low" />
        <Tile label="අවලංගු වූ" value={rupees(cancelled.amount)} detail={`බිල්පත් ${cancelled.count}`} tone="out" />
        <Tile label="සෑදූ සියලු බිල්පත්" value={String(all.length)} detail={monthLabel(month)} />
      </div>

      <Panel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'සියල්ල' },
              { value: 'verified', label: SALE_STATUS.verified },
              { value: 'pending', label: SALE_STATUS.pending },
              { value: 'cancelled', label: SALE_STATUS.cancelled },
            ]}
          />
          <span className="ml-auto text-sm text-white/70">
            {shown.length} බිල්පත් · <b className="text-white">{rupees(shown.reduce((sum, sale) => sum + sale.amount, 0))}</b>
          </span>
        </div>

        {sales.error ? (
          <DataError error={sales.error} />
        ) : sales.data === undefined ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon={<ShoppingCart className="size-7" />} title="මෙම මාසයේ විකුණුම් බිල්පත් නැත" />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>බිල් අංකය</th>
                  <th className={th}>සෑදුවේ</th>
                  <th className={th}>වර්ගය</th>
                  <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
                  <th className={cx(th, 'text-right')}>ඒකක මිල</th>
                  <th className={cx(th, 'text-right')}>මුදල</th>
                  <th className={th}>පාරිභෝගිකයා</th>
                  <th className={th}>තත්වය</th>
                  <th className={th}>තහවුරු කළේ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((sale) => (
                  <tr
                    key={sale.code}
                    onClick={() => setShowing(sale.code)}
                    className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-white/5"
                  >
                    <td className={cx(td, 'whitespace-nowrap')}>
                      <span className="text-base font-extrabold tabular-nums">{saleNumber(sale)}</span>
                      <span className="block font-mono text-xs tracking-wider text-white/55">
                        {formatSaleCode(sale.code)}
                      </span>
                    </td>
                    <td className={cx(td, 'text-xs whitespace-nowrap text-white/75')}>
                      {dateTime(sale.createdAt)}
                      <span className="block text-white/55">{sale.createdByName || '—'}</span>
                    </td>
                    <td className={td}>{SALE_TYPE[sale.type].label}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{quantity(sale.quantity)}</td>
                    <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(sale.unitPrice)}</td>
                    <td className={cx(td, 'text-right text-base font-extrabold tabular-nums')}>{money(sale.amount)}</td>
                    <td className={td}>
                      <span className="font-semibold">{sale.customerName || '—'}</span>
                      <span className="block text-xs text-white/55">
                        {[sale.customerPhone, sale.vehicleNo].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </td>
                    <td className={td}>
                      <SaleStatusBadge status={statusOf(sale)} />
                    </td>
                    <td className={cx(td, 'text-xs whitespace-nowrap text-white/75')}>
                      {sale.verifiedAt ? (
                        <>
                          {sale.verifiedByName || '—'}
                          <span className="block text-white/55">{dateTime(sale.verifiedAt)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      {creating && (
        <SaleModal
          onClose={() => setCreating(false)}
          onCreated={(code) => {
            setCreating(false);
            setShowing(code);
          }}
        />
      )}
      {editingPrices && <PricesModal prices={prices.data ?? null} onClose={() => setEditingPrices(false)} />}
      {showing && <SaleReceiptModal code={showing} onClose={() => setShowing(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'ok' | 'low' | 'out';
}) {
  return (
    <div className="rounded-card bg-well px-4 py-3 ring-1 ring-hairline">
      <p className="text-xs font-semibold text-white/60">{label}</p>
      <p
        className={cx(
          'mt-1 text-xl font-extrabold tabular-nums',
          tone === 'ok' && 'text-lime-hi',
          tone === 'low' && 'text-signal',
          tone === 'out' && 'text-red-300',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-white/55">{detail}</p>
    </div>
  );
}
