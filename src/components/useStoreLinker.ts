import { useEffect, useRef, useState } from 'react';

import { linkStoreItem } from '../data/store';
import { errorMessage } from '../lib/errors';
import type { Person, StockLink, StoreItem } from '../lib/model';
import { planLinks } from '../lib/storeLink';
import { useToast } from './Toasts';

/**
 * How long the crew and the store must stand still before anything is tied.
 * The panel's data arrives in pieces — from the phone's cache first, then the
 * server — and acting on the first piece would miss, or wrongly make, items.
 */
const SETTLE_MS = 1500;

/**
 * Keeps every fluid and every වෙඩි බඩු item the crews record tied to a store
 * item, so recording it takes it off the shelf without anyone setting that up.
 *
 * Runs for as long as the panel is open, so a crew added later, or an item
 * deleted, is dealt with at once. Each use is tried once a session: a refusal
 * is told to the person, not retried in a loop.
 *
 * The count of a new item starts at 0 — the panel cannot know what is on the
 * shelf — so the toast says to count it.
 *
 * Returns whether that is done for now. The usage the crews have recorded is
 * posted only then (see useUsageReconciler): posted a moment sooner, it would
 * find some items tied and some not, and take its share from half of them.
 */
export function useStoreLinker(
  store: readonly StoreItem[],
  crew: readonly Person[],
  me: Person,
  ready: boolean,
): boolean {
  const toast = useToast();
  const attempted = useRef(new Set<StockLink>());
  const inFlight = useRef(0);
  const [working, setWorking] = useState(false);

  const waiting = ready && planLinks(store, crew).some((plan) => !attempted.current.has(plan.option.link));

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const todo = planLinks(store, crew).filter((plan) => !attempted.current.has(plan.option.link));
      if (todo.length === 0) return;
      for (const plan of todo) attempted.current.add(plan.option.link);

      inFlight.current += 1;
      setWorking(true);
      void (async () => {
        const adopted: string[] = [];
        const created: string[] = [];
        // Each use is its own item, so they go at once rather than one after another.
        await Promise.all(
          todo.map(async (plan) => {
            try {
              const result = await linkStoreItem(plan, me);
              if (result === 'adopted') adopted.push(plan.option.label);
              if (result === 'created') created.push(plan.option.label);
            } catch (failure) {
              toast.error(`${plan.option.label}: ගබඩා අයිතමය සම්බන්ධ කළ නොහැකි විය — ${errorMessage(failure)}`);
            }
          }),
        );
        if (adopted.length > 0) {
          toast.success(
            `ගබඩා අයිතම ${adopted.length}ක් කණ්ඩායම් භාවිතයට සම්බන්ධ කළා — දැන් භාවිත කරන විට තොගයෙන් ස්වයංක්‍රීයව අඩු වේ: ${adopted.join(', ')}.`,
          );
        }
        if (created.length > 0) {
          toast.warning(
            `ගබඩාවේ නොතිබූ අයිතම ${created.length}ක් ප්‍රමාණය 0 ලෙස සෑදුවා: ${created.join(', ')}. ඉතිරි ප්‍රමාණය ගණන් කර (ගණන් කළා) යාවත්කාලීන කරන්න.`,
          );
        }
        inFlight.current -= 1;
        if (inFlight.current === 0) setWorking(false);
      })();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [store, crew, me, ready, toast]);

  return ready && !working && !waiting;
}
