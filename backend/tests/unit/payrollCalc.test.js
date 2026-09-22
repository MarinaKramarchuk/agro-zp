import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcAmounts, round2 } from '../../src/services/payrollCalc.js';

const baseRate = (overrides = {}) => ({
  unit: 'ha',
  rate: 0,
  secondary_unit: null,
  secondary_rate: 0,
  is_manual: 0,
  raw_text: null,
  ...overrides,
});

describe('payrollCalc.calcAmounts — прості одиниці', () => {
  it('га: сума = rate * area_ha', () => {
    const calc = calcAmounts({ rate: baseRate({ rate: 120 }), input: { area_ha: 5 } });
    assert.equal(calc.quantity, 5);
    assert.equal(calc.total_amount, 600);
  });

  it('тонни: рахує від tons', () => {
    const calc = calcAmounts({ rate: baseRate({ unit: 'ton', rate: 50 }), input: { tons: 4 } });
    assert.equal(calc.quantity, 4);
    assert.equal(calc.total_amount, 200);
  });

  it('км: рахує від distance_km', () => {
    const calc = calcAmounts({ rate: baseRate({ unit: 'km', rate: 15 }), input: { distance_km: 10 } });
    assert.equal(calc.total_amount, 150);
  });

  it('т·км: кількість = distance_km * cargo_tons', () => {
    const calc = calcAmounts({
      rate: baseRate({ unit: 'tkm', rate: 2 }),
      input: { distance_km: 100, cargo_tons: 3 },
    });
    assert.equal(calc.quantity, 300);
    assert.equal(calc.total_amount, 600);
  });

  it('т·км: округлює кількість до 4 знаків', () => {
    const calc = calcAmounts({
      rate: baseRate({ unit: 'tkm', rate: 1 }),
      input: { distance_km: 3.33333, cargo_tons: 2 },
    });
    assert.equal(calc.quantity, 6.6667);
  });

  it('години / ходка / тюк / день: рахують від відповідного показника', () => {
    assert.equal(
      calcAmounts({ rate: baseRate({ unit: 'hour', rate: 60 }), input: { hours: 8 } }).total_amount,
      480,
    );
    assert.equal(
      calcAmounts({ rate: baseRate({ unit: 'trip', rate: 300 }), input: { trips: 2 } }).total_amount,
      600,
    );
    assert.equal(
      calcAmounts({ rate: baseRate({ unit: 'bale', rate: 5 }), input: { bales: 40 } }).total_amount,
      200,
    );
    assert.equal(
      calcAmounts({ rate: baseRate({ unit: 'day', rate: 700 }), input: { days: 2 } }).total_amount,
      1400,
    );
  });
});

describe('payrollCalc.calcAmounts — складені тарифи (secondary)', () => {
  it('"72,5 грн/год + 5 грн/т": додає другу складову до суми', () => {
    const calc = calcAmounts({
      rate: baseRate({ unit: 'hour', rate: 72.5, secondary_unit: 'ton', secondary_rate: 5 }),
      input: { hours: 8, tons: 2 },
    });
    assert.equal(calc.quantity, 8);
    assert.equal(calc.secondary_quantity, 2);
    assert.equal(calc.total_amount, 590); // 72.5*8 + 5*2
  });

  it('вимагає показники і основної, і другорядної одиниці', () => {
    assert.throws(
      () =>
        calcAmounts({
          rate: baseRate({ unit: 'hour', rate: 72.5, secondary_unit: 'ton', secondary_rate: 5 }),
          input: { hours: 8 }, // tons відсутні
        }),
      /tons|Вага/i,
    );
  });
});

describe('payrollCalc.calcAmounts — валідація показників', () => {
  it('кидає 422, якщо не вистачає обов’язкового показника', () => {
    assert.throws(
      () => calcAmounts({ rate: baseRate({ rate: 100 }), input: {}, label: 'Оранка' }),
      (err) => err.status === 422 && /Оранка/.test(err.message),
    );
  });

  it('нульовий показник теж рахується "відсутнім"', () => {
    assert.throws(
      () => calcAmounts({ rate: baseRate({ rate: 100 }), input: { area_ha: 0 } }),
      (err) => err.status === 422,
    );
  });

  it('невідома одиниця виміру кидає 422', () => {
    assert.throws(
      () => calcAmounts({ rate: baseRate({ unit: 'parsecs' }), input: {} }),
      (err) => err.status === 422 && /Невідома одиниця/.test(err.message),
    );
  });
});

describe('payrollCalc.calcAmounts — ручна сума (manual_amount)', () => {
  it('перекриває розрахунок повністю, навіть без показників', () => {
    const calc = calcAmounts({ rate: baseRate({ rate: 100 }), input: { manual_amount: 250 } });
    assert.equal(calc.total_amount, 250);
  });

  it('тариф "від мінімалки" (is_manual) без manual_amount кидає 422 з path=manual_amount', () => {
    assert.throws(
      () => calcAmounts({ rate: baseRate({ is_manual: 1, raw_text: 'від мінімалки' }), input: { area_ha: 5 } }),
      (err) => err.status === 422 && err.details?.[0]?.path === 'manual_amount',
    );
  });

  it('тариф "від мінімалки" з manual_amount рахується', () => {
    const calc = calcAmounts({ rate: baseRate({ is_manual: 1 }), input: { manual_amount: 500 } });
    assert.equal(calc.total_amount, 500);
  });
});

describe('payrollCalc.round2', () => {
  it('коректно округлює періодичні дроби до копійок', () => {
    const calc = calcAmounts({ rate: baseRate({ rate: 1 / 3 }), input: { area_ha: 3 } });
    assert.equal(calc.total_amount, 1); // 0.333.. * 3 = 0.999.. -> 1.00
  });

  it('round2 не ламається на класичних float edge cases', () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(2.675), 2.68);
  });
});
