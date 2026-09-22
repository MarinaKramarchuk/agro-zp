// Вивантаження шляхових листів у формат для завантаження в BAS FOR AGRO.
// Порт аркуша "Завантаження BAS" з overseer-bas (src/lib/exportXlsx.mjs), але
// джерело даних - worklogs (уже підтверджені людиною записи), а не сирі
// день×техніка факти з OVERSEER; мотогодини й паливо підмішуються з
// machine_facts за тим самим (дата, техніка), що й в екрані "Дані з техніки".
//
// Формат лишається орієнтовним - реального шаблону завантаження BAS ще немає
// (див. примітку, що йде в сам файл при експорті, routes/payroll.js).
import { db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { CROPS } from './crops.js';
import { eachWorklogDate } from './worklogService.js';

function periodFilter({ date_from, date_to }) {
  const where = [];
  const params = {};

  if (date_from) {
    where.push('w.work_date_to >= @date_from');
    params.date_from = date_from;
  }
  if (date_to) {
    where.push('w.work_date <= @date_to');
    params.date_to = date_to;
  }
  if (date_from && date_to && date_from > date_to) {
    throw badRequest('date_from не може бути пізніше date_to');
  }

  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/** Мотогодини/паливо з machine_facts за (дата, техніка) — той самий ключ
 * overseer_name, що й в overseer/hecterra імпорті, завантажено разом, щоб не
 * робити по запиту на кожен рядок вивантаження. */
function loadFactsMap(date_from, date_to) {
  const where = [];
  const params = {};
  if (date_from) {
    where.push('fact_date >= @date_from');
    params.date_from = date_from;
  }
  if (date_to) {
    where.push('fact_date <= @date_to');
    params.date_to = date_to;
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT fact_date, overseer_name, engine_hours, fuel_consumed FROM machine_facts${whereSql}`)
    .all(params);

  return new Map(rows.map((r) => [`${r.fact_date}|${r.overseer_name}`, r]));
}

/**
 * Рядки для вивантаження в BAS: один рядок = один день у межах шляхового
 * листа (багатоденні листи розбиваються по днях — worklogService.eachWorklogDate,
 * той самий підхід, що й у Табелі). Мотогодини/паливо — довідково зі
 * machine_facts за день+техніку; сума й гектари — з самого шляхового
 * (те, що підтвердила людина, а не сирий факт).
 */
export function getBasExportRows({ date_from, date_to }) {
  const { whereSql, params } = periodFilter({ date_from, date_to });

  const items = db
    .prepare(
      `SELECT w.work_date, w.work_date_to, w.area_ha, w.crop, w.total_amount,
              e.full_name  AS employee_name, e.bas_code AS employee_bas_code,
              eq.name      AS equipment_name, eq.bas_code AS equipment_bas_code, eq.overseer_name AS equipment_overseer_name,
              f.name       AS field_name, f.bas_code AS field_bas_code,
              wt.name      AS work_type_name, wt.bas_code AS work_type_bas_code
         FROM worklogs w
         JOIN employees  e  ON e.id  = w.employee_id
         JOIN work_types wt ON wt.id = w.work_type_id
         LEFT JOIN equipment eq ON eq.id = w.equipment_id
         LEFT JOIN fields    f  ON f.id  = w.field_id
         ${whereSql}
        ORDER BY w.work_date, w.id`,
    )
    .all(params);

  const factsMap = loadFactsMap(date_from, date_to);

  const rows = [];
  for (const item of items) {
    for (const date of eachWorklogDate(item, date_from, date_to)) {
      const fact = item.equipment_overseer_name
        ? factsMap.get(`${date}|${item.equipment_overseer_name}`)
        : undefined;

      rows.push({
        date,
        equipment_bas_code: item.equipment_bas_code ?? null,
        equipment_name: item.equipment_name ?? null,
        field_bas_code: item.field_bas_code ?? null,
        field_name: item.field_name ?? null,
        // Немає окремого довідника кодів культур у BAS - лишаємо порожнім,
        // доки не з'явиться реальний шаблон завантаження.
        crop_code: null,
        crop_label: item.crop ? (CROPS[item.crop] ?? item.crop) : null,
        employee_bas_code: item.employee_bas_code ?? null,
        employee_name: item.employee_name,
        work_type_bas_code: item.work_type_bas_code ?? null,
        work_type_name: item.work_type_name,
        engine_hours: fact?.engine_hours ?? null,
        area_ha: item.area_ha,
        fuel_consumed: fact?.fuel_consumed ?? null,
        amount: item.total_amount,
      });
    }
  }

  return rows;
}
