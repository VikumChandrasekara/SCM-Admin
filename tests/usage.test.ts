import { describe, expect, it } from 'vitest';

import { unlinkedUsage } from '../src/lib/alerts';
import {
  BLAST_ITEMS,
  LINK_OPTIONS,
  emptyDay,
  isStockLink,
  sourceLabel,
  usageInStoreUnit,
  type Day,
  type Person,
  type StockLink,
  type StoreItem,
} from '../src/lib/model';
import { usagesOf } from '../src/lib/usage';

const locked = new Date('2026-10-12T11:00:00Z');

function sheet(blasting: Partial<Day['blasting']>): Day {
  return { ...emptyDay('2026-10-12'), blasting: { amounts: {}, sizes: {}, lockedAt: locked, ...blasting } };
}

describe('what a වෙඩි බඩු sheet draws from the store', () => {
  it('draws nothing until the sheet is OK’d', () => {
    expect(usagesOf(sheet({ amounts: { caps: 10 }, sizes: { bits: { '36': 4 } }, lockedAt: null }))).toEqual([]);
  });

  it('posts the sheet’s items, and its බිට් and කටු on their own', () => {
    const usages = usagesOf(
      sheet({
        amounts: { shells: 40, caps: 12 },
        sizes: { bits: { '36': 4, '38': 4 }, rods: { '5': 3 } },
      }),
    );

    expect(usages.map((usage) => usage.source)).toEqual(['blast', 'blastSizes']);
    expect(usages[0].amounts).toEqual({ 'blast:shells': 40, 'blast:caps': 12 });
    // Every size of a kind comes off the one shelf item.
    expect(usages[1].amounts).toEqual({ 'blast:bits': 8, 'blast:rods': 3 });
    expect(usages[1].lockedAt).toBe(locked);
  });

  it('posts බිට් and කටු even when nothing else was drawn', () => {
    const usages = usagesOf(sheet({ sizes: { rods: { '2.5': 2, '10': 1 } } }));
    expect(usages.map((usage) => usage.source)).toEqual(['blastSizes']);
    expect(usages[0].amounts).toEqual({ 'blast:rods': 3 });
  });

  it('posts no බිට් or කටු when none were drawn, so the rest of the sheet posts exactly as before', () => {
    const usages = usagesOf(sheet({ amounts: { caps: 5 }, sizes: { bits: {}, rods: { '8': 0 } } }));
    expect(usages.map((usage) => usage.source)).toEqual(['blast']);
  });

  it('keeps the two postings under ids of their own, so neither can draw the other’s twice', () => {
    const [blast, sizes] = usagesOf(sheet({ amounts: { caps: 5 }, sizes: { bits: { '36': 1 } } }));
    expect(blast.source).not.toBe(sizes.source);
    expect(sourceLabel('blastSizes')).toBe('බිට් සහ කටු');
  });

  it('takes a count off the shelf as it is, not converted like the wire', () => {
    expect(usageInStoreUnit('blast:bits', 'ගණන', 8)).toBe(8);
    expect(usageInStoreUnit('blast:rods', 'ගණන', 3)).toBe(3);
  });
});

describe('the store items a crew’s use can be linked to', () => {
  it('include බිට් and කටු, beside the rest of the වෙඩි බඩු sheet', () => {
    const blast = LINK_OPTIONS.filter((option) => option.group === 'වෙඩි බඩු').map((option) => option.link);
    expect(blast).toEqual([...BLAST_ITEMS.map((item) => `blast:${item}`), 'blast:bits', 'blast:rods']);
    expect(isStockLink('blast:bits')).toBe(true);
    expect(isStockLink('blast:rods')).toBe(true);
    expect(isStockLink('blast:bits36')).toBe(false);
  });
});

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

const item = (link: StockLink | null): StoreItem => ({
  id: link ? link.replace(':', '-') : 'grease',
  name: link ?? 'Grease',
  unit: 'ගණන',
  quantity: 10,
  minQuantity: 2,
  unitPrice: 100,
  piecesPerKg: null,
  link,
  note: '',
  createdAt: null,
  countedAt: null,
  updatedAt: null,
});

describe('what the crews record that no store item is linked to', () => {
  const crew = [person('op1', 'operator'), person('dr1', 'compressor')];
  const links = (store: StoreItem[], who = crew) => unlinkedUsage(store, who).map((option) => option.link);

  it('lists the fluids each kind of crew draws and everything a driller records on the sheet', () => {
    const missing = links([]);
    // The excavator crew's hydraulic oil and the driller's compressor oil, both.
    expect(missing).toContain('fill:hydraulic');
    expect(missing).toContain('fill:compressorOil');
    expect(missing).toContain('fill:diesel');
    for (const blast of BLAST_ITEMS) expect(missing).toContain(`blast:${blast}`);
    expect(missing).toContain('blast:bits');
    expect(missing).toContain('blast:rods');
  });

  it('leaves out what has an item, and the parts fitted at a service', () => {
    const missing = links([item('fill:diesel'), item('blast:shells'), item('blast:bits')]);
    expect(missing).not.toContain('fill:diesel');
    expect(missing).not.toContain('blast:shells');
    expect(missing).not.toContain('blast:bits');
    expect(missing).toContain('blast:rods');
    expect(missing.some((link) => link.startsWith('service:'))).toBe(false);
  });

  it('is empty once every one is linked', () => {
    const all = LINK_OPTIONS.map((option) => item(option.link));
    expect(links(all)).toEqual([]);
  });

  it('asks nothing of the sheet when there is no driller, nor of the oil nobody draws', () => {
    const operatorsOnly = links([], [person('op1', 'operator')]);
    expect(operatorsOnly.some((link) => link.startsWith('blast:'))).toBe(false);
    expect(operatorsOnly).not.toContain('fill:compressorOil');

    const drillersOnly = links([], [person('dr1', 'compressor')]);
    expect(drillersOnly).toContain('blast:bits');
    expect(drillersOnly).not.toContain('fill:hydraulic');
  });

  it('asks nothing for staff, who record nothing', () => {
    expect(links([], [person('sup1', 'supervisor'), person('admin1', 'admin')])).toEqual([]);
  });
});
