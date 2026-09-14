import type { ReactNode } from 'react';

import { hours, money, rupees } from '../lib/format';
import { ROLES, type MonthTally, type Person } from '../lib/model';
import {
  BONUS_PER_TIER,
  TIERS,
  bonusEarned,
  currentTarget,
  daysInMonth,
  daysRemaining,
  loadsToTarget,
  tiersReached,
} from '../lib/target';

/** The mockup's green panel: the month's figures beside the bonus ladder. */
export function TargetPanel({ person, month, today }: { person: Person; month: MonthTally; today: string }) {
  const role = ROLES[person.role];
  return (
    <section className="rounded-[28px] p-5 text-ink shadow-panel panel-lime">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="flex-1 text-lg font-extrabold">{role.tracksBonus ? 'ඉලක්කය සහ බෝනස්' : 'මේ මාසයේ ආඩි'}</h2>
        <span className="text-xs font-bold text-ink/60">{month.month}</span>
      </div>
      {role.tracksBonus ? (
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <Row label="මාසේ දිනයන් ගණන" value={daysInMonth(month.month)} />
            <Row label="පැටවූ ලෝඩ් ගණන" value={month.loads} />
            <Row label="ඉලක්කය" value={currentTarget(month.loads)} />
            <Row label="ඉලක්කයට ඉතිරි දින" value={daysRemaining(month.month, today)} />
            <p className="pt-1 text-xs font-semibold text-ink/75">
              {tiersReached(month.loads) >= TIERS.length
                ? 'සියලු ඉලක්ක සම්පූර්ණයි'
                : `ඊළඟ බෝනස් එකට තව ලෝඩ් ${loadsToTarget(month.loads)}ක්`}
              {' · '}උපයා ඇති බෝනස් {rupees(bonusEarned(month.loads))}
            </p>
          </div>
          <BonusChart loads={month.loads} />
        </div>
      ) : (
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <Row label="මාසේ දිනයන් ගණන" value={daysInMonth(month.month)} />
            <Row label="ආඩි ගණන" value={hours(month.feet)} />
            <Row label="පැය ගණන" value={hours(month.hours)} />
            <Row label="ඉතිරි දින" value={daysRemaining(month.month, today)} />
          </div>
          <div className="rounded-2xl bg-black/10 p-5 text-center">
            <p className="text-sm font-bold">ආඩි වලින් උපයා ඇති මුදල</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums">
              {person.ratePerFoot > 0 ? money(month.feet * person.ratePerFoot) : '—'}
            </p>
            <p className="mt-1 text-xs font-semibold text-ink/70">
              {person.ratePerFoot > 0 ? `ආඩියකට ${rupees(person.ratePerFoot)}` : 'ආඩියක ගාස්තුව සකසා නැත'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-sm font-bold">{label}</span>
      <span className="min-w-16 rounded-lg px-3 py-1 text-center text-sm font-extrabold shadow-control chip-amber tabular-nums">
        {value}
      </span>
    </div>
  );
}

/**
 * Flat to 200, then a step up at each tier — the mockup's sketch, with a
 * marker where the month's loads stand.
 */
function BonusChart({ loads }: { loads: number }) {
  const width = 340;
  const left = 22;
  const right = 318;
  const base = 168;
  const top = 44;
  const span = 550;

  const x = (value: number) => left + (Math.min(Math.max(value, 0), span) / span) * (right - left);
  const y = (step: number) => base - (step / TIERS.length) * (base - top);

  const points: [number, number][] = [
    [x(0), base],
    [x(200), base],
    ...TIERS.map((tier, index): [number, number] => [x(tier), y(index + 1)]),
  ];
  const ladder = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px},${py}`).join(' ');
  const reached = tiersReached(loads);
  const marker = x(loads);
  const labelX = Math.min(Math.max(marker, 18), width - 18);

  return (
    <svg viewBox={`0 0 ${width} 196`} className="w-full" role="img" aria-label={`ලෝඩ් ${loads} — බෝනස් ඉලක්ක 300, 400, 500`}>
      <line x1={left} y1={base} x2={right} y2={base} stroke="currentColor" strokeOpacity="0.25" />
      <path d={ladder} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

      {TIERS.map((tier, index) => (
        <g key={tier}>
          <circle cx={x(tier)} cy={y(index + 1)} r="6.5" fill={index < reached ? '#dd7a1b' : '#ffffff'} stroke="currentColor" strokeWidth="2" />
          <text x={x(tier) - 11} y={y(index + 1) + 4} textAnchor="end" fontSize="11" fontWeight="800" fill="currentColor">
            බෝනස් {money(BONUS_PER_TIER)}
          </text>
          <text x={x(tier)} y={base + 19} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
            {tier}
          </text>
        </g>
      ))}
      <text x={x(0) + 4} y={base + 19} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        1
      </text>
      <text x={x(200)} y={base + 19} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        200
      </text>

      <line x1={marker} y1={top - 12} x2={marker} y2={base} stroke="#17334f" strokeWidth="2" strokeDasharray="4 4" />
      <path d={`M${marker - 7},${top - 22} L${marker + 7},${top - 22} L${marker},${top - 11} Z`} fill="#17334f" />
      <text x={labelX} y={top - 27} textAnchor="middle" fontSize="12" fontWeight="800" fill="#17334f">
        {loads}
      </text>
    </svg>
  );
}
