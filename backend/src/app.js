import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler } from './lib/errors.js';
import { apiRouter } from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src/app.js -> ../../frontend/dist
const frontendDist = path.join(here, '..', '..', 'frontend', 'dist');

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);

  // Невідомий /api-маршрут лишається JSON-помилкою, а не потрапляє в SPA-фолбек нижче.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Невідомий маршрут: ${req.method} ${req.originalUrl}` });
  });

  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist));
    // Усе, що не /api (перехоплено вище) і не знайдений статичний файл, - це
    // маршрут SPA (react-router): віддаємо index.html, роутинг на клієнті.
    app.use((req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: `Невідомий маршрут: ${req.method} ${req.originalUrl}` });
  });

  app.use(errorHandler);

  return app;
}
