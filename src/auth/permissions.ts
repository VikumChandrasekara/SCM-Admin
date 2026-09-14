import type { Bill, Person } from '../lib/model';

/**
 * What the signed-in person may do. firestore.rules is what actually
 * enforces each of these; this only keeps the panel from offering an action
 * the server would refuse.
 */
export interface Permissions {
  isAdmin: boolean;
  /** Create, edit and delete accounts. */
  manageUsers: boolean;
  /** Add, rename, re-price and delete store items — supervisors too. */
  editItems: boolean;
  /** Restock, draw down and recount — supervisors too. */
  adjustStock: boolean;
  addBills: boolean;
  canEditBill: (bill: Bill) => boolean;
  /** Daily wage and rate per foot. */
  setRates: boolean;
  /** Write sales — supervisors too. */
  addSales: boolean;
  /** What a cube and a tractor load sell for. */
  setSalePrices: boolean;
  /** Income, expenses and profit. */
  viewFinance: boolean;
}

export function permissionsFor(profile: Person): Permissions {
  const isAdmin = profile.role === 'admin';
  return {
    isAdmin,
    manageUsers: isAdmin,
    editItems: true,
    adjustStock: true,
    addBills: true,
    canEditBill: (bill) => isAdmin || bill.createdBy === profile.id,
    setRates: isAdmin,
    addSales: true,
    setSalePrices: isAdmin,
    viewFinance: isAdmin,
  };
}
