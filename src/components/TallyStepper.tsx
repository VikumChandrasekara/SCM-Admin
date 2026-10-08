import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveTally } from '../data/machines';
import { errorMessage } from '../lib/errors';
import { hours } from '../lib/format';
import { tallyField, type Day, type Person } from '../lib/model';
import { useToast } from './Toasts';
import { IconButton } from './ui';

/**
 * Taps are collected and written once, as the operator app does: ten in a
 * row are one write, and one audit line.
 */
const SETTLE_MS = 600;

interface Pending {
  value: number;
  /** The day the taps were made on — the dashboard's date may move on before they settle. */
  date: string;
}

/**
 * The crew member's ලෝඩ් (or අඩි) for the day, with − and + — the supervisor
 * console's stepper, for whoever has the panel open. What staff may set is the
 * rules' to say (firestore.rules); the admin is staff.
 *
 * Give it `key={day.date}`, so a different day starts from its own figure.
 */
export function TallyStepper({ person, day }: { person: Person; day: Day }) {
  const { profile } = useSession();
  const toast = useToast();
  const field = tallyField(person);
  const whole = field === 'loads';

  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Pending | null>(null);
  const value = draft ?? day[field];

  // What a write on the way out needs, as it is at that moment.
  const latest = useRef({ person, field, profile });
  useEffect(() => {
    latest.current = { person, field, profile };
  });

  function write({ value: next, date }: Pending) {
    pending.current = null;
    return saveTally(person.machineId, date, field, next, person, profile)
      .catch((failure) => {
        toast.error(errorMessage(failure));
      })
      .finally(() => setDraft((current) => (current === next ? null : current)));
  }

  function bump(delta: number) {
    const next = Math.max(0, value + delta);
    if (next === value) return;
    setDraft(next);
    pending.current = { value: next, date: day.date };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (pending.current) void write(pending.current);
    }, SETTLE_MS);
  }

  // Leaving with a tap still settling must not throw it away.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const waiting = pending.current;
      if (!waiting) return;
      const { person: who, field: which, profile: by } = latest.current;
      void saveTally(who.machineId, waiting.date, which, waiting.value, who, by).catch(() => {});
    },
    [],
  );

  const label = whole ? 'ලෝඩ්' : 'අඩි';
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-[13px] text-white/55">{label}</span>
      <IconButton
        label={`${label} අඩු කරන්න`}
        className="size-7 bg-white/5"
        disabled={!person.machineId || value <= 0}
        onClick={() => bump(-1)}
      >
        <Minus className="size-3.5" />
      </IconButton>
      <span className="min-w-9 text-center text-[15px] font-bold text-amber-hi tabular-nums">
        {whole ? value : hours(value)}
      </span>
      <IconButton
        label={`${label} වැඩි කරන්න`}
        className="size-7 bg-white/5"
        disabled={!person.machineId}
        onClick={() => bump(1)}
      >
        <Plus className="size-3.5" />
      </IconButton>
    </div>
  );
}
