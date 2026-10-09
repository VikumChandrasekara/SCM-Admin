import { describe, expect, it } from 'vitest';

import { serviceAlertsFor } from '../src/lib/alerts';
import {
  LINK_OPTIONS,
  ROLES,
  SERVICE,
  isStockLink,
  machineFrom,
  serviceAlerts,
  serviceDoneLabel,
  serviceMessage,
  serviceNextLabel,
  serviceStatus,
  type Machine,
  type Person,
} from '../src/lib/model';

/** A machine whose meter reads [totalHours] and whose services fall due at [serviceDueAt]. */
const machineAt = (totalHours: number, serviceDueAt: Record<string, number> = {}): Machine =>
  machineFrom('ex1', { totalHours, serviceDueAt });

const kamal: Person = {
  id: 'kamal',
  name: 'Kamal',
  username: 'kamal',
  machineId: 'ex1',
  role: 'operator',
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
};

describe('the 10,000 hour service', () => {
  it('comes every 10,000 hours and is tracked for both crews', () => {
    expect(SERVICE.majorService.interval).toBe(10000);
    expect(ROLES.operator.serviceTasks).toContain('majorService');
    expect(ROLES.compressor.serviceTasks).toContain('majorService');
    expect(ROLES.supervisor.serviceTasks).toEqual([]);
  });

  it('is read off the machine like any other service', () => {
    expect(machineAt(9000, { majorService: 10000 }).serviceDueAt.majorService).toBe(10000);
  });

  it('says nothing while the service has not been set up — never a confident "overdue"', () => {
    expect(serviceStatus(machineAt(8500), 'majorService')).toBeNull();
    expect(serviceAlerts(machineAt(8500), ROLES.operator.serviceTasks)).toEqual([]);
  });

  it('is flagged 500 hours before it falls due — not the 50 a part gets', () => {
    const due = { majorService: 10000 };
    expect(serviceStatus(machineAt(9499, due), 'majorService')).toMatchObject({ remaining: 501, isDueSoon: false });
    expect(serviceStatus(machineAt(9500, due), 'majorService')).toMatchObject({ remaining: 500, isDueSoon: true });
    expect(serviceStatus(machineAt(9990, due), 'majorService')).toMatchObject({ remaining: 10, isDueSoon: true });
  });

  it('is due once the meter reaches it, and overdue past it', () => {
    const due = { majorService: 10000 };
    expect(serviceStatus(machineAt(10000, due), 'majorService')).toMatchObject({ isDue: true, isDueSoon: false });
    expect(serviceStatus(machineAt(10050, due), 'majorService')).toMatchObject({ remaining: -50, isDue: true });
  });

  it('leaves a part change at its 50 hour warning', () => {
    const due = { engineOil: 1000 };
    expect(serviceStatus(machineAt(949, due), 'engineOil')).toMatchObject({ isDueSoon: false });
    expect(serviceStatus(machineAt(950, due), 'engineOil')).toMatchObject({ isDueSoon: true });
  });

  it('puts the most urgent of a machine’s alerts first', () => {
    const machine = machineAt(9700, { engineOil: 9720, majorService: 10000 });
    const alerts = serviceAlerts(machine, ROLES.operator.serviceTasks);
    expect(alerts.map((alert) => alert.task)).toEqual(['engineOil', 'majorService']);
  });

  it('shows up in the alerts bell for the crew on the machine', () => {
    const machines = new Map([['ex1', machineAt(9600, { majorService: 10000 })]]);
    const [alert] = serviceAlertsFor([kamal], machines);
    expect(alert.status).toMatchObject({ task: 'majorService', remaining: 400 });
  });

  it('is not hidden by an overdue part on the same machine', () => {
    const machines = new Map([['ex1', machineAt(9600, { engineOil: 9590, majorService: 10000 })]]);
    const alerts = serviceAlertsFor([kamal], machines);
    expect(alerts.map((alert) => alert.status.task)).toEqual(['engineOil', 'majorService']);
    expect(alerts.every((alert) => alert.machine.id === 'ex1')).toBe(true);
  });

  it('is worded as a service, not a part change', () => {
    const due = { majorService: 10000 };
    expect(serviceMessage(serviceStatus(machineAt(9600, due), 'majorService')!)).toBe(
      '10,000 පැය සේවාවට තව පැය 400 යි',
    );
    expect(serviceMessage(serviceStatus(machineAt(10020, due), 'majorService')!)).toBe(
      '10,000 පැය සේවාව පැය 20 කින් ප්‍රමාද වී ඇත',
    );
    expect(serviceMessage(serviceStatus(machineAt(1180, { engineOil: 1200 }), 'engineOil')!)).toBe(
      'එන්ජින් ඔයිල් මාරු කිරීමට තව පැය 20 යි',
    );
    expect(serviceDoneLabel('majorService')).toBe('සේවාව කළා');
    expect(serviceDoneLabel('engineOil')).toBe('මාරු කළා');
    expect(serviceNextLabel('majorService')).toBe('ඊළඟ සේවාව');
    expect(serviceNextLabel('engineOil')).toBe('ඊළඟ මාරුව');
  });

  it('has no part for the store to give out', () => {
    expect(LINK_OPTIONS.some((option) => option.link.startsWith('service:'))).toBe(true);
    expect(LINK_OPTIONS.map((option) => option.link)).not.toContain('service:majorService');
    expect(isStockLink('service:majorService')).toBe(false);
    expect(isStockLink('service:engineOil')).toBe(true);
  });
});
