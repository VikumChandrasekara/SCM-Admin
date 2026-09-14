#!/usr/bin/env node
// Fills the local Firebase emulators with a small, realistic yard, so the
// panel can be tried end to end without touching the live scm-thrimaa data.
//
//   terminal 1:  npm run emulators
//   terminal 2:  npm run seed:emulators && npm run dev:emulators
//
// Every account's password is test@123456. Wipes the emulators first.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const { initializeApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');

const projectId = 'demo-scm';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();

// ---- a clean slate, under the real rules -----------------------------------

await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
  method: 'DELETE',
});
await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });

// The emulators start with open rules; load the production ones so the panel
// meets exactly the refusals it will meet on scm-thrimaa.
const rulesPath = process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));
const loaded = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}:securityRules`, {
  method: 'PUT',
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: readFileSync(rulesPath, 'utf8') }] } }),
});
if (!loaded.ok) throw new Error(`Could not load firestore.rules: ${loaded.status} ${await loaded.text()}`);

// ---- dates -----------------------------------------------------------------

const pad = (value) => String(value).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const today = new Date();
today.setHours(0, 0, 0, 0);
const daysAgo = (count) => {
  const date = new Date(today);
  date.setDate(date.getDate() - count);
  return date;
};
const at = (date, hour, minute = 0) => {
  const moment = new Date(date);
  moment.setHours(hour, minute, 0, 0);
  return moment.toISOString();
};

// A fixed sequence rather than Math.random, so every seed looks the same.
let seed = 7;
const next = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const between = (low, high) => Math.round(low + next() * (high - low));

// ---- people ----------------------------------------------------------------

const password = 'test@123456';
const people = [
  { username: 'pivithuru', name: 'Pivithuru', role: 'admin' },
  { username: 'nimal', name: 'නිමල්', role: 'supervisor' },
  { username: 'kamal', name: 'කමල්', role: 'operator', machineId: 'excavator-01', dailyWage: 3500 },
  { username: 'sunil', name: 'සුනිල්', role: 'operator', machineId: 'excavator-02', dailyWage: 3500 },
  { username: 'ruwan', name: 'රුවන්', role: 'compressor', machineId: 'compressor-01', dailyWage: 3000, ratePerFoot: 250 },
];

const uids = {};
for (const person of people) {
  const user = await auth.createUser({
    email: `${person.username}@scm-operators.local`,
    password,
    displayName: person.name,
  });
  uids[person.username] = user.uid;
}

const advances = { kamal: 5000, ruwan: 3000 };
for (const person of people) {
  await db.doc(`operators/${uids[person.username]}`).set({
    name: person.name,
    username: person.username,
    role: person.role,
    machineId: person.machineId ?? '',
    leaveDays: person.username === 'sunil' ? 1 : 0,
    advanceAmount: advances[person.username] ?? 0,
    bonusTotal: 0,
    ratePerFoot: person.ratePerFoot ?? 0,
    dailyWage: person.dailyWage ?? 0,
    createdAt: Timestamp.fromDate(daysAgo(40)),
  });
}

// ---- the month so far, machine by machine -----------------------------------

const crews = people.filter((person) => person.machineId);
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const monthKey = keyOf(monthStart).slice(0, 7);
const machineHours = {};
// Fills from before yesterday, posted to the store below. Today's and
// yesterday's are left for the panel, which posts them itself when opened.
const usagePostings = [];
const yesterdayKey = keyOf(daysAgo(1));

for (const person of crews) {
  const excavator = person.role === 'operator';
  let meter = excavator ? 1180 : 640;
  if (person.username === 'sunil') meter = 2410;
  const month = { month: monthKey, loads: 0, feet: 0, hours: 0 };

  const dates = [];
  for (let date = new Date(monthStart); date <= today; date.setDate(date.getDate() + 1)) dates.push(new Date(date));

  let previous = null;
  for (const date of dates) {
    const key = keyOf(date);
    const isToday = key === keyOf(today);
    // Sunil has not started today yet — the dashboard shows an empty column.
    if (isToday && person.username === 'sunil') continue;
    // One day off in the month for each crew.
    if (date.getDate() === 7) continue;

    const worked = between(7, 10);
    const fillings = {
      1: {
        onHours: meter,
        offHours: null,
        amounts: excavator
          ? { diesel: between(35, 60), ...(next() > 0.7 ? { hydraulic: between(4, 10) } : {}) }
          : { diesel: between(25, 40), ...(next() > 0.6 ? { compressorOil: between(2, 5) } : {}) },
        lockedAt: at(date, 7, between(0, 40)),
      },
    };
    if (!isToday || person.username === 'kamal') {
      fillings[2] = {
        onHours: null,
        offHours: null,
        amounts: { diesel: between(20, 35), ...(next() > 0.8 ? { engineOil: between(2, 4) } : {}), ...(next() > 0.85 ? { coolant: between(3, 6) } : {}) },
        lockedAt: at(date, 13, between(0, 50)),
      };
    }

    const inspection = excavator
      ? { diesel: true, hydraulic: true, engineOil: true, coolant: next() > 0.15, surroundings: true }
      : { diesel: true, compressorOil: true, engineOil: true, coolant: true, surroundings: next() > 0.2 };

    if (key < yesterdayKey) {
      for (const [slot, filling] of Object.entries(fillings)) {
        usagePostings.push({ machineId: person.machineId, person, date: key, source: `fill${slot}`, amounts: filling.amounts, at: filling.lockedAt });
      }
    }

    const day = { date: key, fillings, inspection };
    if (excavator) {
      day.loads = isToday ? between(3, 6) : between(8, 14);
      month.loads += day.loads;
    } else {
      day.feet = isToday ? between(5, 9) : between(15, 28);
      month.feet += day.feet;
      day.blasting = {
        amounts: { caps: between(8, 16), fuse: between(20, 45), ammonia: between(10, 25), shells: between(4, 10) },
        lockedAt: at(date, 11, between(0, 50)),
      };
    }

    // This morning's ON closes yesterday out.
    if (previous) {
      previous.day.closingHours = meter;
      month.hours += meter - previous.onHours;
    }
    await db.doc(`machines/${person.machineId}/days/${key}`).set(day);
    if (previous) await db.doc(`machines/${person.machineId}/days/${previous.day.date}`).set(previous.day);

    previous = { day, onHours: meter };
    meter += worked;
  }
  if (previous) await db.doc(`machines/${person.machineId}/days/${previous.day.date}`).set(previous.day);

  machineHours[person.machineId] = previous?.onHours ?? meter;
  await db.doc(`machines/${person.machineId}/months/${monthKey}`).set(month);
}

// Kamal's engine oil is nearly due, Sunil's is overdue — the alerts have
// something to say.
const serviceFrom = (hours, offsets) =>
  Object.fromEntries(Object.entries(offsets).map(([task, offset]) => [task, hours + offset]));
await db.doc('machines/excavator-01').set({
  totalHours: machineHours['excavator-01'],
  serviceDueAt: serviceFrom(machineHours['excavator-01'], { engineOil: 32, dieselFilter: 140, hydraulicFilter: 910 }),
});
await db.doc('machines/excavator-02').set({
  totalHours: machineHours['excavator-02'],
  serviceDueAt: serviceFrom(machineHours['excavator-02'], { engineOil: -6, dieselFilter: 88, hydraulicFilter: 1500 }),
});
await db.doc('machines/compressor-01').set({
  totalHours: machineHours['compressor-01'],
  serviceDueAt: serviceFrom(machineHours['compressor-01'], { engineOil: 120, dieselFilter: 200 }),
});

// ---- the store ---------------------------------------------------------------

const counted = Timestamp.fromDate(daysAgo(20));
const items = [
  ['fill-diesel', 'ඩීසල්', 'L', 1650, 400, 355, 'fill:diesel'],
  ['fill-hydraulic', 'හයිඩ්‍රොලික් ඔයිල්', 'L', 60, 40, 1450, 'fill:hydraulic'],
  ['fill-engineOil', 'එන්ජින් ඔයිල්', 'L', 22, 20, 1850, 'fill:engineOil'],
  ['fill-coolant', 'කුලන්ට්', 'L', 25, 10, 950, 'fill:coolant'],
  ['fill-compressorOil', 'කම්පසර් ඔයිල්', 'L', 6, 10, 2100, 'fill:compressorOil'],
  ['blast-caps', 'කැප්', 'ගණන', 180, 50, 85, 'blast:caps'],
  ['blast-fuse', 'ෆියුස්', 'm', 420, 100, 45, 'blast:fuse'],
  ['blast-ammonia', 'ඇමෝනියා', 'kg', 60, 50, 320, 'blast:ammonia'],
  ['blast-shells', 'වෙඩි කරල්', 'ගණන', 90, 30, 450, 'blast:shells'],
  ['service-dieselFilter', 'ඩීසල් ෆිල්ටර්', 'ගණන', 3, 2, 4200, 'service:dieselFilter'],
  ['service-engineOil', 'එන්ජින් ඔයිල් ෆිල්ටර්', 'ගණන', 1, 2, 3800, 'service:engineOil'],
  ['service-hydraulicFilter', 'හයිඩ්‍රොලික් ෆිල්ටර්', 'ගණන', 2, 1, 12500, 'service:hydraulicFilter'],
  ['grease', 'ග්‍රීස්', 'kg', 8, 5, 1200, null],
];
for (const [id, name, unit, quantity, minQuantity, unitPrice, link] of items) {
  await db.doc(`store/${id}`).set({
    name,
    unit,
    quantity,
    minQuantity,
    unitPrice,
    link,
    note: '',
    createdAt: counted,
    countedAt: counted,
    updatedAt: counted,
    updatedBy: uids.pivithuru,
  });
  await db.collection('storeMovements').add({
    type: 'create',
    items: [{ itemId: id, name, unit, delta: quantity, unitPrice }],
    unmatched: [],
    note: 'ආරම්භක ගණන',
    createdBy: uids.pivithuru,
    createdByName: 'Pivithuru',
    createdAt: counted,
  });
}

// A delivery this month, so the finance page has purchases to show.
const deliveryDay = new Date(monthStart);
deliveryDay.setDate(Math.min(5, today.getDate()));
deliveryDay.setHours(10);
for (const [id, name, unit, delta, unitPrice] of [
  ['fill-diesel', 'ඩීසල්', 'L', 1000, 355],
  ['blast-ammonia', 'ඇමෝනියා', 'kg', 50, 320],
]) {
  await db.collection('storeMovements').add({
    type: 'restock',
    items: [{ itemId: id, name, unit, delta, unitPrice }],
    unmatched: [],
    note: 'සැපයුම්කරුගෙන්',
    createdBy: uids.nimal,
    createdByName: 'නිමල්',
    createdAt: Timestamp.fromDate(deliveryDay),
  });
}

// What the crews used, the way the app posts it — at the fixed id the rules
// hold every posting to.
const byLink = Object.fromEntries(items.filter((row) => row[6]).map((row) => [row[6], row]));
for (const posting of usagePostings) {
  const lines = [];
  for (const [fluid, amount] of Object.entries(posting.amounts)) {
    const row = byLink[`fill:${fluid}`];
    if (row) lines.push({ itemId: row[0], name: row[1], unit: row[2], delta: -amount, unitPrice: row[5] });
  }
  await db.doc(`storeMovements/use_${posting.machineId}_${posting.date}_${posting.source}`).set({
    type: 'usage',
    items: lines,
    unmatched: [],
    machineId: posting.machineId,
    date: posting.date,
    source: posting.source,
    operatorId: uids[posting.person.username],
    operatorName: posting.person.name,
    note: '',
    createdBy: uids[posting.person.username],
    createdByName: posting.person.name,
    createdAt: Timestamp.fromDate(new Date(posting.at)),
  });
}

// ---- bills -------------------------------------------------------------------

const bills = [
  [2, 'advance', 5000, 'kamal', 'මාසික ඇඩ්වාන්ස්'],
  [3, 'advance', 3000, 'ruwan', ''],
  [4, 'food', 1200, 'kamal', 'දිවා ආහාරය'],
  [5, 'food', 800, 'sunil', ''],
  [6, 'water', 2500, null, 'වතුර බවුසරය'],
  [8, 'other', 6500, null, 'ටයර් අලුත්වැඩියාව'],
];
for (const [day, category, amount, who, note] of bills) {
  const date = new Date(monthStart);
  date.setDate(Math.min(day, today.getDate()));
  const person = people.find((candidate) => candidate.username === who);
  await db.collection('bills').add({
    category,
    amount,
    date: keyOf(date),
    note,
    operatorId: person ? uids[person.username] : null,
    operatorName: person?.name ?? null,
    createdBy: uids.nimal,
    createdByName: 'නිමල්',
    createdAt: Timestamp.fromDate(date),
    updatedAt: Timestamp.fromDate(date),
  });
}

// ---- sales -------------------------------------------------------------------

const cubePrice = 8500;
const tractorPrice = 4500;
await db.doc('settings/sales').set({
  cubePrice,
  tractorPrice,
  updatedAt: Timestamp.fromDate(daysAgo(30)),
  updatedBy: uids.pivithuru,
});

const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 8 }, () => codeAlphabet[Math.floor(next() * 32)]).join('');
const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000);
const customers = [
  ['සිල්වා', '0771234567', 'WP LK-4521'],
  ['පෙරේරා', '0712345678', 'CP LB-7788'],
  ['ජයසිංහ', '', 'WP LJ-1290'],
  ['ප්‍රනාන්දු', '0765554433', ''],
];
const verifiers = ['kamal', 'sunil', 'ruwan', 'nimal'];

let saleCount = 0;
// Each month's bills are numbered from 1, the way the apps number them.
const saleCounts = {};
async function addSale({ createdAt, status, verifiedAt = null, verifier = null }) {
  const type = next() > 0.4 ? 'cube' : 'tractor';
  const quantity = type === 'cube' ? between(1, 5) : between(1, 3);
  const unitPrice = type === 'cube' ? cubePrice : tractorPrice;
  const [customerName, customerPhone, vehicleNo] = customers[saleCount % customers.length];
  const by = saleCount % 3 === 0 ? 'pivithuru' : 'nimal';
  const code = newCode();
  const month = keyOf(createdAt).slice(0, 7);
  const number = (saleCounts[month]?.last ?? 0) + 1;
  saleCounts[month] = { last: number, lastCode: code };
  saleCount += 1;
  await db.doc(`sales/${code}`).set({
    code,
    type,
    quantity,
    unitPrice,
    amount: quantity * unitPrice,
    customerName,
    customerPhone,
    vehicleNo,
    note: '',
    date: keyOf(createdAt),
    number,
    status,
    createdBy: uids[by],
    createdByName: people.find((person) => person.username === by).name,
    createdAt: Timestamp.fromDate(createdAt),
    ...(verifiedAt && {
      verifiedBy: uids[verifier],
      verifiedByName: people.find((person) => person.username === verifier).name,
      verifiedAt: Timestamp.fromDate(verifiedAt),
    }),
    ...(status === 'cancelled' && { cancelledAt: Timestamp.fromDate(new Date(createdAt.getTime() + 25 * 3_600_000)) }),
  });
  // Points the bill's printed invoice number back at its code, the way the
  // apps write it, so the seeded bills can be verified by number too.
  await db.doc(`saleIndex/${month}-${number}`).set({ code });
}

// Verified through the month, a day or two apart.
for (let day = 1; day < today.getDate(); day += between(1, 2)) {
  const createdAt = new Date(monthStart);
  createdAt.setDate(day);
  createdAt.setHours(between(8, 15), between(0, 59));
  await addSale({
    createdAt,
    status: 'verified',
    verifiedAt: new Date(createdAt.getTime() + between(1, 5) * 3_600_000),
    verifier: verifiers[saleCount % verifiers.length],
  });
}
// Lapsed, but not yet written down as cancelled — the panel does that.
await addSale({ createdAt: hoursAgo(30), status: 'pending' });
// Waiting to be scanned.
await addSale({ createdAt: hoursAgo(6), status: 'pending' });
await addSale({ createdAt: hoursAgo(2), status: 'pending' });
for (const [month, count] of Object.entries(saleCounts)) {
  await db.doc(`saleCounters/${month}`).set(count);
}

console.log(`Seeded ${projectId}: ${people.length} accounts (password ${password}), ${crews.length} machines, ${items.length} store items, ${bills.length} bills, ${saleCount} sales.`);
console.log('Sign in as pivithuru (admin) or nimal (supervisor).');
