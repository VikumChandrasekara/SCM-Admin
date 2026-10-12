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
| විකුණුම් | Sales bills for tipper and tractor loads, each with a QR code, and the prices they are sold at | Same |
| තහවුරු කිරීම | Verify a sale by scanning its QR with the computer's camera, or by typing its number | Same |
| මූල්‍ය | A month's income, expenses and profit, with every entry behind them | Not shown |
| වෙඩි බඩු | Each compressor crew's sheet for a day, the month's totals, and the explosives left in the store | Same |
| ඉතිහාසය | One crew member's days over a range | Same |
| යන්ත්‍ර | Every machine with what it is (kind, name, make and model, plate), who is on it, its hour meter, the hours it has worked this month and its service state. Set a machine up, put its details right, retire it, move a crew member onto it, and see its hours by month and by day | Same — and the same list is in the app's supervisor console |
| පරිශීලකයින් | Create, edit and delete accounts, and change passwords. A new crew account picks its machine from the list, or sets up a new one — with its details — in the same form | Not shown |

Operator and compressor crews cannot sign in here. They use the app.

Supervisors also get the store and bills in the app's supervisor console.
An admin who signs in to the app gets the supervisor console.

### Machines

A machine is `machines/{id}`: its meter and service (as before) plus, optionally,
`type` (`excavator` or `compressor`), `name`, `model`, `registrationNo`, `notes`
and `active`. A machine set up before these existed has none and is read as the
kind of the crew on it.

- A crew member can only be put on a machine of their kind: an operator on an
  excavator, a compressor driller on a compressor. A retired machine takes no
  one new. Both the panel and the app check this, and `firestore.rules` holds
  the line for the app (a machine with no kind yet suits either, as far as the
  rules can tell).
- A machine's kind is fixed once it has one; its number never changes; it is
  never deleted — retire it instead, and its history stays.
- Hours belong to the machine. They are the month's `hours` (a day counts once
  the next morning's ON has closed it) and the running meter. Moving a crew
  member to another machine leaves the hours they worked with the machine they
  worked them on.
- The supervisor can do all of this from the app (යන්ත්‍ර in the console, and
  the යන්ත්‍රය row on a crew member's screen). Creating the login itself is
  still the admin's, here.
- Setting a machine up, changing its details and moving a crew member are each
  a line in the විගණන සටහන, from whichever app made the change.

### The money figures

These are worked out for one crew member, for the month of the date the
dashboard is showing:

- **මුදල් ප්‍රමාණය** is worked days × daily wage, plus either the bonus ladder
  (excavator crew) or අඩි × rate per foot (compressor crew). A worked day is
  one with an ON reading in පිරවීම 1.
- **ණය මුදල් ප්‍රමාණය** is the month's advance and food bills charged to that
  person.
- **ලැබිය යුතු මුදල් ප්‍රමාණය** is the first figure minus the second.
- **දවසේ මුදල් ප්‍රමාණය** is what the selected day earned: the daily wage if
  the machine was started that day, plus that day's අඩි × rate for a
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

A sale is a bill for a tipper load, sold by the cube, or for tractor loads.
Supervisors and the admin write them, in the panel or in the app. They also
set the prices, under **විකුණුම්** here or on the app's විකුණුම් බිල්පත්
screen: what a full tipper load (3 cubes) sells for and what a tractor load
sells for. A cube is a third of the tipper load's price. Until anyone sets
them, the prices are Rs. 19,500 a tipper load (Rs. 6,500 a cube) and
Rs. 6,500 a tractor load. `firestore.rules` checks that a sale's unit price
is the set one (or the default) and its amount is quantity × price, so no
bill can be written at any other price. Bills already written keep the price
they were written at.

Every bill has an 8-character code, such as `K7Q2-M9XA`, with no 0/O or 1/I
to misread, and a QR code carrying it. The code is the sale's document ID.
Anyone signed in can look a sale up by its code, but only staff can list
every sale. Excavator operators write sales bills too, and list only the ones
they wrote.

A sale counts as income only once someone has verified it. Any role can
verify, by scanning the QR or by typing the code. The panel's
**තහවුරු කිරීම** page uses the computer's camera; the app uses the phone's.
A sale not verified within 24 hours is cancelled: the rules refuse to verify
it after that, and the panel writes `status: 'cancelled'` the next time staff
open it, because Spark has no scheduled functions.

Nothing is ever deleted. Every sale stays on the list as verified, pending
or cancelled, with who wrote it, who verified it and when.

### The finance page

The admin's **මූල්‍ය** page shows a month's money: income, expenses, and what
each material cost.

- **Income** is verified sales, by material — 6/9, බෝල්දාස්, C1, සක්කර and
  කෝරි ඩස්ට් — and by tipper or tractor. Pending and cancelled sales are
  listed, but not counted.
- **Expenses** count each rupee once, each on a line of its own (tap a line
  to see the entries behind it):

  | Expense | Where it comes from |
  |---|---|
  | ඩීසල් | the store, as it is drawn for a පිරවීම |
  | ඔයිල් සහ කූලන්ට් | the store, the other fluids a පිරවීම draws |
  | කරල් | the store, වෙඩි කරල් drawn for a blast |
  | වෙඩි බඩු — අනෙක් | the store, the rest of a blast's items |
  | කොටස් සහ සර්විස් | the store, service parts and filters |
  | පඩි | crew pay in full, less the food charged to it |
  | කෑම | food bills, charged to the crew's pay or not |
  | යන්ත්‍රයට පැයකට | the excavator's hours × the hourly figure |
  | බදු හිමියා | the landowner's per-load figure on 6/9, සක්කර, කෝරි ඩස්ට් |
  | රාජ භාගය | worked out from the gel and ammonia the drillers signed off (below) |
  | අලුත්වැඩියා, වතුර / විදුලි බිල, ණය වාරික, වෙනත් | bills of that category |
  | වෙනත් ගබඩා භාවිතය | store items with no machine or link |

  Crew pay counts in full: advances and food charged to a crew member are
  part of it, paid early, so they appear in the pay table rather than again
  as bills. Stock counts when it is **used**, at what it cost then — what was
  bought is reported beside, not in the total. Store movements record the
  unit price; older ones are valued at the item's current price and marked ≈.
- **රාජ භාගය (royalty)** is worked out, not typed in:

  ```
  ( ජෙල් kg + ඇමෝනියා kg ) × 3.5 × රු. 700 × 18%
  ```

  from every වෙඩි බඩු sheet the drillers have OK'd that month — one delivery of
  15 kg gel and 75 kg ammonia comes to (15 + 75) × 3.5 × 700 × 18% = රු. 39,690.
  The 3.5 (cubes a kilo brings down), the 700 (what a cube is worth) and the 18
  are the admin's to change from the **අනුපාත වෙනස් කරන්න** button on the page
  (`settings/royalty`). The page shows the working step by step, and the
  ledger a line for each day. Royalty **bills** are what was paid: they are
  listed and totalled beside the figure, but not counted a second time.

  The crews record gel as a count of කරල්, so it is turned into kilos at the
  store item's **kg 1කට කරල් ගණන** (`piecesPerKg` on the item — 8 until set:
  15 kg = 120 කරල්).
- **Gel by the kilo.** The gel store item (වෙඩි කරල්) is counted in කරල්,
  because that is how the crews use it and how the store is drawn down, but it
  is delivered by weight. Restocking it — in the panel or in the app — offers
  **kg වලින්**: enter the 15 kg that arrived and 120 කරල් are added, with
  `15 kg × 8 = 120` kept in the movement's note. The item must be counted in
  කරල් (unit `ගණන`), not kg; the item form warns if it is still in kg.
- **What each material cost** is worked out by load (a tipper bill is one
  trip, a tractor bill its loads). The **diesel** is shared by every load
  that left. **Everything else** is shared by the loads of the main
  materials — 6/9, බෝල්දාස්, C1 — alone, so සක්කර and කෝරි ඩස්ට් carry
  diesel only. Each material shows its profit, and the cost and profit of one
  load; the cost of a load is the least it must sell for. Costs that no
  load could carry (no main material left that month) are shown as not shared.
  C1, like බෝල්දාස්, earns the landowner nothing.
- **Profit** is income minus expenses, and the materials' profits add up to
  it. The ledger lists every entry behind the totals, with its category.

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
  figure, and ලෝඩ් / අඩි move the month. These are written in transactions,
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

### CI/CD

`.github/workflows/ci-cd.yml` runs on GitHub Actions:

- **Every pull request and push to `main`:** typecheck and build. If the SCM
  repo is configured (below), the Firestore rules tests run too.
- **Push to `main`:** after those pass, the built `dist/` is deployed to
  Firebase Hosting (`production` environment).

Set these under the repo's Settings > Secrets and variables > Actions:

| Name | Kind | What |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | secret | Full JSON key of a service account that can deploy Hosting (role *Firebase Hosting Admin*) |
| `VITE_FIREBASE_*` (6 values, see `.env.example`) | secrets | The web app config the panel is built with |
| `SCM_REPO` | variable | `owner/name` of the SCM app repo, where `firestore.rules` lives. Leave unset to skip the rules tests |
| `SCM_REPO_TOKEN` | secret | Read-only token for that repo, if it is private |

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
