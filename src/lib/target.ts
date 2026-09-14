// The excavator crew's load target and bonus ladder. Mirrors
// lib/models/target_progress.dart.

export const TIERS = [300, 400, 500] as const;

/** Each tier reached adds this on top of the last: 500 loads is worth 90,000. */
export const BONUS_PER_TIER = 30_000;

export function tiersReached(loads: number): number {
  return TIERS.filter((tier) => loads >= tier).length;
}

/** ඉලක්කය — the tier still being chased, or the top tier once all are met. */
export function currentTarget(loads: number): number {
  const reached = tiersReached(loads);
  return reached >= TIERS.length ? TIERS[TIERS.length - 1] : TIERS[reached];
}

export function loadsToTarget(loads: number): number {
  const target = currentTarget(loads);
  return Math.min(Math.max(target - loads, 0), target);
}

export function bonusEarned(loads: number): number {
  return tiersReached(loads) * BONUS_PER_TIER;
}

/** Cumulative: 300 earns 30,000, 400 earns 60,000, 500 earns 90,000. */
export function bonusAt(tier: number): number {
  return (TIERS.indexOf(tier as (typeof TIERS)[number]) + 1) * BONUS_PER_TIER;
}

/** මාසේ දිනයන් ගණන */
export function daysInMonth(month: string): number {
  const [year, index] = month.split('-').map(Number);
  return new Date(year, index, 0).getDate();
}

/** ඉලක්කයට ඉතිරි දින — counted from today when today is in the month. */
export function daysRemaining(month: string, today: string): number {
  return today.startsWith(month)
    ? daysInMonth(month) - Number(today.slice(8, 10))
    : daysInMonth(month);
}
