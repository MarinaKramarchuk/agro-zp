import { db } from '../db/index.js';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { round2 } from './payrollCalc.js';
import { WORKLOG_SELECT, eachWorklogDate } from './worklogService.js';

const pad = (n) => String(n).padStart(2, '0');
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Кольорова індикація комірки табеля:
 *   0 год           -> 'empty'    (сірий)
 *   1..8 год        -> 'normal'   (зелений)
 *   > 8 год         -> 'overtime' (яскраво-червоний)
 *   є лист без годин -> 'no_hours' (є робота, години не внесені)
 */
export function cellStatus(hours, entries) {
  if (entries === 0) return 'empty';
  if (hours <= 0) return 'no_hours';
  return hours > config.normalShiftHours ? 'overtime' : 'normal';
}

const overtimeOf = (hours) => round2(Math.max(0, hours - config.normalShiftHours));

/** Шляхові листи, що перетинаються з періодом [date_from, date_to]. */
function overlappingWorklogs({ date_from, date_to, employee_id }) {
  const where = ['w.work_date <= @date_to', 'w.work_date_to >= @date_from'];
  const params = { date_from, date_to };
  if (employee_id) {
    where.push('w.employee_id = @employee_id');
    params.employee_id = employee_id;
  }
  return db.prepare(`${WORKLOG_SELECT} WHERE ${where.join(' AND ')}`).all(params);
}

/**
 * Розкладає шляхові листи по календарних днях у межах періоду.
 * Шляховий, що охоплює кілька дат, дублює свої години й суму на кожен день —
 * це відображення для Табеля (не для Відомості ЗП, де сума рахується один раз).
 */
function bucketByEmployeeDay(worklogs, { date_from, date_to }) {
  const byEmployee = new Map();

  for (const w of worklogs) {
    const dates = eachWorklogDate(w, date_from, date_to);
    if (!byEmployee.has(w.employee_id)) byEmployee.set(w.employee_id, new Map());
    const days = byEmployee.get(w.employee_id);

    for (const date of dates) {
      const day = Number(date.slice(8, 10));
      const cell = days.get(day) ?? {
        entries: 0,
        hours: 0,
        repair_hours: 0,
        total_amount: 0,
      };
      cell.entries += 1;
      cell.hours += w.hours;
      if (w.work_type_is_repair) cell.repair_hours += w.hours;
      cell.total_amount += w.total_amount;
      days.set(day, cell);
    }
  }

  return byEmployee;
}

/** Сітка місяця: рядки — працівники, колонки — дні. */
export function getMonthGrid({ year, month, employee_id }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Некоректний рік');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('Некоректний місяць');

  const total_days = daysInMonth(year, month);
  const date_from = `${year}-${pad(month)}-01`;
  const date_to = `${year}-${pad(month)}-${pad(total_days)}`;

  const employeeWhere = [];
  const employeeParams = {};
  if (employee_id) {
    employeeWhere.push('id = @employee_id');
    employeeParams.employee_id = employee_id;
  }

  const employees = db
    .prepare(
      `SELECT id, full_name, position, staff_group FROM employees
        ${employeeWhere.length ? `WHERE ${employeeWhere.join(' AND ')}` : ''}
        ORDER BY full_name COLLATE NOCASE`,
    )
    .all(employeeParams);

  const worklogs = overlappingWorklogs({ date_from, date_to, employee_id });
  const byEmployee = bucketByEmployeeDay(worklogs, { date_from, date_to });

  const rows = employees.map((employee) => {
    const source = byEmployee.get(employee.id) ?? new Map();
    const days = {};
    const totals = {
      days_worked: 0,
      entries: 0,
      hours: 0,
      repair_hours: 0,
      overtime_hours: 0,
      total_amount: 0,
    };

    for (let day = 1; day <= total_days; day += 1) {
      const cell = source.get(day);
      const hours = round2(cell?.hours ?? 0);
      const entries = cell?.entries ?? 0;
      const overtime_hours = overtimeOf(hours);

      days[day] = {
        date: `${year}-${pad(month)}-${pad(day)}`,
        entries,
        hours,
        repair_hours: round2(cell?.repair_hours ?? 0),
        overtime_hours,
        total_amount: round2(cell?.total_amount ?? 0),
        status: cellStatus(hours, entries),
      };

      if (entries > 0) totals.days_worked += 1;
      totals.entries += entries;
      totals.hours += hours;
      totals.repair_hours += days[day].repair_hours;
      totals.overtime_hours += overtime_hours;
      totals.total_amount += days[day].total_amount;
    }

    for (const key of ['hours', 'repair_hours', 'overtime_hours', 'total_amount']) {
      totals[key] = round2(totals[key]);
    }

    return { employee, days, totals };
  });

  return {
    year,
    month,
    date_from,
    date_to,
    total_days,
    normal_shift_hours: config.normalShiftHours,
    legend: {
      empty: 'Немає шляхового листа (0 год) — сірий',
      no_hours: 'Є шляховий лист, години не внесені',
      normal: `1–${config.normalShiftHours} год — зелений`,
      overtime: `більше ${config.normalShiftHours} год — червоний (овертайм)`,
    },
    rows,
  };
}

/** Деталізація дня для pop-up при кліку на комірку. */
export function getDayDetails({ employee_id, date }) {
  const employee = db
    .prepare('SELECT id, full_name, position, staff_group FROM employees WHERE id = ?')
    .get(employee_id);
  if (!employee) throw badRequest(`Працівника #${employee_id} не знайдено`);

  const items = db
    .prepare(`${WORKLOG_SELECT} WHERE w.employee_id = @employee_id AND w.work_date <= @date AND w.work_date_to >= @date
              ORDER BY w.id`)
    .all({ employee_id, date });

  const hours = round2(items.reduce((sum, i) => sum + i.hours, 0));

  const totals = {
    entries: items.length,
    hours,
    repair_hours: round2(items.filter((i) => i.work_type_is_repair).reduce((sum, i) => sum + i.hours, 0)),
    overtime_hours: overtimeOf(hours),
    total_amount: round2(items.reduce((sum, i) => sum + i.total_amount, 0)),
  };

  return {
    employee,
    date,
    status: cellStatus(hours, items.length),
    normal_shift_hours: config.normalShiftHours,
    totals,
    items,
  };
}
