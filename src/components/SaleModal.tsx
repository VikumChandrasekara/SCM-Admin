import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { createSale, useSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { money, quantity, rupees } from '../lib/format';
import {
  CUBES_PER_TIPPER,
  PAYMENT_TYPE_LABEL,
  SALE_MATERIAL,
  SALE_TYPE,
  SALE_TYPES,
  TIPPER_SIZES,
  unitPriceOf,
  type PaymentType,
  type SaleMaterial,
  type SaleType,
} from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select, Textarea } from './ui';

/**
 * A new sale. The price is the one staff set — this only chooses what and
 * how much, and shows the sum before it is written.
 */
export function SaleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { profile } = useSession();
  const prices = useSalesPrices();
  const toast = useToast();

  const [type, setType] = useState<SaleType>('tipper');
  const [prepaid, setPrepaid] = useState(false);
  const [amount, setAmount] = useState('');
  const [material, setMaterial] = useState<SaleMaterial | ''>('');
  const [payment, setPayment] = useState<PaymentType>('cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = Number(amount);
  const unitPrice = prices.data ? unitPriceOf(prices.data, type) : null;
  const total = unitPrice != null && Number.isFinite(count) && count > 0 ? count * unitPrice : null;
  const loadPrice = prices.data
    ? type === 'tipper'
      ? `ටිපර් ලෝඩ් එකක් (කියුබ් ${CUBES_PER_TIPPER}) රු. ${money(prices.data.tipperPrice)}`
      : `ට්‍රැක්ටර් ලෝඩ් එකක් රු. ${money(prices.data.tractorPrice)}`
    : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(count) || count <= 0) return setError('ප්‍රමාණය ශුන්‍යයට වඩා වැඩි විය යුතුය.');
    if (!customerName.trim()) return setError('පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න.');
    // A prepaid load's vehicle may not be known until it comes.
    if (!prepaid && !vehicleNo.trim()) return setError('වාහන අංකය ඇතුළත් කරන්න.');
    if (!material) return setError('ද්‍රව්‍යය තෝරන්න.');

    setBusy(true);
    setError(null);
    try {
      const code = await createSale(
        {
          type,
          quantity: count,
          customerName,
          material,
          paymentType: prepaid ? 'cash' : payment,
          prepaid,
          customerPhone,
          vehicleNo,
          note,
        },
        profile,
      );
      toast.success(
        prepaid
          ? 'කලින් ගෙවූ බිල්පත සෑදුවා — දැන් සිට ආදායමක් ලෙස ගණන් වේ. ලෝඩ් එක ගෙන යන දින QR එක ස්කෑන් කරන්න.'
          : 'බිල්පත සෑදුවා. QR එක ස්කෑන් කර තහවුරු කළ පසු ආදායමක් ලෙස ගණන් වේ.',
      );
      onCreated(code);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="නව විකුණුම් බිල්පතක්"
      subtitle={
        prepaid
          ? 'කලින් ගෙවූ බිල්පත අවලංගු නොවේ — ලෝඩ් එක ගෙන යන දින QR එක ස්කෑන් කරන්න.'
          : 'පැය 24ක් ඇතුළත QR එක ස්කෑන් කර තහවුරු නොකළොත් බිල්පත අවලංගු වේ.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="sale-form" busy={busy} disabled={!prices.data}>
            බිල්පත සාදන්න
          </Button>
        </>
      }
    >
      <form id="sale-form" onSubmit={submit} className="space-y-4">
        {/* Not a <label>: one would name its first button after the whole
            group, so a screen reader would read both choices as one. */}
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-white/75">ලෝඩ් එක</span>
          <Segmented
            value={prepaid ? 'later' : 'now'}
            onChange={(value) => setPrepaid(value === 'later')}
            options={[
              { value: 'now', label: 'දැන් ගෙන යයි' },
              { value: 'later', label: 'කලින් ගෙවයි · පසුව ගෙන යයි' },
            ]}
          />
          {prepaid && (
            <span className="mt-1 block text-xs text-white/55">
              මුදල අද ලැබේ — අද සිට ආදායමට එකතු වේ. ලෝඩ් එක ගෙන යන දින QR එක ස්කෑන් කරන්න.
            </span>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-white/75">වර්ගය</span>
          <Segmented
            value={type}
            onChange={(value) => {
              setType(value);
              setAmount('');
            }}
            options={SALE_TYPES.map((value) => ({
              value,
              // A tipper's figure is a whole load's, though it is sold by the
              // cube; a tractor's is one load.
              label: prices.data
                ? `${SALE_TYPE[value].label} · ${money(value === 'tipper' ? prices.data.tipperPrice : prices.data.tractorPrice)}`
                : SALE_TYPE[value].label,
            }))}
          />
        </div>

        {type === 'tipper' ? (
          // A div rather than a Field, for the same reason as the type
          // picker: a <label> around a group of buttons names the first one
          // after the whole group.
          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-white/70">
              ප්‍රමාණය ({SALE_TYPE.tipper.unit})
            </span>
            <Segmented
              value={amount}
              onChange={setAmount}
              options={TIPPER_SIZES.map((size) => ({ value: String(size), label: quantity(size) }))}
            />
            {unitPrice != null && (
              <span className="mt-1 block text-xs text-white/55">
                කියුබ් එකක් රු. {money(unitPrice)} · ටිපර් ලෝඩ් එකක් = කියුබ් {CUBES_PER_TIPPER}
              </span>
            )}
          </div>
        ) : (
          <Field
            label={`ප්‍රමාණය (${SALE_TYPE.tractor.unit})`}
            hint={unitPrice == null ? undefined : `ලෝඩ් එකක් රු. ${money(unitPrice)}`}
          >
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              autoFocus
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}

        <div className="flex items-center justify-between rounded-card px-4 py-3 text-ink shadow-control chip-amber">
          <span className="text-sm font-bold">
            {total != null && unitPrice != null
              ? `${quantity(count, SALE_TYPE[type].unit)} × ${money(unitPrice)}`
              : (loadPrice ?? 'මිල පූරණය වෙමින්...')}
          </span>
          <span className="text-xl font-extrabold tabular-nums">{total != null ? rupees(total) : '—'}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ද්‍රව්‍යය">
            <Select value={material} onChange={(event) => setMaterial(event.target.value as SaleMaterial | '')}>
              <option value="">— තෝරන්න —</option>
              {(Object.keys(SALE_MATERIAL) as SaleMaterial[]).map((id) => (
                <option key={id} value={id}>
                  {SALE_MATERIAL[id]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ගෙවීම" hint={prepaid ? 'කලින් ගෙවීම මුදලින් පමණි.' : undefined}>
            <Select
              value={prepaid ? 'cash' : payment}
              disabled={prepaid}
              onChange={(event) => setPayment(event.target.value as PaymentType)}
            >
              {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((id) => (
                <option key={id} value={id}>
                  {PAYMENT_TYPE_LABEL[id]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="පාරිභෝගිකයාගේ නම">
            <Input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </Field>
          <Field label="දුරකථන අංකය" hint="අවශ්‍ය නම් පමණක්.">
            <Input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="07XXXXXXXX"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </Field>
        </div>

        <Field label="වාහන අංකය" hint={prepaid ? 'දන්නේ නම් පමණක්.' : undefined}>
          <Input
            required={!prepaid}
            value={vehicleNo}
            onChange={(event) => setVehicleNo(event.target.value)}
            placeholder="උදා: WP LK-1234"
          />
        </Field>

        <Field label="සටහන">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="උදා: ද්‍රව්‍යය, ගෙනයන ස්ථානය" />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
