import { useEffect, useState } from 'react';

import { useLiveData } from '../data/LiveData';
import { useItemMovements } from '../data/store';
import { dateTime, quantity } from '../lib/format';
import { MOVEMENT_LABEL, ROLES, linkLabel, nameOf, sourceLabel, type Movement, type Person, type StoreItem } from '../lib/model';
import { historyRows, pageDelta } from '../lib/storeHistory';
import { DataError } from './DataError';
import { Pagination } from './Pagination';
import { Badge, Loading, TableFrame, cx, td, th } from './ui';

/** Who made a change: the crew member who recorded the use, or the staff member who counted or added. */
function whoOf(movement: Movement, crew: readonly Person[]): { name: string; role: string } {
  const person = crew.find((entry) => entry.id === movement.createdBy);
  return {
    name: movement.operatorName || (person ? nameOf(person) : '') || movement.createdByName || '—',
    role: person ? ROLES[person.role].label : '',
  };
}

/**
 * Everything that has happened to one item, newest first, 50 to a page: when,
 * how much, what the count was before and what it is after, and who — a crew
 * member's use of it on a පිරවීම or වෙඩි බඩු sheet, or a restock, count or
 * removal by staff.
 */
export function ItemHistory({ item }: { item: StoreItem }) {
  const { crew } = useLiveData();
  const history = useItemMovements(item.id);
  const page = history.pager.page;
  const rows = history.data;

  // What the pages before this one added up to, learnt as the reader pages
  // back: the counts on a page are the item's count now, less everything newer.
  const [skipped, setSkipped] = useState<Record<number, number>>({ 1: 0 });
  useEffect(() => {
    if (!rows) return;
    const here = skipped[page];
    if (here === undefined) return;
    const next = here + pageDelta(rows, item.id);
    setSkipped((known) => (known[page + 1] === next ? known : { ...known, [page + 1]: next }));
  }, [rows, page, item.id, skipped]);

  if (history.error) return <DataError error={history.error} />;
  if (rows === undefined) return <Loading />;
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-white/60">මෙම අයිතමයට තවම වෙනස්කම් නැත.</p>;
  }

  const lines = historyRows(rows, item.id, item.quantity, skipped[page] ?? null);

  return (
    <>
      <TableFrame>
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className={th}>දිනය සහ වේලාව</th>
              <th className={th}>වර්ගය</th>
              <th className={cx(th, 'text-right')}>ප්‍රමාණය</th>
              <th className={cx(th, 'text-right')}>කලින් තිබුණු</th>
              <th className={cx(th, 'text-right')}>පසුව ඇති</th>
              <th className={th}>කළේ</th>
              <th className={th}>විස්තරය</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ movement, delta, before, after }) => {
              const who = whoOf(movement, crew);
              const detail =
                movement.type === 'usage'
                  ? [movement.machineId, movement.date, sourceLabel(movement.source)].filter(Boolean).join(' · ')
                  : movement.note;
              return (
                <tr key={movement.id} className="border-b border-hairline/50 align-top last:border-0">
                  <td className={cx(td, 'whitespace-nowrap text-white/80')}>{dateTime(movement.createdAt)}</td>
                  <td className={td}>
                    <Badge tone={movement.type === 'usage' || movement.type === 'use' ? 'info' : movement.type === 'restock' ? 'ok' : 'muted'}>
                      {MOVEMENT_LABEL[movement.type]}
                    </Badge>
                  </td>
                  <td className={cx(td, 'text-right font-bold tabular-nums', delta < 0 ? 'text-red-200' : 'text-lime-hi')}>
                    {delta > 0 ? '+' : ''}
                    {quantity(delta, item.unit)}
                  </td>
                  <td className={cx(td, 'text-right text-white/75 tabular-nums')}>{before == null ? '—' : quantity(before, item.unit)}</td>
                  <td className={cx(td, 'text-right font-bold tabular-nums')}>{after == null ? '—' : quantity(after, item.unit)}</td>
                  <td className={td}>
                    <span className="font-semibold">{who.name}</span>
                    {who.role && <span className="block text-[11px] text-white/50">{who.role}</span>}
                  </td>
                  <td className={cx(td, 'text-xs text-white/70')}>
                    {detail || '—'}
                    {movement.unmatched.length > 0 && (
                      <span className="block text-white/50">ගබඩා අයිතමයක් නැත: {movement.unmatched.map((link) => linkLabel(link as never)).join(', ')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <Pagination pager={history.pager} />
      <p className="mt-2 text-[11px] text-white/45">කලින් / පසුව ප්‍රමාණ, දැනට ඇති ප්‍රමාණයෙන් පසුපසට වෙනස්කම් ගණනය කර පෙන්වයි.</p>
    </>
  );
}
