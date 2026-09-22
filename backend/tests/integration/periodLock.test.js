import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedWorkType } from '../helpers/seed.js';

function hourlyWorklogFixture(employee, workType, overrides = {}) {
  return {
    work_date: '2026-09-11',
    employee_id: employee.id,
    work_type_id: workType.id,
    pay_mode: 'hourly',
    hours: 8,
    ...overrides,
  };
}

describe('замикання періоду (locked_periods)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  describe('GET/POST/DELETE /payroll/locked-periods', () => {
    it('за замовчуванням закритих періодів немає', async () => {
      const res = await ctx.api.get('/api/payroll/locked-periods');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.items, []);
    });

    it('POST закриває місяць, GET показує його, DELETE відкриває назад', async () => {
      const lockRes = await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9, locked_by: 'Марія' });
      assert.equal(lockRes.status, 201);
      assert.deepEqual(
        { year: lockRes.body.year, month: lockRes.body.month, locked_by: lockRes.body.locked_by },
        { year: 2026, month: 9, locked_by: 'Марія' },
      );

      const listRes = await ctx.api.get('/api/payroll/locked-periods');
      assert.equal(listRes.body.items.length, 1);
      assert.equal(listRes.body.items[0].year, 2026);
      assert.equal(listRes.body.items[0].month, 9);

      const unlockRes = await ctx.api.del('/api/payroll/locked-periods/2026/9');
      assert.equal(unlockRes.status, 204);

      const listAfter = await ctx.api.get('/api/payroll/locked-periods');
      assert.deepEqual(listAfter.body.items, []);
    });

    it('повторний POST того самого місяця оновлює locked_by/locked_at, не дублює запис', async () => {
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9, locked_by: 'Марія' });
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9, locked_by: 'Олена' });

      const listRes = await ctx.api.get('/api/payroll/locked-periods');
      assert.equal(listRes.body.items.length, 1);
      assert.equal(listRes.body.items[0].locked_by, 'Олена');
    });

    it('невалідний місяць (13) -> 422', async () => {
      const res = await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 13 });
      assert.equal(res.status, 422);
    });

    it('DELETE неіснуючого закриття - все одно 204 (ідемпотентно)', async () => {
      const res = await ctx.api.del('/api/payroll/locked-periods/2026/9');
      assert.equal(res.status, 204);
    });
  });

  describe('блокує зміни worklogs у закритому місяці', () => {
    it('створення шляхового в закритому місяці -> 409', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const res = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      assert.equal(res.status, 409);
      assert.match(res.body.error, /09\.2026/);
    });

    it('багатоденний запис, що зачіпає закритий місяць лише кінцем (work_date_to) -> теж 409', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 10 });

      const res = await ctx.api.post('/api/worklogs', {
        work_date: '2026-09-29',
        work_date_to: '2026-10-02',
        employee_id: employee.id,
        work_type_id: workType.id,
        pay_mode: 'hourly',
        hours: 8,
      });
      assert.equal(res.status, 409);
    });

    it('створення поза закритим місяцем - працює як звичайно', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 8 });

      const res = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      assert.equal(res.status, 201);
    });

    it('редагування (навіть нейтрального поля) вже існуючого запису в закритому місяці -> 409', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      const created = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      assert.equal(created.status, 201);

      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const res = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { note: 'звірено' });
      assert.equal(res.status, 409);
    });

    it('перенесення дати запису В закритий місяць -> 409', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      const created = await ctx.api.post(
        '/api/worklogs',
        hourlyWorklogFixture(employee, workType, { work_date: '2026-08-15' }),
      );
      assert.equal(created.status, 201);

      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const res = await ctx.api.patch(`/api/worklogs/${created.body.id}`, {
        work_date: '2026-09-01',
        work_date_to: '2026-09-01',
      });
      assert.equal(res.status, 409);
    });

    it('видалення запису в закритому місяці -> 409', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      const created = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      assert.equal(created.status, 201);

      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const res = await ctx.api.del(`/api/worklogs/${created.body.id}`);
      assert.equal(res.status, 409);
    });

    it('після відкриття місяця назад - редагування й видалення знову працюють', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      const created = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const blocked = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { note: 'звірено' });
      assert.equal(blocked.status, 409);

      await ctx.api.del('/api/payroll/locked-periods/2026/9');

      const allowed = await ctx.api.patch(`/api/worklogs/${created.body.id}`, { note: 'звірено' });
      assert.equal(allowed.status, 200);

      const deleted = await ctx.api.del(`/api/worklogs/${created.body.id}`);
      assert.equal(deleted.status, 204);
    });

    it('масове підтвердження (bulk-confirm) з одним записом у закритому місяці -> 409, жоден не змінюється', async () => {
      const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
      const workType = seedWorkType(ctx.db);
      const open = await ctx.api.post(
        '/api/worklogs',
        hourlyWorklogFixture(employee, workType, { work_date: '2026-08-15' }),
      );
      const locked = await ctx.api.post('/api/worklogs', hourlyWorklogFixture(employee, workType));
      await ctx.api.post('/api/payroll/locked-periods', { year: 2026, month: 9 });

      const res = await ctx.api.patch('/api/worklogs/bulk-confirm', {
        ids: [open.body.id, locked.body.id],
        confirmed: true,
      });
      assert.equal(res.status, 409);

      const check = await ctx.api.get(`/api/worklogs/${open.body.id}`);
      assert.equal(check.body.confirmed, 0, 'запис поза закритим місяцем теж не мав змінитись — уся пачка відкотилась');
    });
  });
});
