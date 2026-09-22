import { z } from 'zod';
import { db } from '../db/index.js';
import { makeCrudRouter } from '../lib/crud.js';
import { conflict, notFound } from '../lib/errors.js';
import { boolInt, parseOrThrow, partialUpdate } from '../lib/validate.js';

const shape = {
  name: z.string().trim().min(1, 'Вкажіть назву/номер поля').max(200),
  area_ha: z.coerce.number().nonnegative().nullish(),
  crop: z.string().trim().max(120).nullish(),
  // чи стежити за полем у "Контролі гектарів" - керується з тієї сторінки
  is_watched: boolInt.default(1),
  // ключ поля в Hecterra (той самий розробник, що й OVERSEER) - за ним підставляються
  // поле/га в чернетку шляхового з hecterra_activities
  gektera_field_id: z.string().trim().max(120).nullish(),
  // назва поля за Hecterra ("Поле" у звіті "Оброблено полів" - там немає ID,
  // лише текст) - окремий ключ прив'язки, коли gektera_field_id відсутній
  overseer_name: z.string().trim().max(200).nullish(),
  bas_code: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(1000).nullish(),
};

const createSchema = z.object(shape);

export const fieldsRouter = makeCrudRouter({
  table: 'fields',
  createSchema,
  updateSchema: partialUpdate(createSchema),
  orderBy: 'name COLLATE NOCASE',
  searchColumns: ['name', 'crop', 'gektera_field_id'],
  listFilters: { crop: 'crop', is_watched: 'is_watched' },
});

/**
 * Прив'язка ще одного написання поля з Hecterra ("Поле № 4-В 47 га" поряд з
 * уже прив'язаним "...51 га" - перемір площі на боці Hecterra) - на відміну
 * від PATCH overseer_name, НЕ затирає вже наявне написання, а додає нове.
 * Той самий патерн, що POST /employees/:id/overseer-aliases для водіїв.
 */
fieldsRouter.post('/:id/overseer-aliases', (req, res) => {
  const id = Number(req.params.id);
  const field = db.prepare('SELECT * FROM fields WHERE id = ?').get(id);
  if (!field) throw notFound(`Поле #${id} не знайдено`);

  const { alias } = parseOrThrow(z.object({ alias: z.string().trim().min(1).max(200) }), req.body ?? {});

  const owner = db.prepare('SELECT field_id FROM field_overseer_names WHERE name = @alias').get({ alias });

  if (owner && owner.field_id !== id) {
    throw conflict(`«${alias}» вже прив'язано до іншого поля`);
  }
  if (!owner) {
    if (!field.overseer_name) {
      db.prepare("UPDATE fields SET overseer_name = ?, updated_at = datetime('now') WHERE id = ?").run(alias, id);
    } else {
      db.prepare('INSERT INTO field_overseer_aliases (field_id, alias) VALUES (?, ?)').run(id, alias);
    }
  }

  res.status(201).json(db.prepare('SELECT * FROM fields WHERE id = ?').get(id));
});
