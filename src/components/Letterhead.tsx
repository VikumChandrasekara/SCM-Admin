import { COMPANY } from '../lib/company';
import { LogoMark } from './Logo';

/**
 * The head of every printed sheet — a sale bill, a payment receipt: the mark
 * and the company's name, where it is and how to reach it, and the amber rule
 * the body of the sheet hangs from. One place, so the two can never differ.
 */
export function Letterhead() {
  return (
    <header>
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <LogoMark className="size-14 shrink-0" />
        <div className="min-w-0 leading-snug">
          <p className="text-[26px] leading-none font-black tracking-[0.16em]">SCM</p>
          <p className="mt-1.5 text-[11.5px] leading-tight font-bold">{COMPANY.name}</p>
          <p className="mt-0.5 text-[9.5px] font-bold tracking-[0.12em] text-black/55 uppercase">{COMPANY.site}</p>
        </div>
      </div>

      <div className="space-y-0.5 px-5 pb-3.5 text-[10.5px] leading-snug text-black/70">
        <p>{COMPANY.address}</p>
        <p>
          <span className="font-bold text-black/80">Tel:</span>{' '}
          {COMPANY.phones.map((phone, index) => (
            <span key={phone}>
              {index > 0 && ' · '}
              <span className="whitespace-nowrap">{phone}</span>
            </span>
          ))}
        </p>
        <p>
          <span className="font-bold text-black/80">Email:</span> {COMPANY.email}
        </p>
      </div>

      <div className="h-1 bg-[#F7A340]" />
      <div className="h-px bg-black/80" />
    </header>
  );
}
