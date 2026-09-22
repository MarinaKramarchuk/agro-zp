import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('field-control — GET /field-control (контроль гектарів)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('поле без записів -> порожній breakdown, has_excess=false', async () => {
    const field = seedField(ctx.db, { name: 'Порожнє поле', area_ha: 40 });

    const res = await ctx.api.get('/api/field-control');
    assert.equal(res.status, 200);
    const item = res.body.items.find((i) => i.field_id === field.id);
    assert.deepEqual(item.breakdown, []);
    assert.equal(item.has_excess, false);
  });

  it('обробіток у межах площі поля -> без перевищення', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле А', area_ha: 40 });
    const workType = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 30,
    });

    const res = await ctx.api.get('/api/field-control');
    const item = res.body.items.find((i) => i.field_id === field.id);
    assert.equal(item.breakdown.length, 1);
    assert.equal(item.breakdown[0].worked_ha, 30);
    assert.equal(item.breakdown[0].excess_ha, 0);
    assert.equal(item.breakdown[0].percent_of_field, 75);
    assert.equal(item.has_excess, false);
  });

  it('обробіток понад площу в межах ОДНОГО виду робіт -> перевищення', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле Б', area_ha: 40 });
    const workType = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 25,
    });
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-02',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 25,
    }); // разом 50 га на полі площею 40 га

    const res = await ctx.api.get('/api/field-control');
    const item = res.body.items.find((i) => i.field_id === field.id);
    assert.equal(item.breakdown[0].worked_ha, 50);
    assert.equal(item.breakdown[0].excess_ha, 10);
    assert.equal(item.has_excess, true);
    assert.equal(res.body.totals.fields_with_excess, 1);
  });

  it('різні види робіт на тому самому полі рахуються окремо (оранка + сівба, кожна ~= площі поля — без перевищення)', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле В', area_ha: 40 });
    const plowing = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    const sowing = seedWorkType(ctx.db, { name: 'Сівба', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: plowing.id, unit: 'ha', rate: 100 });
    seedTariff(ctx.db, { work_type_id: sowing.id, unit: 'ha', rate: 120 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: plowing.id,
      field_id: field.id,
      area_ha: 40,
    });
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-05',
      employee_id: employee.id,
      work_type_id: sowing.id,
      field_id: field.id,
      area_ha: 40,
    });

    const res = await ctx.api.get('/api/field-control');
    const item = res.body.items.find((i) => i.field_id === field.id);
    assert.equal(item.breakdown.length, 2);
    assert.ok(item.breakdown.every((b) => b.excess_ha === 0));
    assert.equal(item.has_excess, false);
  });

  it('без all_work_types приховує неконтрольовані види робіт (напр. обприскування - може повторюватись)', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле Ґ', area_ha: 40 });
    const plowing = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    const spraying = seedWorkType(ctx.db, { name: 'Обприскування', is_area_checked: 0 });
    seedTariff(ctx.db, { work_type_id: plowing.id, unit: 'ha', rate: 100 });
    seedTariff(ctx.db, { work_type_id: spraying.id, unit: 'ha', rate: 50 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: plowing.id,
      field_id: field.id,
      area_ha: 40,
    });
    // Обприскування пройшло тричі - 120 га на полі 40 га, це нормально й не
    // має рахуватись як "перевищення".
    for (const date of ['2026-08-05', '2026-08-10', '2026-08-15']) {
      await ctx.api.post('/api/worklogs', {
        work_date: date,
        employee_id: employee.id,
        work_type_id: spraying.id,
        field_id: field.id,
        area_ha: 40,
      });
    }

    const hidden = await ctx.api.get('/api/field-control');
    const hiddenItem = hidden.body.items.find((i) => i.field_id === field.id);
    assert.equal(hiddenItem.breakdown.length, 1);
    assert.equal(hiddenItem.breakdown[0].work_type_name, 'Оранка');

    const shown = await ctx.api.get('/api/field-control?all_work_types=1');
    const shownItem = shown.body.items.find((i) => i.field_id === field.id);
    assert.equal(shownItem.breakdown.length, 2);
    const sprayRow = shownItem.breakdown.find((b) => b.work_type_name === 'Обприскування');
    assert.equal(sprayRow.worked_ha, 120);
    // 120 га на полі 40 га - перевищення все одно 0, бо вид роботи не контрольований
    assert.equal(sprayRow.excess_ha, 0);
  });

  it('фільтр по field_id повертає лише вказане поле', async () => {
    const fieldA = seedField(ctx.db, { name: 'A' });
    seedField(ctx.db, { name: 'B' });

    const res = await ctx.api.get(`/api/field-control?field_id=${fieldA.id}`);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].field_id, fieldA.id);
  });

  it('date_from/date_to (валідний діапазон) обмежують вибірку worklogs', async () => {
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db, { name: 'Поле Г', area_ha: 40 });
    const workType = seedWorkType(ctx.db, { name: 'Оранка', is_area_checked: 1 });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 10,
    }); // у межах
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-09-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      field_id: field.id,
      area_ha: 99,
    }); // поза межами

    const res = await ctx.api.get('/api/field-control?date_from=2026-08-01&date_to=2026-08-31');
    const item = res.body.items.find((i) => i.field_id === field.id);
    assert.equal(item.breakdown[0].worked_ha, 10);
  });

  it('date_from пізніше date_to -> 400', async () => {
    const res = await ctx.api.get('/api/field-control?date_from=2026-08-10&date_to=2026-08-01');
    assert.equal(res.status, 400);
  });
});
