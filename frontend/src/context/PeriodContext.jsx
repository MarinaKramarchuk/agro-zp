import { createContext, useContext, useState } from 'react';
import { MONTH_NAMES, monthRange } from '../lib/format.js';

const KEY = 'agro-zp:period';

function readInitial() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Number.isInteger(saved.year) && Number.isInteger(saved.month)) return saved;
  } catch {
    // приватний режим тощо - просто почнемо з поточного місяця
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const PeriodContext = createContext(null);

/** Обраний звітний місяць/рік - спільний для всіх сторінок, що показують дані
 * за період, щоб не переставляти місяць окремо на кожній. */
export function PeriodProvider({ children }) {
  const [period, setPeriodState] = useState(readInitial);

  const setPeriod = (year, month) => {
    setPeriodState({ year, month });
    try {
      localStorage.setItem(KEY, JSON.stringify({ year, month }));
    } catch {
      // приватний режим тощо - просто не запам'ятається цього разу
    }
  };

  const shift = (delta) => {
    const date = new Date(Date.UTC(period.year, period.month - 1 + delta, 1));
    setPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
  };

  const value = {
    year: period.year,
    month: period.month,
    range: monthRange(period.year, period.month),
    monthLabel: `${MONTH_NAMES[period.month - 1]} ${period.year}`,
    setPeriod,
    shift,
  };

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export const usePeriod = () => useContext(PeriodContext);
