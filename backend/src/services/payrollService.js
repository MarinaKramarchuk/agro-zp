import { db } from '../db/index.js';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { round2 } from './payrollCalc.js';
import { CROPS } from './crops.js';
import { WORKLOG_SELECT } from './worklogService.js';

// Відомість ЗП рахує кожен шляховий лист один раз (навіть якщо він охоплює
// кілька дат) — на відміну від Табеля, де той самий запис відображається
// на кожен день періоду для наочності.
const AGGREGATES = `
  COUNT(DISTINCT w.work_date)                                        AS days_worked,
  COUNT(*)                                                           AS entries,
  COALESCE(SUM(w.hours), 0)                                          AS hours,
  COALESCE(SUM(w.area_ha), 0)                                        AS total_ha,
  -- tons (тариф "грн/т") і cargo_tons (вантаж у рейсі ДАФа, тариф "грн/ходку"
  -- поки не рахує від нього суму) - той самий фізичний зміст "тонн вантажу",
  -- тож у зведенні по працівнику йдуть одним підсумком.
  COALESCE(SUM(w.tons), 0) + COALESCE(SUM(w.cargo_tons), 0)          AS total_tons,
  COALESCE(SUM(w.distance_km), 0)                                    AS total_km,
  COALESCE(SUM(CASE WHEN w.unit = 'tkm' THEN w.quantity ELSE 0 END), 0) AS total_tkm,
  COALESCE(SUM(w.trips), 0)                                          AS total_trips,
  COALESCE(SUM(w.bales), 0)                                          AS total_bales,
  COALESCE(SUM(w.total_amount), 0)                                   AS total_amount
`;

function periodFilter({ date_from, date_to, employee_id, staff_group }) {
  const where = [];
  const params = {};

  // Перетин періоду запису [work_date, work_date_to] з фільтром
  if (date_from) {
    where.push('w.work_date_to >= @date_from');
    params.date_from = date_from;
  }
  if (date_to) {
    where.push('w.work_date <= @date_to');
    params.date_to = date_to;
  }
  if (employee_id) {
    where.push('w.employee_id = @employee_id');
    params.employee_id = employee_id;
  }
  if (staff_group) {
    where.push('e.staff_group = @staff_group');
    params.staff_group = staff_group;
  }

  if (date_from && date_to && date_from > date_to) {
    throw badRequest('date_from не може бути пізніше date_to');
  }

  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/** Понаднормові по днях: сума перевищень норми зміни за кожен день (в межах періоду). */
function overtimeByEmployee({ whereSql, params }) {
  const rows = db
    .prepare(
      `SELECT employee_id,
              COALESCE(SUM(MAX(day_hours - @normal, 0)), 0) AS overtime_hours
         FROM (SELECT w.employee_id AS employee_id,
                      w.work_date   AS work_date,
                      SUM(w.hours)  AS day_hours
                 FROM worklogs w
                 JOIN employees e ON e.id = w.employee_id
                 ${whereSql}
                GROUP BY w.employee_id, w.work_date)
        GROUP BY employee_id`,
    )
    .all({ ...params, normal: config.normalShiftHours });

  return new Map(rows.map((r) => [r.employee_id, round2(r.overtime_hours)]));
}

/** Зведена відомість ЗП за період. */
export function getPayrollSummary(filters) {
  const { whereSql, params } = periodFilter(filters);

  const rows = db
    .prepare(
      `SELECT w.employee_id      AS employee_id,
              e.full_name        AS employee_name,
              e.position         AS position,
              e.staff_group      AS staff_group,
              ${AGGREGATES}
         FROM worklogs w
         JOIN employees e ON e.id = w.employee_id
         ${whereSql}
        GROUP BY w.employee_id
        ORDER BY e.full_name COLLATE NOCASE`,
    )
    .all(params);

  const overtime = overtimeByEmployee({ whereSql, params });

  const items = rows.map((r) => ({
    ...r,
    hours: round2(r.hours),
    overtime_hours: overtime.get(r.employee_id) ?? 0,
    total_ha: round2(r.total_ha),
    total_tons: round2(r.total_tons),
    total_km: round2(r.total_km),
    total_tkm: round2(r.total_tkm),
    total_amount: round2(r.total_amount),
  }));

  const sum = (key) => round2(items.reduce((acc, i) => acc + (i[key] ?? 0), 0));

  return {
    filters,
    normal_shift_hours: config.normalShiftHours,
    items,
    totals: {
      employees: items.length,
      entries: items.reduce((acc, i) => acc + i.entries, 0),
      hours: sum('hours'),
      overtime_hours: sum('overtime_hours'),
      total_ha: sum('total_ha'),
      total_tons: sum('total_tons'),
      total_km: sum('total_km'),
      total_tkm: sum('total_tkm'),
      total_trips: sum('total_trips'),
      total_bales: sum('total_bales'),
      total_amount: sum('total_amount'),
    },
  };
}

function mapCropAggregateRow(r) {
  return {
    days_worked: r.days_worked,
    entries: r.entries,
    hours: round2(r.hours),
    total_ha: round2(r.total_ha),
    total_tons: round2(r.total_tons),
    total_km: round2(r.total_km),
    total_tkm: round2(r.total_tkm),
    total_trips: r.total_trips,
    total_bales: r.total_bales,
    total_amount: round2(r.total_amount),
  };
}

/** Групування відомості по культурах за період, з розбивкою по працівниках усередині кожної культури. */
export function getCropSummary(filters) {
  const { whereSql, params } = periodFilter(filters);

  const rows = db
    .prepare(
      `SELECT w.crop AS crop, ${AGGREGATES}
         FROM worklogs w
         JOIN employees e ON e.id = w.employee_id
         ${whereSql}
        GROUP BY w.crop
        ORDER BY w.crop IS NULL, w.crop`,
    )
    .all(params);

  const employeeRows = db
    .prepare(
      `SELECT w.crop AS crop, w.employee_id AS employee_id, e.full_name AS employee_name, ${AGGREGATES}
         FROM worklogs w
         JOIN employees e ON e.id = w.employee_id
         ${whereSql}
        GROUP BY w.crop, w.employee_id
        ORDER BY w.crop IS NULL, w.crop, e.full_name COLLATE NOCASE`,
    )
    .all(params);

  const employeesByCrop = new Map();
  for (const r of employeeRows) {
    const key = r.crop ?? '';
    if (!employeesByCrop.has(key)) employeesByCrop.set(key, []);
    employeesByCrop.get(key).push({
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      ...mapCropAggregateRow(r),
    });
  }

  const items = rows.map((r) => ({
    crop: r.crop,
    crop_label: r.crop ? (CROPS[r.crop] ?? r.crop) : 'Без культури',
    ...mapCropAggregateRow(r),
    employees: employeesByCrop.get(r.crop ?? '') ?? [],
  }));

  const sum = (key) => round2(items.reduce((acc, i) => acc + (i[key] ?? 0), 0));

  return {
    filters,
    items,
    totals: {
      entries: items.reduce((acc, i) => acc + i.entries, 0),
      hours: sum('hours'),
      total_ha: sum('total_ha'),
      total_tons: sum('total_tons'),
      total_km: sum('total_km'),
      total_tkm: sum('total_tkm'),
      total_trips: sum('total_trips'),
      total_bales: sum('total_bales'),
      total_amount: sum('total_amount'),
    },
  };
}

/** Деталізований розрахунок по працівнику за кожен день (для «корінця»/відомості). */
export function getEmployeeReport({ employee_id, date_from, date_to }) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!employee) throw badRequest(`Працівника #${employee_id} не знайдено`);

  const { whereSql, params } = periodFilter({ employee_id, date_from, date_to });

  const items = db.prepare(`${WORKLOG_SELECT} ${whereSql} ORDER BY w.work_date, w.id`).all(params);

  const daysMap = new Map();
  for (const item of items) {
    if (!daysMap.has(item.work_date)) {
      daysMap.set(item.work_date, {
        date: item.work_date,
        items: [],
        hours: 0,
        total_amount: 0,
      });
    }
    const day = daysMap.get(item.work_date);
    day.items.push(item);
    day.hours = round2(day.hours + item.hours);
    day.total_amount = round2(day.total_amount + item.total_amount);
  }

  const days = [...daysMap.values()].map((day) => ({
    ...day,
    overtime_hours: round2(Math.max(0, day.hours - config.normalShiftHours)),
  }));

  const summary = getPayrollSummary({ employee_id, date_from, date_to });

  return {
    employee,
    date_from: date_from ?? null,
    date_to: date_to ?? null,
    normal_shift_hours: config.normalShiftHours,
    days,
    totals: summary.items[0] ?? {
      days_worked: 0,
      entries: 0,
      hours: 0,
      overtime_hours: 0,
      total_ha: 0,
      total_tons: 0,
      total_km: 0,
      total_tkm: 0,
      total_trips: 0,
      total_bales: 0,
      total_amount: 0,
    },
  };
}
