import { describe, expect, it } from 'vitest';

import { emptyDay, monthFrom, personFrom, type Person, type Sale, type SaleMaterial } from '../src/lib/model';
import { payFor } from '../src/lib/pay';

const now = new Date('2026-10-25T12:00:00Z').getTime();
const today = '2026-10-25';
const month = '2026-10';

const person = (role: Person['role'], extra: Partial<Person> = {}): Person => ({
  id: 'p1',
  name: 'Ruwan',
  username: 'ruwan',
  machineId: role === 'compressor' ? 'cp1' : 'ex1',
  role,
  advanceAmount: 0,
  dailyWage: 0,
  wageBasis: 'day',
  sakkaLoadWage: 0,
  boldasLoadWage: 0,
  c1LoadWage: 0,
  ...extra,
});

const sale = (code: string, material: SaleMaterial | null, loads: number, overrides: Partial<Sale> = {}): Sale => ({
  code,
  material,
  paymentType: 'cash',
  prepaid: false,
  customerKey: 'silva',
  machineCharge: null,
  number: 1,
  // A tractor bill is as many loads as it says; a tipper bill is one trip.
  type: 'tractor',
  quantity: loads,
  unitPrice: 6500,
  amount: 6500 * loads,
  customerName: 'Silva',
  customerPhone: '',
  vehicleNo: '',
  note: '',
  date: '2026-10-12',
  status: 'verified',
  createdBy: 'u1',
  createdByName: '',
  createdAt: new Date('2026-10-12T06:00:00Z'),
  verifiedBy: 'u1',
  verifiedByName: '',
  verifiedAt: new Date('2026-10-12T07:00:00Z'),
  cancelledAt: null,
  // Whose loads the bills are: the one person these tests pay, unless a test says otherwise.
  operatorId: 'p1',
  operatorName: '',
  drillerId: 'p1',
  drillerName: '',
  ...overrides,
});

const tally = (loads = 0, feet = 0) => monthFrom(month, { loads, feet, hours: 0 });

const pay = (
  who: Person,
  sales: Sale[],
  extra: { loads?: number; feet?: number; day?: ReturnType<typeof emptyDay> | null } = {},
) => payFor(who, [], tally(extra.loads, extra.feet), [], extra.day ?? null, today, sales, now);

describe('a driller paid per load', () => {
  const driller = person('compressor', {
    wageBasis: 'load',
    dailyWage: 500,
    sakkaLoadWage: 450,
    boldasLoadWage: 300,
    c1LoadWage: 250,
  });

  it('is paid each kind of load at its own rate, and nothing for any other', () => {
    const figures = pay(driller, [
      sale('SIX00001', 'six_nine', 10),
      sale('SAK00001', 'sakka', 2),
      sale('BOL00001', 'boldas', 1),
      sale('CON00001', 'c1', 3),
      // කෝරි ඩස්ට්, and a bill from before materials were recorded, are not paid for.
      sale('DUS00001', 'kory_dust', 4),
      sale('OLD00001', null, 2),
    ]);

    expect(figures.loadPay?.lines).toEqual([
      { label: '6/9', loads: 10, rate: 500, pay: 5000 },
      { label: 'සක්කර', loads: 2, rate: 450, pay: 900 },
      { label: 'බෝල්දාස්', loads: 1, rate: 300, pay: 300 },
      { label: 'C1', loads: 3, rate: 250, pay: 750 },
    ]);
    expect(figures.wageUnits).toBe(16);
    expect(figures.wagePay).toBe(6950);
    expect(figures.gross).toBe(6950);
  });

  it('is not paid for a load that has not gone, for another month, or for the crew tally', () => {
    const figures = pay(
      driller,
      [
        sale('SIX00001', 'six_nine', 3),
        sale('WAIT0001', 'six_nine', 5, {
          status: 'pending',
          verifiedAt: null,
          createdAt: new Date(now - 60 * 60 * 1000),
        }),
        sale('CANC0001', 'six_nine', 5, { status: 'cancelled' }),
        sale('LAST0001', 'six_nine', 5, { date: '2026-09-28' }),
      ],
      // The day tally the crew's loads used to be paid from no longer counts.
      { loads: 400 },
    );

    expect(figures.loadPay).toMatchObject({ loads: 3, pay: 1500 });
    expect(figures.wagePay).toBe(1500);
  });

  it('is paid nothing for a kind of load until its rate is set', () => {
    const figures = pay(person('compressor', { wageBasis: 'load', dailyWage: 500 }), [
      sale('SIX00001', 'six_nine', 2),
      sale('BOL00001', 'boldas', 6),
      sale('SAK00001', 'sakka', 1),
    ]);
    expect(figures.loadPay).toMatchObject({ loads: 9, pay: 1000 });
    expect(figures.loadPay?.lines[2]).toEqual({ label: 'බෝල්දාස්', loads: 6, rate: 0, pay: 0 });
    expect(figures.wagePay).toBe(1000);
  });

  it('has no loads, and no pay, in a month with no sales', () => {
    const figures = pay(driller, []);
    expect(figures.loadPay).toMatchObject({ loads: 0, pay: 0 });
    expect(figures.loadPay?.lines.every((line) => line.loads === 0 && line.pay === 0)).toBe(true);
    expect(figures.gross).toBe(0);
  });

  it("earns the day's loads for the day", () => {
    const sales = [
      sale('SIX00001', 'six_nine', 4, { date: '2026-10-12' }),
      sale('BOL00001', 'boldas', 2, { date: '2026-10-12' }),
      sale('SIX00002', 'six_nine', 9, { date: '2026-10-13' }),
    ];
    expect(pay(driller, sales, { day: emptyDay('2026-10-12') }).dayEarnings).toBe(4 * 500 + 2 * 300);
    expect(pay(driller, sales, { day: emptyDay('2026-10-14') }).dayEarnings).toBe(0);
    expect(pay(driller, sales).dayEarnings).toBe(0);
  });

  it('is deducted from like anyone else', () => {
    const figures = payFor(
      driller,
      [],
      tally(),
      [
        {
          id: 'b1',
          category: 'advance',
          amount: 1000,
          date: '2026-10-05',
          note: '',
          operatorId: 'p1',
          operatorName: 'Ruwan',
          createdBy: 'u1',
          createdByName: '',
          createdAt: null,
        },
      ],
      null,
      today,
      [sale('SIX00001', 'six_nine', 4)],
      now,
    );
    expect(figures.gross).toBe(2000);
    expect(figures.deductions).toBe(1000);
    expect(figures.net).toBe(1000);
  });

  it('is not deducted from for food — only advances come off the pay', () => {
    const bill = (id: string, category: 'advance' | 'food', amount: number) => ({
      id,
      category,
      amount,
      date: '2026-10-05',
      note: '',
      operatorId: 'p1',
      operatorName: 'Ruwan',
      createdBy: 'u1',
      createdByName: '',
      createdAt: null,
    });
    const figures = payFor(
      driller,
      [],
      tally(),
      [bill('b1', 'advance', 1000), bill('b2', 'food', 700)],
      null,
      today,
      [sale('SIX00001', 'six_nine', 4)],
      now,
    );
    expect(figures.deductions).toBe(1000);
    expect(figures.net).toBe(1000);
  });
});

describe('a driller saved before each kind of load had a rate', () => {
  const stored = { role: 'compressor', wageBasis: 'load', dailyWage: 500, otherLoadWage: 300 };

  it('is still paid as before: සක්කර at the 6/9 wage, බෝල්දාස් and C1 at the old shared rate', () => {
    const old = personFrom('p1', stored);
    expect(old).toMatchObject({ sakkaLoadWage: 500, boldasLoadWage: 300, c1LoadWage: 300 });
  });

  it('keeps a rate set to nothing as nothing', () => {
    const set = personFrom('p1', { ...stored, sakkaLoadWage: 0, c1LoadWage: 275 });
    expect(set).toMatchObject({ sakkaLoadWage: 0, boldasLoadWage: 300, c1LoadWage: 275 });
  });
});

describe("a driller's bonus", () => {
  const perLoad = person('compressor', { wageBasis: 'load', dailyWage: 500, sakkaLoadWage: 500 });

  it('is counted on the loads of 6/9 alone', () => {
    // 250 of 6/9 and 100 of සක්කර: 350 loads sold, but only 250 are 6/9.
    const figures = pay(perLoad, [sale('SIX00001', 'six_nine', 250), sale('SAK00001', 'sakka', 100)]);
    expect(figures.bonusLoads).toBe(250);
    expect(figures.bonusPay).toBe(0);
    // They are all paid for, at the wage, though.
    expect(figures.wagePay).toBe(350 * 500);
  });

  it('climbs the same ladder as the excavator crew: 300, 400, 500', () => {
    const at = (loads: number) => pay(perLoad, [sale('SIX00001', 'six_nine', loads)]).bonusPay;
    expect(at(299)).toBe(0);
    expect(at(300)).toBe(30_000);
    expect(at(400)).toBe(60_000);
    expect(at(500)).toBe(90_000);
    expect(at(800)).toBe(90_000);
  });

  it('is part of what they are paid', () => {
    const figures = pay(perLoad, [sale('SIX00001', 'six_nine', 300)]);
    expect(figures.wagePay).toBe(150_000);
    expect(figures.bonusPay).toBe(30_000);
    expect(figures.gross).toBe(180_000);
  });

  it('is earned on whatever basis they are paid — a driller paid by the foot gets it too', () => {
    const byFoot = person('compressor', { wageBasis: 'foot', dailyWage: 40 });
    const figures = pay(byFoot, [sale('SIX00001', 'six_nine', 400)], { feet: 1000 });
    expect(figures.loadPay).toBeNull();
    // The wage is still the feet drilled; the sales only feed the bonus.
    expect(figures.wageUnits).toBe(1000);
    expect(figures.wagePay).toBe(40_000);
    expect(figures.bonusLoads).toBe(400);
    expect(figures.bonusPay).toBe(60_000);
  });
});

describe('the excavator crew', () => {
  const operator = person('operator', { wageBasis: 'day', dailyWage: 4000 });

  it('has its loads and bonus from the bills that name it — never from a tally typed in', () => {
    // 300 6/9 loads on bills that name p1; a typed-in tally of 50, a bill for someone else and a load of සක්කර are ignored.
    const figures = pay(
      operator,
      [
        sale('SIX00001', 'six_nine', 300),
        sale('SAK00001', 'sakka', 20),
        sale('OTHER001', 'six_nine', 400, { operatorId: 'p2' }),
      ],
      { loads: 50 },
    );
    expect(figures.bonusLoads).toBe(300);
    expect(figures.bonusPay).toBe(30_000);
    expect(figures.loadPay).toBeNull();
  });

  it('counts the 6/9 loads alone, and only loads that have gone, in this month', () => {
    const figures = pay(operator, [
      sale('SIX00001', 'six_nine', 3),
      sale('SAK00001', 'sakka', 4),
      sale('DUS00001', 'kory_dust', 2),
      sale('OLD00001', null, 1),
      sale('WAIT0001', 'six_nine', 9, { status: 'pending', verifiedAt: null, createdAt: new Date(now - 60 * 60 * 1000) }),
      sale('CANC0001', 'six_nine', 9, { status: 'cancelled' }),
      sale('LAST0001', 'six_nine', 9, { date: '2026-09-28' }),
    ]);
    expect(figures.bonusLoads).toBe(3);
  });

  it('is paid per load on the 6/9 loads of its bills, at the one rate', () => {
    const perLoad = person('operator', { wageBasis: 'load', dailyWage: 500, sakkaLoadWage: 999 });
    const figures = pay(perLoad, [sale('SIX00001', 'six_nine', 8), sale('SAK00001', 'sakka', 2)], { loads: 10_000 });
    // The load rates for the other materials are a driller's; an operator is paid the one rate on a 6/9 load.
    expect(figures.loadPay).toBeNull();
    expect(figures.wageUnits).toBe(8);
    expect(figures.wagePay).toBe(4000);
  });

  it('earns the day’s wage on the loads of that day’s bills', () => {
    const perLoad = person('operator', { wageBasis: 'load', dailyWage: 500 });
    const day = { ...emptyDay('2026-10-12') };
    const figures = pay(
      perLoad,
      [sale('SIX00001', 'six_nine', 3), sale('NEXT0001', 'six_nine', 5, { date: '2026-10-13' })],
      { day },
    );
    expect(figures.dayEarnings).toBe(1500);
  });

  it('counts a bill that names no operator for whoever wrote it, if they are the operator', () => {
    const figures = pay(operator, [
      sale('MINE0001', 'six_nine', 7, { operatorId: '', createdBy: 'p1' }),
      sale('NONE0001', 'six_nine', 5, { operatorId: '', createdBy: 'someone-else' }),
    ]);
    expect(figures.bonusLoads).toBe(7);
  });
});

describe('two operators and two drillers', () => {
  const op1 = person('operator', { id: 'op1', dailyWage: 4000 });
  const op2 = person('operator', { id: 'op2', dailyWage: 4000 });
  const dr1 = person('compressor', { id: 'dr1', wageBasis: 'load', dailyWage: 500 });
  const dr2 = person('compressor', { id: 'dr2', wageBasis: 'load', dailyWage: 500 });
  const bills = [
    sale('A0000001', 'six_nine', 6, { operatorId: 'op1', drillerId: 'dr1' }),
    sale('B0000001', 'six_nine', 4, { operatorId: 'op2', drillerId: 'dr1' }),
    sale('C0000001', 'six_nine', 3, { operatorId: 'op2', drillerId: 'dr2' }),
  ];

  it('each get the loads of the bills that name them, and no one else’s', () => {
    expect(pay(op1, bills).bonusLoads).toBe(6);
    expect(pay(op2, bills).bonusLoads).toBe(7);
    expect(pay(dr1, bills).loadPay?.loads).toBe(10);
    expect(pay(dr2, bills).loadPay?.loads).toBe(3);
    expect(pay(dr1, bills).wagePay).toBe(5000);
  });

  it('are paid nothing for a bill that names neither of them', () => {
    const unnamed = [sale('D0000001', 'six_nine', 5, { operatorId: '', drillerId: '', createdBy: 'boss' })];
    expect(pay(op1, unnamed).bonusLoads).toBe(0);
    expect(pay(dr1, unnamed).loadPay?.loads).toBe(0);
  });
});

describe('everyone else', () => {
  it('has no bonus', () => {
    for (const role of ['supervisor', 'admin'] as const) {
      const figures = pay(person(role, { wageBasis: 'month', dailyWage: 90_000 }), [sale('SIX00001', 'six_nine', 500)]);
      expect(figures.bonusLoads).toBeNull();
      expect(figures.bonusPay).toBe(0);
      expect(figures.wagePay).toBe(90_000);
    }
  });
});
