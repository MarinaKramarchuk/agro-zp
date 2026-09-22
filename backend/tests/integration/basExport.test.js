// GET /payroll/bas.xlsx — вивантаження шляхових листів у формат BAS FOR AGRO.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedEquipment, seedField, seedTariff, seedWorkType } from '../helpers/seed.js';

const HEADER = [
  'Дата', 'Код техніки', 'Найменування техніки', 'Код поля', 'Найменування поля',
  'Код культури', 'Культура', 'Код водія', 'Водій', 'Код типу роботи', 'Тип роботи',
  'Мотогодини', 'Га', 'Паливо, л', 'Сума, грн',
];

async function fetchBasRows(baseUrl, query = '') {
  const res = await fetch(`${baseUrl}/api/payroll/bas.xlsx${query}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const workbook = XLSX.read(buf, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return { status: res.status, rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) };
}

describe('payroll — GET /payroll/bas.xlsx (вивантаження в BAS)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('15 колонок у правильному порядку', async () => {
    const { status, rows } = await fetchBasRows(ctx.baseUrl);
    assert.equal(status, 200);
    assert.deepEqual(rows[0], HEADER);
  });

  it('коди BAS підставляються з довідників; мотогодини/паливо - з machine_facts за (дата, техніка)', async () => {
    const equipment = seedEquipment(ctx.db, { name: 'John Deere', overseer_name: 'John Deere 8310', bas_code: '00-000456' });
    const field = seedField(ctx.db, { name: 'Поле №2', bas_code: '00-F002', crop: 'wheat' });
    const employee = seedEmployee(ctx.db, { full_name: 'Іваненко Іван', bas_code: '00-000002' });
    const workType = seedWorkType(ctx.db, { name: 'Оранка', bas_code: '00-000010' });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 200 });

    ctx.db
      .prepare('INSERT INTO machine_facts (fact_date, overseer_name, engine_hours, fuel_consumed) VALUES (?, ?, ?, ?)')
      .run('2026-08-11', 'John Deere 8310', 9.5, 40.2);

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-11',
      employee_id: employee.id,
      equipment_id: equipment.id,
      field_id: field.id,
      work_type_id: workType.id,
      crop: 'wheat',
      area_ha: 18,
    });

    const { rows } = await fetchBasRows(ctx.baseUrl, '?date_from=2026-08-11&date_to=2026-08-11');
    assert.equal(rows.length, 4); // заголовок + 1 запис + порожній рядок + примітка
    assert.deepEqual(rows[1], [
      '2026-08-11', '00-000456', 'John Deere', '00-F002', 'Поле №2',
      null, 'Пшениця', '00-000002', 'Іваненко Іван', '00-000010', 'Оранка',
      9.5, 18, 40.2, 3600,
    ]);
  });

  it('запис без bas_code в жодному довіднику -> порожні коди, решта колонок заповнена', async () => {
    const equipment = seedEquipment(ctx.db, { name: 'Без коду' });
    const employee = seedEmployee(ctx.db, { full_name: 'Працівник Без Коду' });
    const workType = seedWorkType(ctx.db, { name: 'Дискування' });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 50 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-12',
      employee_id: employee.id,
      equipment_id: equipment.id,
      work_type_id: workType.id,
      area_ha: 10,
    });

    const { rows } = await fetchBasRows(ctx.baseUrl, '?date_from=2026-08-12&date_to=2026-08-12');
    const [, row] = rows;
    assert.equal(row[1], null, 'код техніки порожній');
    assert.equal(row[2], 'Без коду', 'найменування техніки є, попри відсутній код');
    assert.equal(row[7], null, 'код водія порожній');
    assert.equal(row[8], 'Працівник Без Коду');
    assert.equal(row[14], 500, 'сума все одно рахується');
  });

  it('без техніки/поля (напр. погодинна робота) - null-и, не падає', async () => {
    const employee = seedEmployee(ctx.db, { monthly_rate: 20000 });
    const workType = seedWorkType(ctx.db);

    const created = await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-13',
      employee_id: employee.id,
      work_type_id: workType.id,
      pay_mode: 'hourly',
      hours: 8,
    });
    assert.equal(created.status, 201);

    const { status, rows } = await fetchBasRows(ctx.baseUrl, '?date_from=2026-08-13&date_to=2026-08-13');
    assert.equal(status, 200);
    const [, row] = rows;
    assert.equal(row[1], null); // код техніки
    assert.equal(row[2], null); // найменування техніки
    assert.equal(row[3], null); // код поля
    assert.equal(row[4], null); // найменування поля
  });

  it('багатоденний шляховий розбивається на один рядок за кожен день', async () => {
    const equipment = seedEquipment(ctx.db);
    const employee = seedEmployee(ctx.db, { staff_group: 'driver' });
    const workType = seedWorkType(ctx.db, { staff_group: 'driver' });
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'trip', rate: 1000 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-14',
      work_date_to: '2026-08-16',
      employee_id: employee.id,
      equipment_id: equipment.id,
      work_type_id: workType.id,
      trips: 1,
      unit: 'trip',
    });

    const { rows } = await fetchBasRows(ctx.baseUrl, '?date_from=2026-08-14&date_to=2026-08-16');
    const dates = rows.slice(1, rows.length - 2).map((r) => r[0]);
    assert.deepEqual(dates, ['2026-08-14', '2026-08-15', '2026-08-16']);
  });

  it('порожній період -> лише заголовок і примітка про орієнтовний формат', async () => {
    const { rows } = await fetchBasRows(ctx.baseUrl, '?date_from=2099-01-01&date_to=2099-01-31');
    assert.deepEqual(rows[0], HEADER);
    assert.equal(rows.length, 3); // заголовок, порожній рядок, примітка
    assert.match(rows[2][0], /орієнтовний/);
  });

  it('date_from пізніше date_to -> 400', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/payroll/bas.xlsx?date_from=2026-08-20&date_to=2026-08-01`);
    assert.equal(res.status, 400);
  });
});
