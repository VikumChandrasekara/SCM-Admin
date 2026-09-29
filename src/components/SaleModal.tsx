import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { createSale, useSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { money, quantity, rupees } from '../lib/format';
import { CUBES_PER_TIPPER, SALE_TYPE, SALE_TYPES, TIPPER_SIZES, unitPriceOf, type SaleType } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal, Segmented, Textarea } from './ui';

/**
 * A new sale. The price is the one staff set — this only chooses what and
 * how much, and shows the sum before it is written.
 */
export function SaleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { profile } = useSession();
  const prices = useSalesPrices();
  const toast = useToast();

  const [type, setType] = useState<SaleType>('tipper');
  const [amount, setAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = Number(amount);
  const unitPrice = prices.data ? unitPriceOf(prices.data, type) : null;
  const total = unitPrice != null && Number.isFinite(count) && count > 0 ? count * unitPrice : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(count) || count <= 0) return setError('ප්‍රමාණය ශුන්‍යයට වඩා වැඩි විය යුතුය.');
    if (!customerName.trim()) return setError('පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න.');
    if (!vehicleNo.trim()) return setError('වාහන අංකය ඇතුළත් කරන්න.');

    setBusy(true);
    setError(null);
    try {
      const code = await createSale(
        { type, quantity: count, customerName, customerPhone, vehicleNo, note },
        profile,
      );
      toast.success('බිල්පත සෑදුවා. QR එක ස්කෑන් කර තහවුරු කළ පසු ආදායමක් ලෙස ගණන් වේ.');
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
      subtitle="පැය 24ක් ඇතුළත QR එක ස්කෑන් කර තහවුරු නොකළොත් බිල්පත අවලංගු වේ."
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
              : unitPrice != null
                ? `${SALE_TYPE[type].unit} එකක් රු. ${money(unitPrice)}`
                : 'මිල පූරණය වෙමින්...'}
          </span>
          <span className="text-xl font-extrabold tabular-nums">{total != null ? rupees(total) : '—'}</span>
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

        <Field label="වාහන අංකය">
          <Input required value={vehicleNo} onChange={(event) => setVehicleNo(event.target.value)} placeholder="උදා: WP LK-1234" />
        </Field>

        <Field label="සටහන">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="උදා: ද්‍රව්‍යය, ගෙනයන ස්ථානය" />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
