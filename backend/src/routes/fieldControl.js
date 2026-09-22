import { Router } from 'express';
import { z } from 'zod';
import { boolInt, isoDate, optionalId, parseOrThrow } from '../lib/validate.js';
import { getFieldControl } from '../services/fieldControlService.js';

export const fieldControlRouter = Router();

const filtersSchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  field_id: optionalId,
  all_work_types: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), boolInt.optional()),
});

/** Контроль гектарів: оброблено vs площа поля, в межах кожного виду роботи. */
fieldControlRouter.get('/', (req, res) => {
  res.json(getFieldControl(parseOrThrow(filtersSchema, req.query)));
});
