import { ChevronDown, ChevronRight, ClipboardPlus, Droplets, PackagePlus, Pencil, Trash2 } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { DataError } from '../components/DataError';
import { Pagination } from '../components/Pagination';
import { DeleteItemModal } from '../components/StockModals';
import { useToast } from '../components/Toasts';
import { UnitPicker } from '../components/UnitPicker';
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  TableFrame,
  Textarea,
  cx,
  td,
  th,
} from '../components/ui';
import { useLiveData } from '../data/LiveData';
import { addFuelRecord, deleteFuelRecord, fuelAmount, updateFuelRecord, useFuelRecords } from '../data/fuel';
import { createItem, updateItem } from '../data/store';
import { errorMessage } from '../lib/errors';
import { dateKey, dateTime, money, quantity, rupees } from '../lib/format';
import type { FuelRecord, StoreItem } from '../lib/model';

function parse(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const two = (value: number) => String(value).padStart(2, '0');

/** A date as a `datetime-local` input holds it, in this computer's time. */
function toInput(date: Date): string {
  return `${dateKey(date)}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * Fuel and oil bought and used straight away — diesel, the oils, petrol, black
 * oil. Nothing is stocked, so there is no count: each item has a price, and
 * every purchase is a record (how much, at what price, when) that adds to what
 * the item has cost and to the month's expenses on the finance page.
 */
export function FuelPage() {
  const { store, ready } = useLiveData();
  const [editing, setEditing] = useState<StoreItem | 'new' | null>(null);
  const [recording, setRecording] = useState<StoreItem | null>(null);
  const [deleting, setDeleting] = useState<StoreItem | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (!ready) return <Loading />;

  const items = store.filter((item) => item.direct).sort((a, b) => a.name.localeCompare(b.name));
  const total = items.reduce((sum, item) => sum + item.usedAmount, 0);

  return (
    <>
      <PageHeader
        title="ඉන්ධන සහ ඔයිල්"
        subtitle="ගන්නා විගස භාවිත කරන ඉන්ධන සහ ඔයිල් — මිල සහ භාවිත සටහන්. මෙහි එකතු කරන වියදම් මූල්‍ය වාර්තාවට ඇතුළත් වේ."
        actions={
          <Button icon={<PackagePlus className="size-4" />} onClick={() => setEditing('new')}>
            නව අයිතමයක්
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card bg-well px-4 py-3 ring-1 ring-hairline">
          <p className="text-xs font-semibold text-white/60">අයිතම</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{items.length}</p>
        </div>
        <div className="rounded-card bg-well px-4 py-3 ring-1 ring-hairline">
          <p className="text-xs font-semibold text-white/60">මුළු වියදම</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{rupees(total)}</p>
        </div>
      </div>

      <Panel className="mb-8 p-4 sm:p-5">
        {items.length === 0 ? (
          <EmptyState
            icon={<Droplets className="size-7" />}
            title="තවම අයිතම නැත"
            detail="ඩීසල්, ඔයිල්, පෙට්‍රල්, කළු තෙල් වැනි දේ එකතු කර, මිල සකසා, භාවිත සටහන් කරන්න."
          />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>අයිතමය</th>
                  <th className={cx(th, 'text-right')}>ඒකක මිල</th>
                  <th className={cx(th, 'text-right')}>භාවිතය</th>
                  <th className={cx(th, 'text-right')}>වටිනාකම</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isOpen = open === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-b border-hairline/60 last:border-0">
                        <td className={td}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : item.id)}
                            className="flex items-center gap-2 text-left"
                          >
                            {isOpen ? <ChevronDown className="size-4 text-white/60" /> : <ChevronRight className="size-4 text-white/60" />}
                            <span>
                              <span className="block font-bold">{item.name}</span>
                              <span className="block text-xs text-white/60">{item.unit || 'ගණන'} · සටහන් බලන්න</span>
                            </span>
                          </button>
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>
                          {item.unitPrice > 0 ? money(item.unitPrice) : <span className="text-signal">මිල සකසන්න</span>}
                        </td>
                        <td className={cx(td, 'text-right text-base font-extrabold tabular-nums')}>
                          {quantity(item.usedQuantity, item.unit)}
                        </td>
                        <td className={cx(td, 'text-right font-bold tabular-nums')}>{item.usedAmount > 0 ? money(item.usedAmount) : '—'}</td>
                        <td className={cx(td, 'text-right')}>
                          <div className="flex justify-end gap-1">
                            <IconButton label="සටහනක් එකතු කරන්න" onClick={() => setRecording(item)}>
                              <ClipboardPlus className="size-4" />
                            </IconButton>
                            <IconButton label="සංස්කරණය" onClick={() => setEditing(item)}>
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton label="ඉවත් කරන්න" onClick={() => setDeleting(item)} className="hover:text-red-200">
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-hairline/60 bg-black/10">
                          <td colSpan={5} className="px-3 py-4">
                            <FuelRecords item={item} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      {editing && <FuelItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {recording && <FuelRecordModal item={recording} onClose={() => setRecording(null)} />}
      {deleting && <DeleteItemModal item={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

/** One item's records, newest first, 50 to a page. */
function FuelRecords({ item }: { item: StoreItem }) {
  const records = useFuelRecords(item.id);
  const [editing, setEditing] = useState<FuelRecord | null>(null);
  const [deleting, setDeleting] = useState<FuelRecord | null>(null);

  if (records.error) return <DataError error={records.error} />;
  if (records.data === undefined) return <Loading />;
  if (records.data.length === 0) {
    return <p className="py-4 text-center text-sm text-white/60">තවම සටහන් නැත. ඉහළ ඇති සටහන් එකතු කරන අයිකනය භාවිත කරන්න.</p>;
  }

  return (
    <>
      <TableFrame>
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className={th}>දිනය සහ වේලාව</th>
              <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
              <th className={cx(th, 'text-right')}>ඒකක මිල</th>
              <th className={cx(th, 'text-right')}>මුදල</th>
              <th className={th}>සටහන</th>
              <th className={cx(th, 'text-right')}>ක්‍රියා</th>
            </tr>
          </thead>
          <tbody>
            {records.data.map((record) => (
              <tr key={record.id} className="border-b border-hairline/50 last:border-0">
                <td className={cx(td, 'whitespace-nowrap text-white/80')}>{dateTime(record.at)}</td>
                <td className={cx(td, 'text-right font-bold tabular-nums')}>{quantity(record.quantity, record.unit)}</td>
                <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{money(record.unitPrice)}</td>
                <td className={cx(td, 'text-right font-bold tabular-nums')}>{money(record.amount)}</td>
                <td className={cx(td, 'text-white/75')}>
                  {record.note || '—'}
                  {record.createdByName && <span className="block text-[11px] text-white/45">{record.createdByName}</span>}
                </td>
                <td className={cx(td, 'text-right')}>
                  <div className="flex justify-end gap-1">
                    <IconButton label="සංස්කරණය" onClick={() => setEditing(record)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="ඉවත් කරන්න" onClick={() => setDeleting(record)} className="hover:text-red-200">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <Pagination pager={records.pager} />

      {editing && <FuelRecordModal item={item} record={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteFuelRecordModal record={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

/** Adds an item that is bought and used straight away, or edits one. */
function FuelItemModal({ item, onClose }: { item: StoreItem | null; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'L');
  const [price, setPrice] = useState(item && item.unitPrice > 0 ? String(item.unitPrice) : '');
  const [note, setNote] = useState(item?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('අයිතමයේ නම ඇතුළත් කරන්න.');
    setBusy(true);
    setError(null);
    try {
      const details = {
        name,
        unit: unit.trim() || 'ගණන',
        minQuantity: item?.minQuantity ?? 0,
        unitPrice: Math.max(parse(price) ?? 0, 0),
        piecesPerKg: item?.piecesPerKg ?? null,
        note,
      };
      if (item) {
        await updateItem(item, details, profile);
      } else {
        await createItem({ ...details, quantity: 0, link: null, direct: true }, profile);
      }
      toast.success(item ? 'අයිතමය යාවත්කාලීන කළා.' : 'අයිතමය එකතු කළා.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={item ? 'අයිතමය සංස්කරණය' : 'නව අයිතමයක්'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="fuel-item-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="fuel-item-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
          <Field label="නම">
            <Input required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="උදා: පෙට්‍රල්" />
          </Field>
          <Field label="ඒකකය">
            <UnitPicker value={unit} onChange={setUnit} />
          </Field>
        </div>
        <Field
          label="ඒකක මිල (රු.)"
          hint="සටහනක් එකතු කරන විට මෙම මිල ස්වයංක්‍රීයව ඇතුළත් වේ — එහිදී වෙනස් කළ හැක."
        >
          <Input type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="සටහන">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

/** A purchase-and-use: how much, at what price, and when — added to an item, or put right. */
function FuelRecordModal({ item, record, onClose }: { item: StoreItem; record?: FuelRecord; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [amount, setAmount] = useState(record ? String(record.quantity) : '');
  const [price, setPrice] = useState(String(record ? record.unitPrice : item.unitPrice || ''));
  const [at, setAt] = useState(toInput(record?.at ?? new Date()));
  const [note, setNote] = useState(record?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantityValue = parse(amount);
  const priceValue = parse(price);
  const when = new Date(at);
  const valid = quantityValue != null && quantityValue > 0 && priceValue != null && priceValue >= 0 && !Number.isNaN(when.getTime());
  const worth = valid ? fuelAmount({ quantity: quantityValue, unitPrice: priceValue }) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || quantityValue == null || priceValue == null) return setError('ප්‍රමාණය, මිල සහ දිනය නිවැරදිව ඇතුළත් කරන්න.');
    setBusy(true);
    setError(null);
    try {
      const input = { quantity: quantityValue, unitPrice: priceValue, at: when, note };
      if (record) await updateFuelRecord(record, input, profile);
      else await addFuelRecord(item, input, profile);
      toast.success(record ? 'සටහන යාවත්කාලීන කළා.' : `${item.name} සටහන එකතු කළා.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={item.name}
      subtitle={record ? 'සටහන සංස්කරණය' : 'නව සටහනක් — ගෙන ආ විගස භාවිත කළ'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="fuel-record-form" busy={busy} disabled={!valid}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="fuel-record-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`ප්‍රමාණය${item.unit ? ` (${item.unit})` : ''}`}>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              autoFocus
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="ඒකක මිල (රු.)">
            <Input type="number" inputMode="decimal" min="0" step="any" required value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-well px-4 py-3">
          <span className="text-sm text-white/75">
            {valid ? `${quantity(quantityValue, item.unit)} × ${money(priceValue)}` : 'මුදල'}
          </span>
          <span className="text-xl font-extrabold tabular-nums">{worth != null ? rupees(worth) : '—'}</span>
        </div>

        <Field label="දිනය සහ වේලාව" hint="දැන් — වෙනත් වේලාවක් නම් වෙනස් කරන්න. මූල්‍ය වාර්තාවේ මෙම මාසයට ඇතුළත් වේ.">
          <Input type="datetime-local" required value={at} onChange={(event) => setAt(event.target.value)} />
        </Field>
        <Field label="සටහන">
          <Textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="උදා: යන්ත්‍රය, බිල් අංකය" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function DeleteFuelRecordModal({ record, onClose }: { record: FuelRecord; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await deleteFuelRecord(record, profile);
      toast.success('සටහන ඉවත් කළා.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title="සටහන ඉවත් කරන්නද?"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            ඉවත් කරන්න
          </Button>
        </>
      }
    >
      <p className="text-sm text-white/80">
        <b>{record.itemName}</b> — {quantity(record.quantity, record.unit)} · {rupees(record.amount)} ({dateTime(record.at)}) සටහන ඉවත් වේ. එය
        අයිතමයේ මුළු භාවිතයෙන් සහ මූල්‍ය වාර්තාවේ වියදමෙන් අඩු වේ.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
