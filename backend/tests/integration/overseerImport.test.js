// Наскрізні тести імпорту звітів OVERSEER через реальний HTTP-роут, на
// знеособлених фікстурах (машина "Китаєць", серпень 2026; адреси вигадані).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipment, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/overseer');

const GENERAL = path.join(fixturesDir, 'Китаєць_Загальний_звіт_(Поїздки+_Витрати)_2026-08-11_15-12-13.xlsx');
const TRIPS_ONLY = path.join(fixturesDir, 'Китаєць_Поездки_2026-08-11_15-04-53.xlsx');
const FUEL = path.join(fixturesDir, 'Китаєць_Расхода_топлива_ДУТ_2026-08-11_15-05-05.xlsx');
const ALL_THREE = [GENERAL, TRIPS_ONLY, FUEL];
const CULTIVATIONS = path.resolve(here, '../fixtures/hecterra/Cultivations_for_unit_Китаєць.xlsx');

async function uploadOverseerFiles(baseUrl, filePaths) {
  const formData = new FormData();
  for (const filePath of filePaths) {
    const buf = fs.readFileSync(filePath);
    formData.append('files', new Blob([buf]), path.basename(filePath));
  }
  const res = await fetch(`${baseUrl}/api/overseer/import`, { method: 'POST', body: formData });
  return { status: res.status, body: await res.json() };
}

describe('overseer — POST /overseer/import, GET /overseer/facts, GET /overseer/unmapped', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('3 звіти одної машини -> 9 днів додано, техніка без прив’язки потрапляє в unmapped', async () => {
    const { status, body } = await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);
    assert.equal(status, 200);
    assert.equal(body.filesProcessed, 3);
    assert.equal(body.daysTouched, 9);
    assert.equal(body.added, 9);
    assert.equal(body.updated, 0);
    assert.equal(body.unchanged, 0);
    assert.equal(body.unmapped.length, 1);
    assert.equal(body.unmapped[0].overseer_name, 'Китаєць');
    assert.equal(body.unmapped[0].days, 9);

    const unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 1);
    assert.equal(unmapped.body.items[0].overseer_name, 'Китаєць');
  });

  it('повторне завантаження тих самих файлів -> ідемпотентно (added=0, updated=0, unchanged=9)', async () => {
    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);
    const { body } = await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);
    assert.equal(body.added, 0);
    assert.equal(body.updated, 0);
    assert.equal(body.unchanged, 9);
  });

  it('довантаження лише звіту палива не стирає вже завантажені мотогодини (мердж полів)', async () => {
    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);
    const { body } = await uploadOverseerFiles(ctx.baseUrl, [FUEL]);
    // той самий день (01.08) вже мав fuel_consumed з попереднього імпорту - unchanged, не updated
    assert.equal(body.unchanged, 6);

    const facts = await ctx.api.get('/api/overseer/facts?date_from=2026-08-01&date_to=2026-08-01');
    const day1 = facts.body.items.find((i) => i.fact_date === '2026-08-01');
    assert.ok(Math.abs(day1.engine_hours - 9.82) < 0.01, 'мотогодини лишились після довантаження лише палива');
    assert.ok(Math.abs(day1.fuel_consumed - 72.27) < 0.01);
  });

  it('прив’язка equipment.overseer_name заднім числом одразу підбирає вже завантажені факти (unmapped самоочищується)', async () => {
    const equipment = seedEquipment(ctx.db, { name: 'Трактор Китаєць' });
    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);

    let unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 1);

    const patch = await ctx.api.patch(`/api/equipment/${equipment.id}`, { overseer_name: 'Китаєць' });
    assert.equal(patch.status, 200);

    unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 0);

    const facts = await ctx.api.get('/api/overseer/facts?date_from=2026-08-01&date_to=2026-08-01');
    assert.equal(facts.body.items[0].equipment_id, equipment.id);
  });

  it('POST /overseer/unmapped/dismiss ховає назву назавжди - повторний імпорт не повертає її', async () => {
    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);

    let unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 1);

    const dismiss = await ctx.api.post('/api/overseer/unmapped/dismiss', { value: 'Китаєць' });
    assert.equal(dismiss.status, 204);

    unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 0);

    // повторне завантаження тих самих файлів не повертає приховану назву в unmapped
    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);
    unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.equal(unmapped.body.items.length, 0);
  });

  it('повторний імпорт не чіпає вже збережені шляхові листи', async () => {
    const equipment = seedEquipment(ctx.db, { name: 'Трактор Китаєць', overseer_name: 'Китаєць' });
    const employee = seedEmployee(ctx.db);
    const field = seedField(ctx.db);
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      area_ha: 12,
    });
    assert.equal(created.status, 201);

    const before = await ctx.api.get(`/api/worklogs/${created.body.id}`);

    await uploadOverseerFiles(ctx.baseUrl, ALL_THREE);

    const after = await ctx.api.get(`/api/worklogs/${created.body.id}`);
    assert.deepEqual(after.body, before.body);

    const facts = await ctx.api.get('/api/overseer/facts?date_from=2026-08-01&date_to=2026-08-01');
    const day1 = facts.body.items.find((i) => i.fact_date === '2026-08-01');
    assert.equal(day1.has_worklog, 1);
  });

  it('файл без даних (не .xlsx звіт OVERSEER) -> filesWithNoData, без падіння', async () => {
    const formData = new FormData();
    formData.append('files', new Blob(['not an excel file']), 'порожній.xlsx');
    const res = await fetch(`${ctx.baseUrl}/api/overseer/import`, { method: 'POST', body: formData });
    const body = await res.json();
    // порожній/невалідний xlsx -> помилка розбору файлу, не крах сервера
    assert.equal(res.status, 200);
    assert.ok(body.fileErrors.length === 1 || body.filesWithNoData.length === 1);
  });

  it('РЕГРЕСІЯ: звіт Hecterra "Оброблено полів" у ту саму зону завантаження -> розпізнається сам, а не тоне у filesWithNoData', async () => {
    const { status, body } = await uploadOverseerFiles(ctx.baseUrl, [CULTIVATIONS]);
    assert.equal(status, 200);
    assert.equal(body.filesWithNoData.length, 0, 'файл Hecterra не мав опинитись серед "не знайдено даних"');
    assert.equal(body.fileErrors.length, 0);
    assert.equal(body.hecterra.activitiesProcessed, 6);
    assert.equal(body.hecterra.added, 6);

    const activities = await ctx.api.get('/api/hecterra/activities');
    assert.equal(activities.body.items.length, 6);
  });

  it('РЕГРЕСІЯ: техніка, що є лише в Hecterra (без жодного OVERSEER-факту) теж потрапляє в /overseer/unmapped', async () => {
    // раніше unmapped дивився тільки в machine_facts - техніка, на яку є лише
    // Cultivations-звіт Hecterra (мотогодин OVERSEER нема), ніколи не показувалась
    // у списку для прив'язки і лишалась вічно "нерозпізнаною"
    await uploadOverseerFiles(ctx.baseUrl, [CULTIVATIONS]);

    const unmapped = await ctx.api.get('/api/overseer/unmapped');
    assert.ok(
      unmapped.body.items.some((i) => i.overseer_name === 'Китаєць'),
      'Китаєць (лише з Hecterra) має бути в списку нерозпізнаної техніки',
    );
  });

  it('без файлів у запиті -> 400', async () => {
    const formData = new FormData();
    const res = await fetch(`${ctx.baseUrl}/api/overseer/import`, { method: 'POST', body: formData });
    assert.equal(res.status, 400);
  });
});
