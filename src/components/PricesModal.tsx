import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveSalesPrices } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import { CUBES_PER_TIPPER, cubePriceFor, type SalesPrices } from '../lib/model';
import { useToast } from './Toasts';
import { Button, ErrorNote, Field, Input, Modal } from './ui';

/**
 * Admin only: what a full tipper load sells for from now on. It is the only
 * price there is — one cube is a third of it, and a tractor load is one cube
 * — so this is where the dividing happens, once, for both apps.
 */
export function PricesModal({ prices, onClose }: { prices: SalesPrices | null; onClose: () => void }) {
  const { profile } = useSession();
  const toast = useToast();
  const [tipper, setTipper] = useState(prices ? String(prices.tipperPrice) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipperPrice = Number(tipper);
  const cubePrice = tipperPrice > 0 ? cubePriceFor(tipperPrice) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!(tipperPrice > 0)) return setError('මිල ශුන්‍යයට වඩා වැඩි විය යුතුය.');

    setBusy(true);
    setError(null);
    try {
      await saveSalesPrices({ tipperPrice, cubePrice: cubePriceFor(tipperPrice) }, profile);
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
      subtitle={`ටිපර් ලෝඩ් එකක් = කියුබ් ${CUBES_PER_TIPPER}. දැනටමත් සෑදූ බිල්පත් ඒවා සෑදූ මිලටම පවතී.`}
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
        <Field label="ටිපර් ලෝඩ් එකක මිල (රු.)" hint={`කියුබ් ${CUBES_PER_TIPPER}ක් — පිරුණු ටිපර් ලෝඩ් එකක්.`}>
          <Input type="number" inputMode="decimal" min="0" step="1" autoFocus required value={tipper} onChange={(event) => setTipper(event.target.value)} />
        </Field>
        <div className="rounded-card bg-well px-4 py-3 ring-1 ring-hairline">
          <p className="text-xs font-semibold text-white/60">මෙයින් හැදෙන මිල</p>
          <p className="mt-1 text-sm font-bold">
            කියුබ් එකක් <span className="text-amber-hi tabular-nums">{cubePrice != null ? `රු. ${money(cubePrice)}` : '—'}</span>
          </p>
          <p className="text-sm font-bold">
            ට්‍රැක්ටර් ලෝඩ් එකක් <span className="text-amber-hi tabular-nums">{cubePrice != null ? `රු. ${money(cubePrice)}` : '—'}</span>
          </p>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
