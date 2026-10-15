import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  getDocs,
  limit,
  onSnapshot,
  query,
  startAfter,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';

import { PAGE_SIZE, type Pager } from '../lib/paginate';

/** A value that follows Firestore: undefined until the first snapshot lands. */
export interface Live<T> {
  data: T | undefined;
  error: FirestoreError | null;
}

/** The latest render's value, readable from an effect without resubscribing. */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Listens to one document for as long as the component is mounted.
 *
 * Resubscribes only when the path changes, so handing it a freshly built
 * reference on every render costs nothing.
 */
export function useLiveDoc<T>(
  ref: DocumentReference | null,
  parse: (snapshot: DocumentSnapshot) => T,
): Live<T> {
  const path = ref?.path ?? null;
  const refRef = useLatest(ref);
  const parseRef = useLatest(parse);
  const [state, setState] = useState<Live<T> & { path: string | null }>({
    data: undefined,
    error: null,
    path: null,
  });

  useEffect(() => {
    const target = refRef.current;
    if (!target) return;
    return onSnapshot(
      target,
      (snapshot) => setState({ data: parseRef.current(snapshot), error: null, path: target.path }),
      (error) => setState({ data: undefined, error, path: target.path }),
    );
  }, [path, refRef, parseRef]);

  // A value left over from the previous path is not this path's value.
  return state.path === path ? state : { data: undefined, error: null };
}

/** Listens to a query. [key] identifies it: change the key to resubscribe. */
export function useLiveQuery<T>(
  key: string | null,
  build: () => Query,
  parse: (snapshot: QueryDocumentSnapshot) => T,
): Live<T[]> {
  const buildRef = useLatest(build);
  const parseRef = useLatest(parse);
  const [state, setState] = useState<Live<T[]> & { key: string | null }>({
    data: undefined,
    error: null,
    key: null,
  });

  useEffect(() => {
    if (key == null) return;
    return onSnapshot(
      buildRef.current(),
      (snapshot) =>
        setState({ data: snapshot.docs.map((doc) => parseRef.current(doc)), error: null, key }),
      (error) => setState({ data: undefined, error, key }),
    );
  }, [key, buildRef, parseRef]);

  return state.key === key ? state : { data: undefined, error: null };
}

/** One page of a log, followed live, and the controls to move to the one before or after it. */
export interface LivePages<T> extends Live<T[]> {
  pager: Pager;
}

const NO_CURSORS: readonly QueryDocumentSnapshot[] = [];

/**
 * The page of [base] that starts after [after] (the top, when null): [size]
 * rows and one more, which is how a full page learns whether another follows
 * without reading it.
 */
export function pageQuery(base: Query, after: QueryDocumentSnapshot | null, size = PAGE_SIZE): Query {
  return after ? query(base, startAfter(after), limit(size + 1)) : query(base, limit(size + 1));
}

/** What [pageQuery] returned, split into the rows to show and whether a page follows them. */
export function pageOf<D>(docs: readonly D[], size = PAGE_SIZE): { shown: D[]; more: boolean } {
  const more = docs.length > size;
  return { shown: more ? docs.slice(0, size) : [...docs], more };
}

/**
 * Pages through a query that grows for ever — a log — [size] rows at a time,
 * newest first. [build] is the whole query *except* its limit and where it
 * starts: an ordering, and any filters. The first page is followed live; each
 * later one is read once.
 *
 * Only the page on screen is ever read. A limit that grows with every "show
 * more" reads everything again each time; this reads [size] + 1 rows (the
 * extra tells whether another page follows) and nothing before them.
 *
 * Changing [key] — the filter the query was built from — starts again at the top.
 */
export function useLivePages<T>(
  key: string,
  build: () => Query,
  parse: (snapshot: QueryDocumentSnapshot) => T,
  size = PAGE_SIZE,
): LivePages<T> {
  const buildRef = useLatest(build);
  const parseRef = useLatest(parse);

  // Each page after the first starts where the one before it ended: [cursors]
  // holds the last row of every page the reader has left behind.
  const [trail, setTrail] = useState<{ key: string; cursors: readonly QueryDocumentSnapshot[] }>({
    key,
    cursors: NO_CURSORS,
  });
  const cursors = trail.key === key ? trail.cursors : NO_CURSORS;
  const after = cursors.length > 0 ? cursors[cursors.length - 1] : null;
  const page = cursors.length + 1;
  const stamp = `${key}#${page}`;

  const [state, setState] = useState<{
    stamp: string;
    items?: T[];
    last?: QueryDocumentSnapshot;
    more?: boolean;
    error: FirestoreError | null;
  }>({ stamp: '', error: null });

  useEffect(() => {
    const target = pageQuery(buildRef.current(), after, size);
    const land = (snapshot: QuerySnapshot) => {
      const { shown, more } = pageOf(snapshot.docs, size);
      setState({
        stamp,
        items: shown.map((doc) => parseRef.current(doc)),
        last: shown[shown.length - 1],
        more,
        error: null,
      });
    };
    const fail = (error: FirestoreError) => setState({ stamp, error });

    // The first page follows the log, so a new entry appears at the top of it.
    if (!after) return onSnapshot(target, land, fail);

    // A later page is read once. Its entries are older than anything that can
    // still change, and a listener's first answer for a page this computer has
    // never fetched is whatever happens to be cached — a handful of rows and
    // no "next" — which would sit on screen until a slow line delivered the
    // rest. getDocs waits for the server, and answers from the cache only when
    // offline.
    let active = true;
    getDocs(target).then(
      (snapshot) => active && land(snapshot),
      (error: FirestoreError) => active && fail(error),
    );
    return () => {
      active = false;
    };
  }, [stamp, after, size, buildRef, parseRef]);

  // A page that has not landed yet is not the page that was on screen before it.
  const current = state.stamp === stamp ? state : null;
  const shown = current?.items?.length ?? 0;
  const first = (page - 1) * size;
  const last = current?.last;
  // A row still waiting on the server for its timestamp cannot be started after.
  const canAdvance = !!current?.more && !!last && !last.metadata.hasPendingWrites;

  const pager: Pager = {
    page,
    pages: null,
    first: shown === 0 ? 0 : first + 1,
    last: first + shown,
    total: null,
    hasPrevious: page > 1,
    hasNext: canAdvance,
    previous: () => setTrail({ key, cursors: cursors.slice(0, -1) }),
    next: () => {
      if (last && canAdvance) setTrail({ key, cursors: [...cursors, last] });
    },
  };

  return { data: current?.items, error: current?.error ?? null, pager };
}

/**
 * Listens to several documents at once — one per crew member, say — keyed by
 * path. A listener that fails leaves its entry missing rather than failing the
 * rest.
 */
export function useLiveDocs<T>(
  refs: readonly DocumentReference[],
  parse: (snapshot: DocumentSnapshot) => T,
): Record<string, T> {
  const key = refs.map((ref) => ref.path).join('|');
  const refsRef = useLatest(refs);
  const parseRef = useLatest(parse);
  const [state, setState] = useState<{ key: string; values: Record<string, T> }>({
    key: '',
    values: {},
  });

  useEffect(() => {
    const stops = refsRef.current.map((ref) =>
      onSnapshot(
        ref,
        (snapshot) =>
          setState((previous) => ({
            key,
            values: {
              ...(previous.key === key ? previous.values : {}),
              [ref.path]: parseRef.current(snapshot),
            },
          })),
        () => {},
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [key, refsRef, parseRef]);

  return state.key === key ? state.values : {};
}
