import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipment, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('work-plans — GET/POST/PATCH/DELETE /work-plans (план -> погодження шляховим)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('створення плану -> статус похідний, "confirmed_worklog_id" відсутній', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);

    const res = await ctx.api.post('/api/work-plans', {
      plan_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
      note: '~40 га',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.employee_name, employee.full_name);
    assert.equal(res.body.confirmed_worklog_id, null);
  });

  it('поле requires_field=1 без field_id -> 422', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db, { requires_field: 1 });

    const res = await ctx.api.post('/api/work-plans', {
      plan_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
    });
    assert.equal(res.status, 422);
  });

  it('GET /work-plans?status=pending/confirmed фільтрує за наявністю погоджуючого шляхового', async () => {
    const employee = seedEmployee(ctx.db);
    const equipment = seedEquipment(ctx.db);
    const field = seedField(ctx.db, { area_ha: 100 });
    const workType = seedWorkType(ctx.db, { requires_field: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const plan = (
      await ctx.api.post('/api/work-plans', {
        plan_date: '2026-08-11',
        employee_id: employee.id,
        equipment_id: equipment.id,
        field_id: field.id,
        work_type_id: workType.id,
      })
    ).body;

    let pending = await ctx.api.get('/api/work-plans?status=pending');
    assert.equal(pending.body.items.length, 1);
    let confirmed = await ctx.api.get('/api/work-plans?status=confirmed');
    assert.equal(confirmed.body.items.length, 0);

    const worklog = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      area_ha: 12,
      plan_id: plan.id,
    });
    assert.equal(worklog.status, 201);

    pending = await ctx.api.get('/api/work-plans?status=pending');
    assert.equal(pending.body.items.length, 0);
    confirmed = await ctx.api.get('/api/work-plans?status=confirmed');
    assert.equal(confirmed.body.items.length, 1);
    assert.equal(confirmed.body.items[0].confirmed_worklog_id, worklog.body.id);
  });

  it('другий шляховий на вже погоджений план -> 422', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });

    const plan = (
      await ctx.api.post('/api/work-plans', {
        plan_date: '2026-08-11',
        employee_id: employee.id,
        work_type_id: workType.id,
      })
    ).body;

    const first = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 8,
      plan_id: plan.id,
    });
    assert.equal(first.status, 201);

    const second = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 4,
      plan_id: plan.id,
    });
    assert.equal(second.status, 422);
  });

  it('PATCH/DELETE погодженого плану -> 409', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });

    const plan = (
      await ctx.api.post('/api/work-plans', {
        plan_date: '2026-08-11',
        employee_id: employee.id,
        work_type_id: workType.id,
      })
    ).body;

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 8,
      plan_id: plan.id,
    });

    const patch = await ctx.api.patch(`/api/work-plans/${plan.id}`, { note: 'зміна' });
    assert.equal(patch.status, 409);

    const del = await ctx.api.del(`/api/work-plans/${plan.id}`);
    assert.equal(del.status, 409);
  });

  it('видалення погоджуючого шляхового повертає план у "pending" (ON DELETE SET NULL)', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });

    const plan = (
      await ctx.api.post('/api/work-plans', {
        plan_date: '2026-08-11',
        employee_id: employee.id,
        work_type_id: workType.id,
      })
    ).body;

    const worklog = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 8,
      plan_id: plan.id,
    });

    await ctx.api.del(`/api/worklogs/${worklog.body.id}`);

    const reloaded = await ctx.api.get(`/api/work-plans/${plan.id}`);
    assert.equal(reloaded.body.confirmed_worklog_id, null);

    // тепер план знову можна редагувати й погодити повторно
    const patch = await ctx.api.patch(`/api/work-plans/${plan.id}`, { note: 'скориговано' });
    assert.equal(patch.status, 200);
  });

  it('PATCH/DELETE неіснуючого плану -> 404', async () => {
    const patch = await ctx.api.patch('/api/work-plans/999999', { note: 'x' });
    assert.equal(patch.status, 404);
    const del = await ctx.api.del('/api/work-plans/999999');
    assert.equal(del.status, 404);
  });
});
