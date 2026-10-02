import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

import { DataError } from '../components/DataError';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  Panel,
  Select,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { useAuditLog } from '../data/audit';
import { dateTime } from '../lib/format';
import { AUDIT_LABEL, auditGroup, type AuditEntry } from '../lib/model';

type Group = 'all' | 'account' | 'store' | 'bill' | 'sales' | 'service' | 'figures' | 'tally';

const GROUP_LABEL: Record<Exclude<Group, 'all'>, string> = {
  account: 'ගිණුම්',
  store: 'ගබඩාව',
  bill: 'බිල්පත්',
  sales: 'විකුණුම් මිල',
  service: 'සේවා',
  figures: 'වැටුප/ඇඩ්වාන්ස්',
  tally: 'ලෝඩ්/අඩි',
};

const actionTone: Record<string, 'grape' | 'info' | 'amber' | 'ok' | 'muted'> = {
  account: 'grape',
  store: 'info',
  bill: 'amber',
  sales: 'ok',
  service: 'muted',
  figures: 'muted',
  tally: 'muted',
};

/** විගණන සටහන — every account, store, bill and price change, who made it and when. */
export function AuditLogPage() {
  const [count, setCount] = useState(100);
  const [group, setGroup] = useState<Group>('all');
  const log = useAuditLog(count);
  const entries = (log.data ?? []).filter((entry) => group === 'all' || auditGroup(entry.action) === group);

  return (
    <>
      <PageHeader
        title="විගණන සටහන"
        subtitle="ගිණුම්, ගබඩා අයිතම, බිල්පත් සහ මිල වෙනස් කළ හැම අවස්ථාවක්ම — කළේ කවුද, කවදාද."
      />

      <Panel tone="deep" className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <Field label="වර්ගය" className="min-w-48">
          <Select value={group} onChange={(event) => setGroup(event.target.value as Group)}>
            <option value="all">සියල්ල</option>
            {(Object.keys(GROUP_LABEL) as Exclude<Group, 'all'>[]).map((key) => (
              <option key={key} value={key}>
                {GROUP_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
      </Panel>

      <Panel className="p-4 sm:p-5">
        {log.error ? (
          <DataError error={log.error} />
        ) : log.data === undefined ? (
          <Loading />
        ) : entries.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-7" />} title="තවම සටහන් නැත" />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>වේලාව</th>
                  <th className={th}>ක්‍රියාව</th>
                  <th className={th}>විස්තරය</th>
                  <th className={th}>කළේ</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
            {log.data.length >= count && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => setCount((value) => value + 50)}>
                  පෙර සටහන් තවත් පෙන්වන්න
                </Button>
              </div>
            )}
          </TableFrame>
        )}
      </Panel>
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const tone = actionTone[auditGroup(entry.action)] ?? 'muted';
  return (
    <tr className="border-b border-hairline/60 align-top last:border-0">
      <td className={cx(td, 'text-xs whitespace-nowrap text-white/70')}>{dateTime(entry.createdAt)}</td>
      <td className={td}>
        <Badge tone={tone}>{AUDIT_LABEL[entry.action]}</Badge>
      </td>
      <td className={td}>
        <p className="font-semibold">{entry.entityLabel}</p>
        <p className="text-xs text-white/60">{entry.summary}</p>
      </td>
      <td className={cx(td, 'text-xs whitespace-nowrap text-white/70')}>{entry.createdByName}</td>
    </tr>
  );
}
