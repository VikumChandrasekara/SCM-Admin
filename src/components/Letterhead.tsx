import { COMPANY } from '../lib/company';

/**
 * The head of every printed sheet — a sale bill, a payment receipt: the
 * company's name and how to reach it, centred like a till receipt's shop name.
 * Black on white only. One place, so the two can never differ.
 */
export function Letterhead() {
  return (
    <header className="px-5 pt-6 pb-4 text-center">
      {/* The tracking adds a gap after the last letter; the padding takes it back so SCM sits dead centre. */}
      <p className="pl-[0.18em] text-[30px] leading-none font-black tracking-[0.18em]">SCM</p>
      <p className="mt-2 text-[12px] leading-tight font-bold">{COMPANY.name}</p>
      <p className="mt-1 text-[11px] leading-snug">
        Tel:{' '}
        {COMPANY.phones.map((phone, index) => (
          <span key={phone}>
            {index > 0 && ' · '}
            <span className="whitespace-nowrap">{phone}</span>
          </span>
        ))}
      </p>
    </header>
  );
}
