import { Router } from 'express';
import { db } from '../db/index.js';
import { badRequest, notFound } from './errors.js';
import { compact, parseOrThrow } from './validate.js';

/**
 * Router з типовим CRUD для довідників.
 *
 * @param {object}   opts
 * @param {string}   opts.table          назва таблиці
 * @param {object}   opts.createSchema   zod-схема для POST
 * @param {object}   opts.updateSchema   zod-схема для PUT/PATCH (усі поля optional)
 * @param {string}   opts.orderBy        ORDER BY за замовчуванням
 * @param {string[]} opts.searchColumns  колонки для ?q=
 * @param {object}   opts.listFilters    { queryParam: 'column' | { column, cast } }
 */
export function makeCrudRouter({
  table,
  createSchema,
  updateSchema,
  orderBy = 'id',
  searchColumns = [],
  listFilters = {},
}) {
  const router = Router();
  const filters = Object.entries(listFilters).map(([param, def]) =>
    typeof def === 'string' ? { param, column: def, cast: String } : { param, cast: String, ...def },
  );

  const findById = (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

  const getOr404 = (id) => {
    const row = findById(id);
    if (!row) throw notFound(`Запис #${id} не знайдено в "${table}"`);
    return row;
  };

  const parseId = (raw) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Некоректний id');
    return id;
  };

  router.get('/', (req, res) => {
    const where = [];
    const params = {};

    for (const { param, column, cast } of filters) {
      const value = req.query[param];
      if (value !== undefined && value !== '') {
        where.push(`${column} = @${param}`);
        params[param] = cast(value);
      }
    }

    if (req.query.q && searchColumns.length > 0) {
      where.push(`(${searchColumns.map((c) => `${c} LIKE @q`).join(' OR ')})`);
      params.q = `%${req.query.q}%`;
    }

    const sql = `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
    const stmt = db.prepare(sql);
    res.json({ items: where.length || params.q ? stmt.all(params) : stmt.all() });
  });

  router.get('/:id', (req, res) => {
    res.json(getOr404(parseId(req.params.id)));
  });

  router.post('/', (req, res) => {
    const data = compact(parseOrThrow(createSchema, req.body ?? {}));
    const keys = Object.keys(data);
    if (keys.length === 0) throw badRequest('Порожній запит');

    const info = db
      .prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`,
      )
      .run(data);

    res.status(201).json(findById(info.lastInsertRowid));
  });

  const update = (req, res) => {
    const id = parseId(req.params.id);
    getOr404(id);

    const data = compact(parseOrThrow(updateSchema, req.body ?? {}));
    const keys = Object.keys(data);
    if (keys.length === 0) throw badRequest('Немає полів для оновлення');

    db.prepare(
      `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`,
    ).run({ ...data, id });

    res.json(findById(id));
  };

  router.put('/:id', update);
  router.patch('/:id', update);

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    getOr404(id);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    res.status(204).end();
  });

  return router;
}
