import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import { customerKeyOf, nameOf, paymentFrom, saleFrom, type Payment, type Person, type Sale } from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

/**
 * Records a payment against a customer's credit account. Written once.
 * Returns its id.
 *
 * [saleCode] is the credit bill the payment settles in full — how a bill is
 * ticked off as paid. Its payment gets an id of its own, so ticking the same
 * bill twice (a double tap, two people at once) is refused rather than
 * counted twice: a payment can be created but never changed.
 */
export async function addPayment(
  customerName: string,
  amount: number,
  date: string,
  note: string,
  by: Person,
  saleCode?: string,
): Promise<string> {
  const name = customerName.trim();
  const batch = writeBatch(db);
  const payment = saleCode ? doc(db, 'payments', `sale-${saleCode}`) : doc(collection(db, 'payments'));
  batch.set(payment, {
    customerKey: customerKeyOf(name),
    customerName: name,
    amount,
    date,
    note: note.trim(),
    ...(saleCode ? { saleCode } : {}),
    createdBy: by.id,
    createdByName: nameOf(by),
    createdAt: serverTimestamp(),
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('payment.add', 'sale', customerKeyOf(name), name, `රු.${amount} · ${date}${note.trim() ? ` · ${note.trim()}` : ''}`, by),
  );
  await commit(batch);
  return payment.id;
}

/** Every sale taken on credit, whatever its month. Staff only — see firestore.rules. */
export function useCreditSales() {
  return useLiveQuery(
    'credit-sales',
    () => query(collection(db, 'sales'), where('paymentType', '==', 'credit')),
    (snapshot) => saleFrom(snapshot.id, snapshot.data()) as Sale,
  );
}

/** Every payment against a credit account. Staff only. */
export function usePayments() {
  return useLiveQuery(
    'payments',
    () => collection(db, 'payments'),
    (snapshot) => paymentFrom(snapshot.id, snapshot.data()) as Payment,
  );
}
