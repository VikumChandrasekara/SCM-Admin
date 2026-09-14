import { useEffect, useRef } from 'react';

import { quantity } from '../lib/format';
import { stockStatus, type StockStatus, type StoreItem } from '../lib/model';
import { useToast } from './Toasts';

const severity: Record<StockStatus, number> = { ok: 0, low: 1, out: 2 };

/**
 * Speaks up the moment an item runs low or out while the panel is open —
 * as a toast, and as a desktop notification when the browser allows one.
 * What already stood when the panel opened is left to the alerts bell.
 */
export function useStockWatcher(store: readonly StoreItem[], ready: boolean): void {
  const toast = useToast();
  const previous = useRef<Map<string, StockStatus> | null>(null);

  useEffect(() => {
    if (!ready) return;
    const current = new Map(store.map((item) => [item.id, stockStatus(item)]));
    const before = previous.current;
    previous.current = current;
    if (!before) return;

    for (const item of store) {
      const now = current.get(item.id) ?? 'ok';
      const was = before.get(item.id) ?? 'ok';
      if (severity[now] <= severity[was]) continue;

      const message =
        now === 'out'
          ? `${item.name} තොග අවසන් විය`
          : `${item.name} තොග අඩුයි — ඉතිරි ${quantity(item.quantity, item.unit)}`;
      toast.warning(message);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('SCM ගබඩාව', { body: message, tag: `stock-${item.id}` });
      }
    }
  }, [store, ready, toast]);
}
