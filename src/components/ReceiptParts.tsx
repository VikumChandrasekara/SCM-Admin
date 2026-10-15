import { cx } from './ui';

/**
 * The rule that divides a till receipt into its parts — a row of stars spread
 * across the sheet's width, so it fits the printed roll and the screen alike.
 */
export function StarRule() {
  return (
    <div aria-hidden="true" className="flex justify-between text-[11px] leading-none select-none">
      {Array.from({ length: 31 }, (_, index) => (
        <span key={index}>*</span>
      ))}
    </div>
  );
}

/** One line of a receipt: what it is on the left, its value on the right. */
export function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cx(strong && 'font-bold')}>{label}</dt>
      <dd className={cx('text-right tabular-nums', strong ? 'text-[15px] font-black' : 'font-semibold')}>{value}</dd>
    </div>
  );
}
