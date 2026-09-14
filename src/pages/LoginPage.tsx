import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../auth/AuthContext';
import { LogoPlaque } from '../components/Logo';
import { Button, ErrorNote, Field, IconButton, Input, Panel } from '../components/ui';
import { usingEmulators } from '../firebase';
import { prefetchPage } from './lazy';

export function LoginPage() {
  const { signIn, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A sign-in the panel then turns away (a crew account, a removed one)
  // arrives as a notice rather than a thrown error.
  useEffect(() => {
    if (notice) setBusy(false);
  }, [notice]);

  // The signed-in panel's code — Firestore with it — downloads while the
  // username is being typed, so it is ready the moment the sign-in goes through.
  useEffect(() => prefetchPage('/'), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('පරිශීලක නාමය සහ මුරපදය ඇතුළත් කරන්න.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Success needs nothing more here: the session change moves the page on.
      await signIn(username, password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  }

  const message = error ?? notice;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <p className="text-center text-[13px] font-bold tracking-[0.32em] text-white/70">WELCOME TO</p>
        <LogoPlaque className="mx-auto mt-4 w-fit" />
        <p className="mt-4 text-center text-sm font-semibold text-white/75">පාලක පුවරුව · Admin panel</p>

        <Panel className="mt-6 p-7">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <h1 className="text-[22px] font-bold">Log in</h1>
              <p className="mt-1 text-xs text-white/70">ඔබගේ පරිශීලක නාමය සහ මුරපදය ඇතුළත් කරන්න</p>
            </div>
            <Field label="Username">
              <Input
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="pivithuru"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <Input
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-12"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <IconButton
                  label={visible ? 'Hide password' : 'Show password'}
                  onClick={() => setVisible((value) => !value)}
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                >
                  {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </IconButton>
              </div>
            </Field>
            {message && <ErrorNote>{message}</ErrorNote>}
            <Button type="submit" size="lg" busy={busy} className="w-full">
              Log in
            </Button>
          </form>
        </Panel>

        {usingEmulators && (
          <p className="mt-4 text-center text-xs text-signal">දේශීය emulators වෙත සම්බන්ධයි — සැබෑ දත්ත නොවේ.</p>
        )}
      </div>
    </div>
  );
}
