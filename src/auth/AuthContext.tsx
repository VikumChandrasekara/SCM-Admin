import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { auth, emailFor } from '../firebase';
import { errorMessage } from '../lib/errors';
import { isStaffRole, type Person } from '../lib/model';

// Firestore, and with it the operator record, is fetched once there is a
// session to read it for — never for the login screen.
const loadProfile = () => import('./profile');

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: User | null;
  /** The signed-in person's operator record. Only staff get this far. */
  profile: Person | null;
  /** Why the last session ended, when it was not the person's own choice. */
  notice: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Person | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next);
        if (!next) {
          setProfile(null);
          setStatus('signedOut');
        } else {
          setStatus('loading');
        }
      }),
    [],
  );

  // The operator record decides everything: whether the account still
  // exists, and whether it is one allowed into the panel at all. It is
  // followed live, so removing someone's access signs them out here too.
  useEffect(() => {
    if (!user) return;
    const refuse = (message: string) => {
      setNotice(message);
      setProfile(null);
      void firebaseSignOut(auth);
    };

    let active = true;
    let stop: (() => void) | undefined;
    loadProfile()
      .then(({ watchProfile }) => {
        if (!active) return;
        stop = watchProfile(
          user.uid,
          (person) => {
            if (!person) {
              refuse('මෙම ගිණුම සොයාගත නොහැක. පරිපාලක අමතන්න.');
            } else if (!isStaffRole(person.role)) {
              refuse('මෙම පුවරුව පරිපාලක සහ සුපවයිසර් සඳහා පමණි. කණ්ඩායම් සාමාජිකයින් SCM යෙදුම භාවිත කරන්න.');
            } else {
              setProfile(person);
              setStatus('signedIn');
            }
          },
          (error) => refuse(errorMessage(error)),
        );
      })
      .catch((error: unknown) => {
        if (active) refuse(errorMessage(error));
      });

    return () => {
      active = false;
      stop?.();
    };
  }, [user]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      profile,
      notice,
      signIn: async (username, password) => {
        setNotice(null);
        // Usually here already, fetched while the login screen was open.
        // If not, it downloads alongside the sign-in instead of after it.
        loadProfile().catch(() => {});
        try {
          await signInWithEmailAndPassword(auth, emailFor(username), password);
        } catch (error) {
          throw new Error(errorMessage(error));
        }
      },
      signOut: async () => {
        setNotice(null);
        await firebaseSignOut(auth);
        // A shared office computer should not keep the yard's figures once
        // the person has signed out. Clearing the cache ends Firestore for
        // this page, so it starts over at the login.
        const { forgetLocalData } = await loadProfile();
        await forgetLocalData();
        window.location.replace('/login');
      },
    }),
    [status, user, profile, notice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>');
  return value;
}

/** For pages behind the sign-in: the session is known to be there. */
export function useSession(): { user: User; profile: Person } {
  const { user, profile } = useAuth();
  if (!user || !profile) throw new Error('useSession() used outside a signed-in page');
  return { user, profile };
}
