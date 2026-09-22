import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee } from '../helpers/seed.js';

describe('employees — POST /employees/:id/overseer-aliases (кілька написань водія)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('без наявного overseer_name -> записує напряму (без окремого аліасу)', async () => {
    const employee = seedEmployee(ctx.db, { overseer_name: null });

    const res = await ctx.api.post(`/api/employees/${employee.id}/overseer-aliases`, { alias: 'Гнотюк' });
    assert.equal(res.status, 201);
    assert.equal(res.body.overseer_name, 'Гнотюк');
  });

  it('з уже наявним overseer_name -> ДОДАЄ друге написання, не затирає перше', async () => {
    const employee = seedEmployee(ctx.db, { overseer_name: 'Гнатюк' });

    const res = await ctx.api.post(`/api/employees/${employee.id}/overseer-aliases`, { alias: 'Гнотюк' });
    assert.equal(res.status, 201);
    // основне написання лишається незмінним - головна вимога цього фікса
    assert.equal(res.body.overseer_name, 'Гнатюк');

    // і обидва написання тепер резолвяться на цього ж працівника
    await ctx.api.post('/api/hecterra/import', {
      activities: [
        { activity_date: '2026-08-01', overseer_name: 'Комбайн', driver_name_raw: 'Гнатюк' },
        { activity_date: '2026-08-02', overseer_name: 'Комбайн', driver_name_raw: 'Гнотюк' },
      ],
    });
    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.ok(activities.body.items.every((a) => a.employee_id === employee.id));

    const unmapped = await ctx.api.get('/api/hecterra/unmapped-drivers');
    assert.deepEqual(unmapped.body.items, []);
  });

  it('написання вже прив’язане до ІНШОГО працівника -> 409', async () => {
    seedEmployee(ctx.db, { overseer_name: 'Гнатюк' });
    const other = seedEmployee(ctx.db, { full_name: 'Інший', overseer_name: null });

    const res = await ctx.api.post(`/api/employees/${other.id}/overseer-aliases`, { alias: 'Гнатюк' });
    assert.equal(res.status, 409);
  });

  it('написання вже прив’язане до ТОГО САМОГО працівника -> ідемпотентно, 201 без дублю', async () => {
    const employee = seedEmployee(ctx.db, { overseer_name: 'Гнатюк' });

    const res = await ctx.api.post(`/api/employees/${employee.id}/overseer-aliases`, { alias: 'Гнатюк' });
    assert.equal(res.status, 201);
    assert.equal(res.body.overseer_name, 'Гнатюк');
  });

  it('неіснуючий працівник -> 404', async () => {
    const res = await ctx.api.post('/api/employees/999999/overseer-aliases', { alias: 'Хтось' });
    assert.equal(res.status, 404);
  });
});
