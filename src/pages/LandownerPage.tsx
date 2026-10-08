import { BadgeCheck, ChevronLeft, ChevronRight, History, Mountain, PenLine, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { DataError } from '../components/DataError';
import { SignaturePad, SignatureView } from '../components/SignaturePad';
import { useToast } from '../components/Toasts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import {
  markLandownerPaid,
  saveLandownerRates,
  unmarkLandownerPaid,
  useLandownerPayments,
  useLandownerRates,
} from '../data/landowner';
import { useMonthSales, useNow } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { addMonths, dateTime, money, monthKey, monthLabel, quantity } from '../lib/format';
import {
  LANDOWNER_MATERIALS,
  currentRates,
  landownerShare,
  newestFirst,
  type LandownerMaterial,
  type LandownerPayment,
  type LandownerShare,
  type MaterialRates,
} from '../lib/landowner';
import { SALE_MATERIAL } from '../lib/model';
import { isSignature } from '../lib/signature';

/**
 * ඉඩම් හිමියා — what is paid to the landowner for each load of 6/9, සක්කර or
 * කෝරි ඩස්ට් that is sold, a figure for each; what that comes to for the
 * month, worked out from the bills; whether he has been paid it, with the name
 * and signature of whoever confirmed; and every change of the figures. Open to
 * the supervisor as well as the admin — firestore.rules lets staff set the
 * figures and mark a month paid, and nobody rewrite a past entry.
 */
export function LandownerPage() {
  const { profile } = useSession();
  const toast = useToast();
  const now = useNow();
  const rates = useLandownerRates();
  const payments = useLandownerPayments();

  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const sales = useMonthSales(month);

  const [drafts, setDrafts] = useState<Partial<Record<LandownerMaterial, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [removing, setRemoving] = useState(false);

  const history = rates.data ? newestFirst(rates.data) : [];
  const current = rates.data ? currentRates(rates.data) : null;
  const everSet = history.length > 0;
  const valueOf = (material: LandownerMaterial) => drafts[material] ?? String(current?.[material] ?? 0);

  const share = sales.data && rates.data ? landownerShare(sales.data, rates.data, now) : null;
  const payment = payments.data?.find((entry) => entry.month === month) ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    const next = {} as MaterialRates;
    for (const material of LANDOWNER_MATERIALS) {
      const text = valueOf(material).trim();
      const rate = text === '' ? NaN : Number(text);
      if (!(rate >= 0)) return setError('ගාස්තු ඍණ නොවන ගණන් විය යුතුය.');
      next[material] = rate;
    }
    if (everSet && LANDOWNER_MATERIALS.every((material) => next[material] === current[material])) {
      return setError('මෙය දැනට පවතින ගාස්තුම ය.');
    }

    setBusy(true);
    setError(null);
    try {
      await saveLandownerRates(next, everSet ? current : null, profile);
      toast.success('ඉඩම් හිමියාගේ ගාස්තු යාවත්කාලීන කළා. මෙතැන් සිට සෑදෙන බිල්පත් මෙම ගාස්තුවෙන් ගණනය වේ.');
      setDrafts({});
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: LandownerPayment) {
    setBusy(true);
    try {
      await unmarkLandownerPaid(entry, profile);
      toast.success(`${monthLabel(entry.month)} ගෙවූ බව ඉවත් කළා.`);
      setRemoving(false);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="ඉඩම් හිමියා"
        subtitle="6/9, සක්කර සහ කෝරි ඩස්ට් ලෝඩ් විකුණන හැම වතාවකම ඉඩම් හිමියාට ගෙවන මුදල — මාසෙකට වරක් එකවර ගෙවයි. බෝල්දාස් සඳහා නැත."
      />

      {rates.error ? (
        <DataError error={rates.error} />
      ) : payments.error ? (
        <DataError error={payments.error} />
      ) : rates.data === undefined || payments.data === undefined ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <Panel className="p-5">
              <p className="text-[10.5px] font-bold tracking-[0.14em] text-white/60 uppercase">ලෝඩ් එකකට ගාස්තු</p>
              <form onSubmit={submit} className="mt-4 space-y-3">
                {LANDOWNER_MATERIALS.map((material) => (
                  <Field key={material} label={`${SALE_MATERIAL[material]} — ලෝඩ් එකකට (රු.)`}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      required
                      value={valueOf(material)}
                      onChange={(event) => {
                        setDrafts({ ...drafts, [material]: event.target.value });
                        setError(null);
                      }}
                    />
                  </Field>
                ))}
                <p className="text-xs text-white/60">
                  {everSet
                    ? 'වෙනස් කළ පසු සෑදෙන බිල්පත්වලට පමණි. දැනටමත් සෑදූ බිල්පත්වල ගාස්තුව වෙනස් නොවේ.'
                    : 'තවම ගාස්තු සකසා නැත. පළමු වතාවට සුරැකූ පසු එය සහ ඉන් පසු හැම වෙනසක්ම ඉතිහාසයට ඇතුළත් වේ.'}
                </p>
                {error && <ErrorNote>{error}</ErrorNote>}
                <Button type="submit" busy={busy}>
                  සුරකින්න
                </Button>
              </form>
            </Panel>

            <Panel tone="deep" className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[10.5px] font-bold tracking-[0.14em] text-white/60 uppercase">මාසික ගෙවීම</p>
                <div className="flex items-center gap-1 rounded-card bg-well p-1">
                  <IconButton label="පෙර මාසය" onClick={() => setMonth((value) => addMonths(value, -1))}>
                    <ChevronLeft className="size-5" />
                  </IconButton>
                  <span className="min-w-36 text-center text-sm font-bold">{monthLabel(month)}</span>
                  <IconButton label="ඊළඟ මාසය" disabled={month >= thisMonth} onClick={() => setMonth((value) => addMonths(value, 1))}>
                    <ChevronRight className="size-5" />
                  </IconButton>
                </div>
              </div>

              {!share ? (
                <Loading />
              ) : (
                <>
                  <ShareTable share={share} />
                  {payment ? (
                    <PaidNote
                      payment={payment}
                      share={share}
                      canRemove={profile.role === 'admin'}
                      onRemove={() => setRemoving(true)}
                    />
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <Badge tone="amber">ගෙවා නැත</Badge>
                      <Button icon={<PenLine className="size-4" />} disabled={share.amount <= 0} onClick={() => setPaying(true)}>
                        ගෙවූ බව සලකුණු කරන්න
                      </Button>
                    </div>
                  )}
                </>
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
                title="තවම ගාස්තු සකසා නැත"
                detail="ගාස්තු සුරැකූ පසු එය සහ ඉන් පසු වන හැම වෙනසක්ම දිනය සහ වේලාවත් සමඟ මෙහි ලැයිස්තුගත වේ."
              />
            ) : (
              <TableFrame>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={th}>දිනය සහ වේලාව</th>
                      {LANDOWNER_MATERIALS.map((material) => (
                        <th key={material} className={cx(th, 'text-right')}>
                          {SALE_MATERIAL[material]}
                        </th>
                      ))}
                      <th className={th}>වෙනස් කළේ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-hairline/60 last:border-0">
                        <td className={cx(td, 'whitespace-nowrap')}>{entry.at ? dateTime(entry.at) : 'සුරකිමින්…'}</td>
                        {LANDOWNER_MATERIALS.map((material) => {
                          const before = entry.previousRates?.[material];
                          const moved = before != null && before !== entry.rates[material];
                          return (
                            <td key={material} className={cx(td, 'text-right tabular-nums')}>
                              <span className="font-bold">රු. {money(entry.rates[material])}</span>
                              {moved && <span className="block text-xs text-white/55">කලින් රු. {money(before)}</span>}
                            </td>
                          );
                        })}
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

      {paying && share && (
        <PayDialog
          month={month}
          share={share}
          onClose={() => setPaying(false)}
          onPaid={() => {
            toast.success(`${monthLabel(month)} ගෙවූ බව සලකුණු කළා.`);
            setPaying(false);
          }}
        />
      )}

      {removing && payment && (
        <Modal
          open
          size="sm"
          title="ගෙවූ බව ඉවත් කරන්නද?"
          subtitle={`${monthLabel(payment.month)} · රු. ${money(payment.amount)} — සලකුණ සහ අත්සන ඉවත් වේ. විගණන සටහනේ එය තබා ගනී.`}
          onClose={() => setRemoving(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(false)}>
                අවලංගු
              </Button>
              <Button variant="danger" busy={busy} onClick={() => void remove(payment)}>
                ඉවත් කරන්න
              </Button>
            </>
          }
        >
          <p className="text-sm text-white/70">තහවුරු කළේ {payment.confirmedName}.</p>
        </Modal>
      )}
    </>
  );
}

/** The month's loads and what they come to — by material, then in all. */
function ShareTable({ share }: { share: LandownerShare }) {
  return (
    <TableFrame>
      <table className="mt-3 w-full min-w-[360px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline">
            <th className={th}>ද්‍රව්‍යය</th>
            <th className={cx(th, 'text-right')}>ලෝඩ්</th>
            <th className={cx(th, 'text-right')}>මුදල</th>
          </tr>
        </thead>
        <tbody>
          {LANDOWNER_MATERIALS.map((material) => (
            <tr key={material} className="border-b border-hairline/60">
              <td className={td}>{SALE_MATERIAL[material]}</td>
              <td className={cx(td, 'text-right tabular-nums')}>{quantity(share.byMaterial[material].loads)}</td>
              <td className={cx(td, 'text-right tabular-nums')}>රු. {money(share.byMaterial[material].amount)}</td>
            </tr>
          ))}
          <tr>
            <td className={cx(td, 'font-bold')}>ගෙවිය යුතු මුළු මුදල</td>
            <td className={cx(td, 'text-right font-bold tabular-nums')}>{quantity(share.loads)}</td>
            <td className={cx(td, 'text-right text-lg font-extrabold text-amber-hi tabular-nums')}>රු. {money(share.amount)}</td>
          </tr>
        </tbody>
      </table>
    </TableFrame>
  );
}

function PaidNote({
  payment,
  share,
  canRemove,
  onRemove,
}: {
  payment: LandownerPayment;
  share: LandownerShare;
  canRemove: boolean;
  onRemove: () => void;
}) {
  // Bills dated in the month can still be added or corrected after it was marked.
  const drift = share.amount - payment.amount;
  return (
    <div className="mt-4 rounded-card bg-well p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="ok">
          <BadgeCheck className="mr-1 inline size-3.5" />
          ගෙවා ඇත · රු. {money(payment.amount)}
        </Badge>
        {canRemove && (
          <Button variant="ghost" size="sm" icon={<Undo2 className="size-3.5" />} onClick={onRemove}>
            ඉවත් කරන්න
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <SignatureView path={payment.signature} className="h-20 w-60 rounded-control bg-white text-slate-900" />
        <div className="text-sm">
          <p className="font-bold">{payment.confirmedName}</p>
          <p className="text-xs text-white/60">තහවුරු කළේ</p>
          <p className="mt-1 text-xs text-white/60">
            {payment.paidAt ? dateTime(payment.paidAt) : 'සුරකිමින්…'} · සලකුණු කළේ {payment.markedByName || '—'}
          </p>
        </div>
      </div>
      {drift !== 0 && (
        <p className="mt-3 text-xs text-amber-hi">
          සලකුණු කළ පසු මාසයේ බිල්පත් වෙනස් වී ඇත — දැන් ගණනය රු. {money(share.amount)} (වෙනස {drift > 0 ? '+' : '−'}රු.{' '}
          {money(Math.abs(drift))}).
        </p>
      )}
    </div>
  );
}

/** Who confirmed, and their signature — asked for on the spot. */
function PayDialog({
  month,
  share,
  onClose,
  onPaid,
}: {
  month: string;
  share: LandownerShare;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { profile } = useSession();
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setError('තහවුරු කළ අයගේ නම ඇතුළත් කරන්න.');
    if (!isSignature(signature)) return setError('අත්සන ඇතුළත් කරන්න.');

    setBusy(true);
    setError(null);
    try {
      await markLandownerPaid(month, share, name, signature, profile);
      onPaid();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      title="ගෙවූ බව සලකුණු කරන්න"
      subtitle={`${monthLabel(month)} · රු. ${money(share.amount)} · ලෝඩ් ${quantity(share.loads)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="landowner-pay-form" busy={busy}>
            තහවුරු කරන්න
          </Button>
        </>
      }
    >
      <form id="landowner-pay-form" onSubmit={submit} className="space-y-4">
        <Field label="තහවුරු කළ අයගේ නම">
          <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="අත්සන">
          <SignaturePad onChange={setSignature} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
