import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import type { SalesPrices } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal } from './ui';

/** Admin only: what a cube and a tractor load sell for from now on. */
export function PricesModal({ prices, onClose }: { prices: SalesPrices | null; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [cube, setCube] = useState(prices ? String(prices.cubePrice) : '');
  const [tractor, setTractor] = useState(prices ? String(prices.tractorPrice) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cubePrice = Number(cube);
    const tractorPrice = Number(tractor);
    if (!(cubePrice > 0) || !(tractorPrice > 0)) return setError('මිල ශුන්‍යයට වඩා වැඩි විය යුතුය.');

    setBusy(true);
    setError(null);
    try {
      await saveSalesPrices({ cubePrice, tractorPrice }, profile);
      toast.success('මිල යාවත්කාලීන කළා. නව බිල්පත් මෙම මිලට සෑදේ.');
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
      title="විකුණුම් මිල"
      subtitle="දැනටමත් සෑදූ බිල්පත් ඒවා සෑදූ මිලටම පවතී."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="prices-form" busy={busy}>
            සුරකින්න
          </Button>
        </>
      }
    >
      <form id="prices-form" onSubmit={submit} className="space-y-4">
        <Field label="කියුබ් එකක මිල (රු.)">
          <Input type="number" inputMode="decimal" min="0" step="1" autoFocus required value={cube} onChange={(event) => setCube(event.target.value)} />
        </Field>
        <Field label="ට්‍රැක්ටර් ලෝඩ් එකක මිල (රු.)">
          <Input type="number" inputMode="decimal" min="0" step="1" required value={tractor} onChange={(event) => setTractor(event.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
