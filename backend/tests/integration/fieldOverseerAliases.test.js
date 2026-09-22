import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedField } from '../helpers/seed.js';

describe('fields — POST /fields/:id/overseer-aliases (кілька написань поля з Hecterra)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('без наявного overseer_name -> записує напряму (без окремого аліасу)', async () => {
    const field = seedField(ctx.db, { overseer_name: null });

    const res = await ctx.api.post(`/api/fields/${field.id}/overseer-aliases`, { alias: 'Поле № 4-В 47 га' });
    assert.equal(res.status, 201);
    assert.equal(res.body.overseer_name, 'Поле № 4-В 47 га');
  });

  it('з уже наявним overseer_name -> ДОДАЄ друге написання, не затирає перше (РЕГРЕСІЯ)', async () => {
    // Живий баг: Hecterra між імпортами міняє площу в назві поля
    // ("...47 га" -> "...51 га") - PATCH overseer_name затирав старе
    // написання, і воно саме ставало "нерозпізнаним" при наступному імпорті
    // старих активностей.
    const field = seedField(ctx.db, { overseer_name: 'Поле № 4-В 47 га' });

    const res = await ctx.api.post(`/api/fields/${field.id}/overseer-aliases`, { alias: 'Поле № 4-В 51 га' });
    assert.equal(res.status, 201);
    // основне написання лишається незмінним - головна вимога цього фікса
    assert.equal(res.body.overseer_name, 'Поле № 4-В 47 га');

    // і обидва написання тепер резолвяться на це ж поле
    await ctx.api.post('/api/hecterra/import', {
      activities: [
        { activity_date: '2026-08-04', overseer_name: 'John Deere', field_name_raw: 'Поле № 4-В 47 га', area_ha: 10 },
        { activity_date: '2026-08-13', overseer_name: 'Case', field_name_raw: 'Поле № 4-В 51 га', area_ha: 12 },
      ],
    });
    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.ok(activities.body.items.every((a) => a.field_id === field.id));

    const unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.deepEqual(unmapped.body.items, []);
  });

  it('написання вже прив’язане до ІНШОГО поля -> 409', async () => {
    seedField(ctx.db, { overseer_name: 'Поле № 4-В 47 га' });
    const other = seedField(ctx.db, { name: 'Інше поле', overseer_name: null });

    const res = await ctx.api.post(`/api/fields/${other.id}/overseer-aliases`, { alias: 'Поле № 4-В 47 га' });
    assert.equal(res.status, 409);
  });

  it('написання вже прив’язане до ТОГО САМОГО поля -> ідемпотентно, 201 без дублю', async () => {
    const field = seedField(ctx.db, { overseer_name: 'Поле № 4-В 47 га' });

    const res = await ctx.api.post(`/api/fields/${field.id}/overseer-aliases`, { alias: 'Поле № 4-В 47 га' });
    assert.equal(res.status, 201);
    assert.equal(res.body.overseer_name, 'Поле № 4-В 47 га');
  });

  it('неіснуюче поле -> 404', async () => {
    const res = await ctx.api.post('/api/fields/999999/overseer-aliases', { alias: 'Хтось' });
    assert.equal(res.status, 404);
  });
});
