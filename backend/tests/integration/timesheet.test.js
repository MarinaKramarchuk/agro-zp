import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('timesheet — GET /timesheet (місячна сітка)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('день без записів -> статус empty, 0 годин', async () => {
    seedEmployee(ctx.db, { full_name: 'Без Записів' });

    const res = await ctx.api.get('/api/timesheet?year=2026&month=8');
    assert.equal(res.status, 200);
    const row = res.body.rows.find((r) => r.employee.full_name === 'Без Записів');
    assert.equal(row.days[3].status, 'empty');
    assert.equal(row.days[3].hours, 0);
  });

  it('5 годин -> normal (зелений)', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-05',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 5,
    });

    const res = await ctx.api.get(`/api/timesheet?year=2026&month=8&employee_id=${employee.id}`);
    const day = res.body.rows[0].days[5];
    assert.equal(day.status, 'normal');
    assert.equal(day.hours, 5);
    assert.equal(day.entries, 1);
    assert.equal(day.total_amount, 250);
  });

  it('10 годин -> overtime (червоний), overtime_hours = 2', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 50 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-06',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 10,
    });

    const res = await ctx.api.get(`/api/timesheet?year=2026&month=8&employee_id=${employee.id}`);
    const day = res.body.rows[0].days[6];
    assert.equal(day.status, 'overtime');
    assert.equal(day.overtime_hours, 2);
  });

  it('багатоденний шляховий дублює години/суму на кожен день періоду (за задумом)', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 60 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-10',
      work_date_to: '2026-08-12',
      employee_id: employee.id,
      work_type_id: workType.id,
      hours: 24,
    });

    const res = await ctx.api.get(`/api/timesheet?year=2026&month=8&employee_id=${employee.id}`);
    const days = res.body.rows[0].days;
    for (const d of [10, 11, 12]) {
      assert.equal(days[d].entries, 1);
      assert.equal(days[d].hours, 24);
      assert.equal(days[d].total_amount, 1440);
    }
    assert.equal(days[9].entries, 0);
    assert.equal(days[13].entries, 0);
  });

  it('день з двома шляховими -> години і сума підсумовуються, без дублювання', async () => {
    const employee = seedEmployee(ctx.db);
    const workTypeA = seedWorkType(ctx.db, { name: 'Оранка' });
    const workTypeB = seedWorkType(ctx.db, { name: 'Ремонт' });
    seedTariff(ctx.db, { work_type_id: workTypeA.id, unit: 'hour', rate: 50 });
    seedTariff(ctx.db, { work_type_id: workTypeB.id, unit: 'hour', rate: 60 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-15',
      employee_id: employee.id,
      work_type_id: workTypeA.id,
      hours: 5,
    });
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-15',
      employee_id: employee.id,
      work_type_id: workTypeB.id,
      hours: 3,
    });

    const res = await ctx.api.get(`/api/timesheet?year=2026&month=8&employee_id=${employee.id}`);
    const day = res.body.rows[0].days[15];
    assert.equal(day.entries, 2);
    assert.equal(day.hours, 8);
    assert.equal(day.total_amount, 430); // 5*50 + 3*60

    const totals = res.body.rows[0].totals;
    assert.equal(totals.hours, 8);
    assert.equal(totals.total_amount, 430);
  });

  it('GET /timesheet/day повертає деталізацію дня для popup', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db, { name: 'Оранка' });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-07',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 4,
      hours: 6,
    });

    const res = await ctx.api.get(`/api/timesheet/day?employee_id=${employee.id}&date=2026-08-07`);
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.entries, 1);
    assert.equal(res.body.totals.hours, 6);
    assert.equal(res.body.items[0].work_type_name, 'Оранка');
    assert.equal(res.body.items[0].total_amount, 400);
  });
});
