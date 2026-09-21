import { Camera, CameraOff, CircleCheck, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { SaleStatusBadge } from '../components/SaleReceipt';
import { useToast } from '../components/Toasts';
import { Button, ErrorNote, Field, Input, Loading, PageHeader, Panel } from '../components/ui';
import { fetchSale, fetchSaleByNumber, useNow, verifySale } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { dateTime, money, quantity, rupees } from '../lib/format';
import {
  SALE_TYPE,
  formatSaleCode,
  padSaleNumber,
  parseInvoiceNumber,
  parseSaleCode,
  saleExpiry,
  saleNumber,
  saleStatus,
  type Sale,
} from '../lib/model';

type Lookup =
  | { state: 'idle' }
  | { state: 'loading'; query: string }
  | { state: 'missing'; query: string }
  | { state: 'failed'; message: string }
  | { state: 'found'; sale: Sale };

/**
 * බිල්පතක් තහවුරු කරන්න — scan a bill's QR (or type its number), check it
 * against the sale, and verify it: what makes the sale income.
 */
export function VerifyPage() {
  const { profile } = useSession();
  const toast = useToast();
  const now = useNow(30_000);
  const [typed, setTyped] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // QR scans still resolve the real code — unaffected by how a bill's
  // invoice number is typed in below.
  const openByCode = useCallback(async (code: string) => {
    setError(null);
    setLookup({ state: 'loading', query: formatSaleCode(code) });
    try {
      const sale = await fetchSale(code);
      setLookup(sale ? { state: 'found', sale } : { state: 'missing', query: formatSaleCode(code) });
    } catch (failure) {
      setLookup({ state: 'failed', message: errorMessage(failure) });
    }
  }, []);

  const openByNumber = useCallback(async (number: number) => {
    setError(null);
    const query = padSaleNumber(number);
    setLookup({ state: 'loading', query });
    try {
      const sale = await fetchSaleByNumber(number);
      setLookup(sale ? { state: 'found', sale } : { state: 'missing', query });
    } catch (failure) {
      setLookup({ state: 'failed', message: errorMessage(failure) });
    }
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const number = parseInvoiceNumber(typed);
    if (!number) {
      setError('බිල් අංකය ඉලක්කම් වලින් සමන්විත විය යුතුය — උදා: 007');
      return;
    }
    void openByNumber(number);
  }

  async function verify(sale: Sale) {
    setBusy(true);
    setError(null);
    try {
      const done = await verifySale(sale.code, profile);
      setLookup({ state: 'found', sale: done });
      toast.success(`බිල් අංක ${saleNumber(sale)} තහවුරු කළා — ${rupees(sale.amount)} ආදායමට එකතු විය.`);
    } catch (failure) {
      setError(errorMessage(failure));
      // Show what the bill says now, if it can be read.
      const fresh = await fetchSale(sale.code).catch(() => null);
      if (fresh) setLookup({ state: 'found', sale: fresh });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="බිල්පතක් තහවුරු කරන්න"
        subtitle="බිල්පතේ QR එක කැමරාවට පෙන්වන්න, නැතහොත් බිල් අංකය ඇතුළත් කරන්න. තහවුරු කළ පසු විකුණුම ආදායමක් ලෙස ගණන් වේ."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="p-4 sm:p-5">
          <CameraScanner onCode={openByCode} />
          <form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-3">
            <Field label="බිල් අංකය" className="min-w-0 flex-1">
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value.replace(/\D/g, ''))}
                placeholder="007"
                inputMode="numeric"
                spellCheck={false}
                className="font-mono text-lg tracking-widest tabular-nums"
              />
            </Field>
            <Button type="submit" variant="secondary">
              සොයන්න
            </Button>
          </form>
        </Panel>

        <Panel tone="deep" className="p-4 sm:p-5">
          {lookup.state === 'idle' && (
            <div className="flex flex-col items-center py-14 text-center text-white/60">
              <ScanLine className="mb-3 size-10" />
              <p className="text-sm">ස්කෑන් කළ බිල්පත මෙහි පෙන්වයි.</p>
            </div>
          )}
          {lookup.state === 'loading' && <Loading label={`${lookup.query} සොයමින්...`} />}
          {lookup.state === 'missing' && (
            <ErrorNote>{lookup.query} — මෙම අංකයෙන් බිල්පතක් නැත. අංකය නැවත පරීක්ෂා කරන්න.</ErrorNote>
          )}
          {lookup.state === 'failed' && <ErrorNote>{lookup.message}</ErrorNote>}
          {lookup.state === 'found' && (
            <SaleCheck sale={lookup.sale} now={now} busy={busy} onVerify={() => void verify(lookup.sale)} />
          )}
          {error && (
            <div className="mt-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

/** The sale, laid out to be checked against the load in front of you. */
function SaleCheck({ sale, now, busy, onVerify }: { sale: Sale; now: number; busy: boolean; onVerify: () => void }) {
  const status = saleStatus(sale, now);
  const expiry = saleExpiry(sale);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-extrabold">බිල් අංකය {saleNumber(sale)}</p>
          <p className="font-mono text-sm font-bold tracking-[0.15em] text-white/60">{formatSaleCode(sale.code)}</p>
        </div>
        <SaleStatusBadge status={status} />
      </div>

      <div className="mb-4 rounded-card px-4 py-3 text-ink shadow-control chip-amber">
        <p className="text-sm font-bold">
          {SALE_TYPE[sale.type].label} · {quantity(sale.quantity)} {SALE_TYPE[sale.type].unit} × {money(sale.unitPrice)}
        </p>
        <p className="text-3xl font-extrabold tabular-nums">{rupees(sale.amount)}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-white/60">පාරිභෝගිකයා</dt>
        <dd className="font-semibold">{sale.customerName || '—'}</dd>
        <dt className="text-white/60">දුරකථනය</dt>
        <dd>{sale.customerPhone || '—'}</dd>
        <dt className="text-white/60">වාහනය</dt>
        <dd>{sale.vehicleNo || '—'}</dd>
        <dt className="text-white/60">සෑදුවේ</dt>
        <dd>
          {sale.createdByName || '—'} · {dateTime(sale.createdAt)}
        </dd>
        {sale.note && (
          <>
            <dt className="text-white/60">සටහන</dt>
            <dd>{sale.note}</dd>
          </>
        )}
      </dl>

      <div className="mt-5">
        {status === 'verified' ? (
          <p className="flex items-center gap-2 rounded-xl bg-lime-hi/15 px-4 py-3 text-sm font-bold text-lime-hi ring-1 ring-lime-hi/40">
            <CircleCheck className="size-5" /> තහවුරුයි — {sale.verifiedByName || '—'}, {dateTime(sale.verifiedAt)}
          </p>
        ) : status === 'cancelled' ? (
          <ErrorNote>පැය 24ක් ඇතුළත තහවුරු නොකළ නිසා මෙම බිල්පත අවලංගු වී ඇත. එය තහවුරු කළ නොහැක.</ErrorNote>
        ) : (
          <>
            <p className="mb-3 text-xs text-white/60">
              {expiry ? `${dateTime(expiry)} ට පෙර තහවුරු කළ යුතුය.` : 'පැය 24ක් ඇතුළත තහවුරු කළ යුතුය.'} ප්‍රමාණය සහ
              වාහනය පරීක්ෂා කර තහවුරු කරන්න.
            </p>
            <Button size="lg" variant="success" busy={busy} className="w-full" icon={<CircleCheck className="size-5" />} onClick={onVerify}>
              තහවුරු කරන්න
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Reads QR codes off the computer's camera, entirely on this computer: frames
 * are decoded here and never leave it. Stops itself on the first bill found.
 */
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'off' | 'starting' | 'on'>('off');
  const [problem, setProblem] = useState<string | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setState('off');
  }, []);

  // Leaving the page turns the camera off.
  useEffect(() => stop, [stop]);

  async function start() {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem('මෙම බ්‍රව්සරයේ කැමරාව භාවිත කළ නොහැක. බිල් අංකය ඇතුළත් කරන්න.');
      return;
    }
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      stream.current = media;
      const element = video.current;
      if (!element) return;
      element.srcObject = media;
      await element.play();
      setState('on');
    } catch (failure) {
      stop();
      const name = (failure as { name?: string }).name;
      setProblem(
        name === 'NotAllowedError'
          ? 'කැමරාවට අවසර දී නැත. බ්‍රව්සරයේ ලිපින තීරුවෙන් අවසර දෙන්න.'
          : name === 'NotFoundError'
            ? 'මෙම පරිගණකයට කැමරාවක් සම්බන්ධ කර නැත. බිල් අංකය ඇතුළත් කරන්න.'
            : 'කැමරාව ආරම්භ කළ නොහැකි විය.',
      );
    }
  }

  useEffect(() => {
    if (state !== 'on') return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let timer = 0;
    let active = true;
    // The decoder is most of this page's weight, so it is fetched only once
    // the camera is actually on — a bill number typed in never needs it.
    let jsQR: typeof import('jsqr').default | null = null;
    import('jsqr')
      .then((module) => {
        jsQR = module.default;
      })
      .catch(() => setProblem('ස්කෑනරය පූරණය කළ නොහැකි විය. බිල් අංකය ඇතුළත් කරන්න.'));

    const tick = () => {
      if (!active) return;
      if (!jsQR) {
        timer = window.setTimeout(tick, 250);
        return;
      }
      const element = video.current;
      if (element && context && element.readyState >= 2 && element.videoWidth > 0) {
        // A smaller frame decodes quicker, and a bill's QR is large enough.
        const scale = Math.min(1, 640 / element.videoWidth);
        canvas.width = Math.round(element.videoWidth * scale);
        canvas.height = Math.round(element.videoHeight * scale);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
        const code = found ? parseSaleCode(found.data) : null;
        if (code) {
          stop();
          onCode(code);
          return;
        }
      }
      // Four looks a second: quick enough to feel instant, light on the CPU.
      timer = window.setTimeout(tick, 250);
    };
    tick();

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [state, stop, onCode]);

  return (
    <div>
      <div className="relative aspect-video overflow-hidden rounded-card bg-black ring-1 ring-hairline">
        <video ref={video} muted playsInline className={state === 'on' ? 'size-full object-cover' : 'hidden'} />
        {state === 'on' && <div className="pointer-events-none absolute inset-[18%] rounded-card border-4 border-amber-hi/80" />}
        {state !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60">
            <Camera className="size-10" />
            <p className="text-sm">QR එක ස්කෑන් කිරීමට කැමරාව ආරම්භ කරන්න</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        {state === 'on' ? (
          <Button variant="secondary" icon={<CameraOff className="size-4" />} onClick={stop}>
            කැමරාව නවත්වන්න
          </Button>
        ) : (
          <Button icon={<Camera className="size-4" />} busy={state === 'starting'} onClick={() => void start()}>
            කැමරාවෙන් ස්කෑන් කරන්න
          </Button>
        )}
      </div>
      {problem && (
        <div className="mt-3">
          <ErrorNote>{problem}</ErrorNote>
        </div>
      )}
    </div>
  );
}
