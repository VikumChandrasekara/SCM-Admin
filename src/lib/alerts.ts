import {
  ROLES,
  serviceAlerts,
  stockStatus,
  type Machine,
  type Person,
  type ServiceStatus,
  type StockStatus,
  type StoreItem,
} from './model';

export interface StockAlert {
  item: StoreItem;
  status: Exclude<StockStatus, 'ok'>;
}

export interface ServiceAlert {
  person: Person;
  machine: Machine;
  /** The part or service that needs attention. */
  status: ServiceStatus;
}

/** Out of stock first, then low, each by name. */
export function stockAlerts(store: readonly StoreItem[]): StockAlert[] {
  return store
    .flatMap((item): StockAlert[] => {
      const status = stockStatus(item);
      return status === 'ok' ? [] : [{ item, status }];
    })
    .sort((a, b) =>
      a.status === b.status ? a.item.name.localeCompare(b.item.name) : a.status === 'out' ? -1 : 1,
    );
}

/**
 * One line for every part or service on a crew machine that needs attention,
 * most urgent first. Every one, not just the machine's most urgent: an overdue
 * oil change must not hide that the 10,000 hour service is coming up.
 */
export function serviceAlertsFor(
  crew: readonly Person[],
  machines: Map<string, Machine>,
): ServiceAlert[] {
  const seen = new Set<string>();
  const alerts: ServiceAlert[] = [];
  for (const person of crew) {
    const machine = machines.get(person.machineId);
    if (!machine || seen.has(machine.id)) continue;
    seen.add(machine.id);
    // A compressor has no hydraulic filter, so only the crew's own parts count.
    for (const status of serviceAlerts(machine, ROLES[person.role].serviceTasks)) {
      alerts.push({ person, machine, status });
    }
  }
  return alerts.sort((a, b) => a.status.remaining - b.status.remaining);
}
