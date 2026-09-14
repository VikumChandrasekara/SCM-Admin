import { Minus, Plus, Equal } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { useLiveData } from '../data/LiveData';
import { changeStock, createItem, deleteItem, updateItem, type StockChange } from '../data/store';
import { errorMessage } from '../lib/errors';
import { quantity } from '../lib/format';
import {
  LINK_OPTIONS,
  STOCK_LABEL,
  stockStatus,
  type StockLink,
  type StoreItem,
} from '../lib/model';
import { useToast } from './Toasts';
import { Badge, Button, ErrorNote, Field, Input, Modal, Segmented, Select, Textarea } from './ui';
import { UnitPicker } from './UnitPicker';

function parse(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Restock, draw down or recount one item. Supervisors and admins. */
export function StockChangeModal({
  item,
  initial = 'restock',
  onClose,
}: {
  item: StoreItem;
  initial?: StockChange;
  onClose: () => void;
}) {
  const { profile } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<StockChange>(initial);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = parse(amount);
  const valid = value != null && (mode === 'adjust' ? value >= 0 : value > 0);
  const after = !valid ? null : mode === 'adjust' ? value : mode === 'restock' ? item.quantity + value : item.quantity - value;

  const label = {
    restock: 'එකතු කරන ප්‍රමාණය',
    use: 'භාවිත කළ / ඉවත් කළ ප්‍රමාණය',
    adjust: 'ගබඩාවේ ඇති සැබෑ ප්‍රමාණය',
  }[mode];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || value == null) return setError('නිවැරදි ප්‍රමාණයක් ඇතුළත් කරන්න.');
    setBusy(true);
    setError(null);
    try {
      await changeStock(item, mode, value, note, profile);
      toast.success(`${item.name} යාවත්කාලීන කළා.`);
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
      subtitle={`දැනට ${quantity(item.quantity, item.unit)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="stock-form" busy={busy} disabled={!valid}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'restock', label: <span className="inline-flex items-center gap-1.5"><Plus className="size-4" />එකතු කරන්න</span> },
            { value: 'use', label: <span className="inline-flex items-center gap-1.5"><Minus className="size-4" />අඩු කරන්න</span> },
            { value: 'adjust', label: <span className="inline-flex items-center gap-1.5"><Equal className="size-4" />ගණන් කළා</span> },
          ]}
        />
        <Field
          label={`${label}${item.unit ? ` (${item.unit})` : ''}`}
          hint={mode === 'adjust' ? 'ගබඩාව ගණන් කළ විට — මෙතෙක් සටහන් වූ භාවිතය මෙම ගණනට ඇතුළත් යැයි සැලකේ.' : undefined}
        >
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        {after != null && (
          <div className="flex items-center gap-3 rounded-xl bg-well px-4 py-3">
            <span className="flex-1 text-sm text-white/75">නව ප්‍රමාණය</span>
            <span className="text-lg font-extrabold tabular-nums">{quantity(after, item.unit)}</span>
            <Badge tone={stockStatus({ quantity: after, minQuantity: item.minQuantity })}>
              {STOCK_LABEL[stockStatus({ quantity: after, minQuantity: item.minQuantity })]}
            </Badge>
          </div>
        )}
        {after != null && after < 0 && (
          <ErrorNote>ගබඩාවේ ඇති ප්‍රමාණයට වඩා අඩු කරයි. ගණන නැවත පරීක්ෂා කරන්න.</ErrorNote>
        )}

        <Field label="සටහන">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="උදා: සැපයුම්කරුගේ නම, බිල් අංකය, හේතුව"
          />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

/** Adds an item, or edits [item]'s details. Admin only. */
export function ItemModal({ item, onClose }: { item: StoreItem | null; onClose: () => void }) {
  const { profile } = useSession();
  const { store } = useLiveData();
  const toast = useToast();

  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [link, setLink] = useState<StockLink | ''>(item?.link ?? '');
  const [opening, setOpening] = useState(item ? String(item.quantity) : '');
  const [minimum, setMinimum] = useState(item ? String(item.minQuantity) : '');
  const [price, setPrice] = useState(item ? String(item.unitPrice) : '');
  const [note, setNote] = useState(item?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = new Set(store.map((entry) => entry.link).filter(Boolean));

  function chooseLink(value: StockLink | '') {
    setLink(value);
    const option = LINK_OPTIONS.find((candidate) => candidate.link === value);
    if (option) {
      if (!name.trim()) setName(option.label);
      setUnit(option.unit);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const quantityValue = parse(opening);
    const minValue = parse(minimum) ?? 0;
    const priceValue = parse(price) ?? 0;
    if (!name.trim()) return setError('අයිතමයේ නම ඇතුළත් කරන්න.');
    if (!unit.trim()) return setError('ඒකකය තෝරන්න (උදා: L, kg, ගණන).');
    if (!item && (quantityValue == null || quantityValue < 0)) return setError('දැනට ඇති ප්‍රමාණය ඇතුළත් කරන්න.');
    if (minValue < 0 || priceValue < 0) return setError('අගයන් ඍණ විය නොහැක.');

    setBusy(true);
    setError(null);
    try {
      const details = { name, unit, minQuantity: minValue, unitPrice: priceValue, note };
      if (item) {
        await updateItem(item, details, profile);
      } else {
        await createItem({ ...details, quantity: quantityValue ?? 0, link: link || null }, profile);
      }
      toast.success(item ? 'අයිතමය යාවත්කාලීන කළා.' : 'අයිතමය ගබඩාවට එකතු කළා.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  const groups = [...new Set(LINK_OPTIONS.map((option) => option.group))];

  return (
    <Modal
      open
      title={item ? 'අයිතමය සංස්කරණය' : 'නව ගබඩා අයිතමයක්'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="item-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="space-y-4">
        <Field
          label="කණ්ඩායම් භාවිතයට සම්බන්ධ කිරීම"
          hint={
            item
              ? 'සම්බන්ධතාවය පසුව වෙනස් කළ නොහැක.'
              : 'සම්බන්ධ කළොත්, කණ්ඩායම පිරවීම / වෙඩි බඩු OK කරන විට මෙම තොගය ස්වයංක්‍රීයව අඩු වේ.'
          }
        >
          <Select
            value={link}
            disabled={!!item}
            onChange={(event) => chooseLink(event.target.value as StockLink | '')}
          >
            <option value="">— සම්බන්ධ නැත (අතින් පමණක් අඩු කරයි) —</option>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {LINK_OPTIONS.filter((option) => option.group === group).map((option) => (
                  <option
                    key={option.link}
                    value={option.link}
                    disabled={option.link !== item?.link && taken.has(option.link)}
                  >
                    {option.label}
                    {option.link !== item?.link && taken.has(option.link) ? ' (දැනටමත් ඇත)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
          <Field label="නම">
            <Input required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="ඒකකය">
            <UnitPicker value={unit} onChange={setUnit} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {!item && (
            <Field label="දැනට ඇති ප්‍රමාණය">
              <Input type="number" min="0" step="any" required value={opening} onChange={(event) => setOpening(event.target.value)} />
            </Field>
          )}
          <Field label="අවම මට්ටම" hint="මෙයට අඩු වූ විට අනතුරු ඇඟවේ.">
            <Input type="number" min="0" step="any" value={minimum} onChange={(event) => setMinimum(event.target.value)} />
          </Field>
          <Field label="ඒකක මිල (රු.)">
            <Input type="number" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} />
          </Field>
        </div>

        <Field label="සටහන">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function DeleteItemModal({ item, onClose }: { item: StoreItem; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await deleteItem(item, profile);
      toast.success(`${item.name} ගබඩාවෙන් ඉවත් කළා.`);
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
      title="අයිතමය ඉවත් කරන්නද?"
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
        <b>{item.name}</b> ({quantity(item.quantity, item.unit)}) ගබඩා ලැයිස්තුවෙන් ඉවත් වේ. පසුගිය චලනයන් ලොගයේ
        රැඳේ.
        {item.link && ' මෙය කණ්ඩායම් භාවිතයට සම්බන්ධ නිසා, ඉවත් කළ පසු එම භාවිතය තොගයෙන් අඩු නොවේ.'}
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}
