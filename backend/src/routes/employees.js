import { z } from 'zod';
import { db } from '../db/index.js';
import { makeCrudRouter } from '../lib/crud.js';
import { conflict, notFound } from '../lib/errors.js';
import { parseOrThrow, partialUpdate } from '../lib/validate.js';

const shape = {
  full_name: z.string().trim().min(1, 'Вкажіть ПІБ').max(200),
  position: z.string().trim().max(120).nullish(),
  // driver — водій (тарифи водіїв), tractor — тракторист/комбайнер, other — інше
  staff_group: z.enum(['driver', 'tractor', 'other']).default('other'),
  // особистий оклад за місяць — для запису "Погодинно" у шляховому листі;
  // якщо не вказано, погодинна ставка рахується від поточної мінімальної ЗП
  // (payroll_settings.minimum_wage)
  monthly_rate: z.coerce.number().nonnegative().nullish(),
  bas_code: z.string().trim().max(60).nullish(),
  // ім'я водія в OVERSEER/Hecterra (як у колонці "Водій" звітів) - за ним
  // підставляється працівник у чернетку шляхового; full_name лишається вільним
  // для гарного ПІБ
  overseer_name: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(1000).nullish(),
};

const createSchema = z.object(shape);

export const employeesRouter = makeCrudRouter({
  table: 'employees',
  createSchema,
  updateSchema: partialUpdate(createSchema),
  orderBy: 'full_name COLLATE NOCASE',
  searchColumns: ['full_name', 'position'],
  listFilters: { staff_group: 'staff_group' },
});

/**
 * Прив'язка ще одного написання імені водія з OVERSEER/Hecterra ("Гнотюк"
 * поряд з уже прив'язаним "Гнатюк") - на відміну від PATCH overseer_name,
 * НЕ затирає вже наявне написання, а додає нове. Якщо в працівника ще
 * взагалі немає overseer_name - записує напряму (як і раніше, без окремого
 * запису в employee_overseer_aliases - для найпростішого випадку однієї
 * прив'язки цього достатньо).
 */
employeesRouter.post('/:id/overseer-aliases', (req, res) => {
  const id = Number(req.params.id);
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!employee) throw notFound(`Працівника #${id} не знайдено`);

  const { alias } = parseOrThrow(z.object({ alias: z.string().trim().min(1).max(200) }), req.body ?? {});

  const owner = db
    .prepare(
      `SELECT employee_id FROM employee_overseer_names WHERE name = @alias`,
    )
    .get({ alias });

  if (owner && owner.employee_id !== id) {
    throw conflict(`«${alias}» вже прив'язано до іншого працівника`);
  }
  if (!owner) {
    if (!employee.overseer_name) {
      db.prepare("UPDATE employees SET overseer_name = ?, updated_at = datetime('now') WHERE id = ?").run(alias, id);
    } else {
      db.prepare('INSERT INTO employee_overseer_aliases (employee_id, alias) VALUES (?, ?)').run(id, alias);
    }
  }

  res.status(201).json(db.prepare('SELECT * FROM employees WHERE id = ?').get(id));
});
