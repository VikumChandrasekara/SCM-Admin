import { describe, expect, it } from 'vitest';

import { DEFAULT_SHELLS_PER_KG, piecesFromKg, piecesPerKgOf, storeItemFrom } from '../src/lib/model';
import { DEFAULT_ROYALTY_RATES, blastRoyaltyOf, royaltyRatesFrom } from '../src/lib/royalty';

describe('royalty rates', () => {
  it('are the stored figures', () => {
    expect(royaltyRatesFrom({ cubesPerKg: 4, cubeValue: 800, percent: 20 })).toEqual({
      cubesPerKg: 4,
      cubeValue: 800,
      percent: 20,
    });
  });

  it('fall back to the defaults for a missing, negative or non-numeric figure', () => {
    expect(royaltyRatesFrom(undefined)).toEqual(DEFAULT_ROYALTY_RATES);
    expect(royaltyRatesFrom({ cubesPerKg: -1, cubeValue: '700', percent: null })).toEqual(DEFAULT_ROYALTY_RATES);
    // Only the bad figure falls back.
    expect(royaltyRatesFrom({ cubeValue: 900 })).toEqual({ ...DEFAULT_ROYALTY_RATES, cubeValue: 900 });
  });

  it('allow a zero share, for a month the royalty is waived', () => {
    expect(royaltyRatesFrom({ percent: 0 }).percent).toBe(0);
  });
});

describe('the royalty on a blast', () => {
  it('works one delivery out to රු. 39,690', () => {
    // 15 kg of gel (120 කරල්) and 75 kg of ammonia.
    const royalty = blastRoyaltyOf({ shells: 120, ammoniaKg: 75 }, 8, DEFAULT_ROYALTY_RATES);
    expect(royalty).toMatchObject({ gelKg: 15, kg: 90, cubes: 315, worth: 220500, royalty: 39690 });
  });

  it('is nothing for nothing used', () => {
    expect(blastRoyaltyOf({ shells: 0, ammoniaKg: 0 }, 8, DEFAULT_ROYALTY_RATES).royalty).toBe(0);
  });

  it('counts no gel at all when there is no rate to turn කරල් into kilos', () => {
    const royalty = blastRoyaltyOf({ shells: 120, ammoniaKg: 10 }, 0, DEFAULT_ROYALTY_RATES);
    expect(royalty.gelKg).toBe(0);
    expect(royalty.kg).toBe(10);
  });

  it('is rounded to the cent', () => {
    const royalty = blastRoyaltyOf({ shells: 1, ammoniaKg: 0 }, 3, DEFAULT_ROYALTY_RATES);
    expect(royalty.royalty).toBe(Math.round(royalty.royalty * 100) / 100);
  });
});

describe('gel by the kilo', () => {
  it('turns a delivery in kg into කරල්', () => {
    expect(piecesFromKg(15, 8)).toBe(120);
    expect(piecesFromKg(0.5, 8)).toBe(4);
  });

  it('does not let float noise into the count', () => {
    expect(piecesFromKg(0.1, 3)).toBe(0.3);
  });

  it('is the figure on the item, or 8 for the shells item that has none', () => {
    expect(piecesPerKgOf({ piecesPerKg: 10, link: 'blast:shells' })).toBe(10);
    expect(piecesPerKgOf({ piecesPerKg: null, link: 'blast:shells' })).toBe(DEFAULT_SHELLS_PER_KG);
    expect(DEFAULT_SHELLS_PER_KG).toBe(8);
  });

  it('is nothing for any other item without one, or no item', () => {
    expect(piecesPerKgOf({ piecesPerKg: null, link: 'blast:caps' })).toBeNull();
    expect(piecesPerKgOf({ piecesPerKg: null, link: null })).toBeNull();
    expect(piecesPerKgOf(undefined)).toBeNull();
  });

  it('is read from the store item, and ignored when it is not a positive number', () => {
    const base = { name: 'වෙඩි කරල්', unit: 'ගණන', quantity: 120, link: 'blast:shells' };
    expect(storeItemFrom('blast-shells', { ...base, piecesPerKg: 8 }).piecesPerKg).toBe(8);
    expect(storeItemFrom('blast-shells', base).piecesPerKg).toBeNull();
    expect(storeItemFrom('blast-shells', { ...base, piecesPerKg: 0 }).piecesPerKg).toBeNull();
    expect(storeItemFrom('blast-shells', { ...base, piecesPerKg: '8' }).piecesPerKg).toBeNull();
  });
});
