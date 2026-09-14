import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

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
