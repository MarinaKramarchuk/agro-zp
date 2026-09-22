import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEquipment, seedEquipmentModel, seedTariff, seedWorkType, linkTariffModel } from '../helpers/seed.js';

describe('work-types — /units, /with-rates, /:id/rates', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('GET /work-types/units повертає всі 8 одиниць виміру з мітками', async () => {
    const res = await ctx.api.get('/api/work-types/units');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 8);
    const ha = res.body.items.find((u) => u.unit === 'ha');
    assert.equal(ha.label, 'га');
    assert.deepEqual(ha.required_metrics, ['area_ha']);
  });

  it('GET /work-types/with-rates рахує кількість тарифів і перелік одиниць', async () => {
    const workType = seedWorkType(ctx.db, { name: 'Оранка' });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', equipment_label: 'МТЗ', rate: 60 });
    seedWorkType(ctx.db, { name: 'Без тарифів' });

    const res = await ctx.api.get('/api/work-types/with-rates');
    const withRates = res.body.items.find((w) => w.name === 'Оранка');
    assert.equal(withRates.rates_count, 2);
    assert.deepEqual(withRates.units.sort(), ['ha', 'hour']);

    const withoutRates = res.body.items.find((w) => w.name === 'Без тарифів');
    assert.equal(withoutRates.rates_count, 0);
    assert.deepEqual(withoutRates.units, []);
  });

  it('GET /work-types/with-rates?staff_group= фільтрує', async () => {
    seedWorkType(ctx.db, { name: 'Водійська', staff_group: 'driver' });
    seedWorkType(ctx.db, { name: 'Тракторна', staff_group: 'tractor' });

    const res = await ctx.api.get('/api/work-types/with-rates?staff_group=driver');
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, 'Водійська');
  });

  it('GET /work-types/:id/rates повертає варіанти тарифів, відфільтровані за технікою', async () => {
    const workType = seedWorkType(ctx.db);
    const model = seedEquipmentModel(ctx.db, { label: 'МТЗ' });
    const equipment = seedEquipment(ctx.db, { model_id: model.id });

    const universal = seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 90 });
    const brandOnly = seedTariff(ctx.db, { work_type_id: workType.id, unit: 'hour', rate: 60 });
    linkTariffModel(ctx.db, brandOnly.id, model.id);

    const all = await ctx.api.get(`/api/work-types/${workType.id}/rates`);
    assert.equal(all.body.items.length, 2);

    const forEquipment = await ctx.api.get(`/api/work-types/${workType.id}/rates?equipment_id=${equipment.id}`);
    assert.equal(forEquipment.body.items.length, 2); // universal + brand match

    assert.ok(forEquipment.body.items.some((r) => r.id === universal.id));
    assert.ok(forEquipment.body.items.some((r) => r.id === brandOnly.id));
  });
});
