export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Запис не знайдено') => new HttpError(404, message);
export const conflict = (message, details) => new HttpError(409, message, details);

/** Мапить помилки SQLite у зрозумілі HTTP-відповіді. */
export function translateDbError(err) {
  // Залежно від версії SQLite код може бути як SQLITE_CONSTRAINT_FOREIGNKEY,
  // так і загальний SQLITE_CONSTRAINT — тому перевіряємо ще й текст.
  if (
    err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    /FOREIGN KEY constraint failed/i.test(err?.message ?? '')
  ) {
    return conflict('Запис використовується в інших даних (шляхові листи) або посилається на неіснуючий довідник');
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(err?.message ?? '')) {
    return conflict('Запис із таким значенням уже існує', { sqlite: err.message });
  }
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return badRequest('Дані не відповідають обмеженням БД', { sqlite: err.message });
  }
  return err;
}

// eslint-disable-next-line no-unused-vars -- Express визначає обробник помилок за 4 аргументами
export function errorHandler(err, req, res, next) {
  const e = translateDbError(err);
  const status = e.status ?? 500;

  if (status >= 500) console.error(e);

  res.status(status).json({
    error: e.message || 'Внутрішня помилка сервера',
    ...(e.details ? { details: e.details } : {}),
  });
}
