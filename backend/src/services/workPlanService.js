import { db } from '../db/index.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';

const WORK_PLAN_SELECT = `
  SELECT wp.*,
         e.full_name    AS employee_name,
         e.staff_group  AS employee_group,
         eq.name        AS equipment_name,
         f.name         AS field_name,
         wt.name        AS work_type_name,
         w.id           AS confirmed_worklog_id,
         w.total_amount AS confirmed_amount
    FROM work_plans wp
    JOIN employees   e  ON e.id  = wp.employee_id
    JOIN work_types  wt ON wt.id = wp.work_type_id
    LEFT JOIN equipment eq ON eq.id = wp.equipment_id
    LEFT JOIN fields    f  ON f.id  = wp.field_id
    LEFT JOIN worklogs  w  ON w.plan_id = wp.id
`;

function requireRef(table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(422, `${label} #${id} не знайдено`);
  return row;
}

/** План уже погоджено (є worklog, що на нього посилається), якщо повернуто рядок. */
function findConfirmingWorklog(planId) {
  return db.prepare('SELECT id FROM worklogs WHERE plan_id = ?').get(planId);
}

export const getWorkPlan = (id) => db.prepare(`${WORK_PLAN_SELECT} WHERE wp.id = ?`).get(id);

export function listWorkPlans(filters) {
  const where = [];
  const params = {};

  if (filters.employee_id !== undefined) {
    where.push('wp.employee_id = @employee_id');
    params.employee_id = filters.employee_id;
  }
  if (filters.date) {
    where.push('wp.plan_date = @date');
    params.date = filters.date;
  }
  if (filters.date_from) {
    where.push('wp.plan_date >= @date_from');
    params.date_from = filters.date_from;
  }
  if (filters.date_to) {
    where.push('wp.plan_date <= @date_to');
    params.date_to = filters.date_to;
  }
  if (filters.status === 'pending') where.push('w.id IS NULL');
  if (filters.status === 'confirmed') where.push('w.id IS NOT NULL');

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const items = db
    .prepare(`${WORK_PLAN_SELECT}${whereSql} ORDER BY wp.plan_date ASC, wp.id ASC`)
    .all(params);

  return { items };
}

function validateRefs(input) {
  const workType = requireRef('work_types', input.work_type_id, 'Вид роботи');
  requireRef('employees', input.employee_id, 'Працівника');
  if (input.equipment_id) requireRef('equipment', input.equipment_id, 'Техніку');

  if (input.field_id) {
    requireRef('fields', input.field_id, 'Поле');
  } else if (workType.requires_field === 1) {
    throw new HttpError(422, `Для роботи "${workType.name}" потрібно вказати поле`, [
      { path: 'field_id', message: 'Обов’язкове поле' },
    ]);
  }
}

export function createWorkPlan(input) {
  validateRefs(input);

  const info = db
    .prepare(
      `INSERT INTO work_plans (plan_date, employee_id, equipment_id, field_id, work_type_id, crop, note, created_by, updated_by)
       VALUES (@plan_date, @employee_id, @equipment_id, @field_id, @work_type_id, @crop, @note, @created_by, @updated_by)`,
    )
    .run({
      plan_date: input.plan_date,
      employee_id: input.employee_id,
      equipment_id: input.equipment_id ?? null,
      field_id: input.field_id ?? null,
      work_type_id: input.work_type_id,
      crop: input.crop ?? null,
      note: input.note ?? null,
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
    });

  return getWorkPlan(info.lastInsertRowid);
}

export function updateWorkPlan(id, patch) {
  const existing = db.prepare('SELECT * FROM work_plans WHERE id = ?').get(id);
  if (!existing) throw notFound(`План #${id} не знайдено`);

  const confirming = findConfirmingWorklog(id);
  if (confirming) {
    throw conflict(`План уже погоджено — редагуйте сам шляховий лист (#${confirming.id})`);
  }

  const merged = { ...existing, ...patch };
  validateRefs(merged);

  const fields = ['plan_date', 'employee_id', 'equipment_id', 'field_id', 'work_type_id', 'crop', 'note', 'updated_by'];
  db.prepare(
    `UPDATE work_plans SET ${fields.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`,
  ).run({ ...Object.fromEntries(fields.map((k) => [k, merged[k] ?? null])), id });

  return getWorkPlan(id);
}

/** Незавершені плани, чия дата вже минула - для дзвіночка сповіщень ("не забути"). */
export function listOverduePlans() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return listWorkPlans({ status: 'pending' }).items.filter((p) => p.plan_date < today);
}

export function deleteWorkPlan(id) {
  const existing = db.prepare('SELECT id FROM work_plans WHERE id = ?').get(id);
  if (!existing) throw notFound(`План #${id} не знайдено`);

  const confirming = findConfirmingWorklog(id);
  if (confirming) {
    throw conflict(`План уже погоджено — видаліть спершу сам шляховий лист (#${confirming.id})`);
  }

  db.prepare('DELETE FROM work_plans WHERE id = ?').run(id);
}
