import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';
import {
  linkTariffModel,
  seedEquipment,
  seedEquipmentModel,
  seedKmRate,
  seedRoute,
  seedTariff,
  seedWorkType,
} from '../helpers/seed.js';

// tariffService.js імпортує db/index.js на верхньому рівні, тому підвантажуємо
// його ДИНАМІЧНО, вже ПІСЛЯ того, як createTestApp() виставить DB_PATH —
// інакше модуль встигне відкрити БД за замовчуванням (backend/data/agro.db)
// ще до того, як тестовий helper матиме шанс це перехопити.
let resolveRate;
let listRateVariants;
let findKmRate;

describe('tariffService', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
    ({ resolveRate, listRateVariants, findKmRate } = await import('../../src/services/tariffService.js'));
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  describe('resolveRate', () => {
    it('route_id -> синтетична ставка unit=trip з тарифу маршруту', () => {
      const route = seedRoute(ctx.db, { rate: 500 });
      const result = resolveRate({ route_id: route.id });
      assert.equal(result.rate.unit, 'trip');
      assert.equal(result.rate.rate, 500);
      assert.equal(result.route.id, route.id);
      assert.equal(result.tariff_rate_id, null);
    });

    it('route_id, якого не існує -> 422', () => {
      assert.throws(() => resolveRate({ route_id: 999999 }), (err) => err.status === 422);
    });

    it('tariff_rate_id -> конкретний тариф із довідника', () => {
      const wt = seedWorkType(ctx.db);
      const tariff = seedTariff(ctx.db, { work_type_id: wt.id, rate: 120 });
      const result = resolveRate({ tariff_rate_id: tariff.id });
      assert.equal(result.rate.id, tariff.id);
      assert.equal(result.rate.rate, 120);
    });

    it('tariff_rate_id з чужим work_type_id -> 422', () => {
      const wt1 = seedWorkType(ctx.db, { name: 'Оранка' });
      const wt2 = seedWorkType(ctx.db, { name: 'Дискування' });
      const tariff = seedTariff(ctx.db, { work_type_id: wt1.id });
      assert.throws(
        () => resolveRate({ tariff_rate_id: tariff.id, work_type_id: wt2.id }),
        (err) => err.status === 422 && /іншому виду робіт/.test(err.message),
      );
    });

    it('manual вимагає unit', () => {
      assert.throws(
        () => resolveRate({ manual: { rate: 10 } }),
        (err) => err.status === 422 && err.details?.[0]?.path === 'unit',
      );
    });

    it('manual без тарифу з довідника формує синтетичну ставку', () => {
      const result = resolveRate({ manual: { unit: 'ha', rate: 77 } });
      assert.equal(result.rate.unit, 'ha');
      assert.equal(result.rate.rate, 77);
      assert.equal(result.tariff_rate_id, null);
    });

    it('немає жодного тарифу для роботи -> 422', () => {
      const wt = seedWorkType(ctx.db);
      assert.throws(
        () => resolveRate({ work_type_id: wt.id }),
        (err) => err.status === 422 && /немає тарифу/.test(err.message),
      );
    });

    it('рівно один варіант -> автовибір', () => {
      const wt = seedWorkType(ctx.db);
      const tariff = seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', rate: 90 });
      const result = resolveRate({ work_type_id: wt.id });
      assert.equal(result.rate.id, tariff.id);
      assert.equal(result.tariff_rate_id, tariff.id);
    });

    it('кілька варіантів -> 422 зі списком variants', () => {
      const wt = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', equipment_label: 'МТЗ', rate: 90 });
      seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', equipment_label: 'John Deere', rate: 110 });
      assert.throws(
        () => resolveRate({ work_type_id: wt.id }),
        (err) => err.status === 422 && Array.isArray(err.details?.variants) && err.details.variants.length === 2,
      );
    });
  });

  describe('listRateVariants — фільтр за технікою (universal vs brand-linked)', () => {
    it('тариф без привʼязки до марки — універсальний, підходить будь-якій техніці', () => {
      const wt = seedWorkType(ctx.db);
      const model = seedEquipmentModel(ctx.db, { label: 'МТЗ' });
      const equipment = seedEquipment(ctx.db, { model_id: model.id });
      const universalTariff = seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', rate: 50 });

      const variants = listRateVariants({ work_type_id: wt.id, equipment_id: equipment.id });
      assert.equal(variants.length, 1);
      assert.equal(variants[0].id, universalTariff.id);
    });

    it('тариф, привʼязаний до марки А, не підходить техніці марки Б', () => {
      const wt = seedWorkType(ctx.db);
      const modelA = seedEquipmentModel(ctx.db, { label: 'МТЗ', key: 'mtz' });
      const modelB = seedEquipmentModel(ctx.db, { label: 'John Deere', key: 'jd' });
      const equipmentB = seedEquipment(ctx.db, { model_id: modelB.id });

      const tariffA = seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', rate: 70 });
      linkTariffModel(ctx.db, tariffA.id, modelA.id);

      const variants = listRateVariants({ work_type_id: wt.id, equipment_id: equipmentB.id });
      assert.equal(variants.length, 0);
    });

    it('тариф, привʼязаний до марки А, підходить техніці марки А', () => {
      const wt = seedWorkType(ctx.db);
      const modelA = seedEquipmentModel(ctx.db, { label: 'МТЗ', key: 'mtz2' });
      const equipmentA = seedEquipment(ctx.db, { model_id: modelA.id });

      const tariffA = seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', rate: 70 });
      linkTariffModel(ctx.db, tariffA.id, modelA.id);

      const variants = listRateVariants({ work_type_id: wt.id, equipment_id: equipmentA.id });
      assert.equal(variants.length, 1);
      assert.equal(variants[0].id, tariffA.id);
    });
  });

  describe('listRateVariants — фільтр за staff_group', () => {
    it('враховує лише тарифи видів робіт із заданою групою', () => {
      const driverWt = seedWorkType(ctx.db, { name: 'Перевезення', staff_group: 'driver' });
      const tractorWt = seedWorkType(ctx.db, { name: 'Оранка', staff_group: 'tractor' });
      seedTariff(ctx.db, { work_type_id: driverWt.id, unit: 'km', rate: 15 });
      seedTariff(ctx.db, { work_type_id: tractorWt.id, unit: 'ha', rate: 90 });

      const driverVariants = listRateVariants({ staff_group: 'driver' });
      assert.equal(driverVariants.length, 1);
      assert.equal(driverVariants[0].work_type_name, 'Перевезення');
    });
  });

  describe('listRateVariants — фільтр за unit', () => {
    it('враховує лише тарифи із заданою одиницею виміру', () => {
      const wt = seedWorkType(ctx.db);
      seedTariff(ctx.db, { work_type_id: wt.id, unit: 'ha', rate: 90 });
      seedTariff(ctx.db, { work_type_id: wt.id, unit: 'hour', rate: 60 });

      const variants = listRateVariants({ work_type_id: wt.id, unit: 'hour' });
      assert.equal(variants.length, 1);
      assert.equal(variants[0].unit, 'hour');
    });
  });

  describe('findKmRate', () => {
    it('обирає найближчу нижню межу діапазону', () => {
      seedKmRate(ctx.db, { from_km: 0, to_km: 50, rate: 10 });
      seedKmRate(ctx.db, { from_km: 50, to_km: 100, rate: 8 });
      seedKmRate(ctx.db, { from_km: 100, to_km: null, rate: 6 });

      assert.equal(findKmRate(30).rate, 10);
      assert.equal(findKmRate(50).rate, 8);
      assert.equal(findKmRate(75).rate, 8);
    });

    it('відкритий діапазон (to_km = NULL) означає "і більше"', () => {
      seedKmRate(ctx.db, { from_km: 0, to_km: 100, rate: 10 });
      seedKmRate(ctx.db, { from_km: 100, to_km: null, rate: 6 });

      assert.equal(findKmRate(500).rate, 6);
    });

    it('відстань за межами найнижчого діапазону -> undefined', () => {
      seedKmRate(ctx.db, { from_km: 10, to_km: 50, rate: 10 });
      assert.equal(findKmRate(5), undefined);
    });
  });
});
