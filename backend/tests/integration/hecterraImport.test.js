// Тести інфраструктури Hecterra на СИНТЕТИЧНИХ даних у нашому внутрішньому
// форматі (доступу до реального формату Hecterra ще немає — див.
// services/hecterra/importService.js). Ключове тут — правило "ручне завжди
// головніше": area_ha, яке ввела людина, не повинно змінюватись повторним
// імпортом Hecterra.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipment, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('hecterra — POST /hecterra/import, GET /hecterra/activities, GET /hecterra/unmapped', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  const activity = (overrides = {}) => ({
    activity_date: '2026-08-11',
    overseer_name: 'Китаєць',
    hecterra_field_id: 'F-001',
    field_name_raw: 'Поле №1',
    area_ha: 9.5,
    work_type_raw: 'Культивація',
    ...overrides,
  });

  it('імпорт нових активностей -> added, поле без прив’язки потрапляє в unmapped', async () => {
    const res = await ctx.api.post('/api/hecterra/import', { activities: [activity()] });
    assert.equal(res.status, 200);
    assert.deepEqual(
      { activitiesProcessed: res.body.activitiesProcessed, added: res.body.added, updated: res.body.updated, unchanged: res.body.unchanged },
      { activitiesProcessed: 1, added: 1, updated: 0, unchanged: 0 },
    );

    const unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 1);
    assert.equal(unmapped.body.items[0].hecterra_field_id, 'F-001');
  });

  it('повторний імпорт тієї самої активності -> unchanged; зміна площі -> updated', async () => {
    await ctx.api.post('/api/hecterra/import', { activities: [activity()] });

    const same = await ctx.api.post('/api/hecterra/import', { activities: [activity()] });
    assert.deepEqual({ added: same.body.added, updated: same.body.updated, unchanged: same.body.unchanged }, { added: 0, updated: 0, unchanged: 1 });

    const changed = await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 11.2 })] });
    assert.deepEqual({ added: changed.body.added, updated: changed.body.updated, unchanged: changed.body.unchanged }, { added: 0, updated: 1, unchanged: 0 });
  });

  it('прив’язка fields.gektera_field_id заднім числом резолвить field_id в активностях, unmapped самоочищується', async () => {
    const field = seedField(ctx.db, { name: 'Поле №1 (Північне)' });
    await ctx.api.post('/api/hecterra/import', { activities: [activity()] });

    let unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 1);

    const patch = await ctx.api.patch(`/api/fields/${field.id}`, { gektera_field_id: 'F-001' });
    assert.equal(patch.status, 200);

    unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 0);

    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.equal(activities.body.items[0].field_id, field.id);
  });

  it('POST /hecterra/unmapped/dismiss ховає поле назавжди - повторний імпорт не повертає його', async () => {
    await ctx.api.post('/api/hecterra/import', { activities: [activity()] });

    let unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 1);

    const dismiss = await ctx.api.post('/api/hecterra/unmapped/dismiss', { value: 'F-001' });
    assert.equal(dismiss.status, 204);

    unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 0);

    await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 12.3 })] });
    unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 0);
  });

  it('дисміс в одній категорії не ховає той самий текстовий збіг в іншій (водій vs вид робіт)', async () => {
    await ctx.api.post('/api/hecterra/import', {
      activities: [activity({ driver_name_raw: 'Загадка', work_type_raw: 'Загадка' })],
    });

    const dismiss = await ctx.api.post('/api/hecterra/unmapped-drivers/dismiss', { value: 'Загадка' });
    assert.equal(dismiss.status, 204);

    const drivers = await ctx.api.get('/api/hecterra/unmapped-drivers');
    assert.equal(drivers.body.items.length, 0);

    const workTypes = await ctx.api.get('/api/hecterra/unmapped-work-types');
    assert.equal(workTypes.body.items.length, 1);
    assert.equal(workTypes.body.items[0].work_type_raw, 'Загадка');
  });

  it('РЕГРЕСІЯ: поле БЕЗ hecterra_field_id (звіт "Оброблено полів" не дає ID, лише назву) теж можна прив\'язати - за overseer_name', async () => {
    // раніше unmapped дивився лише на hecterra_field_id - поля з таких звітів
    // ніколи не показувались у списку прив'язки, навіть якщо вже були в довіднику
    const field = seedField(ctx.db, { name: 'Поле №4-П 132 га' });
    await ctx.api.post('/api/hecterra/import', {
      activities: [activity({ hecterra_field_id: null, field_name_raw: 'Поле №4-П 132 га' })],
    });

    let unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 1);
    assert.equal(unmapped.body.items[0].hecterra_field_id, null);
    assert.equal(unmapped.body.items[0].field_name_raw, 'Поле №4-П 132 га');

    const patch = await ctx.api.patch(`/api/fields/${field.id}`, { overseer_name: 'Поле №4-П 132 га' });
    assert.equal(patch.status, 200);

    unmapped = await ctx.api.get('/api/hecterra/unmapped');
    assert.equal(unmapped.body.items.length, 0);

    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.equal(activities.body.items[0].field_id, field.id);
  });

  it('шляховий з hecterra_activity_id зберігає area_ha_auto = area_ha активності на момент збереження', async () => {
    const equipment = seedEquipment(ctx.db, { overseer_name: 'Китаєць' });
    const field = seedField(ctx.db, { gektera_field_id: 'F-001' });
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const imported = await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 9.5 })] });
    const activityId = (await ctx.api.get('/api/hecterra/activities')).body.items[0].id;
    assert.equal(imported.status, 200);

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      hecterra_activity_id: activityId,
      area_ha: 7.2, // людина ввела інше значення, ніж підказала Hecterra
      manual_rate: 100,
      unit: 'ha',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.area_ha, 7.2, 'ручне значення йде в запис');
    assert.equal(created.body.area_ha_auto, 9.5, 'підказка Hecterra зберігається окремо для порівняння');
    // сума рахується за РУЧНИМ значенням (7.2 * 100 = 720), а не за підказкою Hecterra (9.5 * 100 = 950)
    assert.equal(created.body.total_amount, 720);
  });

  it('GET /hecterra/activities позначає has_worklog лише для тієї активності, яку справді погоджено (не для всього дня×техніки)', async () => {
    const equipment = seedEquipment(ctx.db, { overseer_name: 'Китаєць' });
    const field = seedField(ctx.db, { gektera_field_id: 'F-001' });
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    // два проходи тим самим днем/технікою, але різні поля (типовий випадок -
    // один водій за день обробляє кілька полів)
    await ctx.api.post('/api/hecterra/import', {
      activities: [
        activity({ area_ha: 9.5, hecterra_field_id: 'F-001' }),
        activity({ area_ha: 4.0, hecterra_field_id: 'F-002' }),
      ],
    });
    const [act1, act2] = (await ctx.api.get('/api/hecterra/activities')).body.items
      .sort((a, b) => a.hecterra_field_id.localeCompare(b.hecterra_field_id));

    let list = await ctx.api.get('/api/hecterra/activities');
    assert.ok(list.body.items.every((i) => i.has_worklog === 0), 'до реєстрації жодна активність не позначена');

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      hecterra_activity_id: act1.id,
      area_ha: 9.5,
      manual_rate: 100,
      unit: 'ha',
    });

    list = await ctx.api.get('/api/hecterra/activities');
    const byId = Object.fromEntries(list.body.items.map((i) => [i.id, i.has_worklog]));
    assert.equal(byId[act1.id], 1, 'ця активність погоджена');
    assert.equal(byId[act2.id], 0, 'сусідня активність того самого дня/техніки - ще ні');
  });

  it('ПРАВИЛО "ручне головніше": повторний імпорт Hecterra з іншою площею НЕ змінює вже збережений шляховий', async () => {
    const equipment = seedEquipment(ctx.db, { overseer_name: 'Китаєць' });
    const field = seedField(ctx.db, { gektera_field_id: 'F-001' });
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 9.5 })] });
    const activityId = (await ctx.api.get('/api/hecterra/activities')).body.items[0].id;

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      hecterra_activity_id: activityId,
      area_ha: 7.2,
      manual_rate: 100,
      unit: 'ha',
    });

    // Hecterra "переглянула" площу заднім числом
    const reImport = await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 15.0 })] });
    assert.equal(reImport.body.updated, 1);

    const worklogAfter = await ctx.api.get(`/api/worklogs/${created.body.id}`);
    assert.equal(worklogAfter.body.area_ha, 7.2, 'area_ha не змінюється повторним імпортом Hecterra');
    assert.equal(worklogAfter.body.total_amount, 720, 'сума не перераховується заднім числом');
    // area_ha_auto теж лишається знімком з моменту збереження, а не live-значенням
    assert.equal(worklogAfter.body.area_ha_auto, 9.5);
  });

  it('редагування шляхового (без зміни hecterra_activity_id) оновлює area_ha_auto до поточного значення активності', async () => {
    const equipment = seedEquipment(ctx.db, { overseer_name: 'Китаєць' });
    const field = seedField(ctx.db, { gektera_field_id: 'F-001' });
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 9.5 })] });
    const activityId = (await ctx.api.get('/api/hecterra/activities')).body.items[0].id;

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      hecterra_activity_id: activityId,
      area_ha: 7.2,
      manual_rate: 100,
      unit: 'ha',
    });

    await ctx.api.post('/api/hecterra/import', { activities: [activity({ area_ha: 15.0 })] });

    // людина зайшла в запис і змінила примітку (не area_ha) - area_ha_auto підтягує свіже значення
    const updated = await ctx.api.put(`/api/worklogs/${created.body.id}`, { note: 'перевірено' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.area_ha, 7.2, 'area_ha і далі не чіпається');
    assert.equal(updated.body.area_ha_auto, 15.0, 'area_ha_auto - живий знімок на момент збереження');
  });

  it('hecterra_activity_id, якого не існує -> 422', async () => {
    const equipment = seedEquipment(ctx.db);
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    const res = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      work_type_id: workType.id,
      hecterra_activity_id: 999999,
      area_ha: 5,
      manual_rate: 100,
      unit: 'ha',
    });
    assert.equal(res.status, 422);
  });

  it('порожній масив активностей -> 422', async () => {
    const res = await ctx.api.post('/api/hecterra/import', { activities: [] });
    assert.equal(res.status, 422);
  });

  it('DELETE /hecterra/activities/:id прибирає непотрібний рядок, не чіпаючи вже збережений шляховий', async () => {
    const equipment = seedEquipment(ctx.db, { overseer_name: 'Китаєць' });
    const field = seedField(ctx.db, { gektera_field_id: 'F-001' });
    const employee = seedEmployee(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/hecterra/import', { activities: [activity()] });
    const activityId = (await ctx.api.get('/api/hecterra/activities')).body.items[0].id;

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      hecterra_activity_id: activityId,
      area_ha: 7.2,
      manual_rate: 100,
      unit: 'ha',
    });

    const del = await ctx.api.del(`/api/hecterra/activities/${activityId}`);
    assert.equal(del.status, 204);

    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.equal(activities.body.items.length, 0);

    const worklogAfter = await ctx.api.get(`/api/worklogs/${created.body.id}`);
    assert.equal(worklogAfter.status, 200, 'шляховий лишається на місці після видалення чернетки');
    assert.equal(worklogAfter.body.area_ha, 7.2);
    assert.equal(worklogAfter.body.hecterra_activity_id, null, 'посилання на видалену активність очищене (ON DELETE SET NULL)');
  });

  it('DELETE неіснуючого id -> 404', async () => {
    const res = await ctx.api.del('/api/hecterra/activities/999999');
    assert.equal(res.status, 404);
  });

  it('РЕГРЕСІЯ: кілька водіїв в одному проході ("А, Б") резолвляться по частинах, не пишуться в employees.overseer_name цілком', async () => {
    const employee = seedEmployee(ctx.db, { full_name: 'Іванов', overseer_name: 'Іванов' });

    await ctx.api.post('/api/hecterra/import', {
      activities: [
        activity({ hecterra_field_id: null, field_name_raw: 'Поле А', driver_name_raw: 'Іванов' }),
        activity({ hecterra_field_id: null, field_name_raw: 'Поле Б', driver_name_raw: 'Петров П, 19. Іванов' }),
      ],
    });

    const activities = await ctx.api.get('/api/hecterra/activities');
    const byField = Object.fromEntries(activities.body.items.map((a) => [a.field_name_raw, a]));

    assert.equal(byField['Поле А'].employee_id, employee.id, 'чисте ім\'я матчиться напряму');
    assert.equal(byField['Поле Б'].employee_id, employee.id, 'у комбінованому рядку знаходиться Іванов по частинах');

    // ключове: employees.overseer_name НЕ мав перезаписатись комбінованим рядком
    const emp = await ctx.api.get(`/api/employees/${employee.id}`);
    assert.equal(emp.body.overseer_name, 'Іванов');
  });

  it('GET /hecterra/unmapped-drivers: комбіноване ім\'я з розпізнаваною частиною зникає зі списку', async () => {
    seedEmployee(ctx.db, { full_name: 'Іванов', overseer_name: 'Іванов' });

    await ctx.api.post('/api/hecterra/import', {
      activities: [activity({ driver_name_raw: 'Петров П, 19. Іванов' })],
    });

    const res = await ctx.api.get('/api/hecterra/unmapped-drivers');
    assert.deepEqual(res.body.items, [], 'частину "Іванов" уже розпізнано - висіти вічно не має');
  });

  it('GET /hecterra/unmapped-drivers: комбіноване ім\'я БЕЗ жодної розпізнаваної частини лишається в списку', async () => {
    await ctx.api.post('/api/hecterra/import', {
      activities: [activity({ driver_name_raw: 'Петров П, 19. Невідомий' })],
    });

    const res = await ctx.api.get('/api/hecterra/unmapped-drivers');
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].driver_name_raw, 'Петров П, 19. Невідомий');
  });

  it('РЕГРЕСІЯ: два різні поля того самого дня/техніки БЕЗ hecterra_field_id не зливаються в один запис', async () => {
    // Звіти "Оброблено полів" (на відміну від KMZ-меж) не дають ID поля -
    // раніше унікальний ключ (дата, техніка, IFNULL(field_id,'')) без назви
    // поля в ключі тихо затирав другий запис першим.
    const res = await ctx.api.post('/api/hecterra/import', {
      activities: [
        activity({ hecterra_field_id: null, field_name_raw: 'Поле № 5-В 37ГА', area_ha: 10.92, field_area_ha: 37 }),
        activity({ hecterra_field_id: null, field_name_raw: 'Поле№ 9-Б  88 га', area_ha: 78.58, field_area_ha: 88.07 }),
      ],
    });
    assert.deepEqual(
      { added: res.body.added, updated: res.body.updated, unchanged: res.body.unchanged },
      { added: 2, updated: 0, unchanged: 0 },
    );

    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.equal(activities.body.items.length, 2);
    const names = activities.body.items.map((a) => a.field_name_raw).sort();
    assert.deepEqual(names, ['Поле № 5-В 37ГА', 'Поле№ 9-Б  88 га']);
  });
});
