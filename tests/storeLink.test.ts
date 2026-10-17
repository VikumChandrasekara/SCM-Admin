import { describe, expect, it } from 'vitest';

import { type Person, type StockLink, type StoreItem } from '../src/lib/model';
import { normalizeName, planLinks } from '../src/lib/storeLink';

const person = (id: string, role: Person['role']): Person => ({
  id,
  name: id,
  username: id,
  machineId: role === 'compressor' ? 'cp1' : role === 'operator' ? 'ex1' : '',
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
  sakkaLoadWage: 0,
  boldasLoadWage: 0,
  c1LoadWage: 0,
});

const item = (name: string, link: StockLink | null = null, id = name): StoreItem => ({
  id,
  name,
  unit: 'L',
  quantity: 100,
  minQuantity: 10,
  unitPrice: 300,
  piecesPerKg: null,
  link,
  note: '',
  direct: false,
  usedQuantity: 0,
  usedAmount: 0,
  createdAt: null,
  countedAt: null,
  updatedAt: null,
});

const crew = [person('op1', 'operator'), person('dr1', 'compressor')];

/** Which existing item each use would take, by the use's link. */
function adoptions(store: StoreItem[], who = crew) {
  return Object.fromEntries(planLinks(store, who).map((plan) => [plan.option.link, plan.adopt?.id ?? null]));
}

describe('names, as they are compared', () => {
  it('ignores case, spaces, punctuation, brackets and their contents, and zero-width joiners', () => {
    expect(normalizeName('  Diesel ')).toBe('diesel');
    expect(normalizeName('ඩීසල් (L)')).toBe('ඩීසල්');
    expect(normalizeName('වෙඩි නූල් (අඩි)')).toBe(normalizeName('වෙඩි නූල්'));
    // The same word with and without the joiner a keyboard may or may not type.
    expect(normalizeName('හයිඩ්‍රොලික්')).toBe(normalizeName('හයිඩ්රොලික්'));
    expect(normalizeName('Engine-Oil.')).toBe('engineoil');
  });
});

describe('which existing item a use takes over', () => {
  it('takes the unlinked item whose name is plainly the use', () => {
    const plans = adoptions([
      item('ඩීසල්'),
      item('හයිඩ්‍රොලික් ඔයිල්'),
      item('කම්පසර් ඔයිල්'),
      item('එන්ජින් ඔයිල්'),
      item('කුලන්ට්'),
      item('වෙඩි කරල්'),
      item('කැප්'),
      item('වෙඩි නූල්'),
      item('ඇමෝනියා'),
      item('යාරමීලා'),
      item('වෙඩි කුඩු'),
      item('ඩීසල් මිශ්‍ර'),
      item('බිට්'),
      item('කටු'),
    ]);

    expect(plans).toEqual({
      'fill:diesel': 'ඩීසල්',
      'fill:hydraulic': 'හයිඩ්‍රොලික් ඔයිල්',
      'fill:compressorOil': 'කම්පසර් ඔයිල්',
      'fill:engineOil': 'එන්ජින් ඔයිල්',
      'fill:coolant': 'කුලන්ට්',
      'blast:shells': 'වෙඩි කරල්',
      'blast:caps': 'කැප්',
      'blast:blastingWire': 'වෙඩි නූල්',
      'blast:ammonia': 'ඇමෝනියා',
      'blast:yaramila': 'යාරමීලා',
      'blast:blastPowder': 'වෙඩි කුඩු',
      'blast:dieselMix': 'ඩීසල් මිශ්‍ර',
      'blast:bits': 'බිට්',
      'blast:rods': 'කටු',
    });
  });

  it('reads English names and brackets', () => {
    const plans = adoptions([item('Diesel (L)'), item('Hydraulic oil'), item('Gel')]);
    expect(plans['fill:diesel']).toBe('Diesel (L)');
    expect(plans['fill:hydraulic']).toBe('Hydraulic oil');
    expect(plans['blast:shells']).toBe('Gel');
  });

  it('does not take two names for the same use — that is a guess', () => {
    const plans = adoptions([item('Gel'), item('වෙඩි කරල්')]);
    expect(plans['blast:shells']).toBeNull();
  });

  it('keeps ඩීසල් and ඩීසල් මිශ්‍ර apart', () => {
    const plans = adoptions([item('ඩීසල් මිශ්‍ර')]);
    expect(plans['fill:diesel']).toBeNull();
    expect(plans['blast:dieselMix']).toBe('ඩීසල් මිශ්‍ර');
  });

  it('does not guess: two items with the name, a name that is not the use, or an item already linked', () => {
    const plans = adoptions([
      item('ඩීසල්', null, 'a'),
      item('ඩීසල්', null, 'b'),
      item('ග්‍රීස්'),
      item('කැප්', 'blast:caps', 'blast-caps'),
      item('ඇමෝනියා නයිට්‍රේට්'),
    ]);
    expect(plans['fill:diesel']).toBeNull();
    // Linked already: it needs nothing, so it is not in the plans at all.
    expect('blast:caps' in plans).toBe(false);
    expect(plans['blast:ammonia']).toBeNull();
    // Nothing is taken from outside the uses.
    expect(Object.values(plans)).not.toContain('ග්‍රීස්');
  });

  it('plans nothing once every use has an item', () => {
    const all: StockLink[] = [
      'fill:diesel',
      'fill:hydraulic',
      'fill:compressorOil',
      'fill:engineOil',
      'fill:coolant',
      'blast:shells',
      'blast:caps',
      'blast:blastingWire',
      'blast:ammonia',
      'blast:yaramila',
      'blast:blastPowder',
      'blast:dieselMix',
      'blast:bits',
      'blast:rods',
    ];
    expect(planLinks(all.map((link) => item(link, link, link.replace(':', '-'))), crew)).toEqual([]);
  });

  it('asks only about what the crews on the panel record', () => {
    const operators = adoptions([item('ඩීසල්'), item('බිට්')], [person('op1', 'operator')]);
    expect(operators['fill:diesel']).toBe('ඩීසල්');
    // No driller: no වෙඩි බඩු sheet, so nothing to tie බිට් to.
    expect('blast:bits' in operators).toBe(false);
    expect(planLinks([item('ඩීසල්')], [person('sup1', 'supervisor')])).toEqual([]);
  });
});
