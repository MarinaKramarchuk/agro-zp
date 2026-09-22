import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { makeCrudRouter } from '../lib/crud.js';
import { partialUpdate } from '../lib/validate.js';
import { findKmRate, getRouteOr404 } from '../services/tariffService.js';
import { round2 } from '../services/payrollCalc.js';

// Маршрути міжміських рейсів: фіксована сума за рейс.
const shape = {
  name: z.string().trim().min(1, 'Вкажіть маршрут').max(300),
  distance_km: z.coerce.number().nonnegative().nullish(),
  rate: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(1000).nullish(),
};

const createSchema = z.object(shape);

const crud = makeCrudRouter({
  table: 'routes',
  createSchema,
  updateSchema: partialUpdate(createSchema),
  orderBy: 'name COLLATE NOCASE',
  searchColumns: ['name'],
});

export const routesRouter = Router();

// Ставки грн/км за діапазонами відстані
const kmShape = {
  from_km: z.coerce.number().nonnegative().default(0),
  to_km: z.coerce.number().nonnegative().nullish(),
  rate: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).nullish(),
};

const kmCrud = makeCrudRouter({
  table: 'route_km_rates',
  createSchema: z.object(kmShape),
  updateSchema: partialUpdate(z.object(kmShape)),
  orderBy: 'from_km',
});

routesRouter.use('/km-rates', kmCrud);

// Розрахунок суми рейсу: за довідником маршрутів або за грн/км
routesRouter.get('/estimate', (req, res) => {
  if (req.query.route_id) {
    const route = getRouteOr404(Number(req.query.route_id));
    return res.json({
      source: 'route',
      route,
      rate: route.rate,
    });
  }

  const km = Number(req.query.distance_km);
  if (!Number.isFinite(km) || km <= 0) {
    return res.status(400).json({ error: 'Вкажіть route_id або distance_km' });
  }

  const kmRate = findKmRate(km);
  if (!kmRate) return res.status(404).json({ error: `Немає ставки грн/км для ${km} км` });

  return res.json({
    source: 'km_rate',
    km_rate: kmRate,
    distance_km: km,
    rate: round2(kmRate.rate * km),
  });
});

// Скільки шляхових листів використовує маршрут (перед видаленням)
routesRouter.get('/:id/usage', (req, res) => {
  res.json(
    db.prepare('SELECT COUNT(*) AS worklogs FROM worklogs WHERE route_id = ?').get(Number(req.params.id)),
  );
});

routesRouter.use('/', crud);
