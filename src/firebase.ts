import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

/**
 * The web app registered for the scm-thrimaa project — the same one the
 * Flutter web build uses. None of this is secret: access is decided by
 * firestore.rules in the SCM project, not by who holds these values.
 * Still sourced from env vars (see .env.example) so the project's real
 * identifiers aren't hardcoded in source.
 */
const liveConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** `npm run dev:emulators` points everything at the local emulators instead. */
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

// A `demo-` project id guarantees the emulators never reach a real project.
const config: FirebaseOptions = usingEmulators
  ? { ...liveConfig, apiKey: 'demo-key', projectId: 'demo-scm' }
  : liveConfig;

export const app = initializeApp(config);

// initializeAuth rather than getAuth: getAuth also bundles the popup and
// redirect sign-in flows, which a username-and-password panel never uses.
// Firestore is set up separately, in db.ts.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

/** The login screen asks for a username; Firebase Auth wants an email. */
export const USERNAME_DOMAIN = 'scm-operators.local';

export function emailFor(username: string): string {
  const trimmed = username.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${USERNAME_DOMAIN}`;
}

export function usernameOf(email: string | null | undefined): string {
  if (!email) return '';
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
}

let provisioning: Auth | undefined;

/**
 * A second, throwaway sign-in session for managing other people's logins.
 *
 * Creating a user with the client SDK signs in as that user. Doing it on the
 * main session would sign the admin out, so it happens here instead, in an
 * app instance whose session lives only in memory. On the Spark plan there
 * is no Admin SDK to do this server-side.
 */
export function provisioningAuth(): Auth {
  if (!provisioning) {
    const secondary: FirebaseApp = initializeApp(config, 'provisioning');
    provisioning = initializeAuth(secondary, { persistence: inMemoryPersistence });
    if (usingEmulators) {
      connectAuthEmulator(provisioning, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
  }
  return provisioning;
}
