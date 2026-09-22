import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipment, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('службові маршрути: /health, /stats, невідомий шлях, Gektera-стаб', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('GET /health -> ok', async () => {
    const res = await ctx.api.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('GET /stats рахує записи в усіх довідниках', async () => {
    seedEmployee(ctx.db);
    seedEmployee(ctx.db, { full_name: 'Другий' });
    seedEquipment(ctx.db);
    const field = seedField(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: (await ctx.api.get('/api/employees')).body.items[0].id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 5,
    });

    const res = await ctx.api.get('/api/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.employees, 2);
    assert.equal(res.body.equipment, 1);
    assert.equal(res.body.fields, 1);
    assert.equal(res.body.work_types, 1);
    assert.equal(res.body.tariff_rates, 1);
    assert.equal(res.body.worklogs, 1);
  });

  it('невідомий маршрут -> 404 з описом методу і шляху', async () => {
    const res = await ctx.api.get('/api/no-such-route');
    assert.equal(res.status, 404);
    assert.match(res.body.error, /GET \/api\/no-such-route/);
  });

  it('POST /integrations/gektera/fields -> 501 (зарезервований стаб)', async () => {
    const res = await ctx.api.post('/api/integrations/gektera/fields', { fields: [] });
    assert.equal(res.status, 501);
    assert.match(res.body.error, /не реалізована/);
  });
});
