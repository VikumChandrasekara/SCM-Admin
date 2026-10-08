import { Truck } from 'lucide-react';

import { money, monthLabel, quantity } from '../lib/format';
import { loadAnalysis, type LoadAnalysis as Analysis, type LoadKind, type LoadRow } from '../lib/loads';
import { SALE_MATERIAL, type Sale } from '../lib/model';
import { Panel, TableFrame, cx, td, th } from './ui';

const labelOf = (kind: LoadKind) => (kind === 'unknown' ? 'වර්ගය සඳහන් නැත' : SALE_MATERIAL[kind]);

/**
 * ගිය ලෝඩ් — how many loads have gone this month, and of what: each material
 * by tipper and tractor, with its share of the whole. Only verified bills
 * count as gone; the ones that have not are listed under it.
 */
export function LoadAnalysis({ sales, month, now }: { sales: readonly Sale[]; month: string; now: number }) {
  const analysis = loadAnalysis(sales, now);
  const { total } = analysis;

  return (
    <Panel className="mb-6 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Truck className="size-4 text-white/60" />
            ගිය ලෝඩ් විශ්ලේෂණය · {monthLabel(month)}
          </h2>
          <p className="mt-1 text-xs text-white/60">තහවුරු කළ (ගිය) බිල්පත් පමණි. ටිපර් බිල්පතක් ලෝඩ් 1කි; ට්‍රැක්ටර් බිල්පතක් එහි ලෝඩ් ගණනයි.</p>
        </div>
        <p className="text-right">
          <span className="text-3xl font-extrabold text-lime-hi tabular-nums">{quantity(total.loads)}</span>
          <span className="ml-1.5 text-sm text-white/65">ලෝඩ් ගියා</span>
        </p>
      </div>

      <TableFrame>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className={th}>ලෝඩ් වර්ගය</th>
              <th className={cx(th, 'text-right')}>ටිපර් ලෝඩ්</th>
              <th className={cx(th, 'text-right')}>කියුබ්</th>
              <th className={cx(th, 'text-right')}>ට්‍රැක්ටර් ලෝඩ්</th>
              <th className={cx(th, 'text-right')}>මුළු ලෝඩ්</th>
              <th className={th}>කොටස</th>
              <th className={cx(th, 'text-right')}>මුදල</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.map((row) => (
              <Row key={row.kind} row={row} total={total.loads} />
            ))}
            <tr className="font-bold">
              <td className={td}>එකතුව</td>
              <td className={cx(td, 'text-right tabular-nums')}>{quantity(total.tipperLoads)}</td>
              <td className={cx(td, 'text-right tabular-nums')}>{quantity(total.cubes)}</td>
              <td className={cx(td, 'text-right tabular-nums')}>{quantity(total.tractorLoads)}</td>
              <td className={cx(td, 'text-right text-base tabular-nums')}>{quantity(total.loads)}</td>
              <td className={td} />
              <td className={cx(td, 'text-right tabular-nums')}>රු. {money(total.amount)}</td>
            </tr>
          </tbody>
        </table>
      </TableFrame>

      <Waiting analysis={analysis} />
    </Panel>
  );
}

function Row({ row, total }: { row: LoadRow; total: number }) {
  const share = total > 0 ? (row.loads / total) * 100 : 0;
  return (
    <tr className="border-b border-hairline/60">
      <td className={cx(td, 'font-semibold', row.loads === 0 && 'text-white/50')}>{labelOf(row.kind)}</td>
      <td className={cx(td, 'text-right tabular-nums')}>{quantity(row.tipperLoads)}</td>
      <td className={cx(td, 'text-right text-white/70 tabular-nums')}>{quantity(row.cubes)}</td>
      <td className={cx(td, 'text-right tabular-nums')}>{quantity(row.tractorLoads)}</td>
      <td className={cx(td, 'text-right font-bold tabular-nums')}>{quantity(row.loads)}</td>
      <td className={td}>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-lime-hi" style={{ width: `${share}%` }} />
          </div>
          <span className="w-10 text-xs text-white/65 tabular-nums">{share.toFixed(0)}%</span>
        </div>
      </td>
      <td className={cx(td, 'text-right tabular-nums')}>රු. {money(row.amount)}</td>
    </tr>
  );
}

/** What has not gone, so the month's bills are all accounted for. */
function Waiting({ analysis }: { analysis: Analysis }) {
  const { pending, prepaidOpen } = analysis;
  if (pending.bills === 0 && prepaidOpen.bills === 0) return null;
  return (
    <p className="mt-3 text-xs text-white/65">
      තවම ගොස් නැත:{' '}
      {[
        pending.bills > 0 && `තහවුරු වීමට ඇති බිල්පත් ${pending.bills} (ලෝඩ් ${quantity(pending.loads)})`,
        prepaidOpen.bills > 0 && `කලින් ගෙවූ, ලෝඩ් ඉතිරි බිල්පත් ${prepaidOpen.bills} (ලෝඩ් ${quantity(prepaidOpen.loads)})`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}
