import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSale } from '../data/sales';
import { DEVELOPED_BY } from '../lib/company';
import { dateTime, money, quantity, rupees } from '../lib/format';
import {
  PAYMENT_TYPE_LABEL,
  PREPAID_LABEL,
  SALE_MATERIAL,
  SALE_STATUS,
  SALE_TYPE,
  formatSaleCode,
  saleNumber,
  saleQrPayload,
  type Sale,
  type SaleStatus,
} from '../lib/model';
import { PrintButton, PrinterSettings, useBillPrint } from './BillPrint';
import { Letterhead } from './Letterhead';
import { ReceiptRow, StarRule } from './ReceiptParts';
import { Badge, Button, Loading, Modal } from './ui';

const statusTone: Record<SaleStatus, 'ok' | 'low' | 'out'> = {
  verified: 'ok',
  pending: 'low',
  cancelled: 'out',
};

/** Where a sale stands; a prepaid one still waiting for its load says so. */
export function SaleStatusBadge({ status, prepaid = false }: { status: SaleStatus; prepaid?: boolean }) {
  if (prepaid && status === 'pending') return <Badge tone="ok">{PREPAID_LABEL}</Badge>;
  return <Badge tone={statusTone[status]}>{SALE_STATUS[status]}</Badge>;
}

/** The QR a bill carries, drawn here — nothing is sent anywhere to make it. */
export function useSaleQr(code: string): string | null {
  const [image, setImage] = useState<{ code: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(saleQrPayload(code), { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (active) setImage({ code, url });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [code]);
  return image?.code === code ? image.url : null;
}

// Only the bill is printed, a till-roll wide — it prints the same on a
// receipt printer and at the top of an A4 sheet. It is black on white with no
// fills, so there is nothing a browser would drop.
export const PRINT_CSS = `
@media print {
  @page { margin: 4mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet {
    position: fixed !important; left: 0; top: 0; width: 72mm;
    margin: 0 !important; box-shadow: none !important; border-radius: 0 !important;
  }
}`;

/** The bill for sale [code], live, with its QR and a print button. */
export function SaleReceiptModal({ code, onClose }: { code: string; onClose: () => void }) {
  const sale = useSale(code);
  const body = useRef<HTMLDivElement>(null);
  const printer = useBillPrint(useCallback(() => body.current?.querySelector<HTMLElement>('.print-sheet') ?? null, []));

  return (
    <Modal
      open
      size="sm"
      title={sale.data ? `බිල්පත ${saleNumber(sale.data)}` : 'බිල්පත'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            වසන්න
          </Button>
          <PrintButton printer={printer} disabled={!sale.data} />
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      <div ref={body}>
        {sale.data === undefined ? (
          <Loading />
        ) : sale.data === null ? (
          <p className="py-8 text-center text-sm text-white/70">මෙම අංකයෙන් බිල්පතක් නැත.</p>
        ) : (
          <SaleSheet sale={sale.data} />
        )}
      </div>
      {sale.data && <PrinterSettings printer={printer} />}
    </Modal>
  );
}

/**
 * The bill itself, as it is printed — a till receipt, black on white: the
 * company's name, the bill's number within the month, what was sold and to
 * whom, the line sold with its total, and the QR any role scans to verify it.
 */
export function SaleSheet({ sale }: { sale: Sale }) {
  const qr = useSaleQr(sale.code);
  const type = SALE_TYPE[sale.type];

  return (
    <div className="print-sheet mx-auto max-w-sm overflow-hidden rounded-card bg-white pb-5 text-[13px] text-black shadow-panel">
      <Letterhead />

      <div className="space-y-3 px-5">
        <StarRule />
        <div className="text-center">
          <p className="text-[18px] leading-tight font-black">විකුණුම් බිල්පත</p>
          <p className="mt-0.5 pl-[0.3em] text-[10px] font-bold tracking-[0.3em]">SALES INVOICE</p>
        </div>
        <StarRule />

        <dl className="space-y-1">
          <ReceiptRow strong label="බිල් අංකය" value={saleNumber(sale)} />
          <ReceiptRow label="දිනය" value={dateTime(sale.createdAt)} />
          <ReceiptRow label="පාරිභෝගිකයා" value={sale.customerName || '—'} />
          {sale.customerPhone && <ReceiptRow label="දුරකථනය" value={sale.customerPhone} />}
          {sale.vehicleNo && <ReceiptRow label="වාහනය" value={sale.vehicleNo} />}
          {sale.material && <ReceiptRow label="ද්‍රව්‍යය" value={SALE_MATERIAL[sale.material]} />}
          <ReceiptRow label="ගෙවීම" value={PAYMENT_TYPE_LABEL[sale.paymentType]} />
          {sale.prepaid && <ReceiptRow label="ලෝඩ් එක" value="කලින් ගෙවූ — පසුව ගෙන යයි" />}
        </dl>
        <StarRule />

        <div>
          <div className="flex justify-between text-[12px] font-bold">
            <span>විස්තරය</span>
            <span>මුදල</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="font-bold">{type.label}</span>
            <span className="font-bold tabular-nums">{money(sale.amount)}</span>
          </div>
          <p className="text-[12px] tabular-nums">
            {quantity(sale.quantity, type.unit)} × {money(sale.unitPrice)} / {type.unit}
          </p>
          {sale.note && <p className="mt-0.5 text-[12px]">{sale.note}</p>}
        </div>
        <StarRule />

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-black">මුළු මුදල</span>
            <span className="text-[22px] font-black tabular-nums">{rupees(sale.amount)}</span>
          </div>
          {sale.paymentType === 'credit' && (
            <p className="mt-1.5 text-[11.5px] font-semibold">ණය බිල්පතකි — මුදල පසුව ගෙවිය යුතුය.</p>
          )}
        </div>
        <StarRule />

        <div className="flex flex-col items-center">
          {qr ? (
            <img src={qr} alt={`QR ${formatSaleCode(sale.code)}`} className="size-36" />
          ) : (
            <div className="size-36 border border-dashed border-black" />
          )}
          {/* Typed in to verify the bill when the QR cannot be scanned. */}
          <p className="mt-1.5 pl-[0.18em] font-mono text-[12px] font-bold tracking-[0.18em]">{formatSaleCode(sale.code)}</p>
          <p className="mt-0.5 text-[10.5px]">QR එක ස්කෑන් කර බිල්පත තහවුරු කරන්න</p>
        </div>
        <StarRule />

        <div className="text-center">
          <p className="text-[11.5px]">Billed by: {sale.createdByName || '—'}</p>
          <p className="mt-2 text-[13px] font-black">ස්තූතියි! නැවත එන්න.</p>
          <p className="mt-1 text-[10px]">{DEVELOPED_BY}</p>
        </div>
      </div>
    </div>
  );
}
