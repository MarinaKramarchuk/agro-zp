import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { makeCrudRouter } from '../lib/crud.js';
import { boolInt, partialUpdate } from '../lib/validate.js';
import { UNITS, UNIT_KEYS } from '../services/payrollCalc.js';
import { listRateVariants } from '../services/tariffService.js';

const shape = {
  name: z.string().trim().min(1, 'Вкажіть назву роботи').max(200),
  staff_group: z.enum(['driver', 'tractor', 'other']).default('other'),
  requires_field: boolInt.default(0),
  is_repair: boolInt.default(0),
  is_area_checked: boolInt.default(0),
  is_helper_role: boolInt.default(0),
  is_transport_rate: boolInt.default(0),
  bas_code: z.string().trim().max(60).nullish(),
  // назва операції в Hecterra ("Операція" у звіті) - за нею підставляється
  // вид роботи в чернетку шляхового
  overseer_name: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(1000).nullish(),
};

const createSchema = z.object(shape);

const crud = makeCrudRouter({
  table: 'work_types',
  createSchema,
  updateSchema: partialUpdate(createSchema),
  orderBy: 'name COLLATE NOCASE',
  searchColumns: ['name'],
  listFilters: {
    staff_group: 'staff_group',
    is_helper_role: 'is_helper_role',
    is_transport_rate: 'is_transport_rate',
  },
});

export const workTypesRouter = Router();

// Довідник одиниць виміру — для динамічних полів форми шляхового листа.
workTypesRouter.get('/units', (req, res) => {
  res.json({
    items: UNIT_KEYS.map((key) => ({
      unit: key,
      label: UNITS[key].label,
      rate_label: UNITS[key].rateLabel,
      required_metrics: UNITS[key].required,
    })),
  });
});

// Види робіт разом із кількістю доступних тарифів (для списку в UI).
workTypesRouter.get('/with-rates', (req, res) => {
  const items = db
    .prepare(
      `SELECT wt.*,
              COUNT(r.id)                                   AS rates_count,
              GROUP_CONCAT(DISTINCT r.unit)                 AS units
         FROM work_types wt
         LEFT JOIN tariff_rates r ON r.work_type_id = wt.id
        WHERE (@staff_group IS NULL OR wt.staff_group = @staff_group)
        GROUP BY wt.id
        ORDER BY wt.name COLLATE NOCASE`,
    )
    .all({
      staff_group: req.query.staff_group ?? null,
    });

  res.json({ items: items.map((i) => ({ ...i, units: i.units ? i.units.split(',') : [] })) });
});

// Варіанти тарифів для конкретного виду робіт (з урахуванням обраної техніки).
workTypesRouter.get('/:id/rates', (req, res) => {
  const items = listRateVariants({
    work_type_id: Number(req.params.id),
    equipment_id: req.query.equipment_id ? Number(req.query.equipment_id) : undefined,
    unit: req.query.unit,
  });
  res.json({ items });
});

workTypesRouter.use('/', crud);
