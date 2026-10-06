import { Printer } from 'lucide-react';

import { COMPANY, DEVELOPED_BY } from '../lib/company';
import { rupees } from '../lib/format';
import { LogoMark } from './Logo';
import { PRINT_CSS } from './SaleReceipt';
import { Button, Modal } from './ui';

/** What a receipt for one payment shows, as it was written. */
export interface PaymentSlip {
  id: string;
  customerName: string;
  amount: number;
  /** `yyyy-MM-dd` */
  date: string;
  note: string;
  createdByName: string;
  /** What the customer still owes once this payment is taken off. */
  balance: number;
}

/** The receipt for a payment just taken, with a print button. */
export function PaymentReceiptModal({ slip, onClose }: { slip: PaymentSlip; onClose: () => void }) {
  return (
    <Modal
      open
      size="sm"
      title="ණය ගෙවීම් රිසිට්පත"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            වසන්න
          </Button>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            මුද්‍රණය කරන්න
          </Button>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      <PaymentSheet slip={slip} />
    </Modal>
  );
}

// Printed the same way as a sale bill: the company's letterhead, then the
// payment and what is still owed.
export function PaymentSheet({ slip }: { slip: PaymentSlip }) {
  return (
    <div className="print-sheet mx-auto max-w-sm overflow-hidden rounded-card bg-white text-[12.5px] text-black shadow-panel">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <LogoMark className="size-12 shrink-0" />
        <div className="min-w-0 leading-snug">
          <p className="text-xl leading-tight font-extrabold tracking-wider">SCM</p>
          <p className="text-[11px] font-bold">{COMPANY.name}</p>
          <p className="mt-0.5 text-[10.5px]">{COMPANY.address}</p>
          <p className="text-[10.5px]">දුරකථන: {COMPANY.phone}</p>
        </div>
      </div>
      <div className="h-1 bg-[#F7A340]" />

      <div className="px-5 pt-4 pb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-base font-extrabold">ණය ගෙවීම් රිසිට්පත</p>
            <p className="text-[9.5px] font-extrabold tracking-[0.2em] text-black/45">PAYMENT RECEIPT</p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] text-black/55">රිසිට් අංකය</p>
            <p className="text-2xl leading-none font-extrabold tabular-nums">{slip.id.slice(0, 6).toUpperCase()}</p>
          </div>
        </div>

        <dl className="mt-3 space-y-1">
          <Row label="දිනය" value={slip.date} />
          <Row label="පාරිභෝගිකයා" value={slip.customerName || '—'} />
          {slip.note && <Row label="සටහන" value={slip.note} />}
        </dl>

        <div className="mt-4 flex items-baseline justify-between border-t-2 border-black pt-2">
          <span className="text-sm font-extrabold">ගෙවූ මුදල</span>
          <span className="text-lg font-extrabold tabular-nums">{rupees(slip.amount)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-black/70">
          <span className="text-[12px]">ඉතිරි ශේෂය</span>
          <span className="text-[13px] font-bold tabular-nums">{rupees(slip.balance)}</span>
        </div>

        <p className="mt-4 text-center text-[10.5px] text-black/55">Received by: {slip.createdByName || '—'}</p>
      </div>

      <div className="border-t border-dashed border-black/25 bg-black/[0.04] px-5 py-3 text-center">
        <p className="text-[12px] font-bold">ස්තූතියි!</p>
        <p className="mt-0.5 text-[9.5px] text-black/50">{DEVELOPED_BY}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-black/60">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
