import type { ReactNode } from 'react';

import { hours, money, rupees } from '../lib/format';
import { PAY_BASIS_LABEL, ROLES, paidPerLoad, rateOf, type MonthTally, type Person } from '../lib/model';
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
  const perLoad = paidPerLoad(person);
  const basis = PAY_BASIS_LABEL[perLoad ? 'load' : 'foot'];
  const rate = rateOf(person);
  return (
    <section className="rounded-panel p-5 text-white shadow-panel ring-1 ring-lime-hi/20 panel-lime">
      <div className="mb-4 flex items-baseline gap-2 border-b border-white/15 pb-3">
        <h2 className="flex-1 text-base font-bold tracking-tight">
          {role.tracksBonus ? 'ඉලක්කය සහ බෝනස්' : `මේ මාසයේ ${basis.unit}`}
        </h2>
        <span className="text-[11px] font-semibold text-white/60 tabular-nums">{month.month}</span>
      </div>
      {role.tracksBonus ? (
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <Row label="මාසේ දිනයන් ගණන" value={daysInMonth(month.month)} />
            <Row label="පැටවූ ලෝඩ් ගණන" value={month.loads} />
            <Row label="ඉලක්කය" value={currentTarget(month.loads)} />
            <Row label="ඉලක්කයට ඉතිරි දින" value={daysRemaining(month.month, today)} />
            <p className="pt-1 text-[11.5px] leading-relaxed font-medium text-white/75">
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
            {perLoad ? (
              <Row label="ලෝඩ් ගණන" value={month.loads} />
            ) : (
              <Row label="අඩි ගණන" value={hours(month.feet)} />
            )}
            <Row label="පැය ගණන" value={hours(month.hours)} />
            <Row label="ඉතිරි දින" value={daysRemaining(month.month, today)} />
          </div>
          <div className="rounded-card bg-black/20 p-5 text-center ring-1 ring-white/10">
            <p className="text-[12.5px] font-semibold text-white/75">{basis.unit} වලින් උපයා ඇති මුදල</p>
            <p className="mt-1.5 text-[34px] leading-none font-bold tracking-tight tabular-nums">
              {rate > 0 ? money((perLoad ? month.loads : month.feet) * rate) : '—'}
            </p>
            <p className="mt-2 text-[11.5px] font-medium text-white/65">
              {rate > 0 ? `${basis.per} ${rupees(rate)}` : `${perLoad ? 'ලෝඩ් එකක' : 'අඩියක'} ගාස්තුව සකසා නැත`}
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
      <span className="flex-1 text-[13px] font-semibold text-white/85">{label}</span>
      <span className="min-w-16 rounded-[7px] px-3 py-1 text-center text-[13px] font-bold shadow-control chip-amber tabular-nums">
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
      <line x1={left} y1={base} x2={right} y2={base} stroke="currentColor" strokeOpacity="0.2" />
      <path
        d={ladder}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* One caption instead of the amount repeated on every dot: all three
          tiers pay the same, and three identical labels sat on top of the
          rising line. */}
      <text x={left} y={16} fontSize="10.5" fontWeight="600" fill="currentColor" fillOpacity="0.6">
        එක් ඉලක්කයක් · {rupees(BONUS_PER_TIER)}
      </text>

      {TIERS.map((tier, index) => (
        <g key={tier}>
          <circle
            cx={x(tier)}
            cy={y(index + 1)}
            r="5.5"
            fill={index < reached ? 'var(--color-amber-hi)' : 'var(--color-fill-lime-lo)'}
            stroke="currentColor"
            strokeOpacity={index < reached ? '0' : '0.55'}
            strokeWidth="2"
          />
          <text
            x={x(tier)}
            y={base + 19}
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="600"
            fill="currentColor"
            fillOpacity="0.6"
          >
            {tier}
          </text>
        </g>
      ))}
      <text
        x={x(0) + 4}
        y={base + 19}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="currentColor"
        fillOpacity="0.6"
      >
        1
      </text>
      <text
        x={x(200)}
        y={base + 19}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        fill="currentColor"
        fillOpacity="0.6"
      >
        200
      </text>

      {/* Amber, the colour every other current-value readout uses. The old
          navy marker vanished once the panel went dark. */}
      <line
        x1={marker}
        y1={top - 10}
        x2={marker}
        y2={base}
        stroke="var(--color-amber-hi)"
        strokeOpacity="0.75"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      <path
        d={`M${marker - 6},${top - 20} L${marker + 6},${top - 20} L${marker},${top - 10} Z`}
        fill="var(--color-amber-hi)"
      />
      <text
        x={labelX}
        y={top - 25}
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="700"
        fill="var(--color-amber-hi)"
      >
        {loads}
      </text>
    </svg>
  );
}
