import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { DataError } from '../components/DataError';
import { useToast } from '../components/Toasts';
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
import { restoreEntry, useRecycleBin } from '../data/recycle';
import { useNow } from '../data/sales';
import { errorMessage } from '../lib/errors';
import { dateTime } from '../lib/format';
import {
  BIN_KIND,
  BIN_RETENTION_DAYS,
  binDaysLeft,
  binExpired,
  binKindsFor,
  canRestoreEntry,
  type BinEntry,
  type BinKind,
} from '../lib/recycle';

const kindTone: Record<BinKind, 'grape' | 'info' | 'amber' | 'ok'> = {
  operator: 'grape',
  store: 'info',
  bill: 'amber',
  sale: 'ok',
};

/** කුණු කූඩය — what was deleted, kept for 30 days to put back. */
export function RecycleBinPage() {
  const { profile } = useSession();
  const toast = useToast();
  const now = useNow();
  const bin = useRecycleBin(profile.role);
  const kinds = binKindsFor(profile.role);

  const [kind, setKind] = useState<'all' | BinKind>('all');
  const [busy, setBusy] = useState<string | null>(null);

  // Past its days it is gone, whether or not the panel has purged it yet.
  // Newest first — the query leaves the order to here.
  const entries = (bin.data ?? [])
    .filter((entry) => !binExpired(entry, now) && (kind === 'all' || entry.kind === kind))
    .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));

  async function restore(entry: BinEntry) {
    setBusy(entry.id);
    try {
      await restoreEntry(entry, profile);
      toast.success(`${entry.label} ආපසු ගත්තා.`);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="කුණු කූඩය"
        subtitle={
          profile.role === 'admin'
            ? `මකා දැමූ බිල්පත්, විකුණුම් බිල්පත්, ගබඩා අයිතම සහ ගිණුම් දින ${BIN_RETENTION_DAYS}ක් මෙහි රැඳේ — ආපසු ගත හැක. ඉන්පසු ස්ථිරවම මැකේ.`
            : `මකා දැමූ බිල්පත් සහ ගබඩා අයිතම දින ${BIN_RETENTION_DAYS}ක් මෙහි රැඳේ. ආපසු ගත හැක්කේ ගබඩා අයිතම සහ ඔබ සෑදූ බිල්පත් පමණි. ඉන්පසු ස්ථිරවම මැකේ.`
        }
      />

      <Panel tone="deep" className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <Field label="වර්ගය" className="min-w-48">
          <Select value={kind} onChange={(event) => setKind(event.target.value as 'all' | BinKind)}>
            <option value="all">සියල්ල</option>
            {kinds.map((value) => (
              <option key={value} value={value}>
                {BIN_KIND[value].label}
              </option>
            ))}
          </Select>
        </Field>
      </Panel>

      <Panel className="p-4 sm:p-5">
        {bin.error ? (
          <DataError error={bin.error} />
        ) : bin.data === undefined ? (
          <Loading />
        ) : entries.length === 0 ? (
          <EmptyState icon={<Trash2 className="size-7" />} title="කුණු කූඩය හිස්ය" />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>වර්ගය</th>
                  <th className={th}>විස්තරය</th>
                  <th className={th}>මැකුවේ</th>
                  <th className={cx(th, 'text-right')}>ඉතිරි දින</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const left = binDaysLeft(entry, now);
                  return (
                    <tr key={entry.id} className="border-b border-hairline/60 align-top last:border-0">
                      <td className={td}>
                        <Badge tone={kindTone[entry.kind]}>{BIN_KIND[entry.kind].label}</Badge>
                      </td>
                      <td className={td}>
                        <p className="font-semibold">{entry.label || entry.docId}</p>
                        <p className="text-xs text-white/60">{entry.summary}</p>
                      </td>
                      <td className={cx(td, 'text-xs whitespace-nowrap text-white/70')}>
                        {entry.deletedByName || '—'}
                        <span className="block text-white/55">{dateTime(entry.deletedAt)}</span>
                      </td>
                      <td className={cx(td, 'text-right font-bold tabular-nums', left <= 3 && 'text-red-300')}>
                        {left}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        {canRestoreEntry(entry, profile) ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<RotateCcw className="size-3.5" />}
                            busy={busy === entry.id}
                            onClick={() => void restore(entry)}
                          >
                            ආපසු ගන්න
                          </Button>
                        ) : (
                          <span className="text-xs text-white/45">වෙනත් අයෙකුගේ බිල්පතකි</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>
    </>
  );
}
