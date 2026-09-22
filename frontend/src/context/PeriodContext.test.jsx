import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeriodProvider, usePeriod } from './PeriodContext.jsx';

const KEY = 'agro-zp:period';

describe('PeriodContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('без збереженого періоду - стартує з поточного місяця/року', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11)); // вересень 2026 (місяці з 0)

    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    expect(result.current.year).toBe(2026);
    expect(result.current.month).toBe(9);
  });

  it('відновлює збережений період з localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ year: 2025, month: 3 }));

    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    expect(result.current.year).toBe(2025);
    expect(result.current.month).toBe(3);
  });

  it('пошкоджений localStorage - не падає, стартує з поточного місяця', () => {
    localStorage.setItem(KEY, '{зіпсований json');

    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    expect(Number.isInteger(result.current.year)).toBe(true);
    expect(Number.isInteger(result.current.month)).toBe(true);
  });

  it('shift(+1) з грудня переходить у січень наступного року', () => {
    localStorage.setItem(KEY, JSON.stringify({ year: 2026, month: 12 }));
    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    act(() => result.current.shift(1));

    expect(result.current.year).toBe(2027);
    expect(result.current.month).toBe(1);
  });

  it('shift(-1) із січня переходить у грудень попереднього року', () => {
    localStorage.setItem(KEY, JSON.stringify({ year: 2026, month: 1 }));
    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    act(() => result.current.shift(-1));

    expect(result.current.year).toBe(2025);
    expect(result.current.month).toBe(12);
  });

  it('setPeriod зберігає вибір у localStorage', () => {
    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    act(() => result.current.setPeriod(2030, 5));

    expect(result.current.year).toBe(2030);
    expect(result.current.month).toBe(5);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ year: 2030, month: 5 });
  });

  it('range і monthLabel рахуються від поточного періоду', () => {
    localStorage.setItem(KEY, JSON.stringify({ year: 2026, month: 8 }));
    const { result } = renderHook(() => usePeriod(), { wrapper: PeriodProvider });

    expect(result.current.range).toEqual({ date_from: '2026-08-01', date_to: '2026-08-31' });
    expect(result.current.monthLabel).toBe('Серпень 2026');
  });
});
