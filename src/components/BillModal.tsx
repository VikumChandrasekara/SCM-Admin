import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveBill } from '../data/bills';
import { useLiveData } from '../data/LiveData';
import { errorMessage } from '../lib/errors';
import { todayKey } from '../lib/format';
import { BILL, BILL_CATEGORIES, ROLES, nameOf, type Bill, type BillCategory } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select, Textarea } from './ui';

/**
 * Adds a bill, or edits [bill]. Mounted only while open, so every opening
 * starts from the values it is given.
 */
export function BillModal({
  bill = null,
  category = 'other',
  personId = null,
  date,
  onClose,
}: {
  bill?: Bill | null;
  category?: BillCategory;
  personId?: string | null;
  date?: string;
  onClose: () => void;
}) {
  const { profile } = useSession();
  const { crew, peopleById } = useLiveData();
  const toast = useToast();

  const [kind, setKind] = useState<BillCategory>(bill?.category ?? category);
  const [amount, setAmount] = useState(bill ? String(bill.amount) : '');
  const [day, setDay] = useState(bill?.date ?? date ?? todayKey());
  const [who, setWho] = useState(bill?.operatorId ?? personId ?? '');
  const [note, setNote] = useState(bill?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Someone removed since the bill was written is still shown by name.
  const orphan = who && !crew.some((person) => person.id === who) ? who : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError('මුදල ශුන්‍යයට වඩා වැඩි විය යුතුය.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError('දිනය තෝරන්න.');
    if (kind === 'advance' && !who) return setError('ඇඩ්වාන්ස් එක ලබාගත් කණ්ඩායම් සාමාජිකයා තෝරන්න.');

    setBusy(true);
    setError(null);
    try {
      await saveBill(
        { category: kind, amount: value, date: day, note, person: who ? peopleById.get(who) ?? null : null },
        bill,
        profile,
        peopleById,
      );
      toast.success(bill ? 'බිල්පත යාවත්කාලීන කළා.' : 'බිල්පත සුරැකුණා.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={bill ? 'බිල්පත සංස්කරණය' : 'නව බිල්පතක්'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="bill-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="bill-form" onSubmit={submit} className="space-y-4">
        <Field label="වර්ගය">
          <Segmented
            value={kind}
            onChange={setKind}
            options={BILL_CATEGORIES.map((value) => ({ value, label: BILL[value].label }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="මුදල (රු.)">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoFocus
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="දිනය">
            <Input type="date" required value={day} onChange={(event) => setDay(event.target.value)} />
          </Field>
        </div>

        <Field
          label="කණ්ඩායම් සාමාජිකයා"
          hint={
            BILL[kind].deduction
              ? kind === 'advance'
                ? 'ඔවුන්ගේ ඇඩ්වාන්ස් ගණනට එකතු වී, පඩියෙන් අඩු වේ.'
                : 'තෝරා ගත්තොත් ඔවුන්ගේ පඩියෙන් අඩු වේ.'
              : 'අවශ්‍ය නම් පමණක්.'
          }
        >
          <Select value={who} onChange={(event) => setWho(event.target.value)}>
            <option value="">— කිසිවෙක් නැත —</option>
            {crew.map((person) => (
              <option key={person.id} value={person.id}>
                {nameOf(person)} · {ROLES[person.role].label}
              </option>
            ))}
            {orphan && <option value={orphan}>{bill?.operatorName ?? orphan}</option>}
          </Select>
        </Field>

        <Field label="සටහන">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="උදා: සාප්පුවේ නම, බිල් අංකය"
          />
        </Field>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
