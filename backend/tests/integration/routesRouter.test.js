import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedKmRate, seedRoute, seedWorkType } from '../helpers/seed.js';

describe('routes — CRUD, /estimate, /:id/usage, /km-rates', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('POST /routes створює маршрут з дефолтною ставкою', async () => {
    const res = await ctx.api.post('/api/routes', { name: 'Київ-Одеса', distance_km: 900 });
    assert.equal(res.status, 201);
    assert.equal(res.body.rate, 0);
  });

  it('PATCH одного поля маршруту не скидає інше (regression, той самий клас бага)', async () => {
    const created = await ctx.api.post('/api/routes', {
      name: 'Маршрут X',
      rate: 600,
      distance_km: 50,
    });
    const patched = await ctx.api.patch(`/api/routes/${created.body.id}`, { rate: 650 });
    assert.equal(patched.body.distance_km, 50);
    assert.equal(patched.body.rate, 650);
  });

  it('GET /routes/estimate?route_id= повертає ставку маршруту з довідника', async () => {
    const route = seedRoute(ctx.db, { rate: 450 });
    const res = await ctx.api.get(`/api/routes/estimate?route_id=${route.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'route');
    assert.equal(res.body.rate, 450);
  });

  it('GET /routes/estimate?distance_km= обирає ставку грн/км за діапазоном', async () => {
    seedKmRate(ctx.db, { from_km: 0, to_km: 100, rate: 10 });
    seedKmRate(ctx.db, { from_km: 100, to_km: null, rate: 8 });

    const res = await ctx.api.get('/api/routes/estimate?distance_km=50');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'km_rate');
    assert.equal(res.body.rate, 500); // 10 * 50
  });

  it('GET /routes/estimate без route_id і distance_km -> 400', async () => {
    const res = await ctx.api.get('/api/routes/estimate');
    assert.equal(res.status, 400);
  });

  it('GET /routes/estimate?distance_km= поза жодним діапазоном -> 404', async () => {
    seedKmRate(ctx.db, { from_km: 100, to_km: 200, rate: 10 });
    const res = await ctx.api.get('/api/routes/estimate?distance_km=5');
    assert.equal(res.status, 404);
  });

  it('GET /routes/:id/usage рахує шляхові листи з цим маршрутом', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    const route = seedRoute(ctx.db, { rate: 500 });

    const zero = await ctx.api.get(`/api/routes/${route.id}/usage`);
    assert.equal(zero.body.worklogs, 0);

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      route_id: route.id,
      trips: 1,
    });
    assert.equal(created.status, 201);

    const one = await ctx.api.get(`/api/routes/${route.id}/usage`);
    assert.equal(one.body.worklogs, 1);
  });

  it('/routes/km-rates — CRUD ставок грн/км', async () => {
    const created = await ctx.api.post('/api/routes/km-rates', {
      from_km: 0,
      to_km: 50,
      rate: 12,
    });
    assert.equal(created.status, 201);

    const list = await ctx.api.get('/api/routes/km-rates');
    assert.equal(list.body.items.length, 1);

    const deleted = await ctx.api.del(`/api/routes/km-rates/${created.body.id}`);
    assert.equal(deleted.status, 204);
  });
});
