import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedTariff, seedWorkType } from '../helpers/seed.js';

// Employees використовує спільну фабрику makeCrudRouter (lib/crud.js), яку
// перевикористовують і equipment/fields/work-types/routes — тому цей набір
// одночасно покриває спільну CRUD-логіку для всіх довідників.
describe('employees — generic CRUD router', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('POST створює запис і повертає 201', async () => {
    const res = await ctx.api.post('/api/employees', {
      full_name: 'Іваненко Іван Іванович',
      position: 'Механізатор',
      staff_group: 'tractor',
      monthly_rate: 18000,
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.full_name, 'Іваненко Іван Іванович');
    assert.equal(res.body.staff_group, 'tractor');
  });

  it('POST без full_name -> 422', async () => {
    const res = await ctx.api.post('/api/employees', { staff_group: 'other' });
    assert.equal(res.status, 422);
    assert.ok(res.body.details.some((d) => d.path === 'full_name'));
  });

  it('POST з невалідним staff_group -> 422', async () => {
    const res = await ctx.api.post('/api/employees', { full_name: 'X', staff_group: 'astronaut' });
    assert.equal(res.status, 422);
  });

  it('GET /:id — 200 для існуючого, 404 для відсутнього', async () => {
    const created = await ctx.api.post('/api/employees', { full_name: 'Тест' });
    const found = await ctx.api.get(`/api/employees/${created.body.id}`);
    assert.equal(found.status, 200);

    const missing = await ctx.api.get('/api/employees/999999');
    assert.equal(missing.status, 404);
  });

  it('GET /?q= шукає за ПІБ (LIKE, підрядок)', async () => {
    await ctx.api.post('/api/employees', { full_name: 'Миколаєнко Ольга' });
    await ctx.api.post('/api/employees', { full_name: 'Петренко Петро' });

    const res = await ctx.api.get('/api/employees?q=Миколаєнко');
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].full_name, 'Миколаєнко Ольга');
  });

  it('GET /?staff_group= фільтрує точним значенням', async () => {
    await ctx.api.post('/api/employees', { full_name: 'Водій', staff_group: 'driver' });
    await ctx.api.post('/api/employees', { full_name: 'Тракторист', staff_group: 'tractor' });

    const res = await ctx.api.get('/api/employees?staff_group=driver');
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].full_name, 'Водій');
  });

  it('PATCH оновлює лише передані поля', async () => {
    const created = await ctx.api.post('/api/employees', {
      full_name: 'Тест',
      position: 'Стара посада',
      staff_group: 'other',
    });

    const patched = await ctx.api.patch(`/api/employees/${created.body.id}`, { position: 'Нова посада' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.position, 'Нова посада');
    assert.equal(patched.body.full_name, 'Тест'); // не торкнулось
  });

  it('PATCH з порожнім тілом -> 400', async () => {
    const created = await ctx.api.post('/api/employees', { full_name: 'Тест' });
    const res = await ctx.api.patch(`/api/employees/${created.body.id}`, {});
    assert.equal(res.status, 400);
  });

  it('DELETE видаляє запис (204), далі GET -> 404', async () => {
    const created = await ctx.api.post('/api/employees', { full_name: 'На видалення' });
    const deleted = await ctx.api.del(`/api/employees/${created.body.id}`);
    assert.equal(deleted.status, 204);

    const fetched = await ctx.api.get(`/api/employees/${created.body.id}`);
    assert.equal(fetched.status, 404);
  });

  it('DELETE працівника, на якого посилається шляховий лист -> 409 (FK RESTRICT)', async () => {
    const employee = await ctx.api.post('/api/employees', { full_name: 'Зайнятий' });
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.body.id,
      work_type_id: workType.id,
      area_ha: 5,
    });

    const res = await ctx.api.del(`/api/employees/${employee.body.id}`);
    assert.equal(res.status, 409);
  });
});
