import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { updateSale } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { money, quantity, rupees } from '../lib/format';
import {
  PAYMENT_TYPE_LABEL,
  SALE_MATERIAL,
  SALE_TYPE,
  customerKeyOf,
  saleNumber,
  type PaymentType,
  type Sale,
  type SaleMaterial,
} from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from './ui';

/**
 * Puts a mistake on a bill right — the admin's. What the bill was sold at, its
 * number, its date and its status stay as they were: the sum is worked from
 * the price it was written at.
 */
export function SaleEditModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();

  const [amount, setAmount] = useState(String(sale.quantity));
  const [material, setMaterial] = useState<SaleMaterial | ''>(sale.material ?? '');
  const [payment, setPayment] = useState<PaymentType>(sale.paymentType);
  const [customerName, setCustomerName] = useState(sale.customerName);
  const [customerPhone, setCustomerPhone] = useState(sale.customerPhone);
  const [vehicleNo, setVehicleNo] = useState(sale.vehicleNo);
  const [note, setNote] = useState(sale.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = SALE_TYPE[sale.type];
  const count = Number(amount);
  const total = Number.isFinite(count) && count > 0 ? count * sale.unitPrice : null;
  // A credit bill sits in its customer's account by name, so a new name moves it.
  const movesAccount =
    (sale.paymentType === 'credit' || payment === 'credit') &&
    customerKeyOf(customerName) !== sale.customerKey;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(count) || count <= 0) return setError('ප්‍රමාණය ශුන්‍යයට වඩා වැඩි විය යුතුය.');
    if (!customerName.trim()) return setError('පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න.');
    // A prepaid load's vehicle may not be known until it comes.
    if (!sale.prepaid && !vehicleNo.trim()) return setError('වාහන අංකය ඇතුළත් කරන්න.');
    if (!material) return setError('ද්‍රව්‍යය තෝරන්න.');

    setBusy(true);
    setError(null);
    try {
      await updateSale(
        sale.code,
        { quantity: count, customerName, customerPhone, vehicleNo, material, paymentType: payment, note },
        profile,
      );
      toast.success('බිල්පත යාවත්කාලීන කළා.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`බිල්පත ${saleNumber(sale)} සංස්කරණය`}
      subtitle="ඒකක මිල, බිල් අංකය, දිනය සහ තත්වය වෙනස් නොවේ."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="sale-edit-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="sale-edit-form" onSubmit={submit} className="space-y-4">
        <Field label={`ප්‍රමාණය (${type.unit})`} hint={`${type.label} · ${type.unit}කට රු. ${money(sale.unitPrice)}`}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step={sale.type === 'tipper' ? '0.5' : '1'}
            autoFocus
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between rounded-card px-4 py-3 text-ink shadow-control chip-amber">
          <span className="text-sm font-bold">
            {total != null ? `${quantity(count, type.unit)} × ${money(sale.unitPrice)}` : '—'}
            {total != null && total !== sale.amount && (
              <span className="block text-xs font-semibold">කලින් {rupees(sale.amount)}</span>
            )}
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
          <Field label="ගෙවීම" hint={sale.prepaid ? 'කලින් ගෙවීම මුදලින් පමණි.' : undefined}>
            <Select
              value={sale.prepaid ? 'cash' : payment}
              disabled={sale.prepaid}
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
          <Field
            label="පාරිභෝගිකයාගේ නම"
            hint={movesAccount ? 'නම වෙනස් කිරීමෙන් මෙම බිල්පත වෙනත් ණය ගිණුමකට මාරු වේ.' : undefined}
          >
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

        <Field label="වාහන අංකය" hint={sale.prepaid ? 'දන්නේ නම් පමණක්.' : undefined}>
          <Input
            required={!sale.prepaid}
            value={vehicleNo}
            onChange={(event) => setVehicleNo(event.target.value)}
            placeholder="උදා: WP LK-1234"
          />
        </Field>

        <Field label="සටහන">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
