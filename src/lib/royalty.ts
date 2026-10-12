import type { DocumentData } from 'firebase/firestore';

import { ROLES, type Day, type Person } from './model';

/**
 * රාජ භාගය — the royalty owed on the rock the blasts bring down, worked out
 * from the explosives the compressor crews signed off:
 *
 *   ( ජෙල් කරල් kg + ඇමෝනියා kg ) × cubes per kg × rupees per cube × royalty %
 *
 * One delivery of 15 kg gel and 75 kg ammonia comes to
 * (15 + 75) × 3.5 × 700 × 18% = රු. 39,690. Only the gel and the ammonia
 * count; the caps, the wire and the rest do not.
 *
 * The crews record the gel as a count of කරල්, so it is turned into kilos
 * first, at the shells item's pieces to the kilo (see piecesPerKgOf).
 */

export interface RoyaltyRates {
  /** Cubes of rock a kilo of gel or ammonia is taken to bring down. */
  cubesPerKg: number;
  /** Rupees one of those cubes is worth. */
  cubeValue: number;
  /** The share of that worth paid as royalty, in percent. */
  percent: number;
}

/** What the royalty is worked out at until staff set otherwise. */
export const DEFAULT_ROYALTY_RATES: RoyaltyRates = { cubesPerKg: 3.5, cubeValue: 700, percent: 18 };

/** The settings document, or the defaults for any figure it lacks. */
export function royaltyRatesFrom(data: DocumentData | undefined): RoyaltyRates {
  const figure = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    cubesPerKg: figure(data?.cubesPerKg, DEFAULT_ROYALTY_RATES.cubesPerKg),
    cubeValue: figure(data?.cubeValue, DEFAULT_ROYALTY_RATES.cubeValue),
    percent: figure(data?.percent, DEFAULT_ROYALTY_RATES.percent),
  };
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** What one sheet — or a month of them — used, and what that comes to. */
export interface BlastRoyalty {
  /** Gel cartridges (කරල්) used. */
  shells: number;
  gelKg: number;
  ammoniaKg: number;
  /** [gelKg] and [ammoniaKg] together. */
  kg: number;
  cubes: number;
  /** What those cubes are worth, before the royalty share is taken. */
  worth: number;
  royalty: number;
}

/** The royalty on [used] කරල් of gel and kilos of ammonia, at [shellsPerKg] කරල් to the kilo. */
export function blastRoyaltyOf(
  used: { shells: number; ammoniaKg: number },
  shellsPerKg: number,
  rates: RoyaltyRates,
): BlastRoyalty {
  const gelKg = shellsPerKg > 0 ? used.shells / shellsPerKg : 0;
  const kg = gelKg + used.ammoniaKg;
  const cubes = kg * rates.cubesPerKg;
  const worth = cubes * rates.cubeValue;
  return {
    shells: used.shells,
    gelKg,
    ammoniaKg: used.ammoniaKg,
    kg,
    cubes,
    worth,
    royalty: cents((worth * rates.percent) / 100),
  };
}

/** One signed-off වෙඩි බඩු sheet and its royalty. */
export interface RoyaltyDay extends BlastRoyalty {
  date: string;
  machineId: string;
}

export interface MonthRoyalty extends BlastRoyalty {
  rates: RoyaltyRates;
  shellsPerKg: number;
  /** A line for each sheet that used any gel or ammonia, oldest first. */
  days: RoyaltyDay[];
}

/**
 * The royalty on every sheet the drillers signed off in [crew]'s days. A sheet
 * counts once however many crew members share its machine, and only once OK'd:
 * until then it is a draft the crew can still change.
 */
export function monthRoyaltyOf(
  crew: readonly { person: Pick<Person, 'role' | 'machineId'>; days: readonly Day[] }[],
  shellsPerKg: number,
  rates: RoyaltyRates,
): MonthRoyalty {
  const seen = new Set<string>();
  const days: RoyaltyDay[] = [];

  for (const { person, days: recorded } of crew) {
    if (!ROLES[person.role].tracksBlasting || !person.machineId) continue;
    for (const day of recorded) {
      const key = `${person.machineId}|${day.date}`;
      if (seen.has(key) || !day.blasting.lockedAt) continue;
      seen.add(key);

      const shells = Math.max(day.blasting.amounts.shells ?? 0, 0);
      const ammoniaKg = Math.max(day.blasting.amounts.ammonia ?? 0, 0);
      if (shells === 0 && ammoniaKg === 0) continue;
      days.push({
        date: day.date,
        machineId: person.machineId,
        ...blastRoyaltyOf({ shells, ammoniaKg }, shellsPerKg, rates),
      });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.machineId.localeCompare(b.machineId));

  const total = (pick: (day: RoyaltyDay) => number) => days.reduce((sum, day) => sum + pick(day), 0);
  return {
    rates,
    shellsPerKg,
    days,
    shells: total((day) => day.shells),
    gelKg: total((day) => day.gelKg),
    ammoniaKg: total((day) => day.ammoniaKg),
    kg: total((day) => day.kg),
    cubes: total((day) => day.cubes),
    worth: total((day) => day.worth),
    // The sum of the sheets' own figures, so the entries behind it add up to it.
    royalty: cents(total((day) => day.royalty)),
  };
}
