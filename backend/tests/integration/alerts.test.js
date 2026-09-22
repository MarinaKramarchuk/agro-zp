import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedField, seedTariff, seedWorkPlan, seedWorkType } from '../helpers/seed.js';

// GET /api/alerts лише агрегує вже наявну detection-логіку (unmapped
// OVERSEER/Hecterra, перевищення площі поля) — нової бізнес-логіки тут нема,
// тож тести перевіряють саме агрегацію (склад items/total), а не самі
// правила детекції (ті вже покриті hecterraImport/overseerImport/fieldControl).

function currentMonthDate(day) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-${String(day).padStart(2, '0')}`;
}

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('alerts — GET /alerts (дзвіночок сповіщень)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('порожня база -> items=[], total=0', async () => {
    const res = await ctx.api.get('/api/alerts');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: [], total: 0 });
  });

  it('одна Hecterra-активність з усім немапленим -> 4 категорії по 1, total=4', async () => {
    await ctx.api.post('/api/hecterra/import', {
      activities: [
        {
          activity_date: currentMonthDate(11),
          overseer_name: 'Китаєць',
          hecterra_field_id: 'F-001',
          field_name_raw: 'Поле №1',
          area_ha: 9.5,
          driver_name_raw: 'Незнайомий Водій',
          work_type_raw: 'Культивація',
        },
      ],
    });

    const res = await ctx.api.get('/api/alerts');
    assert.equal(res.status, 200);

    const byKey = Object.fromEntries(res.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.overseer_machines.count, 1);
    assert.equal(byKey.hecterra_drivers.count, 1);
    assert.equal(byKey.hecterra_work_types.count, 1);
    assert.equal(byKey.hecterra_fields.count, 1);
    assert.equal(byKey.field_excess, undefined);
    assert.equal(res.body.total, 4);
    assert.ok(res.body.items.every((i) => i.link === '/machine-data'));
  });

  it('прив’язка сутності заднім числом прибирає відповідний alert', async () => {
    await ctx.api.post('/api/hecterra/import', {
      activities: [{ activity_date: currentMonthDate(11), overseer_name: 'Китаєць', driver_name_raw: 'Незнайомий Водій' }],
    });

    const before1 = await ctx.api.get('/api/alerts');
    assert.equal(before1.body.total, 2); // overseer_machines + hecterra_drivers

    const employee = seedEmployee(ctx.db);
    await ctx.api.patch(`/api/employees/${employee.id}`, { overseer_name: 'Незнайомий Водій' });

    const after1 = await ctx.api.get('/api/alerts');
    const byKey = Object.fromEntries(after1.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.hecterra_drivers, undefined);
    assert.equal(byKey.overseer_machines.count, 1);
    assert.equal(after1.body.total, 1);
  });

  it('поле з перевищенням площі в поточному місяці -> категорія field_excess', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле з перевищенням', area_ha: 10 });
    const workType = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: currentMonthDate(1),
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 25,
    }); // 25 га на полі площею 10 га

    const res = await ctx.api.get('/api/alerts');
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.field_excess.count, 1);
    assert.equal(byKey.field_excess.link, '/field-control');
  });

  it('перевищення поза "не стеженим" полем (is_watched=0) не потрапляє в алерти', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Не стежене поле', area_ha: 10 });
    ctx.db.prepare('UPDATE fields SET is_watched = 0 WHERE id = ?').run(field.id);
    const workType = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: currentMonthDate(1),
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 25,
      confirmed: true, // тест перевіряє field_excess, не unconfirmed_worklogs
    });

    const res = await ctx.api.get('/api/alerts');
    assert.deepEqual(res.body, { items: [], total: 0 });
  });

  it('прострочений незавершений план -> категорія overdue_plans', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedWorkPlan(ctx.db, { plan_date: isoDateOffset(-1), employee_id: employee.id, work_type_id: workType.id });

    const res = await ctx.api.get('/api/alerts');
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.overdue_plans.count, 1);
    assert.equal(byKey.overdue_plans.link, '/work-plans');
  });

  it('план на сьогодні/майбутнє не рахується простроченим', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedWorkPlan(ctx.db, { plan_date: isoDateOffset(0), employee_id: employee.id, work_type_id: workType.id });
    seedWorkPlan(ctx.db, { plan_date: isoDateOffset(1), employee_id: employee.id, work_type_id: workType.id });

    const res = await ctx.api.get('/api/alerts');
    assert.deepEqual(res.body, { items: [], total: 0 });
  });

  it('погоджений прострочений план (є worklog з plan_id) не рахується', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });
    const plan = seedWorkPlan(ctx.db, { plan_date: isoDateOffset(-2), employee_id: employee.id, work_type_id: workType.id });

    await ctx.api.post('/api/worklogs', {
      work_date: isoDateOffset(-2),
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 8,
      plan_id: plan.id,
    });

    const res = await ctx.api.get('/api/alerts');
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.overdue_plans, undefined);
  });

  it('шляховий старший за 10 днів без confirmed -> категорія unconfirmed_worklogs', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: isoDateOffset(-11),
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    const res = await ctx.api.get('/api/alerts');
    const byKey = Object.fromEntries(res.body.items.map((i) => [i.key, i]));
    assert.equal(byKey.unconfirmed_worklogs.count, 1);
    assert.equal(byKey.unconfirmed_worklogs.link, '/worklogs/journal?confirmed=0');
  });

  it('шляховий свіжіший за 10 днів -> ще не потрапляє в unconfirmed_worklogs', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: isoDateOffset(-9),
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    const res = await ctx.api.get('/api/alerts');
    assert.deepEqual(res.body, { items: [], total: 0 });
  });

  it('підтверджений шляховий старший за 10 днів -> не потрапляє в unconfirmed_worklogs', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: isoDateOffset(-11),
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 5,
      confirmed: true,
    });

    const res = await ctx.api.get('/api/alerts');
    assert.deepEqual(res.body, { items: [], total: 0 });
  });
});
