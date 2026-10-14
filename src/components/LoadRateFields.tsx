import type { Person } from '../lib/model';
import { Field, Input } from './ui';

/**
 * The rates a driller paid per load is given for the loads other than 6/9 —
 * each typed in on its own, as text, until they are saved. 6/9 is the
 * person's wage rate, entered beside the wage basis.
 */
export interface LoadRateDraft {
  sakka: string;
  boldas: string;
  c1: string;
}

export type LoadRates = Pick<Person, 'sakkaLoadWage' | 'boldasLoadWage' | 'c1LoadWage'>;

const text = (rate: number) => (rate ? String(rate) : '');

export const draftOf = (person?: Pick<Person, keyof LoadRates> | null): LoadRateDraft => ({
  sakka: text(person?.sakkaLoadWage ?? 0),
  boldas: text(person?.boldasLoadWage ?? 0),
  c1: text(person?.c1LoadWage ?? 0),
});

const rateOf = (value: string) => (value.trim() === '' ? 0 : Number(value));

/** The typed rates as numbers — NaN for one that is not a number. */
export const ratesOf = (draft: LoadRateDraft): LoadRates => ({
  sakkaLoadWage: rateOf(draft.sakka),
  boldasLoadWage: rateOf(draft.boldas),
  c1LoadWage: rateOf(draft.c1),
});

const FIELDS: readonly { key: keyof LoadRateDraft; label: string; hint: string }[] = [
  { key: 'sakka', label: 'පඩිය (රු.) — සක්කර ලෝඩ් එකකට', hint: 'තහවුරු කළ සක්කර ලෝඩ් වලට ගෙවන මුදල. හිස්ව තැබුවොත් ගෙවීමක් නැත.' },
  { key: 'boldas', label: 'පඩිය (රු.) — බෝල්දාස් ලෝඩ් එකකට', hint: 'තහවුරු කළ බෝල්දාස් ලෝඩ් වලට ගෙවන මුදල. හිස්ව තැබුවොත් ගෙවීමක් නැත.' },
  { key: 'c1', label: 'පඩිය (රු.) — C1 ලෝඩ් එකකට', hint: 'තහවුරු කළ C1 ලෝඩ් වලට ගෙවන මුදල. හිස්ව තැබුවොත් ගෙවීමක් නැත.' },
];

/** One field a rate, to sit inside the form's grid beside the 6/9 wage. */
export function LoadRateFields({
  draft,
  onChange,
}: {
  draft: LoadRateDraft;
  onChange: (next: LoadRateDraft) => void;
}) {
  return (
    <>
      {FIELDS.map(({ key, label, hint }) => (
        <Field key={key} label={label} hint={hint}>
          <Input
            type="number"
            min="0"
            step="any"
            value={draft[key]}
            onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
          />
        </Field>
      ))}
    </>
  );
}
