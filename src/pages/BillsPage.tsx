import { ChevronLeft, ChevronRight, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { permissionsFor } from '../auth/permissions';
import { BillModal } from '../components/BillModal';
import { DataError } from '../components/DataError';
import { useToast } from '../components/Toasts';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  TableFrame,
  cx,
  td,
  th,
} from '../components/ui';
import { deleteBill, useMonthBills } from '../data/bills';
import { useLiveData } from '../data/LiveData';
import { errorMessage } from '../lib/errors';
import { addMonths, money, monthKey, monthLabel, rupees } from '../lib/format';
import { BILL, BILL_CATEGORIES, nameOf, type Bill, type BillCategory } from '../lib/model';

const categoryTone: Record<BillCategory, 'info' | 'ok' | 'amber' | 'muted'> = {
  advance: 'info',
  food: 'ok',
  water: 'amber',
  other: 'muted',
};

export function BillsPage() {
  const { profile } = useSession();
  const permissions = permissionsFor(profile);
  const { crew, peopleById } = useLiveData();
  const toast = useToast();

  const current = monthKey(new Date());
  const [month, setMonth] = useState(current);
  const [category, setCategory] = useState<BillCategory | ''>('');
  const [personId, setPersonId] = useState('');
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const bills = useMonthBills(month);
  const all = bills.data ?? [];
  const shown = all.filter(
    (bill) => (!category || bill.category === category) && (!personId || bill.operatorId === personId),
  );
  const total = (list: Bill[]) => list.reduce((sum, bill) => sum + bill.amount, 0);

  async function confirmDelete(bill: Bill) {
    setDeleteBusy(true);
    try {
      await deleteBill(bill, peopleById);
      toast.success('බිල්පත ඉවත් කළා.');
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="බිල්පත්"
        subtitle="ඇඩ්වාන්ස්, කෑම, වතුර බිල සහ වෙනත් වියදම්. ඇඩ්වාන්ස් සහ කෑම කණ්ඩායම් සාමාජිකයාගේ පඩියෙන් අඩු වේ."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-2xl bg-well p-1">
              <IconButton label="පෙර මාසය" onClick={() => setMonth((value) => addMonths(value, -1))}>
                <ChevronLeft className="size-5" />
              </IconButton>
              <span className="min-w-36 text-center text-sm font-bold">{monthLabel(month)}</span>
              <IconButton label="ඊළඟ මාසය" disabled={month >= current} onClick={() => setMonth((value) => addMonths(value, 1))}>
                <ChevronRight className="size-5" />
              </IconButton>
            </div>
            {permissions.addBills && (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                නව බිල්පතක්
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {BILL_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory((selected) => (selected === value ? '' : value))}
            className={cx(
              'rounded-2xl px-4 py-3 text-left ring-1 transition',
              category === value ? 'bg-amber-hi/15 ring-amber-hi' : 'bg-well ring-hairline hover:bg-black/30',
            )}
          >
            <p className="text-xs font-semibold text-white/65">{BILL[value].label}</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums">{money(total(all.filter((bill) => bill.category === value)))}</p>
          </button>
        ))}
        <div className="col-span-2 rounded-2xl px-4 py-3 text-ink shadow-control chip-amber md:col-span-1">
          <p className="text-xs font-bold">මුළු එකතුව</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums">{rupees(total(all))}</p>
        </div>
      </div>

      <Panel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select
            aria-label="කණ්ඩායම් සාමාජිකයා"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            className="w-auto min-w-52"
          >
            <option value="">සියලු දෙනා</option>
            {crew.map((person) => (
              <option key={person.id} value={person.id}>
                {nameOf(person)}
              </option>
            ))}
          </Select>
          {(category || personId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCategory('');
                setPersonId('');
              }}
            >
              පෙරහන් ඉවත් කරන්න
            </Button>
          )}
          <span className="ml-auto text-sm text-white/70">
            {shown.length} බිල්පත් · <b className="text-white">{rupees(total(shown))}</b>
          </span>
        </div>

        {bills.error ? (
          <DataError error={bills.error} />
        ) : bills.data === undefined ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon={<ReceiptText className="size-7" />} title="මෙම මාසයේ බිල්පත් නැත" />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>දිනය</th>
                  <th className={th}>වර්ගය</th>
                  <th className={cx(th, 'text-right')}>මුදල</th>
                  <th className={th}>කණ්ඩායම් සාමාජිකයා</th>
                  <th className={th}>සටහන</th>
                  <th className={th}>ඇතුළත් කළේ</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((bill) => (
                  <tr key={bill.id} className="border-b border-hairline/60 last:border-0">
                    <td className={cx(td, 'whitespace-nowrap tabular-nums')}>{bill.date}</td>
                    <td className={td}>
                      <Badge tone={categoryTone[bill.category]}>{BILL[bill.category].label}</Badge>
                    </td>
                    <td className={cx(td, 'text-right text-base font-extrabold tabular-nums')}>{money(bill.amount)}</td>
                    <td className={td}>{bill.operatorName ?? '—'}</td>
                    <td className={cx(td, 'max-w-64 text-white/75')}>{bill.note || '—'}</td>
                    <td className={cx(td, 'text-xs text-white/65')}>{bill.createdByName || '—'}</td>
                    <td className={cx(td, 'text-right')}>
                      {permissions.canEditBill(bill) && (
                        <div className="flex justify-end gap-1">
                          <IconButton label="සංස්කරණය" onClick={() => setEditing(bill)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="ඉවත් කරන්න" onClick={() => setDeleting(bill)} className="hover:text-red-200">
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      {editing && (
        <BillModal
          bill={editing === 'new' ? null : editing}
          category={category || 'other'}
          personId={personId || null}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Modal
          open
          size="sm"
          title="බිල්පත ඉවත් කරන්නද?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                අවලංගු
              </Button>
              <Button variant="danger" busy={deleteBusy} onClick={() => void confirmDelete(deleting)}>
                ඉවත් කරන්න
              </Button>
            </>
          }
        >
          <p className="text-sm text-white/80">
            {deleting.date} · {BILL[deleting.category].label} · <b>{rupees(deleting.amount)}</b>
            {deleting.operatorName && ` · ${deleting.operatorName}`}
            {deleting.category === 'advance' && deleting.operatorId && (
              <span className="mt-2 block text-white/65">ඔවුන්ගේ ඇඩ්වාන්ස් ගණනෙන් මෙම මුදල අඩු වේ.</span>
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
