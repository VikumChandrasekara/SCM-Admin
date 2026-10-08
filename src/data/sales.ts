import {
  collection,
  doc,
  getDoc,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { db } from '../db';
import { dateTime, monthBounds, monthKey, todayKey } from '../lib/format';
import {
  SALE_CODE_ALPHABET,
  SALE_TYPE,
  customerKeyOf,
  nameOf,
  padSaleNumber,
  pricesFrom,
  saleFrom,
  saleNumber,
  saleStatus,
  unitPriceOf,
  type Person,
  type PaymentType,
  type Sale,
  type SaleMaterial,
  type SaleType,
  type SalesPrices,
} from '../lib/model';
import { saleDeleteSummary, saleEditFields, saleEditSummary, type SaleEdit } from '../lib/saleEdit';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveDoc, useLiveQuery } from './live';
import { binEntryData, binRef } from './recycle';

const pricesRef = () => doc(db, 'settings', 'sales');

/**
 * What a full tipper load, one cube and one tractor load sell for — the
 * defaults until staff set them.
 */
export function useSalesPrices() {
  return useLiveDoc(pricesRef(), (snapshot) => pricesFrom(snapshot.data()));
}

export async function saveSalesPrices(prices: SalesPrices, by: Person): Promise<void> {
  const batch = writeBatch(db);
  batch.set(pricesRef(), { ...prices, updatedAt: serverTimestamp(), updatedBy: by.id });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry(
      'sales.prices',
      'settings',
      'sales',
      'විකුණුම් මිල',
      `ටිපර් ලෝඩ් රු.${prices.tipperPrice} (කියුබ් රු.${prices.cubePrice}) · ට්‍රැක්ටර් ලෝඩ් රු.${prices.tractorPrice} · යන්ත්‍රයට පැයකට රු.${prices.machineHourly}`,
      by,
    ),
  );
  await commit(batch);
}

/** Every sale dated inside `yyyy-MM`, newest first. */
export function useMonthSales(month: string) {
  const { from, to } = monthBounds(month);
  const sales = useLiveQuery(
    `sales:${month}`,
    // A range and an order on the same field need no composite index.
    () => query(collection(db, 'sales'), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc')),
    (snapshot) => saleFrom(snapshot.id, snapshot.data()),
  );
  const sorted = sales.data
    ? [...sales.data].sort(
        (a, b) => b.date.localeCompare(a.date) || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      )
    : undefined;
  return { data: sorted, error: sales.error };
}

/**
 * A new code for a bill: 8 characters from an alphabet without 0/O and 1/I,
 * so it can be read out or typed in when a QR will not scan. It is the
 * sale's document id — which is what lets anyone holding the bill look the
 * sale up without being able to list the rest.
 */
function newSaleCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 256 is a multiple of 32, so every character is equally likely.
  return Array.from(bytes, (byte) => SALE_CODE_ALPHABET[byte % SALE_CODE_ALPHABET.length]).join('');
}

export interface SaleInput {
  type: SaleType;
  quantity: number;
  customerName: string;
  material: SaleMaterial;
  paymentType: PaymentType;
  /** Paid now for a load taken later — always cash. */
  prepaid: boolean;
  customerPhone: string;
  vehicleNo: string;
  note: string;
}

/**
 * Writes a new, unverified sale at today's price and returns its code.
 *
 * A transaction rather than a batch: the price is read on the server at the
 * moment of the sale — the same figure firestore.rules checks the sum
 * against — and a sale is money, so it is never left queued on a computer.
 * The month's bill count moves in the same transaction, so each month's bills
 * run 001, 002, … with none skipped, and none shared by two computers selling
 * at once.
 */
export async function createSale(input: SaleInput, by: Person): Promise<string> {
  const code = newSaleCode();
  const ref = doc(db, 'sales', code);
  const date = todayKey();
  const counterRef = doc(db, 'saleCounters', date.slice(0, 7));

  await runTransaction(db, async (tx) => {
    const prices = pricesFrom((await tx.get(pricesRef())).data());

    const existing = await tx.get(ref);
    if (existing.exists()) {
      // An attempt that follows one which went through.
      if (existing.data().createdBy === by.id) return;
      throw new Error('නැවත උත්සාහ කරන්න.');
    }

    const last: unknown = (await tx.get(counterRef)).data()?.last;
    const number = (typeof last === 'number' ? last : 0) + 1;
    const month = date.slice(0, 7);

    const unitPrice = unitPriceOf(prices, input.type);
    const amount = input.quantity * unitPrice;
    const customerName = input.customerName.trim();
    const vehicleNo = input.vehicleNo.trim().toUpperCase();
    tx.set(counterRef, { last: number, lastCode: code });
    // Points the bill's printed invoice number back at its real code, so
    // typing that number in to verify it does one direct read.
    tx.set(doc(db, 'saleIndex', `${month}-${number}`), { code });
    tx.set(ref, {
      code,
      number,
      type: input.type,
      quantity: input.quantity,
      unitPrice,
      amount,
      customerName,
      customerKey: customerKeyOf(customerName),
      material: input.material,
      // A prepaid bill is paid there and then, so never on credit.
      paymentType: input.prepaid ? 'cash' : input.paymentType,
      prepaid: input.prepaid,
      machineCharge: prices.machineCharge,
      customerPhone: input.customerPhone.trim(),
      vehicleNo,
      note: input.note.trim(),
      date,
      status: 'pending',
      createdBy: by.id,
      createdByName: nameOf(by),
      createdAt: serverTimestamp(),
    });
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry(
        'sales.create',
        'sale',
        code,
        `බිල්පත ${padSaleNumber(number)}`,
        `${input.prepaid ? 'කලින් ගෙවූ · ' : ''}${SALE_TYPE[input.type].label} · ${input.quantity} ${SALE_TYPE[input.type].unit} × රු.${unitPrice} = රු.${amount} · ${customerName}${vehicleNo ? ` · ${vehicleNo}` : ''}`,
        by,
      ),
    );
  });

  return code;
}

/**
 * Puts a mistake on bill [code] right — the admin's alone, see
 * firestore.rules for what may change.
 *
 * In a transaction, measured against the server's copy: an attempt that
 * follows one which went through finds nothing left to change and writes
 * nothing, so it is never logged twice.
 */
export async function updateSale(code: string, edit: SaleEdit, by: Person): Promise<void> {
  const ref = doc(db, 'sales', code);
  await runTransaction(db, async (tx) => {
    const stored = await tx.get(ref);
    if (!stored.exists()) throw new Error('මෙම බිල්පත මේ අතර ඉවත් කර ඇත.');
    const before = saleFrom(stored.id, stored.data());
    const fields = saleEditFields(before, edit);
    const changes = saleEditSummary(before, fields);
    if (changes === null) return;

    tx.update(ref, fields);
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('sales.update', 'sale', code, `බිල්පත ${saleNumber(before)}`, changes, by),
    );
  });
}

/**
 * Removes bill [code] — the admin's alone. It goes to the recycle bin for 30
 * days, and the audit log keeps what it said.
 *
 * Its invoice-number pointer goes with it. And when it is the month's newest
 * bill, the month's count goes back by one, so the next bill takes the number
 * that is now free and the month's numbers still run 001, 002, … with none
 * skipped. A bill from the middle leaves its number empty: winding the count
 * back past a bill still there would give its number out twice.
 *
 * Returns the number given back, or null when there is none to give.
 */
export async function deleteSale(code: string, by: Person): Promise<number | null> {
  const ref = doc(db, 'sales', code);
  return runTransaction(db, async (tx) => {
    const stored = await tx.get(ref);
    if (!stored.exists()) return null; // already gone, with its pointer and number
    const sale = saleFrom(stored.id, stored.data());

    // Every read comes before the first write. A bill from before bills were
    // numbered has no pointer and was never counted.
    const month = sale.date.slice(0, 7);
    const number = sale.number;
    const counterRef = doc(db, 'saleCounters', month);
    const indexRef = number == null ? null : doc(db, 'saleIndex', `${month}-${number}`);
    const index = indexRef ? await tx.get(indexRef) : null;
    const counter = number == null ? null : await tx.get(counterRef);
    const counted = counter?.data();
    // The number to give back — set only when this bill is the count's top.
    const freed = number != null && counted?.last === number && counted.lastCode === code ? number : null;
    const below = freed != null && freed > 1 ? await tx.get(doc(db, 'saleIndex', `${month}-${freed - 1}`)) : null;

    // Kept 30 days in the recycle bin, whole — restoring it takes the bill
    // back with its invoice number.
    tx.set(
      binRef('sale', code),
      binEntryData('sale', code, stored.data(), `බිල්පත ${saleNumber(sale)}`, saleDeleteSummary(sale), by),
    );
    tx.delete(ref);
    if (indexRef && index?.data()?.code === code) tx.delete(indexRef);
    if (freed != null) {
      const previous: unknown = below?.data()?.code;
      // lastCode names the bill now at the top of the count, if one is known.
      tx.update(counterRef, { last: freed - 1, lastCode: typeof previous === 'string' ? previous : '' });
    }
    tx.set(
      doc(collection(db, 'auditLog')),
      auditEntry('sales.delete', 'sale', code, `බිල්පත ${saleNumber(sale)}`, saleDeleteSummary(sale), by),
    );
    return freed;
  });
}

/** One sale, followed live — the bill on screen shows its verification land. */
export function useSale(code: string | null) {
  return useLiveDoc(code ? doc(db, 'sales', code) : null, (snapshot) =>
    snapshot.exists() ? saleFrom(snapshot.id, snapshot.data()) : null,
  );
}

/** The sale with [code], or null when there is none. */
export async function fetchSale(code: string): Promise<Sale | null> {
  const snapshot = await getDoc(doc(db, 'sales', code));
  return snapshot.exists() ? saleFrom(snapshot.id, snapshot.data()) : null;
}

/**
 * The sale carrying invoice [number] — the one printed on the bill — or null
 * when there is none. Checks the current month, then the one before it, so a
 * bill made in the last minutes of one month still turns up when verified in
 * the next.
 */
export async function fetchSaleByNumber(number: number): Promise<Sale | null> {
  const now = new Date();
  const months = [monthKey(now), monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
  for (const month of months) {
    const index = await getDoc(doc(db, 'saleIndex', `${month}-${number}`));
    const code = index.data()?.code;
    if (typeof code === 'string') return fetchSale(code);
  }
  return null;
}

/**
 * Marks the sale verified by [by] — what makes it income.
 *
 * In a transaction, so the status is checked on the server: a bill already
 * verified, or past its day, is refused with the reason rather than
 * verified twice.
 */
export async function verifySale(code: string, by: Person): Promise<Sale> {
  const ref = doc(db, 'sales', code);
  try {
    return await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('මෙම අංකයෙන් බිල්පතක් නැත.');
      const sale = saleFrom(snapshot.id, snapshot.data());

      if (sale.status === 'verified') {
        // An attempt that follows one which went through.
        if (sale.verifiedBy === by.id) return sale;
        throw new Error(
          `මෙම බිල්පත දැනටමත් තහවුරු කර ඇත — ${sale.verifiedByName || '—'}, ${dateTime(sale.verifiedAt)}.`,
        );
      }
      if (saleStatus(sale) === 'cancelled') throw new Error(EXPIRED);

      tx.update(ref, {
        status: 'verified',
        verifiedBy: by.id,
        verifiedByName: nameOf(by),
        verifiedAt: serverTimestamp(),
      });
      tx.set(
        doc(collection(db, 'auditLog')),
        auditEntry(
          'sales.verify',
          'sale',
          code,
          `බිල්පත ${saleNumber(sale)}`,
          `රු.${sale.amount} · ${sale.customerName || '—'}`,
          by,
        ),
      );
      return { ...sale, status: 'verified' as const, verifiedBy: by.id, verifiedByName: nameOf(by), verifiedAt: new Date() };
    });
  } catch (error) {
    // For a signed-in member the rules refuse a verification only once the
    // day has run out by the server's clock, which can be ahead of this one.
    if ((error as { code?: string }).code === 'permission-denied') throw new Error(EXPIRED);
    throw error;
  }
}

const EXPIRED = 'පැය 24ක් ඇතුළත තහවුරු නොකළ නිසා මෙම බිල්පත අවලංගු වී ඇත.';

/** The wall clock, ticking over every [everyMs]. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * Writes down the cancellation of every unverified sale past its day.
 *
 * Spark has no scheduled functions, so the panel does it while staff have it
 * open. Until then a lapsed sale already reads as cancelled everywhere
 * ([saleStatus]) and the rules refuse to verify it; this only makes the
 * record say so.
 */
export function useExpiredSalesSweeper(): void {
  const now = useNow(5 * 60_000);
  const pending = useLiveQuery(
    'sales:pending',
    () => query(collection(db, 'sales'), where('status', '==', 'pending')),
    (snapshot) => saleFrom(snapshot.id, snapshot.data()),
  );

  useEffect(() => {
    // A couple of minutes' grace for a computer clock running ahead of the
    // server's: the rules decide by the server's.
    const cutoff = now - 2 * 60_000;
    const lapsed = (pending.data ?? []).filter((sale) => saleStatus(sale, cutoff) === 'cancelled');
    if (lapsed.length === 0) return;

    const batch = writeBatch(db);
    for (const sale of lapsed) {
      batch.update(doc(db, 'sales', sale.code), { status: 'cancelled', cancelledAt: serverTimestamp() });
    }
    // Refused when another open panel got there first; the listener then
    // hands over what is left.
    batch.commit().catch(() => {});
  }, [pending.data, now]);
}
