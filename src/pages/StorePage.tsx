import { Boxes, Minus, PackagePlus, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { DataError } from '../components/DataError';
import { DeleteItemModal, ItemModal, StockChangeModal } from '../components/StockModals';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  Loading,
  PageHeader,
  Panel,
  SectionLabel,
  Segmented,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useLiveData } from '../data/LiveData';
import { useMovements, type StockChange } from '../data/store';
import { stockAlerts } from '../lib/alerts';
import { dateTime, money, quantity, rupees } from '../lib/format';
import {
  MOVEMENT_LABEL,
  STOCK_LABEL,
  linkLabel,
  sourceLabel,
  stockStatus,
  type Movement,
  type StoreItem,
} from '../lib/model';

type Filter = 'all' | 'alerts' | 'linked';

export function StorePage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const { store, ready } = useLiveData();
  // The log grows for ever; a page of it at a time keeps a slow line quick.
  const [logSize, setLogSize] = useState(25);
  const movements = useMovements(logSize);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<StoreItem | 'new' | null>(null);
  const [changing, setChanging] = useState<{ item: StoreItem; mode: StockChange } | null>(null);
  const [deleting, setDeleting] = useState<StoreItem | null>(null);

  if (!ready) return <Loading />;

  const alerts = stockAlerts(store);
  const value = store.reduce((sum, item) => sum + Math.max(item.quantity, 0) * item.unitPrice, 0);
  const needle = search.trim().toLowerCase();
  const shown = store.filter(
    (item) =>
      (filter === 'all' || (filter === 'alerts' ? stockStatus(item) !== 'ok' : item.link != null)) &&
      (!needle || item.name.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="ගබඩාව"
        subtitle={
          permissions.editItems
            ? 'අයිතම එකතු කිරීම, තොග යාවත්කාලීන කිරීම සහ භාවිතය.'
            : 'තොග ප්‍රමාණ යාවත්කාලීන කිරීම. නව අයිතම එකතු කරන්නේ පරිපාලක පමණි.'
        }
        actions={
          permissions.editItems && (
            <Button icon={<PackagePlus className="size-4" />} onClick={() => setEditing('new')}>
              නව අයිතමයක්
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="අයිතම" value={String(store.length)} />
        <Summary label="තොග අඩුයි" value={String(alerts.filter((alert) => alert.status === 'low').length)} tone="low" />
        <Summary label="තොග අවසන්" value={String(alerts.filter((alert) => alert.status === 'out').length)} tone="out" />
        <Summary label="තොගයේ වටිනාකම" value={rupees(value)} />
      </div>

      {alerts.length > 0 && (
        <Panel tone="deep" className="mb-6 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-signal">
            <TriangleAlert className="size-5" /> තොග අනතුරු ඇඟවීම්
          </p>
          <div className="flex flex-wrap gap-2">
            {alerts.map(({ item, status }) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setChanging({ item, mode: 'restock' })}
                className="flex items-center gap-2 rounded-xl bg-well px-3 py-2 text-left hover:bg-black/30"
              >
                <span className="text-sm font-bold">{item.name}</span>
                <span className="text-xs text-white/65">
                  {quantity(item.quantity, item.unit)} / අවම {quantity(item.minQuantity, item.unit)}
                </span>
                <Badge tone={status}>{STOCK_LABEL[status]}</Badge>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="mb-8 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="අයිතමයක් සොයන්න"
              className="pl-9"
            />
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'සියල්ල' },
              { value: 'alerts', label: 'අඩු / අවසන්' },
              { value: 'linked', label: 'කණ්ඩායම් භාවිතය' },
            ]}
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-7" />}
            title={store.length === 0 ? 'ගබඩාවේ තවම අයිතම නැත' : 'ගැළපෙන අයිතම නැත'}
            detail={
              store.length === 0 && permissions.editItems
                ? 'ඩීසල්, ඔයිල්, කැප් වැනි අයිතම එකතු කර ඒවා කණ්ඩායම් භාවිතයට සම්බන්ධ කරන්න.'
                : undefined
            }
          />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>අයිතමය</th>
                  <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
                  <th className={cx(th, 'text-right')}>අවම</th>
                  <th className={cx(th, 'text-right')}>ඒකක මිල</th>
                  <th className={cx(th, 'text-right')}>වටිනාකම</th>
                  <th className={th}>තත්වය</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const status = stockStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-hairline/60 last:border-0">
                      <td className={td}>
                        <p className="font-bold">{item.name}</p>
                        <p className="text-xs text-white/60">{item.link ? linkLabel(item.link) : item.note || 'අතින් පමණි'}</p>
                      </td>
                      <td className={cx(td, 'text-right text-base font-extrabold tabular-nums')}>
                        {quantity(item.quantity, item.unit)}
                      </td>
                      <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{quantity(item.minQuantity, item.unit)}</td>
                      <td className={cx(td, 'text-right text-white/75 tabular-nums')}>
                        {item.unitPrice > 0 ? money(item.unitPrice) : '—'}
                      </td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {item.unitPrice > 0 ? money(Math.max(item.quantity, 0) * item.unitPrice) : '—'}
                      </td>
                      <td className={td}>
                        <Badge tone={status}>{STOCK_LABEL[status]}</Badge>
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <div className="flex justify-end gap-1">
                          <IconButton label="තොග එකතු කරන්න" onClick={() => setChanging({ item, mode: 'restock' })}>
                            <Plus className="size-4" />
                          </IconButton>
                          <IconButton label="තොග අඩු කරන්න" onClick={() => setChanging({ item, mode: 'use' })}>
                            <Minus className="size-4" />
                          </IconButton>
                          {permissions.editItems && (
                            <>
                              <IconButton label="සංස්කරණය" onClick={() => setEditing(item)}>
                                <Pencil className="size-4" />
                              </IconButton>
                              <IconButton label="ඉවත් කරන්න" onClick={() => setDeleting(item)} className="hover:text-red-200">
                                <Trash2 className="size-4" />
                              </IconButton>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      <SectionLabel>තොග චලනයන්</SectionLabel>
      <Panel tone="deep" className="p-4 sm:p-5">
        {movements.error ? (
          <DataError error={movements.error} />
        ) : movements.data === undefined ? (
          <Loading />
        ) : movements.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/60">තවම චලනයන් නැත.</p>
        ) : (
          <TableFrame>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>වේලාව</th>
                  <th className={th}>වර්ගය</th>
                  <th className={th}>අයිතම</th>
                  <th className={th}>විස්තරය</th>
                  <th className={th}>කළේ</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </tbody>
            </table>
            {movements.data.length >= logSize && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => setLogSize((size) => size + 25)}>
                  පෙර චලනයන් තවත් පෙන්වන්න
                </Button>
              </div>
            )}
          </TableFrame>
        )}
      </Panel>

      {editing && <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {changing && <StockChangeModal item={changing.item} initial={changing.mode} onClose={() => setChanging(null)} />}
      {deleting && <DeleteItemModal item={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'low' | 'out' }) {
  return (
    <div className="rounded-card bg-well px-4 py-3 ring-1 ring-hairline">
      <p className="text-xs font-semibold text-white/60">{label}</p>
      <p
        className={cx(
          'mt-1 text-2xl font-extrabold tabular-nums',
          tone === 'low' && value !== '0' && 'text-signal',
          tone === 'out' && value !== '0' && 'text-red-300',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MovementRow({ movement }: { movement: Movement }) {
  const detail =
    movement.type === 'usage'
      ? [movement.operatorName, movement.machineId, movement.date, sourceLabel(movement.source)].filter(Boolean).join(' · ')
      : movement.note;

  return (
    <tr className="border-b border-hairline/60 align-top last:border-0">
      <td className={cx(td, 'text-xs whitespace-nowrap text-white/70')}>{dateTime(movement.createdAt)}</td>
      <td className={td}>
        <Badge tone={movement.type === 'usage' || movement.type === 'use' ? 'info' : movement.type === 'restock' ? 'ok' : 'muted'}>
          {MOVEMENT_LABEL[movement.type]}
        </Badge>
      </td>
      <td className={td}>
        {movement.items.map((line) => (
          <p key={line.itemId} className="whitespace-nowrap">
            {line.name}{' '}
            <b className={cx('tabular-nums', line.delta < 0 ? 'text-red-200' : 'text-lime-hi')}>
              {line.delta > 0 ? '+' : ''}
              {quantity(line.delta, line.unit)}
            </b>
          </p>
        ))}
        {movement.unmatched.length > 0 && (
          <p className="text-xs text-white/55">ගබඩා අයිතමයක් නැත: {movement.unmatched.map((link) => linkLabel(link as never)).join(', ')}</p>
        )}
      </td>
      <td className={cx(td, 'text-xs text-white/70')}>{detail || '—'}</td>
      <td className={cx(td, 'text-xs whitespace-nowrap text-white/70')}>{movement.createdByName || '—'}</td>
    </tr>
  );
}
