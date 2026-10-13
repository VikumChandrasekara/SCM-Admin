import {
  LINK_OPTIONS,
  ROLES,
  serviceAlerts,
  stockStatus,
  type LinkOption,
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
 * What the crews record that no store item is linked to, so recording it takes
 * nothing off the shelf: the fluids a crew's පිරවීම draws, and — when there is
 * a driller — everything on the වෙඩි බඩු sheet, බිට් and කටු included. Parts
 * fitted at a service are left out: they come off the shelf when staff mark
 * the service done, not when a crew records anything.
 */
export function unlinkedUsage(store: readonly StoreItem[], crew: readonly Person[]): LinkOption[] {
  const linked = new Set(store.map((item) => item.link));
  const fluids = new Set<string>(crew.flatMap((person) => ROLES[person.role].fillItems));
  const blasts = crew.some((person) => ROLES[person.role].tracksBlasting);
  return LINK_OPTIONS.filter((option) => {
    if (linked.has(option.link)) return false;
    if (option.link.startsWith('fill:')) return fluids.has(option.link.slice('fill:'.length));
    if (option.link.startsWith('blast:')) return blasts;
    return false;
  });
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
