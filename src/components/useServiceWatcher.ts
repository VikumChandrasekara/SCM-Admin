import { useEffect, useRef } from 'react';

import {
  ROLES,
  serviceMessage,
  serviceStatus,
  type Machine,
  type Person,
  type ServiceStatus,
} from '../lib/model';
import { useToast } from './Toasts';

type ServiceState = 'ok' | 'soon' | 'due';

const severity: Record<ServiceState, number> = { ok: 0, soon: 1, due: 2 };

function stateOf(status: ServiceStatus | null): ServiceState {
  if (!status) return 'ok';
  return status.isDue ? 'due' : status.isDueSoon ? 'soon' : 'ok';
}

/**
 * Speaks up the moment a part on a crew's machine comes within its 50 hour
 * warning, or goes past due, while the panel is open — as a toast, and as a
 * browser notification when the person has allowed them. The same moments the
 * push worker sends to the phones (tool/push-worker in the SCM project).
 *
 * What already stood when the panel opened is left to the alerts bell, and
 * each state is announced once: a part inside its window stays quiet as the
 * meter creeps on.
 */
export function useServiceWatcher(
  crew: readonly Person[],
  machines: Map<string, Machine>,
  ready: boolean,
): void {
  const toast = useToast();
  const previous = useRef<Map<string, ServiceState> | null>(null);

  useEffect(() => {
    if (!ready) return;

    // One entry per part per machine, judged over the parts its crew has: a
    // compressor has no hydraulic filter.
    const current = new Map<string, { state: ServiceState; status: ServiceStatus | null; machineId: string }>();
    for (const person of crew) {
      const machine = machines.get(person.machineId);
      if (!machine) continue;
      for (const task of ROLES[person.role].serviceTasks) {
        const key = `${machine.id}:${task}`;
        if (current.has(key)) continue;
        const status = serviceStatus(machine, task);
        current.set(key, { state: stateOf(status), status, machineId: machine.id });
      }
    }

    const before = previous.current;
    previous.current = new Map([...current].map(([key, entry]) => [key, entry.state]));
    if (!before) return;

    for (const [key, { state, status, machineId }] of current) {
      const was = before.get(key) ?? 'ok';
      if (!status || severity[state] <= severity[was]) continue;

      const message = `${machineId} — ${serviceMessage(status)}`;
      if (state === 'due') toast.error(message);
      else toast.warning(message);

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(state === 'due' ? 'සේවා කාලය ඉක්මවා ඇත' : 'සේවා අවවාදය', {
          body: message,
          tag: `service-${key}`,
        });
      }
    }
  }, [crew, machines, ready, toast]);
}
