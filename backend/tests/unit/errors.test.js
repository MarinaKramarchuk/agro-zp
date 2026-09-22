import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorHandler, HttpError, translateDbError } from '../../src/lib/errors.js';

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

describe('translateDbError', () => {
  it('FOREIGN KEY (за code) -> 409 "використовується"', () => {
    const err = translateDbError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY', message: 'FOREIGN KEY constraint failed' });
    assert.equal(err.status, 409);
    assert.match(err.message, /використовується/);
  });

  it('FOREIGN KEY (лише за текстом, без коду) -> 409', () => {
    const err = translateDbError({ message: 'SQLITE_CONSTRAINT: FOREIGN KEY constraint failed' });
    assert.equal(err.status, 409);
  });

  it('UNIQUE -> 409 "вже існує" з деталями', () => {
    const err = translateDbError({ code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed: employees.full_name' });
    assert.equal(err.status, 409);
    assert.match(err.message, /уже існує/);
    assert.equal(err.details.sqlite, 'UNIQUE constraint failed: employees.full_name');
  });

  it('інший SQLITE_CONSTRAINT_* -> 400', () => {
    const err = translateDbError({ code: 'SQLITE_CONSTRAINT_CHECK', message: 'CHECK constraint failed: hours' });
    assert.equal(err.status, 400);
  });

  it('не-SQLite помилка проходить без змін', () => {
    const original = new TypeError('boom');
    assert.equal(translateDbError(original), original);
  });
});

describe('errorHandler (express middleware)', () => {
  it('HttpError -> статус і повідомлення з нього', () => {
    const res = mockRes();
    errorHandler(new HttpError(404, 'Не знайдено'), {}, res, () => {});
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Не знайдено');
  });

  it('HttpError з details -> потрапляють у відповідь', () => {
    const res = mockRes();
    errorHandler(new HttpError(422, 'Некоректні дані', [{ path: 'x', message: 'y' }]), {}, res, () => {});
    assert.deepEqual(res.body.details, [{ path: 'x', message: 'y' }]);
  });

  it('звичайна помилка без status -> 500 і дефолтне повідомлення', () => {
    const res = mockRes();
    errorHandler(new Error(''), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Внутрішня помилка сервера');
  });

  it('SQLite UNIQUE помилка транслюється перед відправкою', () => {
    const res = mockRes();
    errorHandler({ code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed: x' }, {}, res, () => {});
    assert.equal(res.statusCode, 409);
  });
});
