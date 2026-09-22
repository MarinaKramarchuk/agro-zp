import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import {
  linkTariffModel,
  seedEmployee,
  seedEquipment,
  seedEquipmentModel,
  seedField,
  seedRoute,
  seedTariff,
  seedWorkType,
} from '../helpers/seed.js';

/** Незалежний оракул для перевірки погодинної ставки (Пн-Пт у місяці × 8 год). */
function workDaysInMonth(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= days; d += 1) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

describe('worklogs — інтеграційні тести (HTTP)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('POST /worklogs/preview — щасливий шлях, сума рахується автоматично', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const res = await ctx.api.post('/api/worklogs/preview', {
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.total_amount, 500);
    assert.equal(res.body.quantity, 5);
  });

  it('POST /worklogs/preview без employee_id/work_type_id -> 422 (обидва обов’язкові в схемі)', async () => {
    const res = await ctx.api.post('/api/worklogs/preview', { area_ha: 5 });
    assert.equal(res.status, 422);
  });

  it('POST /worklogs/preview — кілька тарифів без уточнення -> 422 з variants', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', equipment_label: 'МТЗ', rate: 90 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', equipment_label: 'John Deere', rate: 110 });

    const res = await ctx.api.post('/api/worklogs/preview', {
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.details.variants.length, 2);
  });

  it('POST /worklogs -> 201, GET /worklogs/:id повертає збережений знімок тарифу', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.total_amount, 500);
    assert.equal(created.body.unit, 'ha');

    const fetched = await ctx.api.get(`/api/worklogs/${created.body.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.total_amount, 500);
    assert.equal(fetched.body.employee_name, employee.full_name);
  });

  it('PATCH /worklogs/:id перераховує суму за новими показниками', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    const patched = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { area_ha: 10 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.quantity, 10);
    assert.equal(patched.body.total_amount, 1000);
  });

  it('DELETE /worklogs/:id видаляє запис (404 після)', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    const deleted = await ctx.api.del(`/api/worklogs/${created.body.id}`);
    assert.equal(deleted.status, 204);

    const fetched = await ctx.api.get(`/api/worklogs/${created.body.id}`);
    assert.equal(fetched.status, 404);
  });

  it('pay_mode=hourly рахує ставку від окладу / норми годин місяця', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
    const workType = seedWorkType(ctx.db);
    // тарифу в довіднику взагалі немає — при hourly він ігнорується

    const workDate = '2026-08-03'; // серпень 2026
    const expectedHourlyRate = Math.round((20000 / (workDaysInMonth(2026, 8) * 8) + Number.EPSILON) * 100) / 100;

    const res = await ctx.api.post('/api/worklogs', {
      work_date: workDate,
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.rate, expectedHourlyRate);
    assert.equal(res.body.total_amount, Math.round(expectedHourlyRate * 8 * 100) / 100);
  });

  it('pay_mode=hourly без окладу в працівника -> 422', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: null });
    const workType = seedWorkType(ctx.db);

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });

    assert.equal(res.status, 422);
    assert.match(res.body.error, /оклад/);
  });

  it('pay_mode=hourly без окладу в працівника -> бере мінімальну ЗП з /settings', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: null });
    const workType = seedWorkType(ctx.db);
    await ctx.api.patch('/api/settings', { minimum_wage: 8000 });

    const workDate = '2026-08-03';
    const expectedHourlyRate = Math.round((8000 / (workDaysInMonth(2026, 8) * 8) + Number.EPSILON) * 100) / 100;

    const res = await ctx.api.post('/api/worklogs', {
      work_date: workDate,
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.rate, expectedHourlyRate);
  });

  it('pay_mode=hourly: власний оклад пріоритетніший за мінімальну ЗП', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
    const workType = seedWorkType(ctx.db);
    await ctx.api.patch('/api/settings', { minimum_wage: 8000 });

    const workDate = '2026-08-03';
    const expectedHourlyRate = Math.round((20000 / (workDaysInMonth(2026, 8) * 8) + Number.EPSILON) * 100) / 100;

    const res = await ctx.api.post('/api/worklogs', {
      work_date: workDate,
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.rate, expectedHourlyRate);
    // не 8000/norm - власний оклад пріоритетніший за мінімальну ЗП
    assert.notEqual(res.body.rate, Math.round((8000 / (workDaysInMonth(2026, 8) * 8)) * 100) / 100);
  });

  it('pay_mode=hourly без окладу і без встановленої мінімальної ЗП (0) -> 422', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: null });
    const workType = seedWorkType(ctx.db);

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });

    assert.equal(res.status, 422);
    assert.match(res.body.error, /оклад/i);
    assert.match(res.body.error, /мінімальна ЗП/i);
  });

  it('"дата по" раніше "дата з" -> 422', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-10',
      work_date_to: '2026-08-05',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    assert.equal(res.status, 422);
  });

  it('requires_field=1 без field_id -> 422', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db, { requires_field: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    assert.equal(res.status, 422);
    assert.match(res.body.error, /поле/);
  });

  it('requires_field=1 з field_id — успішно створюється', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db, { requires_field: 1 });
    const field = seedField(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 5,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.field_name, field.name);
  });

  it('GET /worklogs?date_from&date_to — фільтрує і підсумовує тільки в межах діапазону', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 2,
    }); // amount 200, у межах
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-15',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 3,
    }); // amount 300, у межах
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-09-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 100,
    }); // поза межами

    const res = await ctx.api.get('/api/worklogs?date_from=2026-08-01&date_to=2026-08-31');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.totals.count, 2);
    assert.equal(res.body.totals.total_amount, 500);
  });

  it('розцінка вручну (manual_rate), коли тарифу немає в довіднику', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db); // жодного тарифу для цього виду робіт

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      unit: 'ha',
      area_ha: 5,
      manual_rate: 90,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.rate, 90);
    assert.equal(res.body.total_amount, 450); // 90 * 5
    assert.equal(res.body.tariff_rate_id, null);
  });

  it('PATCH запису з ручною розцінкою (лише {confirmed}) не губить і не підміняє розцінку', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db); // жодного тарифу для цього виду робіт

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      unit: 'ha',
      area_ha: 5,
      manual_rate: 90,
    });
    assert.equal(created.status, 201);

    const confirmed = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { confirmed: true });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.confirmed, 1);
    assert.equal(confirmed.body.rate, 90);
    assert.equal(confirmed.body.total_amount, 450);
    assert.equal(confirmed.body.tariff_rate_id, null);
  });

  it('PATCH запису з ручною розцінкою не підміняє її, навіть якщо в довіднику зʼявився підхожий тариф', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      unit: 'ha',
      area_ha: 5,
      manual_rate: 90,
    });
    assert.equal(created.status, 201);

    // Після створення в довіднику з'явився один тариф для того самого виду
    // робіт/одиниці - без фіксу PATCH мовчки підмінив би ним ручну розцінку.
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 999 });

    const confirmed = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { confirmed: true });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.rate, 90);
    assert.equal(confirmed.body.total_amount, 450);
    assert.equal(confirmed.body.tariff_rate_id, null);
  });

  it('GET /worklogs?<кожен фільтр окремо> звужує вибірку', async () => {
    const employee = seedEmployee(ctx.db);
    const otherEmployee = seedEmployee(ctx.db, { full_name: 'Інший' });
    const workType = seedWorkType(ctx.db);
    const otherWorkType = seedWorkType(ctx.db, { name: 'Інша робота' });
    const equipment = seedEquipment(ctx.db);
    const field = seedField(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });
    seedTariff(ctx.db, { work_type_id: otherWorkType.id, unit: 'ha', rate: 100 });

    const target = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-15',
      employee_id: employee.id,
      work_type_id: workType.id,
      equipment_id: equipment.id,
      field_id: field.id,
      crop: 'wheat',
      area_ha: 3,
    });
    assert.equal(target.status, 201);

    // "шум" — не повинен пройти жоден з фільтрів нижче
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-16',
      employee_id: otherEmployee.id,
      work_type_id: otherWorkType.id,
      area_ha: 1,
    });

    const cases = [
      `employee_id=${employee.id}`,
      `work_type_id=${workType.id}`,
      `equipment_id=${equipment.id}`,
      `field_id=${field.id}`,
      `crop=wheat`,
      `date=2026-08-15`,
    ];

    for (const qs of cases) {
      const res = await ctx.api.get(`/api/worklogs?${qs}`);
      assert.equal(res.status, 200, qs);
      assert.equal(res.body.items.length, 1, qs);
      assert.equal(res.body.items[0].id, target.body.id, qs);
    }
  });

  it('GET /worklogs?route_id= фільтрує за маршрутом', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    const route = seedRoute(ctx.db, { rate: 500 });

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-15',
      employee_id: employee.id,
      work_type_id: workType.id,
      route_id: route.id,
      trips: 1,
    });
    assert.equal(created.status, 201);

    const res = await ctx.api.get(`/api/worklogs?route_id=${route.id}`);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].id, created.body.id);
  });

  it('багатоденний шляховий (work_date .. work_date_to) створюється однією сумою', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 60 });

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-10',
      work_date_to: '2026-08-12',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 24,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.work_date, '2026-08-10');
    assert.equal(res.body.work_date_to, '2026-08-12');
    assert.equal(res.body.total_amount, 1440); // 24 год * 60, сума рахується один раз
  });

  describe('звірка з паперовим шляховим (confirmed)', () => {
    it('PATCH без confirmed не скидає раніше встановлене значення', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      const created = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
      });
      assert.equal(created.body.confirmed, 0);

      const confirmed = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { confirmed: true });
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.confirmed, 1);

      // PATCH іншого поля, confirmed взагалі не передається
      const patched = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { note: 'перевірено' });
      assert.equal(patched.body.confirmed, 1);
    });

    it('GET /worklogs?confirmed=1 повертає лише підтверджені записи', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      const confirmedOne = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
        confirmed: true,
      });
      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-04',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
      });

      const res = await ctx.api.get('/api/worklogs?confirmed=1');
      assert.equal(res.status, 200);
      assert.equal(res.body.items.length, 1);
      assert.equal(res.body.items[0].id, confirmedOne.body.id);
    });
  });

  describe('масове підтвердження PATCH /worklogs/bulk-confirm', () => {
    it('підтверджує кілька записів одним запитом', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      const a = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
      });
      const b = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-04',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
      });

      const res = await ctx.api.patch('/api/worklogs/bulk-confirm', {
        ids: [a.body.id, b.body.id],
        confirmed: true,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 2);
      assert.ok(res.body.items.every((i) => i.confirmed === 1));

      const check = await ctx.api.get(`/api/worklogs/${a.body.id}`);
      assert.equal(check.body.confirmed, 1);
    });

    it('можна й зняти підтвердження масово (confirmed: false)', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      const a = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
        confirmed: true,
      });

      const res = await ctx.api.patch('/api/worklogs/bulk-confirm', {
        ids: [a.body.id],
        confirmed: false,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.items[0].confirmed, 0);
    });

    it('порожній ids -> 422', async () => {
      const res = await ctx.api.patch('/api/worklogs/bulk-confirm', { ids: [], confirmed: true });
      assert.equal(res.status, 422);
    });

    it('неіснуючий id у списку -> 404, жоден запис зі списку не змінюється (атомарно)', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });
      const a = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 5,
      });

      const res = await ctx.api.patch('/api/worklogs/bulk-confirm', {
        ids: [a.body.id, 999999],
        confirmed: true,
      });

      assert.equal(res.status, 404);

      const check = await ctx.api.get(`/api/worklogs/${a.body.id}`);
      assert.equal(check.body.confirmed, 0, 'перший запис не мав змінитись — транзакція відкотилась');
    });
  });

  describe('доплата "хімік 50%" (helper_absent)', () => {
    function seedSprayerAndHelper(ctx) {
      const employee = seedEmployee(ctx.db, { staff_group: 'driver' });
      const workType = seedWorkType(ctx.db, { name: 'Обприскування', staff_group: 'driver' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 31 }); // 31 грн/га
      const helperWorkType = seedWorkType(ctx.db, { name: 'Помічник (хімік)', staff_group: 'driver', is_helper_role: 1 });
      const helperTariff = seedTariff(ctx.db, { work_type_id: helperWorkType.id, unit: 'ha', rate: 21 }); // 21 грн/га
      return { employee, workType, helperWorkType, helperTariff };
    }

    it('helper_absent=true рахує 50% від тарифу хіміка × area_ha і додає до суми', async () => {
      const { employee, workType, helperTariff } = seedSprayerAndHelper(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 10,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });

      assert.equal(res.status, 201);
      // власна сума водія: 31*10 = 310; доплата хіміка: 0.5*21*10 = 105
      assert.equal(res.body.helper_amount, 105);
      assert.equal(res.body.helper_rate, 21);
      assert.equal(res.body.total_amount, 415); // 310 + 105
    });

    it('helper_absent=false (за замовчуванням) — жодних змін у сумі', async () => {
      const { employee, workType } = seedSprayerAndHelper(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 10,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.helper_absent, 0);
      assert.equal(res.body.helper_amount, null);
      assert.equal(res.body.total_amount, 310);
    });

    it('helper_absent=true без helper_tariff_rate_id -> 422', async () => {
      const { employee, workType } = seedSprayerAndHelper(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 10,
        helper_absent: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /тариф хіміка/i);
    });

    it('helper_tariff_rate_id вказує на тариф БЕЗ is_helper_role -> 422', async () => {
      const { employee, workType } = seedSprayerAndHelper(ctx);
      const otherWorkType = seedWorkType(ctx.db, { name: 'Оранка' }); // is_helper_role=0
      const otherTariff = seedTariff(ctx.db, { work_type_id: otherWorkType.id, unit: 'ha', rate: 100 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 10,
        helper_absent: true,
        helper_tariff_rate_id: otherTariff.id,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /не позначений як розцінка хіміка/i);
    });

    it('helper_absent=true без area_ha -> 422, навіть коли основний тариф не вимагає area_ha', async () => {
      const { helperTariff } = seedSprayerAndHelper(ctx);
      const employee = seedEmployee(ctx.db, { staff_group: 'driver' });
      // погодинний тариф на саму роботу — area_ha йому не потрібне, але потрібне доплаті хіміка
      const workType = seedWorkType(ctx.db, { name: 'Обприскування (год.)', staff_group: 'driver' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 100 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        hours: 8,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /площ/i);
    });

    it('helper_absent=true з pay_mode=hourly -> 422 (лише для тарифної оплати)', async () => {
      const { helperTariff } = seedSprayerAndHelper(ctx);
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db, { name: 'Ремонт' });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'hourly',
        hours: 8,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /тарифної оплати/i);
    });

    it('PATCH знімає helper_absent і прибирає доплату з суми', async () => {
      const { employee, workType, helperTariff } = seedSprayerAndHelper(ctx);

      const created = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 10,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });
      assert.equal(created.body.total_amount, 415);

      const patched = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { helper_absent: false });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.helper_amount, null);
      assert.equal(patched.body.total_amount, 310);
    });
  });

  describe('оплата за транспортним тарифом (transport_pay)', () => {
    function seedDiscingAndTransport(ctx) {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db, { name: 'Дискування' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 }); // 100 грн/га

      const transportWorkType = seedWorkType(ctx.db, {
        name: 'Транспортні роботи по господарству',
        is_transport_rate: 1,
      });
      const model = seedEquipmentModel(ctx.db, { label: 'МТЗ' });
      const modelRate = seedTariff(ctx.db, {
        work_type_id: transportWorkType.id,
        equipment_label: 'МТЗ',
        unit: 'hour',
        rate: 72.5,
      });
      linkTariffModel(ctx.db, modelRate.id, model.id);
      // JCB навмисно теж прив'язана до окремої моделі (не "універсальна" без
      // привʼязки) - щоб тест "техніка не підходить під жодну групу" реально
      // перевіряв фолбек на is_default_rate, а не збіг за "немає привʼязки".
      const jcbModel = seedEquipmentModel(ctx.db, { label: 'JCB' });
      const defaultRate = seedTariff(ctx.db, {
        work_type_id: transportWorkType.id,
        equipment_label: 'JCB',
        unit: 'hour',
        rate: 50,
        is_default_rate: 1,
      });
      linkTariffModel(ctx.db, defaultRate.id, jcbModel.id);

      const equipmentWithModel = seedEquipment(ctx.db, { name: 'МТЗ-82', model_id: model.id });
      const equipmentWithoutModel = seedEquipment(ctx.db, { name: 'Автономна техніка', model_id: null });

      return { employee, workType, transportWorkType, modelRate, defaultRate, equipmentWithModel, equipmentWithoutModel };
    }

    it('happy path з технікою, що відповідає моделі — сума рахується за годинами і ставкою моделі', async () => {
      const { employee, workType, equipmentWithModel } = seedDiscingAndTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        equipment_id: equipmentWithModel.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.total_amount, 362.5); // 5 год × 72.5 грн/год
      assert.equal(res.body.transport_pay, 1);
      assert.equal(res.body.transport_rate, 72.5);
      // "інформаційний" тариф лишається тарифом дискування — для друку й Контролю гектарів
      assert.equal(res.body.unit, 'ha');
      assert.equal(res.body.rate, 100);
      assert.equal(res.body.quantity, 3);
      assert.equal(res.body.area_ha, 3);
    });

    it('без техніки — застосовується типова ставка транспортного тарифу', async () => {
      const { employee, workType } = seedDiscingAndTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.total_amount, 250); // 5 год × 50 грн/год (типова ставка)
      assert.equal(res.body.transport_rate, 50);
    });

    it('transport_pay=false (за замовчуванням) — сума за звичайним тарифом виду робіт', async () => {
      const { employee, workType } = seedDiscingAndTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 3,
        hours: 5,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.total_amount, 300); // 3 га × 100 грн/га
      assert.equal(res.body.transport_pay, 0);
    });

    it('transport_pay=true без годин -> 422', async () => {
      const { employee, workType } = seedDiscingAndTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 3,
        transport_pay: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /годин/i);
    });

    it('немає жодного is_transport_rate виду робіт -> 422', async () => {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db, { name: 'Дискування' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /транспортні роботи по господарству/i);
    });

    it('позначено декілька is_transport_rate видів робіт -> 422', async () => {
      const { employee, workType } = seedDiscingAndTransport(ctx);
      seedWorkType(ctx.db, { name: 'Ще один транспортний', is_transport_rate: 1 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /декілька/i);
    });

    it('техніка не підходить під жодну групу, немає типової ставки -> 422', async () => {
      const { employee, workType, defaultRate, equipmentWithoutModel } = seedDiscingAndTransport(ctx);
      ctx.db.prepare('UPDATE tariff_rates SET is_default_rate = 0 WHERE id = ?').run(defaultRate.id);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        equipment_id: equipmentWithoutModel.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /типову ставку/i);
    });

    it('pay_mode=hourly + transport_pay=true -> 422', async () => {
      const { workType } = seedDiscingAndTransport(ctx);
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'hourly',
        hours: 5,
        transport_pay: true,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /тарифної оплати/i);
    });

    it('transport_pay=true разом з helper_absent=true -> 422 (взаємовиключні)', async () => {
      const { employee, workType, equipmentWithModel } = seedDiscingAndTransport(ctx);
      const helperWorkType = seedWorkType(ctx.db, { name: 'Помічник (хімік)', is_helper_role: 1 });
      const helperTariff = seedTariff(ctx.db, { work_type_id: helperWorkType.id, unit: 'ha', rate: 21 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        equipment_id: equipmentWithModel.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });

      assert.equal(res.status, 422);
      assert.match(res.body.error, /хімік 50%.*транспортним тарифом/i);
    });

    it('PATCH знімає transport_pay — сума повертається до звичайної тарифної', async () => {
      const { employee, workType, equipmentWithModel } = seedDiscingAndTransport(ctx);

      const created = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        equipment_id: equipmentWithModel.id,
        area_ha: 3,
        hours: 5,
        transport_pay: true,
      });
      assert.equal(created.body.total_amount, 362.5);

      const patched = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { transport_pay: false });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.transport_pay, 0);
      assert.equal(patched.body.total_amount, 300); // 3 га × 100 грн/га
    });
  });

  describe('вид вантажу (cargo_type) і тонаж для транспортного тарифу (САЗ)', () => {
    function seedSazTransport(ctx) {
      const employee = seedEmployee(ctx.db);
      const workType = seedWorkType(ctx.db, {
        name: 'Транспортні роботи по господарству',
        is_transport_rate: 1,
      });
      const tariff = seedTariff(ctx.db, {
        work_type_id: workType.id,
        equipment_label: 'МТЗ, Джон Дір',
        unit: 'hour',
        rate: 72.5,
        is_default_rate: 1,
      });
      return { employee, workType, tariff };
    }

    it('зберігає tons і cargo_type, сума рахується лише від годин × ставки', async () => {
      const { employee, workType } = seedSazTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'tariff',
        unit: 'hour',
        hours: 4,
        tons: 2.4,
        cargo_type: 'chaff',
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.total_amount, 290); // 4 год × 72.5 грн/год, тонаж не впливає
      assert.equal(res.body.tons, 2.4);
      assert.equal(res.body.cargo_type, 'chaff');

      const other = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'tariff',
        unit: 'hour',
        hours: 4,
        cargo_type: 'grain_waste',
      });
      assert.equal(other.status, 201);
      assert.equal(other.body.total_amount, 290);
      assert.equal(other.body.tons, null);
      assert.equal(other.body.cargo_type, 'grain_waste');
    });

    it('невалідне значення cargo_type -> 400', async () => {
      const { employee, workType } = seedSazTransport(ctx);

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'tariff',
        unit: 'hour',
        hours: 4,
        cargo_type: 'сміття',
      });

      assert.equal(res.status, 422);
    });

    it('PATCH оновлює cargo_type без зміни суми', async () => {
      const { employee, workType } = seedSazTransport(ctx);

      const created = await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'tariff',
        unit: 'hour',
        hours: 4,
      });
      assert.equal(created.body.cargo_type, null);

      const patched = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { cargo_type: 'chaff', tons: 1.8 });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.cargo_type, 'chaff');
      assert.equal(patched.body.tons, 1.8);
      assert.equal(patched.body.total_amount, created.body.total_amount);
    });
  });

  describe('GET /worklogs/waybill.xlsx — Excel-версія друкованого бланка', () => {
    it('форма 67-б: розбиває суму на "Обприскування"/"Хімік 50%"/"Разом", з підсумковим рядком', async () => {
      const employee = seedEmployee(ctx.db, { staff_group: 'driver' });
      const equipment = seedEquipment(ctx.db);
      const workType = seedWorkType(ctx.db, { name: 'Обприскування', staff_group: 'driver' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 31 });
      const helperWorkType = seedWorkType(ctx.db, { name: 'Помічник (хімік)', staff_group: 'driver', is_helper_role: 1 });
      const helperTariff = seedTariff(ctx.db, { work_type_id: helperWorkType.id, unit: 'ha', rate: 21 });

      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        equipment_id: equipment.id,
        work_type_id: workType.id,
        area_ha: 10,
        helper_absent: true,
        helper_tariff_rate_id: helperTariff.id,
      });

      const res = await ctx.api.get(
        `/api/worklogs/waybill.xlsx${
          `?employee_id=${employee.id}&equipment_id=${equipment.id}&date_from=2026-08-01&date_to=2026-08-31&template=67b`
        }`,
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /spreadsheetml/);

      const wb = XLSX.read(res.raw, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const header = rows.find((r) => r[0] === 'Дата');
      assert.deepEqual(header.slice(8), ['Обприскування, грн', 'Хімік 50%, грн', 'Разом, грн']);

      const dataRow = rows.find((r) => r[0] === '2026-08-03');
      // тариф 31*10=310, доплата хіміка 0.5*21*10=105, разом=415
      assert.equal(dataRow[8], 310); // 415 - 105
      assert.equal(dataRow[9], 105);
      assert.equal(dataRow[10], 415);

      const totalRow = rows.find((r) => r[0] === 'Разом:');
      assert.equal(totalRow[8], 310);
      assert.equal(totalRow[9], 105);
      assert.equal(totalRow[10], 415);
    });

    it('без записів за умовами -> 404', async () => {
      const employee = seedEmployee(ctx.db);
      const equipment = seedEquipment(ctx.db);
      const res = await ctx.api.get(
        `/api/worklogs/waybill.xlsx?employee_id=${employee.id}&equipment_id=${equipment.id}&date_from=2026-08-01&date_to=2026-08-31&template=68`,
      );
      assert.equal(res.status, 404);
    });

    it('без equipment_id -> 422 (один шляховий лист = одна одиниця техніки)', async () => {
      const employee = seedEmployee(ctx.db);
      const res = await ctx.api.get(
        `/api/worklogs/waybill.xlsx?employee_id=${employee.id}&date_from=2026-08-01&date_to=2026-08-31&template=68`,
      );
      assert.equal(res.status, 422);
    });

    it('форма №68: заповнює офіційний бланк (шаблони/Подорожній лист трактора.xlsx) - по аркушу на день', async () => {
      const employee = seedEmployee(ctx.db, { full_name: 'Іваненко Іван Іванович' });
      const equipment = seedEquipment(ctx.db, { name: 'МТЗ-82', plate_number: 'AA1234BB' });
      const field = seedField(ctx.db, { name: 'Поле №5', crop: 'wheat' });
      const workType = seedWorkType(ctx.db, { name: 'Оранка' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 170 });

      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-03',
        employee_id: employee.id,
        equipment_id: equipment.id,
        field_id: field.id,
        work_type_id: workType.id,
        area_ha: 10,
      });

      const res = await ctx.api.get(
        `/api/worklogs/waybill.xlsx?employee_id=${employee.id}&equipment_id=${equipment.id}&date_from=2026-08-01&date_to=2026-08-31&template=68&org_name=${encodeURIComponent('ФГ «Приклад»')}`,
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /spreadsheetml/);

      const wb = XLSX.read(res.raw, { type: 'buffer' });
      assert.deepEqual(wb.SheetNames, ['2026-08-03']);
      const sheet = wb.Sheets['2026-08-03'];
      assert.equal(sheet['C3'].v, 'ДОРОЖНІЙ ЛИСТОК ТРАКТОРА'); // офіційний бланк, не переписаний
      assert.equal(sheet['A2'].v, 2026);
      assert.equal(sheet['C2'].v, 8);
      assert.equal(sheet['E2'].v, 3);
      assert.equal(sheet['G2'].v, 'ФГ «Приклад»');
      assert.equal(sheet['C5'].v, 'Іваненко Іван Іванович, Тракторист');
      assert.equal(sheet['S3'].v, 'МТЗ-82');
      assert.equal(sheet['R4'].v, 'Державний № AA1234BB');
      // Рядки 26-37 - це шапка "ВИКОНАНЕ ЗАВДАННЯ" (об'єднані комірки на всю
      // висоту, повернутий на 90° текст), а не таблиця даних - вона має
      // лишитись незмінною. Самі записи йдуть у перший порожній рядок
      // таблиці нижче шапки (38).
      assert.equal(sheet['C26'].v, 'Куди');
      assert.equal(sheet['C38'].v, 'Поле №5');
      assert.equal(sheet['E38'].v, 'Оранка');
      assert.equal(sheet['V38'].v, 10);
      assert.equal(sheet['AC38'].v, 170); // довідкова розцінка
      assert.equal(sheet['AE38'].v, 1700); // "Оплата праці" - 170×10
    });

    it('типова форма №2: заповнює офіційний бланк (шаблони/Подорожній лист розширений.xlsx)', async () => {
      const employee = seedEmployee(ctx.db, { full_name: 'Петренко Петро Петрович', staff_group: 'driver', position: 'Водій' });
      const equipment = seedEquipment(ctx.db, { name: 'КамАЗ-5511', plate_number: 'AA5678CC', category: 'truck' });
      const field = seedField(ctx.db, { name: 'Поле №1' });
      const workType = seedWorkType(ctx.db, { name: 'Перевезення зерна', staff_group: 'driver' });
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ton', rate: 30 });

      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-05',
        employee_id: employee.id,
        equipment_id: equipment.id,
        field_id: field.id,
        work_type_id: workType.id,
        tons: 5,
      });

      const res = await ctx.api.get(
        `/api/worklogs/waybill.xlsx?employee_id=${employee.id}&equipment_id=${equipment.id}&date_from=2026-08-01&date_to=2026-08-31&template=2`,
      );
      assert.equal(res.status, 200);

      const wb = XLSX.read(res.raw, { type: 'buffer' });
      assert.deepEqual(wb.SheetNames, ['2026-08-05']);
      const sheet = wb.Sheets['2026-08-05'];
      assert.equal(sheet['G2'].v.trim(), 'ПОДОРОЖНІЙ ЛИСТ'); // офіційний бланк, не переписаний
      assert.equal(sheet['I5'].v, '5 серпня 2026');
      assert.equal(sheet['G13'].v, 'Петренко Петро Петрович, Водій');
      assert.equal(sheet['G11'].v, 'КамАЗ-5511  № AA5678CC');
      assert.equal(sheet['Y31'].v, 'Поле №1');
      assert.equal(sheet['AQ31'].v, 5);
    });
  });
});
