import { useCallback, useRef } from 'react';

import { DEVELOPED_BY } from '../lib/company';
import { rupees } from '../lib/format';
import { PrintButton, PrinterSettings, useBillPrint } from './BillPrint';
import { Letterhead } from './Letterhead';
import { ReceiptRow, StarRule } from './ReceiptParts';
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
  const body = useRef<HTMLDivElement>(null);
  const printer = useBillPrint(useCallback(() => body.current?.querySelector<HTMLElement>('.print-sheet') ?? null, []));

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
          <PrintButton printer={printer} />
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      <div ref={body}>
        <PaymentSheet slip={slip} />
      </div>
      <PrinterSettings printer={printer} />
    </Modal>
  );
}

// Printed the same way as a sale bill: the company's name, then the payment
// and what is still owed, black on white.
export function PaymentSheet({ slip }: { slip: PaymentSlip }) {
  return (
    <div className="print-sheet mx-auto max-w-sm overflow-hidden rounded-card bg-white pb-5 text-[13px] text-black shadow-panel">
      <Letterhead />

      <div className="space-y-3 px-5">
        <StarRule />
        <div className="text-center">
          <p className="text-[18px] leading-tight font-black">ණය ගෙවීම් රිසිට්පත</p>
          <p className="mt-0.5 pl-[0.3em] text-[10px] font-bold tracking-[0.3em]">PAYMENT RECEIPT</p>
        </div>
        <StarRule />

        <dl className="space-y-1">
          <ReceiptRow strong label="රිසිට් අංකය" value={slip.id.slice(0, 6).toUpperCase()} />
          <ReceiptRow label="දිනය" value={slip.date} />
          <ReceiptRow label="පාරිභෝගිකයා" value={slip.customerName || '—'} />
          {slip.note && <ReceiptRow label="සටහන" value={slip.note} />}
        </dl>
        <StarRule />

        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-black">ගෙවූ මුදල</span>
            <span className="text-[22px] font-black tabular-nums">{rupees(slip.amount)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span>ඉතිරි ශේෂය</span>
            <span className="font-bold tabular-nums">{rupees(slip.balance)}</span>
          </div>
        </div>
        <StarRule />

        <div className="text-center">
          <p className="text-[11.5px]">Received by: {slip.createdByName || '—'}</p>
          <p className="mt-2 text-[13px] font-black">ස්තූතියි!</p>
          <p className="mt-1 text-[10px]">{DEVELOPED_BY}</p>
        </div>
      </div>
    </div>
  );
}
