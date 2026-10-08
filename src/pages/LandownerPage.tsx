import { History, Mountain } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { DataError } from '../components/DataError';
import { useToast } from '../components/Toasts';
import { Button, EmptyState, ErrorNote, Field, Input, Loading, PageHeader, Panel, TableFrame, cx, td, th } from '../components/ui';
import { saveLandownerRate, useLandownerRates } from '../data/landowner';
import { useMonthSales, useNow } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { dateTime, money, monthKey, monthLabel, quantity } from '../lib/format';
import {
  LANDOWNER_MATERIALS,
  currentRate,
  landownerChargeOf,
  newestFirst,
  paysLandowner,
  saleLoads,
} from '../lib/landowner';
import { SALE_MATERIAL, isSaleIncome } from '../lib/model';

/**
 * ඉඩම් හිමියා — what is paid to the landowner for each load sold, and every
 * time that figure has changed. Open to the supervisor as well as the admin;
 * firestore.rules lets staff set it and nobody rewrite or remove a past entry.
 */
export function LandownerPage() {
  const { profile } = useSession();
  const toast = useToast();
  const now = useNow();
  const rates = useLandownerRates();
  const month = monthKey(new Date());
  const sales = useMonthSales(month);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = rates.data ? newestFirst(rates.data) : [];
  const current = rates.data ? currentRate(rates.data) : 0;
  const everSet = history.length > 0;

  // This month's share, each bill at the figure in force when it was written.
  const share = (() => {
    if (!sales.data || !rates.data) return null;
    let loads = 0;
    let amount = 0;
    for (const sale of sales.data) {
      if (!isSaleIncome(sale, now) || !paysLandowner(sale)) continue;
      loads += saleLoads(sale);
      amount += landownerChargeOf(sale, rates.data);
    }
    return { loads, amount };
  })();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const rate = draft.trim() === '' ? NaN : Number(draft);
    if (!(rate >= 0)) return setError('ගාස්තුව ඍණ නොවන ගණනක් විය යුතුය.');
    if (everSet && rate === current) return setError('මෙය දැනට පවතින ගාස්තුවමයි.');

    setBusy(true);
    setError(null);
    try {
      await saveLandownerRate(rate, everSet ? current : null, profile);
      toast.success('ඉඩම් හිමියාගේ ගාස්තුව යාවත්කාලීන කළා. මෙතැන් සිට සෑදෙන බිල්පත් මෙම ගාස්තුවෙන් ගණනය වේ.');
      setDraft('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="ඉඩම් හිමියා"
        subtitle="6/9, සක්කර සහ කෝරි දූවිලි ලෝඩ් එකක් විකුණන හැම වතාවකම ඉඩම් හිමියාට ගෙවන මුදල. බෝල්දාස් සඳහා නැත."
      />

      {rates.error ? (
        <DataError error={rates.error} />
      ) : rates.data === undefined ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Panel className="p-5">
              <p className="text-[10.5px] font-bold tracking-[0.14em] text-white/60 uppercase">දැන් ගාස්තුව</p>
              <p className="mt-1 text-3xl font-extrabold text-amber-hi tabular-nums">
                {everSet ? `රු. ${money(current)}` : 'තවම සකසා නැත'}
              </p>
              <p className="text-sm text-white/65">ලෝඩ් එකකට</p>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <Field
                  label="නව ගාස්තුව — ලෝඩ් එකකට (රු.)"
                  hint="වෙනස් කළ පසු සෑදෙන බිල්පත්වලට පමණි. දැනටමත් සෑදූ බිල්පත්වල ගාස්තුව වෙනස් නොවේ."
                >
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    required
                    value={draft}
                    placeholder={everSet ? String(current) : '0'}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError(null);
                    }}
                  />
                </Field>
                {error && <ErrorNote>{error}</ErrorNote>}
                <Button type="submit" busy={busy}>
                  සුරකින්න
                </Button>
              </form>
            </Panel>

            <Panel tone="deep" className="p-5">
              <p className="text-[10.5px] font-bold tracking-[0.14em] text-white/60 uppercase">
                {monthLabel(month)} · ඉඩම් හිමියාට
              </p>
              {share ? (
                <>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums">රු. {money(share.amount)}</p>
                  <p className="text-sm text-white/65">
                    තහවුරු කළ ලෝඩ් {quantity(share.loads)} ·{' '}
                    {LANDOWNER_MATERIALS.map((material) => SALE_MATERIAL[material]).join(', ')}
                  </p>
                </>
              ) : (
                <Loading />
              )}
            </Panel>
          </div>

          <Panel className="p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <History className="size-4 text-white/60" />
              ගාස්තු වෙනස්කිරීම්
            </h2>
            {history.length === 0 ? (
              <EmptyState
                icon={<Mountain className="size-7" />}
                title="තවම ගාස්තුවක් සකසා නැත"
                detail="පළමු ගාස්තුව සුරැකූ පසු එය සහ ඉන් පසු වන හැම වෙනසක්ම දිනය සහ වේලාවත් සමඟ මෙහි ලැයිස්තුගත වේ."
              />
            ) : (
              <TableFrame>
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>දිනය සහ වේලාව</th>
                      <th className={cx(th, 'text-right')}>කලින්</th>
                      <th className={cx(th, 'text-right')}>අලුත්</th>
                      <th className={th}>වෙනස් කළේ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-hairline/60 last:border-0">
                        <td className={cx(td, 'whitespace-nowrap')}>{entry.at ? dateTime(entry.at) : 'සුරකිමින්…'}</td>
                        <td className={cx(td, 'text-right tabular-nums text-white/70')}>
                          {entry.previousRate == null ? '—' : `රු. ${money(entry.previousRate)}`}
                        </td>
                        <td className={cx(td, 'text-right font-bold tabular-nums')}>රු. {money(entry.rate)}</td>
                        <td className={td}>{entry.setByName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
