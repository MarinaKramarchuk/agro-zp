import { z } from 'zod';
import { HttpError } from './errors.js';

/** Валідує дані схемою zod; на помилку кидає 422 з переліком полів. */
export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      422,
      'Некоректні дані',
      result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return result.data;
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Очікується дата у форматі YYYY-MM-DD');

/** Необов'язкове невід'ємне число з query/JSON (порожній рядок -> undefined). */
export const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().nonnegative().optional(),
);

export const optionalId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

/** Прапорець 0/1 у БД — приймає і boolean, і '0'/'1'. */
export const boolInt = z.preprocess(
  (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v),
  z.coerce.number().int().min(0).max(1),
);

/** Прибирає undefined-поля, щоб не перетирати значення в БД при PATCH. */
export const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Update-версія createSchema: усі поля необов'язкові, БЕЗ .default().
 * z.object(shape).partial() саму лишає .default() на кожному полі, тож Zod
 * підставляє дефолт замість undefined навіть для полів, яких немає в тілі
 * запиту — і PATCH/PUT тихо перезаписує в БД значення, які просто не
 * прийшли в запиті (напр. поле, відсутнє у формі фронтенду). removeDefault()
 * знімає дефолт перед .optional(), щоб відсутнє поле лишало значення в БД
 * незмінним, як і задумано compact().
 */
export function partialUpdate(schema) {
  const shape = {};
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const stripped = fieldSchema instanceof z.ZodDefault ? fieldSchema.removeDefault() : fieldSchema;
    shape[key] = stripped.optional();
  }
  return z.object(shape);
}
