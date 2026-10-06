import { customerKeyOf, saleStatus, type Payment, type Sale } from './model';

/**
 * One customer's credit account: what they took on credit, what they have
 * paid back, and what is still owed. Never stored — worked out from the sales
 * and payments each time. Mirrors CustomerAccount in the supervisor app.
 */
export interface CustomerAccount {
  customerKey: string;
  customerName: string;
  credit: number;
  paid: number;
  outstanding: number;
}

/** Every customer with a credit sale, the ones still owing first. A cancelled credit sale is not owed. */
export function customerAccounts(
  sales: readonly Sale[],
  payments: readonly Payment[],
  now = Date.now(),
): CustomerAccount[] {
  const credit = new Map<string, number>();
  const paid = new Map<string, number>();
  const names = new Map<string, string>();

  for (const sale of sales) {
    if (sale.paymentType !== 'credit' || saleStatus(sale, now) === 'cancelled') continue;
    const key = customerKeyOf(sale.customerName);
    credit.set(key, (credit.get(key) ?? 0) + sale.amount);
    if (!names.has(key)) names.set(key, sale.customerName.trim());
  }
  for (const payment of payments) {
    paid.set(payment.customerKey, (paid.get(payment.customerKey) ?? 0) + payment.amount);
    if (!names.has(payment.customerKey)) names.set(payment.customerKey, payment.customerName.trim());
  }

  return [...credit.entries()]
    .map(([key, total]) => {
      const received = paid.get(key) ?? 0;
      return {
        customerKey: key,
        customerName: names.get(key) ?? key,
        credit: total,
        paid: received,
        outstanding: total - received,
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);
}
