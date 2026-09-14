import { useEffect, useMemo, useRef } from 'react';

import { db } from '../db';
import { addDays } from '../lib/format';
import { dayFrom, nameOf, type Person } from '../lib/model';
import { postUsage, usageId, usagesOf } from '../lib/usage';
import { useToday } from '../lib/useToday';
import { useLiveDocs } from './live';
import { dayRef } from './machines';

/**
 * The panel's half of keeping the store in step with what the crews record.
 *
 * Watches today and yesterday on every crew machine and posts any locked
 * පිරවීම slot or වෙඩි බඩු sheet the operator app has not posted itself. Older
 * days are left alone: by then the shelf has been counted, and a late
 * posting would take the same fuel off twice.
 */
export function useUsageReconciler(crew: readonly Person[], me: Person): void {
  const today = useToday();
  const yesterday = addDays(today, -1);

  const refs = useMemo(
    () =>
      crew
        .filter((person) => person.machineId)
        .flatMap((person) => [dayRef(person.machineId, yesterday), dayRef(person.machineId, today)]),
    [crew, today, yesterday],
  );
  const days = useLiveDocs(refs, (snapshot) => dayFrom(snapshot.id, snapshot.data()));

  // Each posting is tried once per session; the rules refuse a second anyway.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    for (const person of crew) {
      if (!person.machineId) continue;
      for (const date of [yesterday, today]) {
        const day = days[dayRef(person.machineId, date).path];
        if (!day) continue;
        for (const usage of usagesOf(day)) {
          const id = usageId(person.machineId, date, usage.source);
          if (attempted.current.has(id)) continue;
          attempted.current.add(id);
          postUsage(db, {
            machineId: person.machineId,
            date,
            usage,
            person,
            by: { uid: me.id, name: nameOf(me) },
          }).catch((error: { code?: string }) => {
            // Refused means someone else posted it first. Anything else — a
            // dropped connection — is worth another go on the next update.
            if (error?.code !== 'permission-denied') attempted.current.delete(id);
          });
        }
      }
    }
  }, [crew, days, today, yesterday, me]);
}
