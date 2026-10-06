import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';

import { db } from '../db';
import { customerKeyOf, nameOf, paymentFrom, saleFrom, type Payment, type Person, type Sale } from '../lib/model';
import { auditEntry } from './audit';
import { commit } from './commit';
import { useLiveQuery } from './live';

/** Records a payment against a customer's credit account. Written once. Returns its id. */
export async function addPayment(
  customerName: string,
  amount: number,
  date: string,
  note: string,
  by: Person,
): Promise<string> {
  const name = customerName.trim();
  const batch = writeBatch(db);
  const payment = doc(collection(db, 'payments'));
  batch.set(payment, {
    customerKey: customerKeyOf(name),
    customerName: name,
    amount,
    date,
    note: note.trim(),
    createdBy: by.id,
    createdByName: nameOf(by),
    createdAt: serverTimestamp(),
  });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditEntry('payment.add', 'sale', customerKeyOf(name), name, `රු.${amount} · ${date}`, by),
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
