import { useMemo, useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { useNow } from '../data/sales';
import { addPayment, useCreditSales, usePayments } from '../data/payments';
import { errorMessage } from '../lib/errors';
import { rupees } from '../lib/format';
import { customerAccounts, type CustomerAccount } from '../lib/customers';
import { nameOf } from '../lib/model';
import { PaymentReceiptModal, type PaymentSlip } from './PaymentReceipt';
import { useToast } from './Toasts';
import { Button, Field, Input, Panel, SectionLabel, cx } from './ui';

/** ණය ගිණුම් — what each customer on credit still owes, and a payment entry for it. */
export function CreditAccounts() {
  const now = useNow();
  const sales = useCreditSales();
  const payments = usePayments();
  const [paying, setPaying] = useState<CustomerAccount | null>(null);
  const [receipt, setReceipt] = useState<PaymentSlip | null>(null);

  const accounts = useMemo(
    () => customerAccounts(sales.data ?? [], payments.data ?? [], now),
    [sales.data, payments.data, now],
  );

  if (accounts.length === 0) return null;

  return (
    <Panel className="mb-6 p-4 sm:p-5">
      <SectionLabel>ණය ගිණුම්</SectionLabel>
      <ul className="divide-y divide-hairline">
        {accounts.map((account) => (
          <li key={account.customerKey} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-bold">{account.customerName}</p>
              <p className="text-xs text-white/60">
                ණයට {rupees(account.credit)} · ගෙවා {rupees(account.paid)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={cx('font-extrabold tabular-nums', account.outstanding > 0 ? 'text-amber-hi' : 'text-emerald-300')}>
                {account.outstanding > 0 ? rupees(account.outstanding) : 'ගෙවා අවසන්'}
              </span>
              {account.outstanding > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setPaying(account)}>
                  ගෙවීමක් එකතු කරන්න
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {paying && (
        <PaymentForm
          account={paying}
          onClose={() => setPaying(null)}
          onSaved={(slip) => {
            setPaying(null);
            setReceipt(slip);
          }}
        />
      )}
      {receipt && <PaymentReceiptModal slip={receipt} onClose={() => setReceipt(null)} />}
    </Panel>
  );
}

function PaymentForm({
  account,
  onClose,
  onSaved,
}: {
  account: CustomerAccount;
  onClose: () => void;
  onSaved: (slip: PaymentSlip) => void;
}) {
  const { profile } = useSession();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('ගෙවූ මුදල ඇතුළත් කරන්න.');
      return;
    }
    setBusy(true);
    try {
      const id = await addPayment(account.customerName, value, date, note, profile);
      toast.success(`${account.customerName} — ගෙවීම සුරැකුණා.`);
      onSaved({
        id,
        customerName: account.customerName,
        amount: value,
        date,
        note: note.trim(),
        createdByName: nameOf(profile),
        balance: Math.max(0, account.outstanding - value),
      });
    } catch (failure) {
      toast.error(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-card bg-well p-4">
      <p className="text-sm font-bold">
        {account.customerName} · ඉතිරි {rupees(account.outstanding)}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="ගෙවූ මුදල (රු.)">
          <Input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="දිනය">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="සටහන">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          සුරකින්න
        </Button>
        <Button variant="secondary" onClick={onClose}>
          අවලංගු
        </Button>
      </div>
    </form>
  );
}
