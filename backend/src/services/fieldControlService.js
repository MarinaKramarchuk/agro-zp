import { db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { round2 } from './payrollCalc.js';

/**
 * Контроль гектарів: для кожного поля — скільки фактично оброблено (сума area_ha
 * з шляхових) ОКРЕМО по кожному виду роботи за період, порівняно з площею поля.
 *
 * Рахувати перевищення по сумі ВСІХ операцій на полі не можна — оранка,
 * культивація, сівба тощо кожна окремо покриває всю площу поля, тому загальна
 * сума завжди буде в рази більшою за площу. Перевищення має сенс лише в межах
 * одного виду роботи (напр. оранки не може бути більше, ніж площа поля).
 */
export function getFieldControl({ date_from, date_to, field_id, all_work_types }) {
  if (date_from && date_to && date_from > date_to) {
    throw badRequest('date_from не може бути пізніше date_to');
  }

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
  if (field_id) {
    where.push('w.field_id = @field_id');
    params.field_id = field_id;
  }
  where.push('w.field_id IS NOT NULL', 'w.area_ha IS NOT NULL');
  // За замовчуванням - лише разові операції (оранка/посів/обмолот): решта
  // (обприскування, культивація, внесення добрив тощо) можуть повторюватись
  // за сезон, і "перевищення" для них не має сенсу - лише засмічує звіт.
  if (!all_work_types) where.push('wt.is_area_checked = 1');

  const breakdownRows = db
    .prepare(
      `SELECT w.field_id       AS field_id,
              w.work_type_id   AS work_type_id,
              wt.name          AS work_type_name,
              wt.is_area_checked AS is_area_checked,
              SUM(w.area_ha)   AS worked_ha,
              COUNT(*)         AS entries
         FROM worklogs w
         JOIN work_types wt ON wt.id = w.work_type_id
        WHERE ${where.join(' AND ')}
        GROUP BY w.field_id, w.work_type_id
        ORDER BY wt.name COLLATE NOCASE`,
    )
    .all(params);

  const byField = new Map();
  for (const row of breakdownRows) {
    if (!byField.has(row.field_id)) byField.set(row.field_id, []);
    byField.get(row.field_id).push(row);
  }

  // Без явного field_id показуємо лише поля зі списку стеження - конкретний
  // пошук поля (field_id) завжди спрацьовує, навіть якщо його прибрали зі списку.
  const fieldsSql = field_id
    ? 'SELECT * FROM fields WHERE id = @field_id ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM fields WHERE is_watched = 1 ORDER BY name COLLATE NOCASE';
  const fields = db.prepare(fieldsSql).all(field_id ? { field_id } : {});

  const items = fields.map((field) => {
    const rows = byField.get(field.id) ?? [];
    const breakdown = rows.map((row) => {
      const worked_ha = round2(row.worked_ha);
      // Перевищення рахуємо лише для разових операцій (оранка/посів/обмолот) -
      // коли показуємо й інші (all_work_types), для них excess завжди 0.
      const excess_ha =
        row.is_area_checked && field.area_ha != null && worked_ha > field.area_ha
          ? round2(worked_ha - field.area_ha)
          : 0;
      return {
        work_type_id: row.work_type_id,
        work_type_name: row.work_type_name,
        is_area_checked: Boolean(row.is_area_checked),
        worked_ha,
        entries: row.entries,
        percent_of_field: field.area_ha ? round2((worked_ha / field.area_ha) * 100) : null,
        excess_ha,
      };
    });

    return {
      field_id: field.id,
      field_name: field.name,
      field_area_ha: field.area_ha,
      field_crop: field.crop,
      breakdown,
      has_excess: breakdown.some((b) => b.excess_ha > 0),
    };
  });

  return {
    filters: {
      date_from: date_from ?? null,
      date_to: date_to ?? null,
      field_id: field_id ?? null,
      all_work_types: Boolean(all_work_types),
    },
    items,
    totals: {
      fields: items.length,
      fields_with_excess: items.filter((i) => i.has_excess).length,
    },
  };
}
