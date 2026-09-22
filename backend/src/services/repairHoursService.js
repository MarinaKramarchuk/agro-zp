import { db } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { round2 } from './payrollCalc.js';
import { daysInMonth } from './timesheetService.js';
import { createWorklog, deleteWorklog, updateWorklog } from './worklogService.js';

const pad = (n) => String(n).padStart(2, '0');

/** Єдиний вид робіт "ремонт" для групи працівника (driver/tractor) - саме
 * ним автоматично проставляються швидко внесені години. Для групи "other"
 * (чи якщо в довіднику "Види робіт" ремонт для групи не позначений) - немає. */
function repairWorkTypeFor(staffGroup) {
  return db
    .prepare('SELECT id, name FROM work_types WHERE staff_group = ? AND is_repair = 1 ORDER BY id LIMIT 1')
    .get(staffGroup);
}

/** Сітка місяця для швидкого внесення годин ремонту: працівники × дні. */
export function getRepairGrid({ year, month }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Некоректний рік');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('Некоректний місяць');

  const total_days = daysInMonth(year, month);
  const date_from = `${year}-${pad(month)}-01`;
  const date_to = `${year}-${pad(month)}-${pad(total_days)}`;

  const employees = db
    .prepare('SELECT id, full_name, position, staff_group FROM employees ORDER BY full_name COLLATE NOCASE')
    .all();

  // Для підказки над таблицею - які ставки застосуються (є "ремонт" не для
  // кожної групи, і в кожної групи щонайбільше один тариф "ремонту").
  const repair_types = db
    .prepare(
      `SELECT wt.id, wt.name, wt.staff_group, r.rate
         FROM work_types wt
         LEFT JOIN tariff_rates r ON r.work_type_id = wt.id
        WHERE wt.is_repair = 1
        ORDER BY wt.staff_group, wt.name`,
    )
    .all();

  // Один "ремонтний" запис = один день (work_date = work_date_to), тож у
  // сітці кожна комірка відповідає щонайбільше одному запису.
  const entries = db
    .prepare(
      `SELECT w.id, w.employee_id, w.work_date, w.hours, w.total_amount, w.updated_by
         FROM worklogs w
         JOIN work_types wt ON wt.id = w.work_type_id
        WHERE wt.is_repair = 1 AND w.work_date = w.work_date_to
          AND w.work_date >= @date_from AND w.work_date <= @date_to`,
    )
    .all({ date_from, date_to });

  const byKey = new Map(entries.map((e) => [`${e.employee_id}:${e.work_date}`, e]));

  const rows = employees.map((employee) => {
    const work_type = repairWorkTypeFor(employee.staff_group) ?? null;
    const days = {};
    let totalHours = 0;
    let totalAmount = 0;

    for (let day = 1; day <= total_days; day += 1) {
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const entry = byKey.get(`${employee.id}:${date}`);
      days[day] = {
        date,
        hours: entry?.hours ?? 0,
        worklog_id: entry?.id ?? null,
        updated_by: entry?.updated_by ?? null,
      };
      totalHours += days[day].hours;
      totalAmount += entry?.total_amount ?? 0;
    }

    return {
      employee,
      work_type,
      days,
      totals: { hours: round2(totalHours), total_amount: round2(totalAmount) },
    };
  });

  return { year, month, total_days, date_from, date_to, repair_types, rows };
}

/** Проставляє (чи прибирає, якщо 0) години ремонту одному працівнику за один
 * день - як комірка табеля. Створює/оновлює/видаляє один запис worklogs. */
export function setRepairHours({ employee_id, date, hours, actor }) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!employee) throw badRequest(`Працівника #${employee_id} не знайдено`);

  const workType = repairWorkTypeFor(employee.staff_group);
  if (!workType) {
    throw badRequest(
      `Для групи "${employee.staff_group}" не позначено вид робіт "ремонт" — додайте позначку в довіднику "Види робіт"`,
    );
  }

  const existing = db
    .prepare(
      `SELECT id FROM worklogs
        WHERE employee_id = ? AND work_date = ? AND work_date_to = ? AND work_type_id = ?
        ORDER BY id LIMIT 1`,
    )
    .get(employee_id, date, date, workType.id);

  if (!(hours > 0)) {
    if (existing) deleteWorklog(existing.id);
    return { date, hours: 0, worklog_id: null, total_amount: 0 };
  }

  const saved = existing
    ? updateWorklog(existing.id, { hours, updated_by: actor ?? null })
    : createWorklog({
        employee_id,
        work_date: date,
        work_date_to: date,
        work_type_id: workType.id,
        hours,
        created_by: actor ?? null,
        updated_by: actor ?? null,
      });

  return { date, hours: saved.hours, worklog_id: saved.id, total_amount: saved.total_amount };
}
