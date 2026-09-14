/**
 * Who the sale bills are issued by — printed at the head of every bill.
 *
 * The address and phone number are placeholders until the company's own are
 * given. They live here, and in the operator app's lib/utils/company.dart,
 * so filling them in is a one-line change on each side.
 */
export const COMPANY = {
  name: 'Singha Constructions & Machinery (Pvt) Ltd',
  address: 'ලිපිනය මෙතැනට',
  phone: '0XX XXX XXXX',
} as const;

/** The line at the foot of every bill. */
export const DEVELOPED_BY = 'Developed by Thrimaa Interactive (Pvt) Ltd';
