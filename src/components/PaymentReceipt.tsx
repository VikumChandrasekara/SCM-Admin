import { Printer } from 'lucide-react';

import { DEVELOPED_BY } from '../lib/company';
import { rupees } from '../lib/format';
import { Letterhead } from './Letterhead';
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
      <Letterhead />

      <div className="px-5 pt-4 pb-3">
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex flex-col justify-center">
            <p className="text-[17px] leading-tight font-black">ණය ගෙවීම් රිසිට්පත</p>
            <p className="mt-0.5 text-[9.5px] font-extrabold tracking-[0.22em] text-black/50">PAYMENT RECEIPT</p>
          </div>
          <div className="min-w-20 rounded-md border-2 border-black px-3 py-1.5 text-center">
            <p className="text-[9px] font-bold tracking-wider text-black/55">රිසිට් අංකය</p>
            <p className="text-[22px] leading-none font-black tabular-nums">{slip.id.slice(0, 6).toUpperCase()}</p>
          </div>
        </div>

        <dl className="mt-3.5 divide-y divide-black/10 rounded-md border border-black/15 px-3 py-0.5">
          <Row label="දිනය" value={slip.date} />
          <Row label="පාරිභෝගිකයා" value={slip.customerName || '—'} />
          {slip.note && <Row label="සටහන" value={slip.note} />}
        </dl>

        <div className="mt-3.5 flex items-center justify-between rounded-md border-2 border-black px-3 py-2">
          <span>
            <span className="block text-sm leading-tight font-black">ගෙවූ මුදල</span>
            <span className="block text-[9px] font-bold tracking-[0.22em] text-black/50">PAID</span>
          </span>
          <span className="text-[22px] font-black tabular-nums">{rupees(slip.amount)}</span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between px-1 text-black/70">
          <span className="text-[12px]">ඉතිරි ශේෂය</span>
          <span className="text-[13px] font-bold tabular-nums">{rupees(slip.balance)}</span>
        </div>

        <p className="mt-3 border-t border-black/10 pt-2 text-center text-[10.5px] text-black/55">
          Received by: {slip.createdByName || '—'}
        </p>
      </div>

      <div className="border-t border-dashed border-black/30 bg-black/[0.04] px-5 py-3 text-center">
        <p className="text-[12px] font-bold">ස්තූතියි!</p>
        <p className="mt-0.5 text-[9.5px] text-black/50">{DEVELOPED_BY}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-black/60">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
