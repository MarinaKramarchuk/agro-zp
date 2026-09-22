import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import { seedEmployee, seedTariff, seedWorkType } from '../helpers/seed.js';

describe('payroll — GET /payroll/summary + .xlsx', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  async function seedTwoWorklogsForOneEmployee() {
    const employee = seedEmployee(ctx.db, { full_name: 'Іваненко Іван' });
    const workType = seedWorkType(ctx.db);
    seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 3,
      hours: 6,
    }); // 300 грн
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-02',
      employee_id: employee.id,
      work_type_id: workType.id,
      area_ha: 2,
      hours: 4,
    }); // 200 грн

    return employee;
  }

  it('агрегує дні/години/суму по працівнику за період', async () => {
    const employee = await seedTwoWorklogsForOneEmployee();

    const res = await ctx.api.get('/api/payroll/summary?date_from=2026-08-01&date_to=2026-08-31');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);

    const row = res.body.items[0];
    assert.equal(row.employee_id, employee.id);
    assert.equal(row.days_worked, 2);
    assert.equal(row.entries, 2);
    assert.equal(row.hours, 10);
    assert.equal(row.total_ha, 5);
    assert.equal(row.total_amount, 500);

    assert.equal(res.body.totals.total_amount, 500);
    assert.equal(res.body.totals.employees, 1);
  });

  it('total_tons враховує і tons (напр. перевезення зерна), і cargo_tons (вантаж у рейсі ДАФа)', async () => {
    const employee = seedEmployee(ctx.db, { full_name: 'Водій ДАФа' });
    const grainType = seedWorkType(ctx.db, { name: 'Перевезення зерна' });
    seedTariff(ctx.db, { work_type_id: grainType.id, unit: 'ton', rate: 10 });
    const routeType = seedWorkType(ctx.db, { name: 'Міжміський рейс (за маршрутом)' });
    seedTariff(ctx.db, { work_type_id: routeType.id, unit: 'trip', rate: 500 });

    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-01',
      employee_id: employee.id,
      work_type_id: grainType.id,
      tons: 5,
    });
    await ctx.api.post('/api/worklogs', {
      work_date: '2026-08-02',
      employee_id: employee.id,
      work_type_id: routeType.id,
      trips: 1,
      cargo_tons: 8,
      distance_km: 120,
    });

    const res = await ctx.api.get('/api/payroll/summary?date_from=2026-08-01&date_to=2026-08-31');
    assert.equal(res.status, 200);
    const row = res.body.items[0];
    assert.equal(row.total_tons, 13);
    assert.equal(row.total_km, 120);
    assert.equal(row.total_trips, 1);
  });

  it('фільтрує за staff_group', async () => {
    await seedTwoWorklogsForOneEmployee(); // 'tractor' за замовчуванням (seedEmployee)

    const matching = await ctx.api.get('/api/payroll/summary?staff_group=tractor');
    assert.equal(matching.body.items.length, 1);

    const nonMatching = await ctx.api.get('/api/payroll/summary?staff_group=driver');
    assert.equal(nonMatching.body.items.length, 0);
  });

  it('date_from пізніше date_to -> 400', async () => {
    const res = await ctx.api.get('/api/payroll/summary?date_from=2026-08-31&date_to=2026-08-01');
    assert.equal(res.status, 400);
  });

  it('GET /payroll/employee/:id для працівника без записів у періоді -> нульові підсумки', async () => {
    const employee = seedEmployee(ctx.db, { full_name: 'Без записів' });

    const res = await ctx.api.get(`/api/payroll/employee/${employee.id}?date_from=2026-08-01&date_to=2026-08-31`);
    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 0);
    assert.equal(res.body.totals.total_amount, 0);
    assert.equal(res.body.totals.days_worked, 0);
  });

  it('записи поза періодом не враховуються', async () => {
    await seedTwoWorklogsForOneEmployee();

    const res = await ctx.api.get('/api/payroll/summary?date_from=2026-09-01&date_to=2026-09-30');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 0);
    assert.equal(res.body.totals.total_amount, 0);
  });

  it('GET /payroll/summary.xlsx повертає книгу з тими самими підсумками', async () => {
    await seedTwoWorklogsForOneEmployee();

    const res = await ctx.api.get('/api/payroll/summary.xlsx?date_from=2026-08-01&date_to=2026-08-31');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.ok(res.raw.length > 0);

    const wb = XLSX.read(res.raw, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const header = rows[2];
    assert.deepEqual(header.slice(0, 3), ['ПІБ', 'Посада', 'Група']);

    const dataRow = rows[3];
    assert.equal(dataRow[0], 'Іваненко Іван');

    const totalRow = rows.at(-1);
    assert.equal(totalRow[0], 'РАЗОМ');
    assert.equal(totalRow.at(-1), 500); // Разом, грн
  });

  it('GET /payroll/employee/:id — деталізація по днях', async () => {
    const employee = await seedTwoWorklogsForOneEmployee();

    const res = await ctx.api.get(`/api/payroll/employee/${employee.id}?date_from=2026-08-01&date_to=2026-08-31`);
    assert.equal(res.status, 200);
    assert.equal(res.body.employee.id, employee.id);
    assert.equal(res.body.days.length, 2);
    assert.equal(res.body.totals.total_amount, 500);
  });

  it('GET /payroll/employee/:id/export.xlsx — Excel-книга з розрахунком по днях', async () => {
    const employee = await seedTwoWorklogsForOneEmployee();

    const res = await ctx.api.get(
      `/api/payroll/employee/${employee.id}/export.xlsx?date_from=2026-08-01&date_to=2026-08-31`,
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);

    const wb = XLSX.read(res.raw, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.match(rows[0][0], /Іваненко Іван/);

    const totalRow = rows.find((r) => r[0] === 'ВСЬОГО');
    assert.ok(totalRow);
    assert.equal(totalRow[8], 10); // Год
    assert.equal(totalRow[9], 500); // Сума, грн
  });

  describe('/payroll/by-crop — зведення по культурах', () => {
    async function seedByCrop() {
      const employee = seedEmployee(ctx.db, { full_name: 'Петренко Петро' });
      const employee2 = seedEmployee(ctx.db, { full_name: 'Сидоренко Сидір' });
      const workType = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: workType.id, unit: 'ha', rate: 100 });

      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-01',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 4,
        crop: 'wheat',
      }); // 400 грн, пшениця, Петренко
      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-01',
        employee_id: employee2.id,
        work_type_id: workType.id,
        area_ha: 2,
        crop: 'wheat',
      }); // 200 грн, пшениця, Сидоренко
      await ctx.api.post('/api/worklogs', {
        work_date: '2026-08-02',
        employee_id: employee.id,
        work_type_id: workType.id,
        area_ha: 1,
      }); // 100 грн, без культури

      return { employee, employee2 };
    }

    it('GET /payroll/by-crop групує суми по культурі, включно з "без культури"', async () => {
      await seedByCrop();

      const res = await ctx.api.get('/api/payroll/by-crop?date_from=2026-08-01&date_to=2026-08-31');
      assert.equal(res.status, 200);
      assert.equal(res.body.items.length, 2);

      const wheat = res.body.items.find((i) => i.crop === 'wheat');
      assert.equal(wheat.crop_label, 'Пшениця');
      assert.equal(wheat.total_amount, 600);

      const none = res.body.items.find((i) => i.crop === null);
      assert.equal(none.crop_label, 'Без культури');
      assert.equal(none.total_amount, 100);

      assert.equal(res.body.totals.total_amount, 700);
    });

    it('GET /payroll/by-crop розбиває кожну культуру по працівниках', async () => {
      await seedByCrop();

      const res = await ctx.api.get('/api/payroll/by-crop?date_from=2026-08-01&date_to=2026-08-31');
      const wheat = res.body.items.find((i) => i.crop === 'wheat');

      assert.equal(wheat.employees.length, 2);
      const petrenko = wheat.employees.find((e) => e.employee_name === 'Петренко Петро');
      const sydorenko = wheat.employees.find((e) => e.employee_name === 'Сидоренко Сидір');
      assert.equal(petrenko.total_amount, 400);
      assert.equal(sydorenko.total_amount, 200);

      const none = res.body.items.find((i) => i.crop === null);
      assert.equal(none.employees.length, 1);
      assert.equal(none.employees[0].employee_name, 'Петренко Петро');
      assert.equal(none.employees[0].total_amount, 100);
    });

    it('GET /payroll/by-crop.xlsx повертає книгу з тими самими підсумками', async () => {
      await seedByCrop();

      const res = await ctx.api.get('/api/payroll/by-crop.xlsx?date_from=2026-08-01&date_to=2026-08-31');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /spreadsheetml/);

      const wb = XLSX.read(res.raw, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const header = rows[2];
      assert.deepEqual(header.slice(0, 2), ['Культура', 'Днів']);

      // Під рядком культури йдуть рядки-розбивки по працівниках (ім'я з відступом).
      assert.ok(rows.some((r) => typeof r[0] === 'string' && r[0].trim() === 'Петренко Петро'));
      assert.ok(rows.some((r) => typeof r[0] === 'string' && r[0].trim() === 'Сидоренко Сидір'));

      const totalRow = rows.at(-1);
      assert.equal(totalRow[0], 'РАЗОМ');
      assert.equal(totalRow.at(-1), 700);
    });
  });
});
