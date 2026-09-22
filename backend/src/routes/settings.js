import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../lib/validate.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

const updateSchema = z.object({
  minimum_wage: z.coerce.number().nonnegative(),
  updated_by: z.string().trim().max(120).nullish(),
});

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json(getSettings());
});

const update = (req, res) => {
  res.json(updateSettings(parseOrThrow(updateSchema, req.body ?? {})));
};

settingsRouter.put('/', update);
settingsRouter.patch('/', update);
