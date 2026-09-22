import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipmentModel, seedWorkType } from '../helpers/seed.js';

describe('tariffs — кастомний роутер (model_ids, /resolve, /usage)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('POST з model_ids прив’язує марки техніки до тарифу', async () => {
    const workType = seedWorkType(ctx.db);
    const modelA = seedEquipmentModel(ctx.db, { label: 'МТЗ', key: 'mtz' });
    const modelB = seedEquipmentModel(ctx.db, { label: 'John Deere', key: 'jd' });

    const created = await ctx.api.post('/api/tariffs', {
      work_type_id: workType.id,
      unit: 'ha',
      rate: 90,
      model_ids: [modelA.id, modelB.id],
    });
    assert.equal(created.status, 201);

    const models = await ctx.api.get(`/api/tariffs/${created.body.id}/models`);
    assert.equal(models.body.items.length, 2);
    assert.deepEqual(
      models.body.items.map((m) => m.label).sort(),
      ['John Deere', 'МТЗ'],
    );
  });

  it('PUT /:id/models повністю замінює прив’язки', async () => {
    const workType = seedWorkType(ctx.db);
    const modelA = seedEquipmentModel(ctx.db, { label: 'МТЗ', key: 'mtz2' });
    const modelB = seedEquipmentModel(ctx.db, { label: 'John Deere', key: 'jd2' });

    const created = await ctx.api.post('/api/tariffs', {
      work_type_id: workType.id,
      unit: 'ha',
      rate: 90,
      model_ids: [modelA.id],
    });

    await ctx.api.put(`/api/tariffs/${created.body.id}/models`, { model_ids: [modelB.id] });

    const models = await ctx.api.get(`/api/tariffs/${created.body.id}/models`);
    assert.equal(models.body.items.length, 1);
    assert.equal(models.body.items[0].label, 'John Deere');
  });

  it('POST/GET повертають model_ids прямо в рядку тарифу (без окремого запиту до /models)', async () => {
    const workType = seedWorkType(ctx.db);
    const modelA = seedEquipmentModel(ctx.db, { label: 'Case', key: 'case3' });
    const modelB = seedEquipmentModel(ctx.db, { label: 'Claas', key: 'claas3' });

    const created = await ctx.api.post('/api/tariffs', {
      work_type_id: workType.id,
      unit: 'ha',
      rate: 201,
      model_ids: [modelA.id, modelB.id],
    });
    assert.deepEqual(created.body.model_ids.sort(), [modelA.id, modelB.id].sort());

    const fetched = await ctx.api.get(`/api/tariffs/${created.body.id}`);
    assert.deepEqual(fetched.body.model_ids.sort(), [modelA.id, modelB.id].sort());

    const list = await ctx.api.get('/api/tariffs');
    const row = list.body.items.find((i) => i.id === created.body.id);
    assert.deepEqual(row.model_ids.sort(), [modelA.id, modelB.id].sort());
  });

  it('тариф без прив’язаних марок -> model_ids: []', async () => {
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 90 });
    assert.deepEqual(created.body.model_ids, []);
  });

  it('GET / повертає список і фільтрує через ?q= по назві роботи/техніці/інвентарю', async () => {
    const plowing = seedWorkType(ctx.db, { name: 'Оранка' });
    const sowing = seedWorkType(ctx.db, { name: 'Сівба' });
    await ctx.api.post('/api/tariffs', { work_type_id: plowing.id, unit: 'ha', rate: 90 });
    await ctx.api.post('/api/tariffs', { work_type_id: sowing.id, unit: 'ha', rate: 120 });

    const all = await ctx.api.get('/api/tariffs');
    assert.equal(all.body.total, 2);

    const filtered = await ctx.api.get('/api/tariffs?q=оран');
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0].work_type_name, 'Оранка');
  });

  it('GET /:id повертає тариф з декорованими unit_label/rate_label', async () => {
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 90 });

    const res = await ctx.api.get(`/api/tariffs/${created.body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, created.body.id);
    assert.equal(res.body.unit_label, 'га');
  });

  it('GET /:id — 404 для відсутнього тарифу', async () => {
    const res = await ctx.api.get('/api/tariffs/999999');
    assert.equal(res.status, 404);
  });

  it('PUT /:id/models — 404 для відсутнього тарифу', async () => {
    const res = await ctx.api.put('/api/tariffs/999999/models', { model_ids: [] });
    assert.equal(res.status, 404);
  });

  it('GET /resolve без ідентифікаторів -> 400', async () => {
    const res = await ctx.api.get('/api/tariffs/resolve');
    assert.equal(res.status, 400);
  });

  it('GET /resolve?work_type_id= повертає єдиний тариф', async () => {
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 75 });

    const res = await ctx.api.get(`/api/tariffs/resolve?work_type_id=${workType.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.rate.id, created.body.id);
  });

  it('GET /:id/usage рахує кількість шляхових з цим тарифом', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 75 });

    const zero = await ctx.api.get(`/api/tariffs/${created.body.id}/usage`);
    assert.equal(zero.body.worklogs, 0);

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      tariff_rate_id: created.body.id,
      area_ha: 5,
    });

    const one = await ctx.api.get(`/api/tariffs/${created.body.id}/usage`);
    assert.equal(one.body.worklogs, 1);
  });

  it('DELETE тарифу, використаного в шляховому -> дозволено, tariff_rate_id стає NULL (ON DELETE SET NULL)', async () => {
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 75 });

    const worklog = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-03',
      employee_id: employee.id,
      work_type_id: workType.id,
      tariff_rate_id: created.body.id,
      area_ha: 5,
    });

    const deleted = await ctx.api.del(`/api/tariffs/${created.body.id}`);
    assert.equal(deleted.status, 204);

    const fetched = await ctx.api.get(`/api/worklogs/${worklog.body.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.tariff_rate_id, null);
    // знімок суми лишається незмінним (не перераховується заднім числом)
    assert.equal(fetched.body.total_amount, 375);
  });

  it('PATCH одного поля не перезаписує інші дефолтні поля (regression)', async () => {
    const workType = seedWorkType(ctx.db);
    const created = await ctx.api.post('/api/tariffs', {
      work_type_id: workType.id,
      unit: 'ha',
      rate: 170,
      secondary_unit: 'ton',
      secondary_rate: 8,
    });
    assert.equal(created.body.rate, 170);
    assert.equal(created.body.secondary_rate, 8);

    // Надсилаємо лише одне поле — решта (у т.ч. ті, що мають .default() у
    // схемі) мають лишитися незмінними, а не скинутися до дефолту.
    const patched = await ctx.api.patch(`/api/tariffs/${created.body.id}`, { rate: 175 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.rate, 175);
    assert.equal(patched.body.secondary_unit, 'ton');
    assert.equal(patched.body.secondary_rate, 8);
  });

  it('POST з дублікатом (work_type_id, equipment_label, implement_label, unit) -> 409', async () => {
    const workType = seedWorkType(ctx.db);
    await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 75 });
    const dup = await ctx.api.post('/api/tariffs', { work_type_id: workType.id, unit: 'ha', rate: 999 });
    assert.equal(dup.status, 409);
  });
});
