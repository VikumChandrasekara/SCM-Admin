import { ChevronLeft, ChevronRight, Pencil, Plus, ShoppingCart, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { CreditAccounts } from '../components/CreditAccounts';
import { DataError } from '../components/DataError';
import { PricesModal } from '../components/PricesModal';
import { SaleEditModal } from '../components/SaleEditModal';
import { SaleModal } from '../components/SaleModal';
import { SaleReceiptModal, SaleStatusBadge } from '../components/SaleReceipt';
import { useToast } from '../components/Toasts';
import {
  Button,
  EmptyState,
  IconButton,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Segmented,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { deleteSale, useMonthSales, useNow, useSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { addMonths, dateTime, money, monthKey, monthLabel, quantity, rupees } from '../lib/format';
import {
  SALE_STATUS,
  SALE_TYPE,
  awaitsPrepaidLoad,
  formatSaleCode,
  isSaleIncome,
  padSaleNumber,
  saleNumber,
  saleStatus,
  type Sale,
  type SaleStatus,
} from '../lib/model';

type Filter = 'all' | SaleStatus | 'prepaid';

export function SalesPage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const toast = useToast();
  const now = useNow();

  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [editingPrices, setEditingPrices] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState<Sale | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const prices = useSalesPrices();
  const sales = useMonthSales(month);
  const all = sales.data ?? [];
  const statusOf = (sale: Sale) => saleStatus(sale, now);
  // A prepaid bill waiting for its load is income, not "to be verified".
  const matches = (sale: Sale, value: Filter) =>
    value === 'all'
      ? true
      : value === 'prepaid'
        ? sale.prepaid
        : value === 'pending'
          ? statusOf(sale) === 'pending' && !sale.prepaid
          : statusOf(sale) === value;
  const shown = all.filter((sale) => matches(sale, filter));
  // The actions column is there when any bill on show is one this person may change.
  const editable = shown.some(permissions.canEditSale);

  const totalOf = (list: Sale[]) => ({ count: list.length, amount: list.reduce((sum, sale) => sum + sale.amount, 0) });
  const income = totalOf(all.filter((sale) => isSaleIncome(sale, now)));
  const prepaidOpen = all.filter((sale) => awaitsPrepaidLoad(sale, now)).length;
  const pending = totalOf(all.filter((sale) => matches(sale, 'pending')));
  const cancelled = totalOf(all.filter((sale) => matches(sale, 'cancelled')));

  async function confirmDelete(sale: Sale) {
    setDeleteBusy(true);
    try {
      const freed = await deleteSale(sale.code, profile);
      toast.success(
        freed == null
          ? 'බිල්පත ඉවත් කළා.'
          : `බිල්පත ඉවත් කළා — ඊළඟ බිල්පත ${padSaleNumber(freed)} ලෙස සෑදේ.`,
      );
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="විකුණුම්"
        subtitle="ටිපර් සහ ට්‍රැක්ටර් ලෝඩ් බිල්පත්. QR එක ස්කෑන් කර තහවුරු කළ පසු පමණක් ආදායමක් ලෙස ගණන් වේ; පැය 24ක් ඇතුළත තහවුරු නොකළ බිල්පත් අවලංගු වේ. කලින් ගෙවූ බිල්පත් ගෙවූ දින සිටම ආදායමයි, අවලංගු නොවේ."
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

      {prices.data && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Tag className="size-4 text-white/60" />
          <span className="rounded-full bg-well px-3 py-1.5 text-sm font-bold ring-1 ring-hairline">
            ටිපර් ලෝඩ් එකක් <span className="text-amber-hi tabular-nums">{rupees(prices.data.tipperPrice)}</span>
          </span>
          <span className="rounded-full bg-well px-3 py-1.5 text-sm font-bold ring-1 ring-hairline">
            ට්‍රැක්ටර් ලෝඩ් එකක් <span className="text-amber-hi tabular-nums">{rupees(prices.data.tractorPrice)}</span>
          </span>
          <span className="rounded-full bg-well px-3 py-1.5 text-sm font-bold ring-1 ring-hairline">
            යන්ත්‍රයට ලෝඩ් එකකට <span className="text-amber-hi tabular-nums">{rupees(prices.data.machineCharge)}</span>
          </span>
          {permissions.setSalePrices && (
            <Button variant="ghost" size="sm" onClick={() => setEditingPrices(true)}>
              මිල වෙනස් කරන්න
            </Button>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="ආදායම"
          value={rupees(income.amount)}
          detail={`බිල්පත් ${income.count}${prepaidOpen > 0 ? ` · කලින් ගෙවූ, ලෝඩ් ඉතිරි ${prepaidOpen}` : ''}`}
          tone="ok"
        />
        <Tile label="තහවුරු වීමට ඇති" value={rupees(pending.amount)} detail={`බිල්පත් ${pending.count}`} tone="low" />
        <Tile label="අවලංගු වූ" value={rupees(cancelled.amount)} detail={`බිල්පත් ${cancelled.count}`} tone="out" />
        <Tile label="සෑදූ සියලු බිල්පත්" value={String(all.length)} detail={monthLabel(month)} />
      </div>

      <CreditAccounts />

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
              { value: 'prepaid', label: 'කලින් ගෙවූ' },
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
                  {editable && <th className={cx(th, 'text-right')}>ක්‍රියා</th>}
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
                    <td className={cx(td, 'text-right tabular-nums')}>{quantity(sale.quantity, SALE_TYPE[sale.type].unit)}</td>
                    <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(sale.unitPrice)}</td>
                    <td className={cx(td, 'text-right text-base font-extrabold tabular-nums')}>{money(sale.amount)}</td>
                    <td className={td}>
                      <span className="font-semibold">{sale.customerName || '—'}</span>
                      <span className="block text-xs text-white/55">
                        {[sale.customerPhone, sale.vehicleNo].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </td>
                    <td className={td}>
                      <SaleStatusBadge status={statusOf(sale)} prepaid={sale.prepaid} />
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
                    {editable && (
                      // The row opens the bill; these must not.
                      <td className={cx(td, 'text-right')} onClick={(event) => event.stopPropagation()}>
                        {permissions.canEditSale(sale) && (
                          <div className="flex justify-end gap-1">
                            <IconButton label="සංස්කරණය" onClick={() => setEditing(sale)}>
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton label="ඉවත් කරන්න" onClick={() => setDeleting(sale)} className="hover:text-red-200">
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        )}
                      </td>
                    )}
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
      {editingPrices && prices.data && <PricesModal prices={prices.data} onClose={() => setEditingPrices(false)} />}
      {showing && <SaleReceiptModal code={showing} onClose={() => setShowing(null)} />}
      {editing && <SaleEditModal sale={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Modal
          open
          size="sm"
          title="බිල්පත ඉවත් කරන්නද?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                අවලංගු
              </Button>
              <Button variant="danger" busy={deleteBusy} onClick={() => void confirmDelete(deleting)}>
                ඉවත් කරන්න
              </Button>
            </>
          }
        >
          <p className="text-sm text-white/80">
            <b>{saleNumber(deleting)}</b> · {formatSaleCode(deleting.code)} · {SALE_TYPE[deleting.type].label} ·{' '}
            {deleting.customerName || '—'} · <b>{rupees(deleting.amount)}</b>
            {isSaleIncome(deleting, now) && (
              <span className="mt-2 block text-white/65">මෙය ආදායමක් ලෙස ගණන් වී ඇත — ඉවත් කළ විට එයින් අඩු වේ.</span>
            )}
            {deleting.paymentType === 'credit' && (
              <span className="mt-2 block text-white/65">පාරිභෝගිකයාගේ ණය ගිණුමෙන් ද අඩු වේ.</span>
            )}
            <span className="mt-2 block text-white/65">
              මාසයේ අවසාන බිල්පත නම් එහි අංකය ඊළඟ බිල්පතට නැවත ලැබේ; අතරමැදක් නම් එම අංකය හිස්ව පවතී. මෙය ආපසු හැරවිය නොහැක — විගණන සටහනේ විස්තර ඉතිරි වේ.
            </span>
          </p>
        </Modal>
      )}
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
