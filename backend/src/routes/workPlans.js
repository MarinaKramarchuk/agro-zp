import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { compact, isoDate, optionalId, parseOrThrow, partialUpdate } from '../lib/validate.js';
import { CROP_KEYS } from '../services/crops.js';
import { assertDateRange } from '../services/worklogService.js';
import {
  createWorkPlan,
  deleteWorkPlan,
  getWorkPlan,
  listWorkPlans,
  updateWorkPlan,
} from '../services/workPlanService.js';

const baseShape = {
  plan_date: isoDate,
  employee_id: z.coerce.number().int().positive(),
  equipment_id: optionalId.nullable(),
  field_id: optionalId.nullable(),
  work_type_id: z.coerce.number().int().positive(),
  crop: z.enum(CROP_KEYS).nullish(),
  note: z.string().trim().max(1000).nullish(),
  created_by: z.string().trim().max(120).nullish(),
  updated_by: z.string().trim().max(120).nullish(),
};

const createSchema = z.object(baseShape);
const updateSchema = partialUpdate(createSchema);

const listQuerySchema = z.object({
  date: isoDate.optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  employee_id: optionalId,
  status: z.enum(['pending', 'confirmed']).optional(),
});

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Некоректний id');
  return id;
};

export const workPlansRouter = Router();

workPlansRouter.get('/', (req, res) => {
  const filters = parseOrThrow(listQuerySchema, req.query);
  assertDateRange(filters.date_from, filters.date_to);
  res.json(listWorkPlans(filters));
});

workPlansRouter.get('/:id', (req, res) => {
  const item = getWorkPlan(parseId(req.params.id));
  if (!item) throw notFound(`План #${req.params.id} не знайдено`);
  res.json(item);
});

workPlansRouter.post('/', (req, res) => {
  res.status(201).json(createWorkPlan(parseOrThrow(createSchema, req.body ?? {})));
});

const update = (req, res) => {
  const patch = compact(parseOrThrow(updateSchema, req.body ?? {}));
  if (Object.keys(patch).length === 0) throw badRequest('Немає полів для оновлення');
  res.json(updateWorkPlan(parseId(req.params.id), patch));
};

workPlansRouter.put('/:id', update);
workPlansRouter.patch('/:id', update);

workPlansRouter.delete('/:id', (req, res) => {
  deleteWorkPlan(parseId(req.params.id));
  res.status(204).end();
});
