import { collection, type FirestoreError } from 'firebase/firestore';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { db } from '../db';
import {
  ROLES,
  byCrewThenName,
  machineFrom,
  personFrom,
  storeItemFrom,
  type Machine,
  type Person,
  type StoreItem,
} from '../lib/model';
import { useLiveQuery } from './live';

/**
 * The handful of collections nearly every page needs, subscribed once for
 * the whole signed-in session instead of once per page.
 */
export interface LiveData {
  /** Everyone with an account, crews first. */
  people: Person[];
  /** Only the operators and compressor crews — who the dashboard shows. */
  crew: Person[];
  peopleById: Map<string, Person>;
  store: StoreItem[];
  machines: Map<string, Machine>;
  ready: boolean;
  /**
   * Why one of the three could not be read. A refused listener never
   * delivers, so without this the panel would wait on it for ever.
   */
  error: FirestoreError | null;
}

const LiveDataContext = createContext<LiveData | null>(null);

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const people = useLiveQuery(
    'operators',
    () => collection(db, 'operators'),
    (snapshot) => personFrom(snapshot.id, snapshot.data()),
  );
  const store = useLiveQuery(
    'store',
    () => collection(db, 'store'),
    (snapshot) => storeItemFrom(snapshot.id, snapshot.data()),
  );
  const machines = useLiveQuery(
    'machines',
    () => collection(db, 'machines'),
    (snapshot) => machineFrom(snapshot.id, snapshot.data()),
  );

  const value = useMemo<LiveData>(() => {
    const everyone = [...(people.data ?? [])].sort(byCrewThenName);
    return {
      people: everyone,
      crew: everyone.filter((person) => ROLES[person.role].isCrew),
      peopleById: new Map(everyone.map((person) => [person.id, person])),
      store: [...(store.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      machines: new Map((machines.data ?? []).map((machine) => [machine.id, machine])),
      ready: people.data !== undefined && store.data !== undefined && machines.data !== undefined,
      error: people.error ?? store.error ?? machines.error,
    };
  }, [people, store, machines]);

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

export function useLiveData(): LiveData {
  const value = useContext(LiveDataContext);
  if (!value) throw new Error('useLiveData() must be used inside <LiveDataProvider>');
  return value;
}
