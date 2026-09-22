import { Router } from 'express';
import { z } from 'zod';
import { isoDate, optionalNumber, parseOrThrow } from '../lib/validate.js';
import { getRepairGrid, setRepairHours } from '../services/repairHoursService.js';

export const repairHoursRouter = Router();

const monthSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
});

/** Сітка місяця для швидкого внесення годин ремонту: працівники × дні. */
repairHoursRouter.get('/', (req, res) => {
  const now = new Date();
  const params = parseOrThrow(monthSchema, {
    year: req.query.year ?? now.getFullYear(),
    month: req.query.month ?? now.getMonth() + 1,
  });

  res.json(getRepairGrid(params));
});

const cellSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  date: isoDate,
  hours: optionalNumber,
  actor: z.string().trim().max(120).nullish(),
});

/** Проставляє (або, якщо 0/порожньо, прибирає) години ремонту в одній комірці. */
repairHoursRouter.put('/', (req, res) => {
  const params = parseOrThrow(cellSchema, req.body);
  res.json(setRepairHours({ ...params, hours: params.hours ?? 0 }));
});
