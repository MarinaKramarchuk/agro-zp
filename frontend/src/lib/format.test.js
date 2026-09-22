import { describe, expect, it } from 'vitest';
import { dateLabel, isWeekend, money, monthRange, num, pad, weekdayOf } from './format.js';

describe('money / num', () => {
  it('форматує число у форматі uk-UA з двома знаками для money', () => {
    // Intl.NumberFormat('uk-UA') розділяє тисячі NBSP (U+00A0), не звичайним пробілом.
    expect(money(1234.5)).toBe('1 234,50');
  });

  it('null/undefined -> 0', () => {
    expect(money(null)).toBe('0,00');
    expect(money(undefined)).toBe('0,00');
    expect(num(null)).toBe('0');
  });

  it('num не додає зайвих нулів після коми', () => {
    expect(num(30.83)).toBe('30,83');
    expect(num(8)).toBe('8');
  });
});

describe('pad', () => {
  it('доповнює одноцифрові числа нулем', () => {
    expect(pad(1)).toBe('01');
    expect(pad(12)).toBe('12');
  });
});

describe('monthRange', () => {
  it('звичайний місяць', () => {
    expect(monthRange(2026, 8)).toEqual({ date_from: '2026-08-01', date_to: '2026-08-31' });
  });

  it('лютий у високосному році - 29 днів', () => {
    expect(monthRange(2028, 2)).toEqual({ date_from: '2028-02-01', date_to: '2028-02-29' });
  });

  it('лютий у невисокосному році - 28 днів', () => {
    expect(monthRange(2026, 2)).toEqual({ date_from: '2026-02-01', date_to: '2026-02-28' });
  });
});

describe('weekdayOf / isWeekend', () => {
  it('27.08.2026 - четвер', () => {
    expect(weekdayOf(2026, 8, 27)).toBe('Чт');
    expect(isWeekend(2026, 8, 27)).toBe(false);
  });

  it('субота й неділя позначені як вихідні', () => {
    // 2026-08-01 - субота, 2026-08-02 - неділя
    expect(weekdayOf(2026, 8, 1)).toBe('Сб');
    expect(isWeekend(2026, 8, 1)).toBe(true);
    expect(weekdayOf(2026, 8, 2)).toBe('Нд');
    expect(isWeekend(2026, 8, 2)).toBe(true);
  });
});

describe('dateLabel', () => {
  it('ISO -> дд.мм.рррр', () => {
    expect(dateLabel('2026-08-27')).toBe('27.08.2026');
  });

  it('порожнє значення -> порожній рядок', () => {
    expect(dateLabel('')).toBe('');
    expect(dateLabel(undefined)).toBe('');
  });
});
