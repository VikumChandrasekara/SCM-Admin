/**
 * Who the sale bills are issued by — printed at the head of every bill and
 * every payment receipt, from the company's own stationery.
 *
 * Every bill is drawn from this each time it is shown, so a change here is
 * a change to the bills already written as well as the next ones. The same
 * details live in the operator app's lib/utils/company.dart.
 */
export const COMPANY = {
  name: 'Singha Constructions & Machinery (Pvt) Ltd',
  /** The site the bills are issued from, under the name. */
  site: 'SCM Quarry Thantirimale',
  address: 'No : 187/3, Kiridiwela Rd, Weliveriya.',
  phones: ['076 9964026', '077 9004026', '077 0714026'],
  email: 'scmachinery@gmail.com',
} as const;

/** The line at the foot of every bill. */
export const DEVELOPED_BY = 'Developed by Thrimaa Interactive (Pvt) Ltd';
