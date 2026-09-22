import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { UNITS } from './payrollCalc.js';

const RATE_SELECT = `
  SELECT r.*,
         wt.name        AS work_type_name,
         wt.staff_group AS staff_group,
         (SELECT GROUP_CONCAT(m.label, ', ')
            FROM tariff_rate_models trm
            JOIN equipment_models m ON m.id = trm.model_id
           WHERE trm.rate_id = r.id) AS model_labels,
         -- список id прив'язаних марок для форми редагування (щоб чекбокси
         -- марок одразу підвантажувались разом з рядком, без окремого запиту)
         (SELECT json_group_array(m.id)
            FROM tariff_rate_models trm
            JOIN equipment_models m ON m.id = trm.model_id
           WHERE trm.rate_id = r.id) AS model_ids_json
    FROM tariff_rates r
    JOIN work_types wt ON wt.id = r.work_type_id
`;

const decorate = (rate) => {
  if (!rate) return rate;
  const { model_ids_json, ...rest } = rate;
  return {
    ...rest,
    unit_label: UNITS[rate.unit]?.label ?? rate.unit,
    rate_label: UNITS[rate.unit]?.rateLabel ?? '',
    model_ids: model_ids_json ? JSON.parse(model_ids_json) : [],
  };
};

export const getRate = (id) => decorate(db.prepare(`${RATE_SELECT} WHERE r.id = ?`).get(id));

/**
 * Варіанти тарифів для форми шляхового листа.
 * Якщо передано equipment_id — залишаємо тарифи, привʼязані до марки цієї техніки,
 * а також універсальні (без привʼязки до марок).
 */
export function listRateVariants({ work_type_id, equipment_id, unit, staff_group, is_default_rate }) {
  const where = [];
  const params = {};

  if (work_type_id) {
    where.push('r.work_type_id = @work_type_id');
    params.work_type_id = work_type_id;
  }
  if (unit) {
    where.push('r.unit = @unit');
    params.unit = unit;
  }
  if (staff_group) {
    where.push('wt.staff_group = @staff_group');
    params.staff_group = staff_group;
  }
  if (is_default_rate) {
    where.push('r.is_default_rate = 1');
  }
  if (equipment_id) {
    where.push(`(
      NOT EXISTS (SELECT 1 FROM tariff_rate_models t WHERE t.rate_id = r.id)
      OR EXISTS (
        SELECT 1 FROM tariff_rate_models t
          JOIN equipment e ON e.model_id = t.model_id
         WHERE t.rate_id = r.id AND e.id = @equipment_id
      )
    )`);
    params.equipment_id = equipment_id;
  }

  const sql = `${RATE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
               ORDER BY wt.name COLLATE NOCASE, r.equipment_label, r.implement_label, r.unit`;

  const stmt = db.prepare(sql);
  const rows = where.length ? stmt.all(params) : stmt.all();
  return rows.map(decorate);
}

/**
 * Визначає тариф для запису шляхового листа.
 * Пріоритет: явно вибраний tariff_rate_id -> маршрут -> ручна розцінка ->
 * єдиний підхожий варіант із довідника.
 *
 * @param {object} [manual] розцінка, введена вручну (коли тарифу немає в
 *   переліку): { unit, rate }. unit обов'язковий.
 */
export function resolveRate({ tariff_rate_id, route_id, work_type_id, equipment_id, unit, manual }) {
  if (route_id) {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(route_id);
    if (!route) throw new HttpError(422, `Маршрут #${route_id} не знайдено`);
    return {
      rate: {
        unit: 'trip',
        rate: route.rate,
        secondary_unit: null,
        secondary_rate: 0,
        is_manual: 0,
        raw_text: route.name,
      },
      label: `Рейс ${route.name}`,
      tariff_rate_id: null,
      route,
    };
  }

  if (tariff_rate_id) {
    const rate = getRate(tariff_rate_id);
    if (!rate) throw new HttpError(422, `Тариф #${tariff_rate_id} не знайдено`);
    if (work_type_id && rate.work_type_id !== work_type_id) {
      throw new HttpError(422, 'Обраний тариф належить іншому виду робіт');
    }
    return { rate, label: rate.work_type_name, tariff_rate_id: rate.id, route: null };
  }

  if (manual) {
    if (!manual.unit) {
      throw new HttpError(422, 'Для ручної розцінки вкажіть одиницю виміру', [
        { path: 'unit', message: 'Обов’язкове значення' },
      ]);
    }
    return {
      rate: {
        unit: manual.unit,
        rate: Number(manual.rate ?? 0),
        secondary_unit: null,
        secondary_rate: 0,
        is_manual: 0,
        raw_text: 'Розцінка вказана вручну (немає в довіднику тарифів)',
      },
      label: 'ручна розцінка',
      tariff_rate_id: null,
      route: null,
    };
  }

  const variants = listRateVariants({ work_type_id, equipment_id, unit });

  if (variants.length === 0) {
    throw new HttpError(
      422,
      'Для цього виду робіт і техніки немає тарифу — додайте розцінку в довідник тарифів',
      [{ path: 'tariff_rate_id', message: 'Тариф не знайдено' }],
    );
  }
  if (variants.length > 1) {
    throw new HttpError(422, 'Для цього виду робіт є кілька тарифів — виберіть потрібний', {
      variants: variants.map((v) => ({
        id: v.id,
        equipment_label: v.equipment_label,
        implement_label: v.implement_label,
        unit: v.unit,
        unit_label: v.unit_label,
        rate: v.rate,
      })),
    });
  }

  const [rate] = variants;
  return { rate, label: rate.work_type_name, tariff_rate_id: rate.id, route: null };
}

export function getRouteOr404(id) {
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(id);
  if (!route) throw notFound(`Маршрут #${id} не знайдено`);
  return route;
}

/** Ставка грн/км за діапазоном відстані (для маршрутів поза довідником). */
export function findKmRate(distanceKm) {
  return db
    .prepare(
      `SELECT * FROM route_km_rates
        WHERE from_km <= @km AND (to_km IS NULL OR to_km >= @km)
        ORDER BY from_km DESC LIMIT 1`,
    )
    .get({ km: distanceKm });
}
