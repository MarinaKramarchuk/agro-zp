import { Router } from 'express';
import { z } from 'zod';
import { makeCrudRouter } from '../lib/crud.js';
import { optionalId, partialUpdate } from '../lib/validate.js';

const CATEGORIES = ['tractor', 'truck', 'combine', 'loader', 'sprayer', 'implement', 'other'];

const shape = {
  name: z.string().trim().min(1, 'Вкажіть назву/модель').max(200),
  model_id: optionalId.nullable(),
  plate_number: z.string().trim().max(40).nullish(),
  category: z.enum(CATEGORIES).default('other'),
  // назва об'єкта в OVERSEER/Hecterra - за нею мерджаться дані з machine_facts/hecterra_activities
  overseer_name: z.string().trim().max(200).nullish(),
  bas_code: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(1000).nullish(),
};

const createSchema = z.object(shape);

const crud = makeCrudRouter({
  table: 'equipment',
  createSchema,
  updateSchema: partialUpdate(createSchema),
  orderBy: 'name COLLATE NOCASE',
  searchColumns: ['name', 'plate_number'],
  listFilters: {
    category: 'category',
    model_id: { column: 'model_id', cast: Number },
  },
});

// Довідник марок техніки (МТЗ, Джон Дір, ДАФ ...) — використовується в тарифах.
const modelShape = {
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  category: z.enum(['tractor', 'truck', 'combine', 'loader', 'sprayer', 'other']).default('other'),
  note: z.string().trim().max(1000).nullish(),
};

const modelsCrud = makeCrudRouter({
  table: 'equipment_models',
  createSchema: z.object(modelShape),
  updateSchema: partialUpdate(z.object(modelShape)),
  orderBy: 'label COLLATE NOCASE',
  searchColumns: ['label', 'key'],
  listFilters: { category: 'category' },
});

export const equipmentRouter = Router();
equipmentRouter.use('/models', modelsCrud);
equipmentRouter.use('/', crud);
