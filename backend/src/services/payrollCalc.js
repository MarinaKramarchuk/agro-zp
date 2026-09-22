import { HttpError } from '../lib/errors.js';

/** Типи розрахунку (одиниці виміру) та показники виробітку, які вони вимагають. */
export const UNITS = {
  ha: { label: 'га', rateLabel: 'грн/га', metric: 'area_ha', required: ['area_ha'] },
  ton: { label: 'тонни', rateLabel: 'грн/т', metric: 'tons', required: ['tons'] },
  km: { label: 'км', rateLabel: 'грн/км', metric: 'distance_km', required: ['distance_km'] },
  tkm: {
    label: 'т·км',
    rateLabel: 'грн/т·км',
    required: ['distance_km', 'cargo_tons'],
    quantity: (m) => m.distance_km * m.cargo_tons,
  },
  hour: { label: 'години', rateLabel: 'грн/год', metric: 'hours', required: ['hours'] },
  trip: { label: 'ходка/рейс', rateLabel: 'грн/ходку', metric: 'trips', required: ['trips'] },
  bale: { label: 'тюк', rateLabel: 'грн/тюк', metric: 'bales', required: ['bales'] },
  day: { label: 'день', rateLabel: 'грн/день', metric: 'days', required: ['days'] },
};

export const UNIT_KEYS = Object.keys(UNITS);

export const METRIC_FIELDS = [
  'hours',
  'area_ha',
  'tons',
  'distance_km',
  'cargo_tons',
  'trips',
  'bales',
  'days',
];

const METRIC_LABELS = {
  hours: 'Кількість годин',
  area_ha: 'Кількість га',
  tons: 'Вага (тонн)',
  distance_km: 'Відстань (км)',
  cargo_tons: 'Вантаж (тонн)',
  trips: 'Кількість ходок/рейсів',
  bales: 'Кількість тюків',
  days: 'Кількість днів',
};

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

const unitSpec = (unit) => {
  const spec = UNITS[unit];
  if (!spec) throw new HttpError(422, `Невідома одиниця виміру: ${unit}`);
  return spec;
};

const quantityFor = (unit, metrics) => {
  const spec = unitSpec(unit);
  return round4(spec.quantity ? spec.quantity(metrics) : (metrics[spec.metric] ?? 0));
};

export const unitMetrics = (unit) => unitSpec(unit).required;

/**
 * Розраховує суму за одним записом шляхового листа.
 *
 * Одна ставка (rate), нараховується одній людині. Складені тарифи (напр.
 * "72,5 грн/год + 5 грн/т") рахуються як друга складова
 * (secondary_unit + secondary_rate) і додаються до суми.
 *
 * @param {object} rate  розцінка (з довідника тарифів, маршруту або введена вручну)
 * @param {object} input показники виробітку зі форми
 * @param {string} label назва роботи — для тексту помилок
 */
export function calcAmounts({ rate, input, label = 'роботи' }) {
  const spec = unitSpec(rate.unit);

  const metrics = {};
  for (const key of METRIC_FIELDS) {
    metrics[key] = input[key] === undefined || input[key] === null || input[key] === ''
      ? null
      : Number(input[key]);
  }

  const manual_amount =
    input.manual_amount === undefined || input.manual_amount === null || input.manual_amount === ''
      ? null
      : Number(input.manual_amount);

  // Тариф "від мінімалки" тощо — суму вводить обліковець.
  if (rate.is_manual && manual_amount === null) {
    throw new HttpError(
      422,
      `Тариф для "${label}" не фіксований (${rate.raw_text ?? 'вводиться вручну'}) — вкажіть суму вручну`,
      [{ path: 'manual_amount', message: 'Обов’язкове значення' }],
    );
  }

  const required = [...spec.required];
  if (rate.secondary_unit) required.push(...unitSpec(rate.secondary_unit).required);

  const missing = required.filter((key) => !metrics[key] || metrics[key] <= 0);
  if (missing.length > 0 && manual_amount === null) {
    throw new HttpError(
      422,
      `Для "${label}" (${spec.label}) потрібно вказати: ${missing.map((k) => METRIC_LABELS[k]).join(', ')}`,
      missing.map((k) => ({ path: k, message: 'Обов’язкове значення більше 0' })),
    );
  }

  const quantity = quantityFor(rate.unit, metrics);
  const secondary_quantity = rate.secondary_unit ? quantityFor(rate.secondary_unit, metrics) : 0;

  const rateValue = Number(rate.rate ?? 0);
  const secondary_rate = Number(rate.secondary_rate ?? 0);

  const base = rateValue * quantity + secondary_rate * secondary_quantity;

  let total_amount = round2(base);

  // Ручна сума перекриває розрахунок.
  if (manual_amount !== null) {
    total_amount = round2(manual_amount);
  }

  return {
    ...metrics,
    hours: metrics.hours ?? 0,
    unit: rate.unit,
    rate: rateValue,
    quantity,
    secondary_unit: rate.secondary_unit ?? null,
    secondary_rate,
    secondary_quantity,
    manual_amount,
    total_amount,
  };
}
