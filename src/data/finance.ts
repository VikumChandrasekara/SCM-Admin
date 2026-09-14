import { Timestamp, collection, getDoc, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';

import { db } from '../db';
import { monthBounds, parseDateKey } from '../lib/format';
import { monthFrom, movementFrom, type Day, type MonthTally, type Person } from '../lib/model';
import { useLiveQuery } from './live';
import { fetchDays, monthRef } from './machines';

/** Every change to a count written during `yyyy-MM`, newest first. */
export function useMonthMovements(month: string) {
  return useLiveQuery(
    `movements-in:${month}`,
    () => {
      const { from, to } = monthBounds(month);
      const start = parseDateKey(from);
      const end = parseDateKey(to);
      end.setDate(end.getDate() + 1);
      // A range and an order on the one field — no composite index.
      return query(
        collection(db, 'storeMovements'),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<', Timestamp.fromDate(end)),
        orderBy('createdAt', 'desc'),
      );
    },
    (snapshot) => movementFrom(snapshot.id, snapshot.data()),
  );
}

export interface CrewMonth {
  person: Person;
  days: Day[];
  tally: MonthTally;
}

/**
 * Each crew member's days and tally for `yyyy-MM` — what their pay is worked
 * out from. Read once for the month shown rather than followed, since that
 * would be a listener per machine; bump [version] to read it again.
 */
export function useCrewMonths(
  crew: readonly Person[],
  month: string,
  version = 0,
): { data: CrewMonth[] | undefined; error: unknown } {
  const key = `${month}|${version}|${crew.map((person) => `${person.id}:${person.machineId}`).join(',')}`;
  const [state, setState] = useState<{ key: string; data?: CrewMonth[]; error: unknown }>({
    key: '',
    error: null,
  });

  // [key] already carries everything the read depends on.
  const people = useRef(crew);
  useEffect(() => {
    people.current = crew;
  });

  useEffect(() => {
    let active = true;
    const [readMonth] = key.split('|');
    const { from, to } = monthBounds(readMonth);
    Promise.all(
      people.current.map(async (person): Promise<CrewMonth> => {
        if (!person.machineId) return { person, days: [], tally: monthFrom(readMonth, undefined) };
        const [days, tally] = await Promise.all([
          fetchDays(person.machineId, from, to),
          getDoc(monthRef(person.machineId, readMonth)),
        ]);
        return { person, days, tally: monthFrom(readMonth, tally.data()) };
      }),
    ).then(
      (data) => {
        if (active) setState({ key, data, error: null });
      },
      (error: unknown) => {
        if (active) setState({ key, error });
      },
    );
    return () => {
      active = false;
    };
  }, [key]);

  return state.key === key ? { data: state.data, error: state.error } : { data: undefined, error: null };
}
