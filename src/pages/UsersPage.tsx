import { KeyRound, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { useSession } from '../auth/AuthContext';
import { useToast } from '../components/Toasts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
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
import { useLiveData } from '../data/LiveData';
import { USERNAME_PATTERN, changePassword, createAccount, removeAccount, updateAccount } from '../data/users';
import { USERNAME_DOMAIN } from '../firebase';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import { PAY_BASIS_LABEL, ROLES, ROLE_IDS, nameOf, rateOf, type PayBasis, type Person, type RoleId } from '../lib/model';

const roleTone: Record<RoleId, 'grape' | 'info' | 'amber' | 'ok'> = {
  admin: 'grape',
  supervisor: 'info',
  operator: 'amber',
  compressor: 'ok',
};

const MACHINE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function UsersPage() {
  const { profile } = useSession();
  const { people, ready } = useLiveData();
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [password, setPassword] = useState<Person | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);

  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader
        title="පරිශීලකයින්"
        subtitle="ගිණුම් සෑදීම, සංස්කරණය සහ ඉවත් කිරීම. සියලු දෙනා පිවිසෙන්නේ පරිශීලක නාමය සහ මුරපදයෙනි."
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setEditing('new')}>
            නව පරිශීලකයෙක්
          </Button>
        }
      />

      <Panel className="p-4 sm:p-5">
        {people.length === 0 ? (
          <EmptyState icon={<Users className="size-7" />} title="තවම ගිණුම් නැත" />
        ) : (
          <TableFrame>
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={th}>නම</th>
                  <th className={th}>පරිශීලක නාමය</th>
                  <th className={th}>භූමිකාව</th>
                  <th className={th}>යන්ත්‍රය</th>
                  <th className={cx(th, 'text-right')}>දවසේ පඩිය</th>
                  <th className={cx(th, 'text-right')}>අඩියකට / ලෝඩ් එකකට</th>
                  <th className={cx(th, 'text-right')}>ක්‍රියා</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const self = person.id === profile.id;
                  return (
                    <tr key={person.id} className="border-b border-hairline/60 last:border-0">
                      <td className={td}>
                        <span className="font-bold">{nameOf(person)}</span>
                        {self && (
                          <Badge tone="amber" className="ml-2">
                            ඔබ
                          </Badge>
                        )}
                      </td>
                      <td className={cx(td, 'text-white/80')}>{person.username || <span className="text-white/45">—</span>}</td>
                      <td className={td}>
                        <Badge tone={roleTone[person.role]}>{ROLES[person.role].label}</Badge>
                      </td>
                      <td className={cx(td, 'text-white/80')}>{person.machineId || '—'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{person.dailyWage > 0 ? money(person.dailyWage) : '—'}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {person.role === 'compressor' && rateOf(person) > 0 ? (
                          <>
                            {money(rateOf(person))}
                            <span className="block text-xs text-white/55">{PAY_BASIS_LABEL[person.payBasis].per}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <div className="flex justify-end gap-1">
                          <IconButton label="සංස්කරණය" onClick={() => setEditing(person)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label={person.username ? 'මුරපදය වෙනස් කරන්න' : 'පරිශීලක නාමය නොදන්නා පැරණි ගිණුමකි'}
                            disabled={!person.username}
                            onClick={() => setPassword(person)}
                          >
                            <KeyRound className="size-4" />
                          </IconButton>
                          <IconButton
                            label={self ? 'ඔබගේම ගිණුම ඉවත් කළ නොහැක' : 'ඉවත් කරන්න'}
                            disabled={self}
                            onClick={() => setRemoving(person)}
                            className="hover:text-red-200"
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Panel>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-white/55">
        Firebase නොමිලේ (Spark) සැලැස්මේ සර්වර් පැත්තක් නැති නිසා, වෙනත් අයෙකුගේ මුරපදය වෙනස් කිරීමට හෝ පිවිසුම
        සම්පූර්ණයෙන් මැකීමට ඔවුන්ගේ දැනට ඇති මුරපදය අවශ්‍යයි. එය නැතිව "ඉවත් කරන්න" එබූ විට, ඔවුන්ට යෙදුමට හෝ
        පුවරුවට ප්‍රවේශය එසැණින් නැති වේ — පරිශීලක නාමය පමණක් නැවත භාවිත කළ නොහැක.
      </p>

      {editing && <UserModal person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {password && <PasswordModal person={password} onClose={() => setPassword(null)} />}
      {removing && <RemoveModal person={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

function number(value: string): number {
  return value.trim() === '' ? 0 : Number(value);
}

function UserModal({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const { profile } = useSession();
  const { machines } = useLiveData();
  const toast = useToast();

  const [name, setName] = useState(person?.name ?? '');
  const [username, setUsername] = useState(person?.username ?? '');
  const [secret, setSecret] = useState('');
  const [role, setRole] = useState<RoleId>(person?.role ?? 'operator');
  const [machineId, setMachineId] = useState(person?.machineId ?? '');
  const [meter, setMeter] = useState('');
  const [wage, setWage] = useState(person?.dailyWage ? String(person.dailyWage) : '');
  const [payBasis, setPayBasis] = useState<PayBasis>(person?.payBasis ?? 'foot');
  const [rate, setRate] = useState(person?.ratePerFoot ? String(person.ratePerFoot) : '');
  const [loadRate, setLoadRate] = useState(person?.ratePerLoad ? String(person.ratePerLoad) : '');
  const [leave, setLeave] = useState(String(person?.leaveDays ?? 0));
  const [advance, setAdvance] = useState(String(person?.advanceAmount ?? 0));
  const [receivable, setReceivable] = useState(String(person?.receivableAmount ?? 0));
  const [bonus, setBonus] = useState(String(person?.bonusTotal ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crew = ROLES[role].isCrew;
  const machine = machineId.trim();
  const newMachine = crew && machine !== '' && !machines.has(machine);
  const self = person?.id === profile.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const figures = [number(wage), number(rate), number(loadRate), number(leave), number(advance), number(receivable), number(bonus), number(meter)];
    if (!name.trim()) return setError('නම ඇතුළත් කරන්න.');
    if (!person && !USERNAME_PATTERN.test(username.trim().toLowerCase())) {
      return setError('පරිශීලක නාමය අකුරු 3–32ක් විය යුතුය: a–z, 0–9, . _ - පමණි.');
    }
    if (!person && secret.length < 6) return setError('මුරපදය අවම වශයෙන් අක්ෂර 6ක් විය යුතුය.');
    if (crew && !MACHINE_PATTERN.test(machine)) return setError('යන්ත්‍ර අංකය ඇතුළත් කරන්න (උදා: excavator-01).');
    if (figures.some((value) => !Number.isFinite(value) || value < 0)) return setError('සංඛ්‍යා ඍණ නොවිය යුතුය.');
    if (self && role !== 'admin') return setError('ඔබගේම පරිපාලක අවසරය ඉවත් කළ නොහැක.');

    setBusy(true);
    setError(null);
    const fields = {
      name,
      role,
      machineId: machine,
      dailyWage: number(wage),
      payBasis,
      ratePerFoot: number(rate),
      ratePerLoad: number(loadRate),
    };
    try {
      if (person) {
        await updateAccount(
          person,
          {
            ...fields,
            leaveDays: Math.round(number(leave)),
            advanceAmount: number(advance),
            receivableAmount: number(receivable),
            bonusTotal: number(bonus),
            meterHours: number(meter),
          },
          machines,
        );
        toast.success(`${name.trim()} යාවත්කාලීන කළා.`);
      } else {
        await createAccount({ ...fields, username, password: secret, meterHours: number(meter) }, machines);
        toast.success(`${name.trim()} සඳහා ගිණුම සෑදුවා — පරිශීලක නාමය: ${username.trim().toLowerCase()}`);
      }
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={person ? 'පරිශීලකයා සංස්කරණය' : 'නව පරිශීලකයෙක්'}
      subtitle={person?.username ? `පරිශීලක නාමය: ${person.username}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="user-form" busy={busy}>
            {person ? 'සුරකින්න' : 'ගිණුම සාදන්න'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="නම">
            <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="භූමිකාව">
            <Select value={role} onChange={(event) => setRole(event.target.value as RoleId)} disabled={self}>
              {ROLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {ROLES[id].label} ({ROLES[id].english})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {!person && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="පරිශීලක නාමය" hint={`පිවිසීමට භාවිත කරයි. (${username.trim().toLowerCase() || 'name'}@${USERNAME_DOMAIN})`}>
              <Input
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="kamal"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label="මුරපදය" hint="අවම අක්ෂර 6. පරිශීලකයාට ලබා දී, ආරක්ෂිතව තබා ගන්න.">
              <Input required type="text" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} />
            </Field>
          </div>
        )}

        {crew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="යන්ත්‍රය"
              hint={newMachine ? 'නව යන්ත්‍රයකි — පළමු වරට සැකසේ.' : 'පවතින යන්ත්‍රයක් හෝ නව අංකයක්.'}
            >
              <Input
                required
                list="machine-list"
                placeholder={role === 'compressor' ? 'compressor-01' : 'excavator-01'}
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
              />
              <datalist id="machine-list">
                {[...machines.keys()].map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </Field>
            {newMachine && (
              <Field label="දැනට ඇති මීටර් පැය" hint="සේවා කාල ගණනය කරන්නේ මෙතැන් සිටයි.">
                <Input type="number" min="0" step="any" value={meter} onChange={(event) => setMeter(event.target.value)} />
              </Field>
            )}
          </div>
        )}

        {crew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="දවසේ පඩිය (රු.)" hint="වැඩ කළ දිනකට — මාසයේ මුදල් ගණනයට යොදයි.">
              <Input type="number" min="0" step="any" value={wage} onChange={(event) => setWage(event.target.value)} />
            </Field>
          </div>
        )}

        {role === 'compressor' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ගෙවන ආකාරය" hint="මාසයේ මුදල ගණනය කරන්නේ අඩි ගණනින්ද, ලෝඩ් ගණනින්ද යන්න.">
              <Select value={payBasis} onChange={(event) => setPayBasis(event.target.value as PayBasis)}>
                {(Object.keys(PAY_BASIS_LABEL) as PayBasis[]).map((id) => (
                  <option key={id} value={id}>
                    {PAY_BASIS_LABEL[id].choice}
                  </option>
                ))}
              </Select>
            </Field>
            {payBasis === 'load' ? (
              <Field label="ලෝඩ් එකක ගාස්තුව (රු.)" hint="යෙදුමේ ඔහුගේ ලැබිය යුතු මුදල මෙයින් ගණනය වේ.">
                <Input type="number" min="0" step="any" value={loadRate} onChange={(event) => setLoadRate(event.target.value)} />
              </Field>
            ) : (
              <Field label="අඩියක ගාස්තුව (රු.)" hint="යෙදුමේ ඔහුගේ ලැබිය යුතු මුදල මෙයින් ගණනය වේ.">
                <Input type="number" min="0" step="any" value={rate} onChange={(event) => setRate(event.target.value)} />
              </Field>
            )}
          </div>
        )}

        {person && crew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="නිවාඩු දින">
              <Input type="number" min="0" step="1" value={leave} onChange={(event) => setLeave(event.target.value)} />
            </Field>
            <Field label="ඇඩ්වාන්ස් (රු.)">
              <Input type="number" min="0" step="any" value={advance} onChange={(event) => setAdvance(event.target.value)} />
            </Field>
            <Field label="ලැබිය යුතු මුදල (රු.)" hint="ඇඩ්වාන්ස් අඩු කළ පසු ඉතිරිය කණ්ඩායමට පෙනේ.">
              <Input type="number" min="0" step="any" value={receivable} onChange={(event) => setReceivable(event.target.value)} />
            </Field>
            {role === 'operator' && (
              <Field label="බෝනස් එකතුව (රු.)">
                <Input type="number" min="0" step="any" value={bonus} onChange={(event) => setBonus(event.target.value)} />
              </Field>
            )}
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function PasswordModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 6) return setError('නව මුරපදය අවම වශයෙන් අක්ෂර 6ක් විය යුතුය.');
    if (next !== again) return setError('නව මුරපද දෙක නොගැළපේ.');
    setBusy(true);
    setError(null);
    try {
      await changePassword(person.username, current, next);
      toast.success(`${nameOf(person)} ගේ මුරපදය වෙනස් කළා.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title="මුරපදය වෙනස් කරන්න"
      subtitle={`${nameOf(person)} · ${person.username}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button type="submit" form="password-form" busy={busy}>
            වෙනස් කරන්න
          </Button>
        </>
      }
    >
      <form id="password-form" onSubmit={submit} className="space-y-4">
        <Field label="දැනට ඇති මුරපදය" hint="නොදන්නේ නම් ගිණුම ඉවත් කර නව පරිශීලක නාමයකින් නැවත සාදන්න.">
          <Input type="password" autoFocus required value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label="නව මුරපදය">
          <Input type="text" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        <Field label="නව මුරපදය නැවත">
          <Input type="text" autoComplete="new-password" required value={again} onChange={(event) => setAgain(event.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

function RemoveModal({ person, onClose }: { person: Person; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await removeAccount(person, password || null);
      toast.success(
        password ? `${nameOf(person)} ගේ ගිණුම සම්පූර්ණයෙන් මැකුවා.` : `${nameOf(person)} ගේ ප්‍රවේශය ඉවත් කළා.`,
      );
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={`${nameOf(person)} ඉවත් කරන්නද?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            අවලංගු
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            ඉවත් කරන්න
          </Button>
        </>
      }
    >
      <p className="text-sm text-white/80">
        ඉවත් කළ සැණින් ඔවුන්ට SCM යෙදුමට හෝ මෙම පුවරුවට ප්‍රවේශ විය නොහැක. පසුගිය වාර්තා (පිරවීම්, බිල්පත්) රැඳේ.
      </p>
      {person.username && (
        <Field
          className="mt-4"
          label="දැනට ඇති මුරපදය (විකල්ප)"
          hint="ඇතුළත් කළොත් පිවිසුමද මැකේ, එවිට පරිශීලක නාමය නැවත භාවිත කළ හැක."
        >
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
      )}
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
