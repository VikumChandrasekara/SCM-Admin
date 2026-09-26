#!/usr/bin/env node
// Creates an admin account for the SCM admin panel — or, if the username is
// already taken, resets that login's password and makes it an admin.
//
//   npm run create-admin -- --username pivithuru --password "test@123456" --name "Pivithuru"
//   npm run create-admin -- --emulators --username pivithuru --password "test@123456"
//
// The first admin has to be made from outside the panel: the panel only lets
// an existing admin create accounts. This uses the Admin SDK, which bypasses
// firestore.rules, so it needs credentials for the project. In order:
//
//   1. scripts/service-account.json — a key from Firebase console → Project
//      settings → Service accounts (git-ignored; never commit it).
//   2. GOOGLE_APPLICATION_CREDENTIALS, if it is set.
//   3. The Firebase CLI's own login — run `npx firebase login` first.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    project: { type: 'string', default: 'scm-thrimaa' },
    emulators: { type: 'boolean', default: false },
  },
});

const username = values.username?.trim().toLowerCase() ?? '';
if (!/^[a-z0-9._-]{3,32}$/.test(username) || !values.password) {
  console.error('Usage: npm run create-admin -- --username <name> --password <password> [--name "Full name"] [--emulators]');
  console.error('Usernames are 3–32 characters: a–z, 0–9, dot, underscore or hyphen.');
  process.exit(1);
}
if (values.password.length < 6) {
  console.error('Firebase needs a password of at least 6 characters.');
  process.exit(1);
}

const projectId = values.emulators ? 'demo-scm' : values.project;
const email = `${username}@scm-operators.local`;
const displayName = values.name?.trim() || username;

// ---- credentials -----------------------------------------------------------

let cleanUp = () => {};

if (values.emulators) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
} else {
  const serviceAccount = fileURLToPath(new URL('./service-account.json', import.meta.url));
  if (existsSync(serviceAccount)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount;
  } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // The CLI's login, handed to the Admin SDK as application default
    // credentials — the same thing the CLI does for the Functions emulator.
    const configstore = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    const refreshToken = existsSync(configstore)
      ? JSON.parse(readFileSync(configstore, 'utf8')).tokens?.refresh_token
      : undefined;
    if (!refreshToken) {
      console.error('No credentials found. Run `npx firebase login` first,');
      console.error('or save a service-account key as scripts/service-account.json.');
      process.exit(1);
    }
    const folder = mkdtempSync(join(tmpdir(), 'scm-admin-'));
    const file = join(folder, 'credentials.json');
    writeFileSync(
      file,
      JSON.stringify({
        type: 'authorized_user',
        // The Firebase CLI's public OAuth client, which issued the token.
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        refresh_token: refreshToken,
        quota_project_id: projectId,
      }),
      { mode: 0o600 },
    );
    process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
    cleanUp = () => rmSync(folder, { recursive: true, force: true });
  }
}

// ---- the account -----------------------------------------------------------

const { applicationDefault, initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { FieldValue, getFirestore } = await import('firebase-admin/firestore');

try {
  initializeApp(values.emulators ? { projectId } : { credential: applicationDefault(), projectId });
  const auth = getAuth();
  const db = getFirestore();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password: values.password, displayName, disabled: false });
    console.log(`Login "${username}" already existed — its password has been reset.`);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({ email, password: values.password, displayName });
    console.log(`Created login "${username}".`);
  }

  const record = db.doc(`operators/${user.uid}`);
  const existing = await record.get();
  await record.set(
    {
      name: displayName,
      username,
      role: 'admin',
      machineId: '',
      ...(existing.exists
        ? {}
        : { leaveDays: 0, advanceAmount: 0, bonusTotal: 0, ratePerFoot: 0, ratePerLoad: 0, payBasis: 'foot', dailyWage: 0, createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  console.log(`"${username}" is an admin of ${projectId}. Sign in to the panel with that username and password.`);
} catch (error) {
  console.error(`Failed: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  cleanUp();
}
