import { unlinkedUsage } from './alerts';
import type { LinkOption, Person, StockLink, StoreItem } from './model';

/**
 * Tying the store to what the crews record, with no one asked to.
 *
 * A crew's පිරවීම or වෙඩි බඩු sheet draws the store down only through an item
 * that is *linked* to what was used, and a linked item has to live at an id its
 * link fixes — which is why a link cannot be added to an item afterwards. A
 * store set up before that, or by hand, therefore has the right items with
 * nothing tied to them, and nothing was coming off the shelf.
 *
 * So the panel does the tying itself: an item whose name plainly stands for
 * one of the uses is moved to the id its link needs, count and all, and any
 * use with no such item gets an item of its own to draw from.
 */

/**
 * What a store item for each use is likely to be called, beside the name the
 * panel gives it. Compared with spaces, brackets and punctuation left out.
 */
const ALIASES: Partial<Record<StockLink, readonly string[]>> = {
  'fill:diesel': ['ඩීසල්', 'diesel'],
  'fill:hydraulic': ['හයිඩ්‍රොලික්', 'හයිඩ්‍රොලික් ඔයිල්', 'hydraulic', 'hydraulic oil'],
  'fill:compressorOil': ['කම්පසර් ඔයිල්', 'කම්ප්‍රසර් ඔයිල්', 'compressor oil'],
  'fill:engineOil': ['එන්ජින් ඔයිල්', 'එංජින් ඔයිල්', 'engine oil'],
  'fill:coolant': ['කුලන්ට්', 'කූලන්ට්', 'coolant'],
  'blast:shells': ['වෙඩි කරල්', 'කරල්', 'shells', 'gel'],
  'blast:caps': ['කැප්', 'කැප්ස්', 'caps', 'cap'],
  'blast:blastingWire': ['වෙඩි නූල්', 'නූල්', 'blasting wire', 'wire'],
  'blast:ammonia': ['ඇමෝනියා', 'ammonia'],
  'blast:yaramila': ['යාරමීලා', 'යාරමිලා', 'yaramila'],
  'blast:blastPowder': ['වෙඩි කුඩු', 'blast powder', 'powder'],
  'blast:dieselMix': ['ඩීසල් මිශ්‍ර', 'diesel mix'],
  'blast:bits': ['බිට්', 'බිට්ස්', 'bit', 'bits'],
  'blast:rods': ['කටු', 'rod', 'rods'],
};

/** [name] as it is compared: lower case, no brackets and their contents, no spaces, punctuation or joiners. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

/** One use with no store item, and the existing item that should become it — if there is one. */
export interface LinkPlan {
  option: LinkOption;
  /** An item that is not linked yet and is plainly this one; null when there is none, or more than one. */
  adopt: StoreItem | null;
}

/**
 * What to do so every use the crews record has an item to draw from. Nothing,
 * once it has.
 *
 * An item is only adopted when exactly one unlinked item carries a name for
 * the use — two of them is a guess, so the use gets a fresh item instead and
 * the others are left as they are.
 */
export function planLinks(store: readonly StoreItem[], crew: readonly Person[]): LinkPlan[] {
  const loose = store.filter((item) => item.link == null);
  const taken = new Set<string>();

  return unlinkedUsage(store, crew).map((option) => {
    const names = new Set([...(ALIASES[option.link] ?? []), option.label].map(normalizeName));
    const matches = loose.filter((item) => !taken.has(item.id) && names.has(normalizeName(item.name)));
    const adopt = matches.length === 1 ? matches[0] : null;
    if (adopt) taken.add(adopt.id);
    return { option, adopt };
  });
}
