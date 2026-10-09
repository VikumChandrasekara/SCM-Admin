import { describe, expect, it } from 'vitest';

import { ROLES, ROLE_IDS, hasWageRate, isStaffRole, personFrom, roleById } from '../src/lib/model';

describe('the landowner’s account', () => {
  it('is a role of its own, offered when an account is made', () => {
    expect(ROLE_IDS).toContain('landowner');
    expect(ROLES.landowner.label).toBe('ඉඩම් හිමියා');
    expect(roleById('landowner')).toBe('landowner');
    // Anything unrecognised still opens the excavator crew's console.
    expect(roleById('owner')).toBe('operator');
    expect(roleById(undefined)).toBe('operator');
  });

  it('is neither crew nor staff, and has no machine, wage or service to keep', () => {
    expect(ROLES.landowner.isCrew).toBe(false);
    expect(isStaffRole('landowner')).toBe(false);
    expect(hasWageRate('landowner')).toBe(false);
    expect(ROLES.landowner.serviceTasks).toEqual([]);
    expect(ROLES.landowner.fillItems).toEqual([]);
  });

  it('is read from his record like anyone else’s, and sorts after the crews and staff', () => {
    const landowner = personFrom('land1', { name: 'Kasun', username: 'kasun', role: 'landowner' });
    expect(landowner).toMatchObject({ id: 'land1', role: 'landowner', machineId: '', dailyWage: 0 });
    expect(ROLE_IDS.indexOf('landowner')).toBeGreaterThan(ROLE_IDS.indexOf('admin'));
  });
});
