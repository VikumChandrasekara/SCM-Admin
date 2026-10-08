import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '../auth/AuthContext';
import { saveTally } from '../data/machines';
import { errorMessage } from '../lib/errors';
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

  /** What is being typed in the field, or null while it just shows the figure. */
  const [typing, setTyping] = useState<string | null>(null);
  const cancelled = useRef(false);

  // A figure typed in is final: written at once rather than after the taps settle.
  function commit() {
    const text = typing;
    setTyping(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text == null || text.trim() === '') return;
    const typed = Number(text);
    if (!Number.isFinite(typed) || typed < 0) return;
    const next = whole ? Math.round(typed) : typed;
    if (next === value) return;
    setDraft(next);
    window.clearTimeout(timer.current);
    void write({ value: next, date: day.date });
  }

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
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step={whole ? '1' : 'any'}
        aria-label={`${label} ගණන`}
        disabled={!person.machineId}
        value={typing ?? (whole ? String(value) : String(Number(value.toFixed(2))))}
        onFocus={(event) => {
          setTyping(String(value));
          event.target.select();
        }}
        onChange={(event) => setTyping(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        className="h-7 w-14 rounded-control bg-transparent text-center text-[15px] font-bold text-amber-hi tabular-nums outline-none [appearance:textfield] focus:bg-white/10 focus:ring-1 focus:ring-amber-hi/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
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
