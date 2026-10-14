import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveMachineHourly } from '../data/sales';
import { errorMessage } from '../lib/errors';
import type { SalesPrices } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal } from './ui';

/**
 * Admin: what the machine is charged for each hour the loading excavator
 * worked — one of the finance report's expenses. It is worked out afresh each
 * time the report opens, so a change here moves every month's figure, not
 * just the months to come.
 */
export function MachineRateModal({ prices, onClose }: { prices: SalesPrices; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [hourly, setHourly] = useState(String(prices.machineHourly));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const machineHourly = hourly.trim() === '' ? NaN : Number(hourly);
    if (!(machineHourly >= 0)) return setError('යන්ත්‍ර ගාස්තුව ඍණ නොවන ගණනක් විය යුතුය.');

    setBusy(true);
    setError(null);
    try {
      await saveMachineHourly(prices, machineHourly, profile);
      toast.success('යන්ත්‍රයට පැයකට ගාස්තුව යාවත්කාලීන කළා.');
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
      title="යන්ත්‍රයට — පැයකට"
      subtitle="එක්ස්කැවේටර් වැඩ කළ පැය ගණන × මෙම ගාස්තුව, වියදමක් ලෙස අඩු වේ."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="machine-rate-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="machine-rate-form" onSubmit={submit} className="space-y-4">
        <Field label="යන්ත්‍රයට — පැයකට (රු.)" hint="සියලු මාසවල මූල්‍ය වාර්තාවට බලපායි.">
          <Input type="number" inputMode="decimal" min="0" step="1" autoFocus required value={hourly} onChange={(event) => setHourly(event.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
