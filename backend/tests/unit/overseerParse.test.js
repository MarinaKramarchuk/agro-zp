// Знеособлені вивантаження OVERSEER (машина "Китаєць", серпень 2026) — ті самі
// фікстури, на яких overseer-bas ловив реальні аномалії формату OVERSEER.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { readTripWorkbook } from '../../src/services/overseer/parseWorkbook.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/overseer');
const mapping = JSON.parse(fs.readFileSync(path.resolve(here, '../../config/overseer-mapping.json'), 'utf8'));

const GENERAL = path.join(fixturesDir, 'Китаєць_Загальний_звіт_(Поїздки+_Витрати)_2026-08-11_15-12-13.xlsx');
const TRIPS_ONLY = path.join(fixturesDir, 'Китаєць_Поездки_2026-08-11_15-04-53.xlsx');
const FUEL = path.join(fixturesDir, 'Китаєць_Расхода_топлива_ДУТ_2026-08-11_15-05-05.xlsx');

describe('overseer/parseWorkbook — readTripWorkbook (знеособлені звіти OVERSEER)', () => {
  it('розпізнає назву машини з аркуша "Статистика"', async () => {
    const result = await readTripWorkbook(GENERAL, mapping);
    assert.equal(result.machineName, 'Китаєць');
    assert.equal(result.hasAnyData, true);
    assert.equal(result.perDay.size, 9);
  });

  it('мотогодини рахуються з дочірніх рядків: 01.08 = 9.82', async () => {
    const result = await readTripWorkbook(GENERAL, mapping);
    const day = result.perDay.get('2026-08-01');
    assert.ok(day);
    assert.ok(Math.abs(day.engine_hours - 9.82) < 0.01, `очікували ~9.82, є ${day.engine_hours}`);
    assert.ok(Math.abs(day.distance_km - 20.63) < 0.01);
  });

  it('4-добовий безперервний холостий хід розподіляється рівно по 24г на кожен повний день (07–09.08)', async () => {
    const result = await readTripWorkbook(GENERAL, mapping);
    for (const key of ['2026-08-07', '2026-08-08', '2026-08-09']) {
      assert.equal(result.perDay.get(key).engine_hours, 24, `${key} має бути рівно 24 год`);
    }
    // крайні дні аномального запису — часткові, не рівно 24
    assert.ok(result.perDay.get('2026-08-06').engine_hours < 24);
    assert.ok(result.perDay.get('2026-08-10').engine_hours < 24);
  });

  it('звіт "Поездки" без аркуша "Статистика" -> machineName=null (розпізнавання з імені файлу — рівень сервісу імпорту)', async () => {
    const result = await readTripWorkbook(TRIPS_ONLY, mapping);
    assert.equal(result.machineName, null);
    assert.equal(result.hasAnyData, true);
  });

  it('окремий звіт "Розхід палива ДУТ" дає fuel_consumed за 01.08 = 72.27', async () => {
    const result = await readTripWorkbook(FUEL, mapping);
    const day = result.perDay.get('2026-08-01');
    assert.ok(Math.abs(day.fuel_consumed - 72.27) < 0.01);
  });

  it('округлення прибирає хвости з плаваючою комою (сума десятків дочірніх рядків)', async () => {
    const result = await readTripWorkbook(GENERAL, mapping);
    for (const day of result.perDay.values()) {
      for (const field of ['engine_hours', 'distance_km', 'fuel_consumed', 'fuel_refueled']) {
        if (day[field] === undefined) continue;
        assert.equal(day[field], Math.round(day[field] * 100) / 100);
      }
    }
  });
});
