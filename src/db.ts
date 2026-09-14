import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore';

import { app, usingEmulators } from './firebase';

// Firestore lives apart from firebase.ts: it is the larger half of Firebase,
// and the login screen, which only needs Auth, does not wait for it.

// Everything read is kept on this computer, shared between open tabs. The
// panel opens from that copy at once and only what changed since last time
// crosses the network — which is what makes it usable on a weak connection,
// and keeps reads (the Spark plan's daily quota) down.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (usingEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * Forgets everything cached on this computer, for signing out of a shared
 * office machine. Firestore cannot be used again afterwards — reload.
 */
export async function forgetLocalData(): Promise<void> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // Another open tab still holds the cache; it goes when that tab does.
  }
}
