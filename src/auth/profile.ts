import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';

import { db } from '../db';
import { personFrom, type Person } from '../lib/model';

// Loaded by AuthContext only once someone has signed in, so the login screen
// never waits on Firestore.

export { forgetLocalData } from '../db';

/** Follows a person's operator record; `null` once there is none. */
export function watchProfile(
  uid: string,
  next: (person: Person | null) => void,
  fail: (error: FirestoreError) => void,
): () => void {
  return onSnapshot(
    doc(db, 'operators', uid),
    (snapshot) => next(snapshot.exists() ? personFrom(snapshot.id, snapshot.data()) : null),
    fail,
  );
}
