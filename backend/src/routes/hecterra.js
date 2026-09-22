import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { isoDate, optionalNumber, parseOrThrow } from '../lib/validate.js';
import { CROP_KEYS } from '../services/crops.js';
import {
  deleteHecterraActivity,
  importHecterraActivities,
  listHecterraActivities,
  listUnmappedHecterraDrivers,
  listUnmappedHecterraFields,
  listUnmappedHecterraWorkTypes,
} from '../services/hecterra/importService.js';
import { dismissAlert } from '../services/alertDismissalsService.js';

export const hecterraRouter = Router();

const dismissSchema = z.object({ value: z.string().trim().min(1) });

const activitySchema = z.object({
  activity_date: isoDate,
  overseer_name: z.string().trim().min(1),
  hecterra_field_id: z.string().trim().min(1).nullish(),
  field_name_raw: z.string().trim().max(200).nullish(),
  area_ha: optionalNumber.nullable(),
  field_area_ha: optionalNumber.nullable(),
  driver_name_raw: z.string().trim().max(200).nullish(),
  crop: z.enum(CROP_KEYS).nullish(),
  work_type_raw: z.string().trim().max(200).nullish(),
  distance_km: optionalNumber.nullable(),
  fuel_consumed: optionalNumber.nullable(),
  hours: optionalNumber.nullable(),
  external_id: z.string().trim().max(200).nullish(),
  source_files: z.string().trim().max(2000).nullish(),
});

const importSchema = z.object({ activities: z.array(activitySchema).min(1) });

/**
 * Приймає вже розібрані активності Hecterra (поле × дата × техніка) у нашому
 * внутрішньому форматі - див. коментар у services/hecterra/importService.js.
 * Коли з'явиться доступ до реального формату Hecterra, перед цим ендпоінтом
 * стане парсер файлу/відповіді API; сам ендпоінт і все, що на ньому побудовано,
 * не зміниться.
 */
hecterraRouter.post('/import', (req, res) => {
  const { activities } = parseOrThrow(importSchema, req.body ?? {});
  if (!activities.length) throw badRequest('Не передано жодної активності');
  res.json(importHecterraActivities(activities));
});

const listFiltersSchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  overseer_name: z.string().trim().optional(),
});

hecterraRouter.get('/activities', (req, res) => {
  res.json({ items: listHecterraActivities(parseOrThrow(listFiltersSchema, req.query)) });
});

/** Ключі полів Hecterra без прив'язаного поля в довіднику. */
hecterraRouter.get('/unmapped', (req, res) => {
  res.json({ items: listUnmappedHecterraFields() });
});

/** Назавжди приховати одне поле (за тим самим key: hecterra_field_id або
 * field_name_raw) зі сповіщень "нерозпізнані поля". */
hecterraRouter.post('/unmapped/dismiss', (req, res) => {
  const { value } = parseOrThrow(dismissSchema, req.body ?? {});
  dismissAlert('hecterra_field', value);
  res.status(204).end();
});

/** Імена водіїв Hecterra без прив'язаного працівника в довіднику. */
hecterraRouter.get('/unmapped-drivers', (req, res) => {
  res.json({ items: listUnmappedHecterraDrivers() });
});

/** Назавжди приховати одне ім'я водія зі сповіщень "нерозпізнані водії". */
hecterraRouter.post('/unmapped-drivers/dismiss', (req, res) => {
  const { value } = parseOrThrow(dismissSchema, req.body ?? {});
  dismissAlert('hecterra_driver', value);
  res.status(204).end();
});

/** Операції Hecterra без прив'язаного виду роботи в довіднику. */
hecterraRouter.get('/unmapped-work-types', (req, res) => {
  res.json({ items: listUnmappedHecterraWorkTypes() });
});

/** Назавжди приховати одну операцію зі сповіщень "нерозпізнані операції". */
hecterraRouter.post('/unmapped-work-types/dismiss', (req, res) => {
  const { value } = parseOrThrow(dismissSchema, req.body ?? {});
  dismissAlert('hecterra_work_type', value);
  res.status(204).end();
});

/** Видалити один "непотрібний" рядок чернетки (помилковий/зайвий запис). */
hecterraRouter.delete('/activities/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Некоректний id');
  deleteHecterraActivity(id);
  res.status(204).end();
});
