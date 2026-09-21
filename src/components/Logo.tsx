import { cx } from './ui';

/**
 * Two open squares locked through one another — the SCM mark, drawn the same
 * way the operator app's fallback lockup draws it.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinejoin="miter" transform="rotate(-9 24 24)">
        <rect x="6.5" y="8" width="21" height="21" />
        <rect x="19.5" y="18" width="21" height="21" />
      </g>
    </svg>
  );
}

/** The full lockup, on the pale plaque the login screen sets it on. */
export function LogoPlaque({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center rounded-panel bg-gradient-to-br from-white to-[#f1eee8] px-8 py-5 text-ink shadow-panel',
        className,
      )}
    >
      <LogoMark className="size-14" />
      <span className="mt-1 font-serif text-5xl leading-none font-bold tracking-wide">SCM</span>
      <span className="mt-1.5 font-serif text-[13px]">Singha Constructions &amp; Machinery (pvt) ltd.</span>
    </div>
  );
}
