import { describe, expect, it } from 'vitest';

import { draftOf, editError, editLines, fillChanges, planMeters, type DayEdit } from '../src/lib/dayEdit';
import { ROLES, dayFrom, type Day } from '../src/lib/model';

const LOCKED = '2026-10-07T07:00:00.000Z';

/** A day as the database holds it. */
function day(
  date: string,
  parts: {
    on?: number;
    closing?: number;
    loads?: number;
    diesel?: number;
    locked?: boolean;
    inspection?: Record<string, boolean>;
  } = {},
): Day {
  return dayFrom(date, {
    date,
    ...(parts.closing != null ? { closingHours: parts.closing } : {}),
    ...(parts.loads != null ? { loads: parts.loads } : {}),
    ...(parts.inspection ? { inspection: parts.inspection } : {}),
    ...(parts.on != null || parts.diesel != null
      ? {
          fillings: {
            '1': {
              ...(parts.on != null ? { onHours: parts.on } : {}),
              amounts: parts.diesel != null ? { diesel: parts.diesel } : {},
              ...(parts.locked ? { lockedAt: LOCKED } : {}),
            },
          },
        }
      : {}),
  });
}

/** 6 → 7 → 8 October, each day closed by the next morning's ON. */
const sixth = day('2026-10-06', { on: 6771.2, closing: 6780.5 });
const seventh = day('2026-10-07', {
  on: 6780.5,
  closing: 6789.7,
  loads: 4,
  diesel: 220,
  locked: true,
  inspection: { diesel: true },
});
const eighth = day('2026-10-08', { on: 6789.7 });
const all = [eighth, seventh, sixth];

const around = (date: string, offset: number) => {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  return all.find((entry) => entry.date === moved) ?? null;
};

const context = (target: Day, machineHours = 6789.7) => ({
  day: target,
  previous: around(target.date, -1),
  next: around(target.date, 1),
  around: all,
  machineHours,
});

describe('moving a day’s meters', () => {
  it('changes nothing when nothing moved', () => {
    const planned = planMeters(context(seventh), 6780.5, 6789.7);
    expect(planned.plan).toMatchObject({ setOn: null, setClosing: null, closePrevious: null, totalHours: null });
    expect(planned.plan?.monthHours.size).toBe(0);
  });

  it('an ON moved takes the day before’s closing with it, and the hours move between the two days', () => {
    const planned = planMeters(context(seventh), 6781, 6789.7);
    expect(planned.error).toBeUndefined();
    expect(planned.plan?.setOn).toEqual({ slot: 1, value: 6781 });
    expect(planned.plan?.closePrevious).toEqual({ date: '2026-10-06', closingHours: 6781 });
    // The sixth gains what the seventh loses: the same month, so nothing moves.
    expect(planned.plan?.monthHours.size).toBe(0);
    expect(planned.plan?.totalHours).toBeNull();
  });

  it('hours that cross a month go to the month each day belongs to', () => {
    const lastOfSeptember = day('2026-09-30', { on: 100, closing: 108 });
    const firstOfOctober = day('2026-10-01', { on: 108, closing: 117 });
    const second = day('2026-10-02', { on: 117 });
    const set = [second, firstOfOctober, lastOfSeptember];
    const planned = planMeters(
      { day: firstOfOctober, previous: lastOfSeptember, next: second, around: set, machineHours: 117 },
      110,
      117,
    );
    expect(planned.plan?.closePrevious).toEqual({ date: '2026-09-30', closingHours: 110 });
    expect(Object.fromEntries(planned.plan!.monthHours)).toEqual({ '2026-09': 2, '2026-10': -2 });
  });

  it('refuses an ON outside the readings either side of it, or one taken away', () => {
    expect(planMeters(context(seventh), 6700, 6789.7).error).toMatch(/වඩා අඩු විය නොහැක/);
    expect(planMeters(context(seventh), 6800, 6789.7).error).toMatch(/වඩා වැඩි විය නොහැක/);
    expect(planMeters(context(seventh), null, 6789.7).error).toMatch(/ඉවත් කළ නොහැක/);
    expect(planMeters(context(seventh), -1, 6789.7).error).toBeDefined();
  });

  it('an OFF is the next morning’s ON, so it is not changed while there is one', () => {
    expect(planMeters(context(seventh), 6780.5, 6790).error).toMatch(/පසු දවසේ ON/);
  });

  it('the last day’s OFF can be set, and the hours and the machine’s meter follow it', () => {
    const planned = planMeters(context(eighth), 6789.7, 6795);
    expect(planned.plan?.setClosing).toBe(6795);
    expect(Object.fromEntries(planned.plan!.monthHours)).toEqual({ '2026-10': 5.3 });
    // The machine held this day’s reading, so it follows the new one.
    expect(planned.plan?.totalHours).toBe(6795);

    // A correction downward moves it back too, while it is still this day's reading.
    const wrong = day('2026-10-08', { on: 6789.7, closing: 6900 });
    const fixed = planMeters(
      { day: wrong, previous: seventh, next: null, around: [wrong, seventh, sixth], machineHours: 6900 },
      6789.7,
      6795,
    );
    expect(fixed.plan?.totalHours).toBe(6795);
    expect(Object.fromEntries(fixed.plan!.monthHours)).toEqual({ '2026-10': -105 });
  });

  it('an OFF below its ON, above a later reading, or taken away is refused', () => {
    expect(planMeters(context(eighth), 6789.7, 6700).error).toBeDefined();
    const later = day('2026-10-10', { on: 6800 });
    expect(
      planMeters(
        { day: eighth, previous: seventh, next: null, around: [later, eighth, seventh], machineHours: 6789.7 },
        6789.7,
        6900,
      ).error,
    ).toMatch(/වඩා වැඩි විය නොහැක/);
    const closed = day('2026-10-08', { on: 6789.7, closing: 6795 });
    expect(
      planMeters({ day: closed, previous: seventh, next: null, around: [closed], machineHours: 6795 }, 6789.7, null).error,
    ).toMatch(/ඉවත් කළ නොහැක/);
  });

  it('only raises the machine’s meter when the day was not its last reading', () => {
    // The machine already read further than this day: a higher OFF below it leaves it alone.
    expect(planMeters(context(eighth, 7000), 6789.7, 6795).plan?.totalHours).toBeNull();
    // A reading above what it holds raises it.
    expect(planMeters(context(eighth, 6700), 6789.7, 6795).plan?.totalHours).toBe(6795);
  });

  it('a day with no ON gains one as a leave day marked worked does', () => {
    const open = day('2026-10-09', { loads: 2 });
    const tenth = day('2026-10-10', { on: 6800 });
    const set = [tenth, open, eighth, seventh];
    const planned = planMeters({ day: open, previous: eighth, next: tenth, around: set, machineHours: 6800 }, 6795, null);
    expect(planned.plan?.setOn).toEqual({ slot: 1, value: 6795 });
    expect(planned.plan?.closePrevious).toEqual({ date: '2026-10-08', closingHours: 6795 });
    expect(planned.plan?.setClosing).toBe(6800);
    expect(Object.fromEntries(planned.plan!.monthHours)).toEqual({ '2026-10': 10.3 });
  });
});

describe('what else a day edit changes', () => {
  const role = ROLES.operator;
  const draft = (target: Day): DayEdit => draftOf(target, 'loads', role);

  it('starts as the day stands, and says nothing changed', () => {
    const edit = draft(seventh);
    expect(edit).toMatchObject({ onHours: 6780.5, offHours: 6789.7, tally: 4 });
    expect(edit.inspection.diesel).toBe(true);
    expect(edit.inspection.surroundings).toBeNull();
    expect(editLines(seventh, edit, 'loads')).toEqual([]);
    expect(fillChanges(seventh, edit)).toEqual([]);
  });

  it('lists each change in the log’s words', () => {
    const edit = draft(seventh);
    edit.onHours = 6781;
    edit.tally = 6;
    edit.fillings[1] = { diesel: 250 };
    edit.inspection.diesel = false;
    edit.inspection.surroundings = true;

    expect(editLines(seventh, edit, 'loads')).toEqual([
      'ON 6780.5 → 6781',
      'ලෝඩ් 4 → 6',
      expect.stringMatching(/\(පිරවීම 1\) 220 → 250 L$/),
      expect.stringMatching(/ ✓ → ✗$/),
      expect.stringMatching(/ — → ✓$/),
    ]);
    expect(fillChanges(seventh, edit)).toEqual([{ slot: 1, item: 'diesel', before: 220, after: 250, locked: true }]);
  });

  it('a mark can be taken away, and an amount cleared counts as nothing', () => {
    const edit = draft(seventh);
    edit.inspection.diesel = null;
    edit.fillings[1] = {};
    expect(editLines(seventh, edit, 'loads')).toEqual([
      expect.stringMatching(/220 → 0 L$/),
      expect.stringMatching(/ ✓ → —$/),
    ]);
  });

  it('refuses figures below nothing', () => {
    const edit = draft(seventh);
    expect(editError(edit)).toBeNull();
    expect(editError({ ...edit, tally: -1 })).toBeDefined();
    expect(editError({ ...edit, fillings: { 1: { diesel: -5 } } })).toBeDefined();
    expect(editError({ ...edit, onHours: -2 })).toBeDefined();
  });
});
