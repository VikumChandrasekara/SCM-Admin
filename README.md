# SCM Admin

The office side of the SCM operator app: a web admin panel for Singha
Constructions & Machinery (pvt) ltd. It runs on the same Firebase project as
the app (`scm-thrimaa`) and works on the same Firestore data. Nothing is
copied between them.

React 19 · TypeScript · Vite · Tailwind CSS 4 · Firebase JS SDK 12

## Pages

| Page | Admin | Supervisor |
| --- | --- | --- |
| පාලක පුවරුව | Every crew member's day side by side (පරික්ෂාව, service hours, පිරවීම in litres and rupees), plus one person's month: loads against the bonus ladder and the four money figures | Same |
| ගබඩාව | Add, edit and delete items. Restock, draw down and recount. Low and out-of-stock alerts. The log of every change | Same |
| බිල්පත් | Add, edit and delete any bill | Add bills, and edit or delete their own |
| විකුණුම් | Sales bills for cubes and tractor loads, each with a QR code, and the prices they are sold at | Sales bills; the prices are read-only |
| තහවුරු කිරීම | Verify a sale by scanning its QR with the computer's camera, or by typing its number | Same |
| මූල්‍ය | A month's income, expenses and profit, with every entry behind them | Not shown |
| වෙඩි බඩු | Each compressor crew's sheet for a day, the month's totals, and the explosives left in the store | Same |
| ඉතිහාසය | One crew member's days over a range | Same |
| පරිශීලකයින් | Create, edit and delete accounts, and change passwords | Not shown |

Operator and compressor crews cannot sign in here. They use the app.

Supervisors also get the store and bills in the app's supervisor console.
An admin who signs in to the app gets the supervisor console.

### The money figures

These are worked out for one crew member, for the month of the date the
dashboard is showing:

- **මුදල් ප්‍රමාණය** is worked days × daily wage, plus either the bonus ladder
  (excavator crew) or ආඩි × rate per foot (compressor crew). A worked day is
  one with an ON reading in පිරවීම 1.
- **ණය මුදල් ප්‍රමාණය** is the month's advance and food bills charged to that
  person.
- **ලැබිය යුතු මුදල් ප්‍රමාණය** is the first figure minus the second.
- **දවසේ මුදල් ප්‍රමාණය** is what the selected day earned: the daily wage if
  the machine was started that day, plus that day's ආඩි × rate for a
  compressor crew.

The daily wage and rate per foot are set on each person in පරිශීලකයින්.

An advance bill is also added to the person's ඇඩ්වාන්ස් ගණන, the figure their
app shows them. Editing or deleting the bill moves that figure back.

### How the store is drawn down

A store item can be **linked** to something the crews record, such as ඩීසල් on
a පිරවීම or කැප් on a වෙඩි බඩු sheet. A linked item has a fixed document ID
(`fill:diesel` is stored at `store/fill-diesel`), so the app can find it by ID
from its offline cache.

An item can also be linked to a service part, such as a diesel filter. When
staff mark that service done (**මාරු කළා** in a crew member's තොරතුරු), one of
the part is taken off the shelf in the same write.

When a crew member OKs a slot or a sheet, the app posts the usage straight
away. This panel also watches today and yesterday on every crew machine, and
posts anything the app could not, for example because it was offline with
nothing cached. Every posting is written to a fixed ID,
`storeMovements/use_{machine}_{day}_{slot}`, and `firestore.rules` refuses a
second write to that ID. So a fill is never drawn down twice.

Days older than yesterday are never posted from the panel, and neither is
usage recorded before the shelf was last counted. A recount (**ගණන් කළා**)
sets `countedAt`, and anything recorded before that time is treated as
already included in the count.

An item is low at or below its minimum, and out at zero or below. Both show
under the bell, as a banner on the dashboard, and on the supervisor console.
If the browser allows notifications, an item that runs low while the panel is
open also raises a desktop notification.

### Sales

A sale is a bill for material sold by the cube or by the tractor load.
Supervisors and the admin write them, in the panel or in the app. The admin
sets the price of a cube and of a tractor load under **විකුණුම්**, and every
sale is priced from there. `firestore.rules` checks that a sale's unit price
is the set one and its amount is quantity × price, so no bill can be written
at any other price.

Every bill has an 8-character code, such as `K7Q2-M9XA`, with no 0/O or 1/I
to misread, and a QR code carrying it. The code is the sale's document ID.
Anyone signed in can look a sale up by its code, but only staff can list
sales.

A sale counts as income only once someone has verified it. Any role can
verify, by scanning the QR or by typing the code. The panel's
**තහවුරු කිරීම** page uses the computer's camera; the app uses the phone's.
A sale not verified within 24 hours is cancelled: the rules refuse to verify
it after that, and the panel writes `status: 'cancelled'` the next time staff
open it, because Spark has no scheduled functions.

Nothing is ever deleted. Every sale stays on the list as verified, pending
or cancelled, with who wrote it, who verified it and when.

### The finance page

The admin's **මූල්‍ය** page shows a month's money.

- **Income** is verified sales, split into cubes and tractor loads. Pending
  and cancelled sales are listed, but not counted.
- **Expenses** count each rupee once:
  - Crew pay in full: worked days × daily wage, plus the bonus or ආඩි pay.
    Advances and food charged to a crew member are part of that pay, paid
    early, so they appear in the pay table rather than again as bills.
  - Every other bill: water, other, and food charged to nobody.
  - Store purchases: new items and restocks, at the price they were bought
    at. Store movements now record the unit price. Older ones are valued at
    the item's current price and marked ≈.
- **Machine use** is the fuel, oil, explosives and parts drawn from the
  store, by machine and by item. It is shown beside the total rather than
  added to it, because it was already counted when it was bought.
- **Profit** is income minus expenses. The ledger lists every entry behind
  the totals.

## Built for weak connections

The panel has no server of its own: the browser talks to Firebase directly,
and Firebase Hosting only hands out static files. What matters is how much
crosses a slow line, and how often.

- **Split into small downloads.** The login screen loads React and Firebase
  Auth only. Firestore, the larger half of Firebase, and each page are
  separate files, fetched after sign-in or when a link is pointed at. The
  dashboard's code downloads while the username is being typed. Once the
  panel is up, the remaining pages follow in the background (about 25 kB,
  once), unless the browser is set to save data.
- **No font download.** Sinhala text uses the font already on the device
  (Nirmala UI on Windows, Noto Sans Sinhala on Android, Sinhala Sangam MN on
  Apple).
- **The app is kept on the computer.** A service worker (`public/sw.js`)
  keeps every built file. They have hashed names, so they never need to be
  checked again. A new deploy is picked up on the next visit, but a weak
  signal gets the saved page after 3.5 seconds instead of a blank screen.
  If a page's code cannot be fetched, the page says so and offers a retry.
  It only reloads by itself when a new deploy has replaced the code
  (`src/main.tsx`, `src/components/PageBoundary.tsx`).
- **So is the data.** Firestore keeps what it has read in IndexedDB,
  shared between tabs (`src/db.ts`). The panel opens from that copy at once,
  and only what changed since the last visit is downloaded. That also keeps
  the Spark plan's daily read quota down. Signing out clears it.
- **Saves never hang, and never count twice.** A store change reaches the
  screen immediately. If the server has not confirmed it within 4 seconds,
  the panel says it is queued and moves on, and Firestore sends it when the
  connection allows, even after a reload (`src/data/commit.ts`). A queued
  write can be sent a second time after a reload. Every store change
  therefore also creates a movement-log entry, which the rules only allow
  to be created once, so a repeat is refused as a whole instead of counted
  twice.
- **Running totals go through transactions.** Bills move the advance
  figure, and ලෝඩ් / ආඩි move the month. These are written in transactions,
  which are never queued and check the server first, so a retry finds the
  work already done. They need a connection; offline, they fail and say so.
  With no connection at all, a නොබැඳි badge and banner show in the header.
- **Only what is shown is read.** The store's movement log loads 25 rows at
  a time.
- **Light on the computer.** No blur effects, and crew columns only
  re-render when their own data changes.

`firebase.json` sets the caching headers for Hosting. Files under `/assets/`
are cached for a year; `index.html` and `sw.js` are always revalidated.

## Accounts on the Spark plan

The project is on Firebase's free Spark plan, so there are no Cloud Functions
and no Admin SDK in the panel. Accounts work like this:

- **Creating an account.** The panel signs up the new login on a second
  sign-in session that is kept only in memory (`provisioningAuth()` in
  `src/firebase.ts`), so the admin stays signed in. It then writes the
  person's `operators/{uid}` record. If writing the record fails, the new
  login is deleted again.
- **The record is what grants access.** `firestore.rules` gives a login
  without an operator record access to nothing, and the app refuses to open
  for it. Deleting someone therefore removes their record, which ends their
  access immediately.
- **Deleting or re-passwording a login** is only possible by signing in as
  it. So it needs that person's current password. Without the password,
  "ඉවත් කරන්න" still removes all access, but the username cannot be used
  again.

Moving to the Blaze plan would allow a small callable Cloud Function to take
over account management with the Admin SDK and remove these limits.

## Running it locally

You need Node 20 or later, and Java 21 or later for the Firebase emulators.

```
npm install
npm run emulators         # terminal 1: Auth + Firestore emulators
npm run seed:emulators    # terminal 2: a demo yard, under the real rules
npm run dev:emulators     # http://localhost:5173
```

After seeding, sign in as `pivithuru` (admin) or `nimal` (supervisor). Every
seeded account's password is `test@123456`. Seeding wipes the emulators
first.

`npm run dev` connects to the live `scm-thrimaa` project instead.

## Security rules

`firestore.rules` lives in the SCM app project, at `../SCM/firestore.rules`,
and is deployed from there:

```
cd ../SCM
npx firebase-tools deploy --only firestore:rules
```

`npm run test:rules` runs `tests/rules.test.ts` against the Firestore
emulator. Run it after any change to the rules.

## The first admin

The panel only lets an existing admin create accounts, so the first admin is
created with a script that uses the Admin SDK:

```
npx firebase login
npm run create-admin -- --username pivithuru --password "..." --name "Pivithuru"
```

The script looks for credentials in this order:

1. A service-account key saved as `scripts/service-account.json`. This file is
   git-ignored; never commit it.
2. The `GOOGLE_APPLICATION_CREDENTIALS` environment variable.
3. The Firebase CLI's own login.

If the username already exists, the script resets its password and makes the
account an admin. Add `--emulators` to run it against the local emulators.

## Deploying

```
npx firebase login
npm run deploy    # builds, then deploys dist/ to Firebase Hosting
```

This publishes the panel at `https://scm-thrimaa.web.app`.

## Code map

| Path | What is there |
| --- | --- |
| `src/lib/model.ts` | The Firestore shapes, read the way the Flutter models read them. Keep the two in step |
| `src/lib/pay.ts`, `src/lib/target.ts` | The money figures and the bonus ladder |
| `src/lib/usage.ts`, `src/data/reconcile.ts` | Posting store usage |
| `src/data/` | Firestore hooks and every write the panel makes |
| `src/auth/` | Sign-in, and what each role may do |
| `src/pages/`, `src/components/` | The UI |
| `scripts/` | Creating the first admin, and seeding the emulators |
| `tests/rules.test.ts` | The security rules, tested against the emulator |

## CI/CD

GitHub Actions, in `.github/workflows/`:

- `ci.yml` runs on every PR and push to `main`: typecheck, production build,
  and (optional) the Firestore rules tests.
- `deploy.yml` deploys to Firebase Hosting (`scm-thrimaa`): pushes to `main` go
  live, pull requests get a 7-day preview channel.

Repository secrets to add (Settings > Secrets and variables > Actions):

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`: the same values
  as in `.env`.
- `FIREBASE_SERVICE_ACCOUNT`: the JSON key of a service account with the
  Firebase Hosting Admin role (`firebase init hosting:github` creates one).

To run the rules tests in CI, set the repository variable `SCM_REPO`
(e.g. `owner/SCM`) to the repo holding `firestore.rules`; if it is private,
also add a read-only `SCM_REPO_TOKEN` secret.
