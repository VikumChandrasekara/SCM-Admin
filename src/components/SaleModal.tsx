import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { useLiveData } from '../data/LiveData';
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
  nameOf,
  unitPriceOf,
  type PaymentType,
  type SaleMaterial,
  type SaleType,
} from '../lib/model';
import { PricesModal } from './PricesModal';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, IconButton, Input, Modal, Segmented, Textarea } from './ui';

/**
 * A new sale. The price is the one staff set — this only chooses what and
 * how much, and shows the sum before it is written.
 */
export function SaleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const prices = useSalesPrices();
  const toast = useToast();
  /** The price editor, opened from here so a price can be put right without leaving the bill. */
  const [editingPrices, setEditingPrices] = useState(false);

  const [type, setType] = useState<SaleType>('tipper');
  const [prepaid, setPrepaid] = useState(false);
  const [amount, setAmount] = useState('');
  /** A tipper bill written for a number of loads typed in, rather than cubes picked from the lorry sizes. */
  const [byLoads, setByLoads] = useState(false);
  const [material, setMaterial] = useState<SaleMaterial | ''>('');
  const [payment, setPayment] = useState<PaymentType>('cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [note, setNote] = useState('');
  // The bill says whose loads it is: the operator who loaded it and the driller whose work it was.
  // Taken for granted only when there is no choice — the one there is, or the operator selling from their own phone.
  const { crew } = useLiveData();
  const operators = crew.filter((person) => person.role === 'operator');
  const drillers = crew.filter((person) => person.role === 'compressor');
  const [operatorId, setOperatorId] = useState(
    profile.role === 'operator' ? profile.id : operators.length === 1 ? operators[0].id : '',
  );
  const [drillerId, setDrillerId] = useState(drillers.length === 1 ? drillers[0].id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = Number(amount);
  // Loads typed in are kept as that many full tipper loads' worth of cubes, so
  // the bill still adds up as cubes × the cube price.
  const wholeLoads = type === 'tipper' && byLoads;
  const count = wholeLoads ? typed * CUBES_PER_TIPPER : typed;
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
    if (wholeLoads && !Number.isInteger(typed)) return setError('ලෝඩ් ගණන පූර්ණ සංඛ්‍යාවක් විය යුතුය.');
    if (!customerName.trim()) return setError('පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න.');
    // A prepaid load's vehicle may not be known until it comes.
    if (!prepaid && !vehicleNo.trim()) return setError('වාහන අංකය ඇතුළත් කරන්න.');
    if (!material) return setError('ද්‍රව්‍යය තෝරන්න.');
    const operator = operators.find((person) => person.id === operatorId) ?? null;
    const driller = drillers.find((person) => person.id === drillerId) ?? null;
    if (operators.length > 0 && !operator) return setError('ලෝඩ් කළ ඔපරේටර් තෝරන්න.');
    if (drillers.length > 0 && !driller) return setError('වැඩ කළ ඩ්‍රිලර් තෝරන්න.');

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
          operator: operator && { id: operator.id, name: nameOf(operator) },
          driller: driller && { id: driller.id, name: nameOf(driller) },
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
    <>
      <Modal
        open
        title="නව විකුණුම් බිල්පතක්"
        subtitle={
          prepaid
            ? 'කලින් ගෙවූ බිල්පත අවලංගු නොවේ — ලෝඩ් එක ගෙන යන දින QR එක ස්කෑන් කරන්න.'
            : 'පැය 24ක් ඇතුළත QR එක ස්කෑන් කර තහවුරු නොකළොත් බිල්පත අවලංගු වේ.'
        }
        // The price editor opens over this one; Escape and a click outside belong to it, not to the bill.
        onClose={editingPrices ? () => undefined : onClose}
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
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-white/75">වර්ගය</span>
              {/* Whoever may set the prices may put one right here; the bill below follows it as soon as it is saved. */}
              {permissions.setSalePrices && prices.data && (
                <IconButton label="මිල වෙනස් කරන්න" className="-my-1.5 size-8" onClick={() => setEditingPrices(true)}>
                  <Pencil className="size-4" />
                </IconButton>
              )}
            </div>
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
            <div className="space-y-3">
              <div>
                <span className="mb-1.5 block text-[12.5px] font-semibold text-white/70">ප්‍රමාණය දෙන ආකාරය</span>
                <Segmented
                  value={byLoads ? 'loads' : 'cubes'}
                  onChange={(value) => {
                    setByLoads(value === 'loads');
                    setAmount('');
                  }}
                  options={[
                    { value: 'cubes', label: 'කියුබ් අනුව' },
                    { value: 'loads', label: 'ලෝඩ් ගණන අනුව' },
                  ]}
                />
              </div>
              {byLoads ? (
                <Field
                  label="ලෝඩ් ගණන"
                  hint={
                    unitPrice == null
                      ? undefined
                      : `ලෝඩ් එකක් = කියුබ් ${CUBES_PER_TIPPER} · රු. ${money(unitPrice * CUBES_PER_TIPPER)}` +
                        (count > 0 ? ` · කියුබ් ${quantity(count)}` : '')
                  }
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    autoFocus
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
              ) : (
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
                ? wholeLoads
                  ? `ලෝඩ් ${quantity(typed)} (කියුබ් ${quantity(count)}) × ${money(unitPrice * CUBES_PER_TIPPER)}`
                  : `${quantity(count, SALE_TYPE[type].unit)} × ${money(unitPrice)}`
                : (loadPrice ?? 'මිල පූරණය වෙමින්...')}
            </span>
            <span className="text-xl font-extrabold tabular-nums">{total != null ? rupees(total) : '—'}</span>
          </div>

          {/* Divs rather than Fields, for the same reason as the type picker: a
              <label> around a group of buttons names the first one after the whole group. */}
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-white/75">ද්‍රව්‍යය</span>
            {/* Nothing is picked until someone does, so the bill cannot go out with a guessed material. */}
            <Segmented
              value={material}
              onChange={setMaterial}
              options={(Object.keys(SALE_MATERIAL) as SaleMaterial[]).map((id) => ({ value: id, label: SALE_MATERIAL[id] }))}
            />
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-white/75">ගෙවීම</span>
            <Segmented
              value={prepaid ? 'cash' : payment}
              disabled={prepaid}
              onChange={setPayment}
              options={(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((id) => ({
                value: id,
                label: PAYMENT_TYPE_LABEL[id],
              }))}
            />
            {prepaid && <span className="mt-1 block text-xs text-white/55">කලින් ගෙවීම මුදලින් පමණි.</span>}
          </div>

          {operators.length > 1 && (
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-white/75">ලෝඩ් කළ ඔපරේටර්</span>
              <Segmented
                value={operatorId}
                onChange={setOperatorId}
                options={operators.map((person) => ({ value: person.id, label: nameOf(person) }))}
              />
              <span className="mt-1 block text-xs text-white/55">මෙම බිල්පතේ ලෝඩ් සහ බෝනස් ඔහුට එකතු වේ.</span>
            </div>
          )}

          {drillers.length > 1 && (
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-white/75">වැඩ කළ ඩ්‍රිලර්</span>
              <Segmented
                value={drillerId}
                onChange={setDrillerId}
                options={drillers.map((person) => ({ value: person.id, label: nameOf(person) }))}
              />
              <span className="mt-1 block text-xs text-white/55">ද්‍රව්‍යය අනුව ලෝඩ් එකකට ගෙවීම ඔහුට එකතු වේ.</span>
            </div>
          )}

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
      {editingPrices && prices.data && <PricesModal prices={prices.data} onClose={() => setEditingPrices(false)} />}
    </>
  );
}
