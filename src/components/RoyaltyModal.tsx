import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveRoyaltyRates } from '../data/royalty';
import { errorMessage } from '../lib/errors';
import { money, quantity } from '../lib/format';
import { blastRoyaltyOf, type RoyaltyRates } from '../lib/royalty';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal } from './ui';

/**
 * Admin: the figures the රාජ භාගය is worked out at. The royalty is worked out
 * afresh from the signed-off sheets each time the report opens, so a change
 * here moves every month's figure, not just the months to come.
 */
export function RoyaltyModal({ rates, onClose }: { rates: RoyaltyRates; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [cubes, setCubes] = useState(String(rates.cubesPerKg));
  const [value, setValue] = useState(String(rates.cubeValue));
  const [percent, setPercent] = useState(String(rates.percent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entered: RoyaltyRates = { cubesPerKg: Number(cubes), cubeValue: Number(value), percent: Number(percent) };
  const valid = [cubes, value, percent].every((text) => text.trim() !== '') && Object.values(entered).every((n) => n >= 0);
  // What a single kilo of gel or ammonia comes to at these figures.
  const perKg = valid ? blastRoyaltyOf({ shells: 0, ammoniaKg: 1 }, 1, entered).royalty : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return setError('අගයන් ඍණ නොවන ගණන් විය යුතුය.');

    setBusy(true);
    setError(null);
    try {
      await saveRoyaltyRates(entered, profile);
      toast.success('රාජ භාග අනුපාත යාවත්කාලීන කළා.');
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
      title="රාජ භාග අනුපාත"
      subtitle="(ජෙල් kg + ඇමෝනියා kg) × කියුබ් × කියුබ් එකක වටිනාකම × රාජ භාගය %"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="royalty-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="royalty-form" onSubmit={submit} className="space-y-4">
        <Field label="kg එකකට කියුබ් ගණන" hint="ජෙල් හෝ ඇමෝනියා kg එකක් කඳු කපන කියුබ් ගණන.">
          <Input type="number" inputMode="decimal" min="0" step="any" autoFocus required value={cubes} onChange={(event) => setCubes(event.target.value)} />
        </Field>
        <Field label="කියුබ් එකක වටිනාකම (රු.)">
          <Input type="number" inputMode="decimal" min="0" step="any" required value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="රාජ භාගය (%)">
          <Input type="number" inputMode="decimal" min="0" step="any" required value={percent} onChange={(event) => setPercent(event.target.value)} />
        </Field>
        {perKg != null && (
          <p className="rounded-xl bg-well px-4 py-3 text-sm text-white/80">
            kg 1ක් = කියුබ් {quantity(entered.cubesPerKg)} × රු. {money(entered.cubeValue)} × {quantity(entered.percent)}% ={' '}
            <b className="tabular-nums">රු. {money(perKg)}</b>
          </p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
