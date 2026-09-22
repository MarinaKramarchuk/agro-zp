import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { boolInt, compact, optionalId, parseOrThrow, partialUpdate } from '../lib/validate.js';
import { UNIT_KEYS } from '../services/payrollCalc.js';
import { getRate, listRateVariants, resolveRate } from '../services/tariffService.js';

const unitEnum = z.enum(UNIT_KEYS);

const shape = {
  work_type_id: z.coerce.number().int().positive(),
  equipment_label: z.string().trim().max(300).nullish(),
  implement_label: z.string().trim().max(300).nullish(),
  unit: unitEnum,
  rate: z.coerce.number().nonnegative().default(0),
  secondary_unit: unitEnum.nullish(),
  secondary_rate: z.coerce.number().nonnegative().default(0),
  is_manual: boolInt.default(0),
  // "типова ставка" в межах виду робіт - фолбек для оплати за транспортним
  // тарифом (worklogs.transport_pay), коли техніка не вказана або не
  // належить жодній з груп
  is_default_rate: boolInt.default(0),
  raw_text: z.string().trim().max(300).nullish(),
  note: z.string().trim().max(1000).nullish(),
  model_ids: z.array(z.coerce.number().int().positive()).optional(),
};

const createSchema = z.object(shape);
const updateSchema = partialUpdate(createSchema);

export const tariffsRouter = Router();

const RATE_COLUMNS = [
  'work_type_id',
  'equipment_label',
  'implement_label',
  'unit',
  'rate',
  'secondary_unit',
  'secondary_rate',
  'is_manual',
  'is_default_rate',
  'raw_text',
  'note',
];

function syncModels(rateId, modelIds) {
  db.prepare('DELETE FROM tariff_rate_models WHERE rate_id = ?').run(rateId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tariff_rate_models (rate_id, model_id) VALUES (?, ?)',
  );
  for (const modelId of modelIds) insert.run(rateId, modelId);
}

/** Список тарифів (з фільтрами для UI довідника). */
tariffsRouter.get('/', (req, res) => {
  const items = listRateVariants({
    work_type_id: req.query.work_type_id ? Number(req.query.work_type_id) : undefined,
    equipment_id: req.query.equipment_id ? Number(req.query.equipment_id) : undefined,
    unit: req.query.unit,
    staff_group: req.query.staff_group,
  });

  const q = req.query.q?.toString().toLowerCase();
  const filtered = q
    ? items.filter((i) =>
        [i.work_type_name, i.equipment_label, i.implement_label]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q)),
      )
    : items;

  res.json({ items: filtered, total: filtered.length });
});

/** Підбір тарифу для форми: робота + техніка -> один тариф або список варіантів. */
tariffsRouter.get('/resolve', (req, res) => {
  const { work_type_id, equipment_id, unit, tariff_rate_id, route_id } = req.query;
  if (!work_type_id && !tariff_rate_id && !route_id) {
    throw badRequest('Вкажіть work_type_id (або tariff_rate_id / route_id)');
  }

  const resolved = resolveRate({
    tariff_rate_id: tariff_rate_id ? Number(tariff_rate_id) : null,
    route_id: route_id ? Number(route_id) : null,
    work_type_id: work_type_id ? Number(work_type_id) : null,
    equipment_id: equipment_id ? Number(equipment_id) : null,
    unit: unit ?? null,
  });

  res.json(resolved);
});

tariffsRouter.get('/:id', (req, res) => {
  const rate = getRate(Number(req.params.id));
  if (!rate) throw notFound(`Тариф #${req.params.id} не знайдено`);
  res.json(rate);
});

tariffsRouter.post('/', (req, res) => {
  const data = parseOrThrow(createSchema, req.body ?? {});
  const { model_ids = [], ...rate } = data;

  const values = compact(Object.fromEntries(RATE_COLUMNS.map((k) => [k, rate[k]])));
  const keys = Object.keys(values);

  const info = db
    .prepare(`INSERT INTO tariff_rates (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`)
    .run(values);

  if (model_ids.length > 0) syncModels(info.lastInsertRowid, model_ids);

  res.status(201).json(getRate(info.lastInsertRowid));
});

const update = (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM tariff_rates WHERE id = ?').get(id);
  if (!existing) throw notFound(`Тариф #${id} не знайдено`);

  const data = compact(parseOrThrow(updateSchema, req.body ?? {}));
  const { model_ids, ...patch } = data;

  const values = Object.fromEntries(
    Object.entries(patch).filter(([k]) => RATE_COLUMNS.includes(k)),
  );
  const keys = Object.keys(values);
  if (keys.length === 0 && !model_ids) throw badRequest('Немає полів для оновлення');

  if (keys.length > 0) {
    db.prepare(
      `UPDATE tariff_rates SET ${keys.map((k) => `${k} = @${k}`).join(', ')},
              updated_at = datetime('now')
        WHERE id = @id`,
    ).run({ ...values, id });
  }

  if (model_ids) syncModels(id, model_ids);

  res.json(getRate(id));
};

tariffsRouter.put('/:id', update);
tariffsRouter.patch('/:id', update);

tariffsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM tariff_rates WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound(`Тариф #${id} не знайдено`);
  res.status(204).end();
});

// Прив'язані марки техніки для тарифу
tariffsRouter.get('/:id/models', (req, res) => {
  const items = db
    .prepare(
      `SELECT m.* FROM tariff_rate_models trm
         JOIN equipment_models m ON m.id = trm.model_id
        WHERE trm.rate_id = ?
        ORDER BY m.label COLLATE NOCASE`,
    )
    .all(Number(req.params.id));
  res.json({ items });
});

tariffsRouter.put('/:id/models', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM tariff_rates WHERE id = ?').get(id)) {
    throw notFound(`Тариф #${id} не знайдено`);
  }
  const { model_ids } = parseOrThrow(
    z.object({ model_ids: z.array(z.coerce.number().int().positive()) }),
    req.body ?? {},
  );
  syncModels(id, model_ids);
  res.json(getRate(id));
});

// Заготовка під редагування id техніки в тарифі з фронтенду
tariffsRouter.get('/:id/usage', (req, res) => {
  const rateId = optionalId.parse(req.params.id);
  const usage = db
    .prepare('SELECT COUNT(*) AS worklogs FROM worklogs WHERE tariff_rate_id = ?')
    .get(rateId);
  res.json(usage);
});
