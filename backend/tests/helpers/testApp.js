import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

/**
 * Піднімає застосунок на випадковому порту з чистою тимчасовою SQLite БД.
 * db/index.js та config.js — модулі-синглтони, тому DB_PATH треба виставити
 * ДО першого імпорту (навіть транзитивного) — виклич це один раз на файл,
 * у top-level `before()`, і далі використовуй resetDb() між тестами.
 */
export async function createTestApp() {
  const dbPath = path.join(
    os.tmpdir(),
    `agro-zp-test-${process.pid}-${Date.now()}-${counter += 1}.db`,
  );
  process.env.DB_PATH = dbPath;
  process.env.CORS_ORIGIN = '*';
  process.env.NORMAL_SHIFT_HOURS ??= '8';

  const { db } = await import('../../src/db/index.js');
  db.exec(fs.readFileSync(path.resolve(here, '../../src/db/schema.sql'), 'utf8'));

  const { createApp } = await import('../../src/app.js');
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    db,
    baseUrl: `http://127.0.0.1:${port}`,
    api: client(`http://127.0.0.1:${port}`),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    },
  };
}

/** Прибирає всі рядки між тестами (порядок — від дітей до батьків через FK). */
export function resetDb(db) {
  const tables = [
    'locked_periods',
    'alert_dismissals',
    'hecterra_activities',
    'machine_facts',
    'worklogs',
    'work_plans',
    'employee_overseer_aliases',
    'tariff_rate_models',
    'tariff_rates',
    'route_km_rates',
    'routes',
    'work_types',
    'fields',
    'equipment',
    'equipment_models',
    'employees',
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get()) {
    db.exec('DELETE FROM sqlite_sequence');
  }
  // singleton-рядок, не видаляється - лише скидається до дефолту між тестами
  db.exec("UPDATE payroll_settings SET minimum_wage = 0, updated_by = NULL WHERE id = 1");
}

/** Тонкий HTTP-клієнт для інтеграційних тестів (Node fetch, без supertest). */
export function client(baseUrl) {
  const call = async (method, urlPath, body) => {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = Buffer.from(await res.arrayBuffer());
    const text = raw.toString('utf8');
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, raw, headers: res.headers };
  };

  return {
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, body),
    put: (p, body) => call('PUT', p, body),
    patch: (p, body) => call('PATCH', p, body),
    del: (p) => call('DELETE', p),
  };
}
