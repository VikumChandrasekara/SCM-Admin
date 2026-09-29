import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import { CUBES_PER_TIPPER, cubePriceFor, type SalesPrices } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal } from './ui';

/**
 * Staff: what a full tipper load and a tractor load sell for from now on. A
 * cube is a third of the tipper's figure, and this is where the dividing
 * happens, for both apps.
 */
export function PricesModal({ prices, onClose }: { prices: SalesPrices; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [tipper, setTipper] = useState(String(prices.tipperPrice));
  const [tractor, setTractor] = useState(String(prices.tractorPrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipperPrice = Number(tipper);
  const tractorPrice = Number(tractor);
  const cubePrice = tipperPrice > 0 ? cubePriceFor(tipperPrice) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!(tipperPrice > 0) || !(tractorPrice > 0)) return setError('මිල ශුන්‍යයට වඩා වැඩි විය යුතුය.');

    setBusy(true);
    setError(null);
    try {
      await saveSalesPrices({ tipperPrice, cubePrice: cubePriceFor(tipperPrice), tractorPrice }, profile);
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
        <Field
          label="ටිපර් ලෝඩ් එකක මිල (රු.)"
          hint={
            cubePrice != null
              ? `කියුබ් ${CUBES_PER_TIPPER}ක් — කියුබ් එකක් රු. ${money(cubePrice)}.`
              : `කියුබ් ${CUBES_PER_TIPPER}ක් — පිරුණු ටිපර් ලෝඩ් එකක්.`
          }
        >
          <Input type="number" inputMode="decimal" min="0" step="1" autoFocus required value={tipper} onChange={(event) => setTipper(event.target.value)} />
        </Field>
        <Field label="ට්‍රැක්ටර් ලෝඩ් එකක මිල (රු.)">
          <Input type="number" inputMode="decimal" min="0" step="1" required value={tractor} onChange={(event) => setTractor(event.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
