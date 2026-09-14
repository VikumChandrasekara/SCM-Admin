import { Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { useSale } from '../data/sales';
import { COMPANY, DEVELOPED_BY } from '../lib/company';
import { dateTime, money, quantity, rupees } from '../lib/format';
import {
  SALE_STATUS,
  SALE_TYPE,
  formatSaleCode,
  saleNumber,
  saleQrPayload,
  type Sale,
  type SaleStatus,
} from '../lib/model';
import { LogoMark } from './Logo';
import { Badge, Button, Loading, Modal, cx } from './ui';

const statusTone: Record<SaleStatus, 'ok' | 'low' | 'out'> = {
  verified: 'ok',
  pending: 'low',
  cancelled: 'out',
};

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
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
// receipt printer and at the top of an A4 sheet. The letterhead's rule and
// the tinted table head are kept: browsers drop backgrounds unless told.
const PRINT_CSS = `
@media print {
  @page { margin: 4mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet {
    position: fixed !important; left: 0; top: 0; width: 72mm;
    margin: 0 !important; box-shadow: none !important; border-radius: 0 !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
}`;

/** The bill for sale [code], live, with its QR and a print button. */
export function SaleReceiptModal({ code, onClose }: { code: string; onClose: () => void }) {
  const sale = useSale(code);

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
          <Button icon={<Printer className="size-4" />} disabled={!sale.data} onClick={() => window.print()}>
            මුද්‍රණය කරන්න
          </Button>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      {sale.data === undefined ? (
        <Loading />
      ) : sale.data === null ? (
        <p className="py-8 text-center text-sm text-white/70">මෙම අංකයෙන් බිල්පතක් නැත.</p>
      ) : (
        <SaleSheet sale={sale.data} />
      )}
    </Modal>
  );
}

/**
 * The bill itself, as it is printed: the company's letterhead, the bill's
 * number within the month, the line sold as a small table, and the QR any
 * role scans to verify it.
 */
export function SaleSheet({ sale }: { sale: Sale }) {
  const qr = useSaleQr(sale.code);
  const cell = 'px-2 py-1.5 text-right';

  return (
    <div className="print-sheet mx-auto max-w-sm overflow-hidden rounded-2xl bg-white text-[12.5px] text-black shadow-panel">
      {/* Letterhead */}
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
            <p className="text-base font-extrabold">විකුණුම් බිල්පත</p>
            <p className="text-[9.5px] font-extrabold tracking-[0.2em] text-black/45">SALES INVOICE</p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] text-black/55">බිල් අංකය</p>
            <p className="text-2xl leading-none font-extrabold tabular-nums">{saleNumber(sale)}</p>
          </div>
        </div>

        <dl className="mt-3 space-y-1">
          <Row label="දිනය" value={dateTime(sale.createdAt)} />
          <Row label="පාරිභෝගිකයා" value={sale.customerName || '—'} />
          {sale.customerPhone && <Row label="දුරකථනය" value={sale.customerPhone} />}
          {sale.vehicleNo && <Row label="වාහනය" value={sale.vehicleNo} />}
        </dl>

        <table className="mt-3 w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-black/[0.06] text-[10.5px] text-black/60">
              <th className="rounded-l-md px-2 py-1.5 text-left font-bold">විස්තරය</th>
              <th className={cx(cell, 'font-bold')}>ප්‍රමාණය</th>
              <th className={cx(cell, 'font-bold')}>මිල</th>
              <th className={cx(cell, 'rounded-r-md font-bold')}>මුදල</th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="px-2 py-2 font-bold">
                {SALE_TYPE[sale.type].label}
                {sale.note && <span className="block text-[10.5px] font-normal text-black/60">{sale.note}</span>}
              </td>
              <td className={cx(cell, 'py-2 tabular-nums')}>{quantity(sale.quantity)}</td>
              <td className={cx(cell, 'py-2 tabular-nums')}>{money(sale.unitPrice)}</td>
              <td className={cx(cell, 'py-2 font-bold tabular-nums')}>{money(sale.amount)}</td>
            </tr>
          </tbody>
        </table>

        <div className="flex items-baseline justify-between border-t-2 border-black pt-2">
          <span className="text-sm font-extrabold">මුළු මුදල</span>
          <span className="text-lg font-extrabold tabular-nums">{rupees(sale.amount)}</span>
        </div>

        <div className="mt-4 flex flex-col items-center">
          {qr ? (
            <img src={qr} alt={`QR ${formatSaleCode(sale.code)}`} className="size-40" />
          ) : (
            <div className="size-40 animate-pulse rounded bg-black/10" />
          )}
        </div>

        <p className="mt-3 text-center text-[10.5px] text-black/55">Billed by: {sale.createdByName || '—'}</p>
      </div>

      {/* Footer */}
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
