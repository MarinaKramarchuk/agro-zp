import { db } from '../db/index.js';
import { conflict } from '../lib/errors.js';

export function listLockedPeriods() {
  return db.prepare('SELECT year, month, locked_by, locked_at FROM locked_periods ORDER BY year DESC, month DESC').all();
}

export function isPeriodLocked(year, month) {
  return Boolean(db.prepare('SELECT 1 FROM locked_periods WHERE year = ? AND month = ?').get(year, month));
}

export function lockPeriod(year, month, locked_by) {
  db.prepare(
    `INSERT INTO locked_periods (year, month, locked_by, locked_at) VALUES (@year, @month, @locked_by, datetime('now'))
       ON CONFLICT (year, month) DO UPDATE SET locked_by = @locked_by, locked_at = datetime('now')`,
  ).run({ year, month, locked_by: locked_by ?? null });
  return db.prepare('SELECT year, month, locked_by, locked_at FROM locked_periods WHERE year = ? AND month = ?').get(year, month);
}

export function unlockPeriod(year, month) {
  db.prepare('DELETE FROM locked_periods WHERE year = ? AND month = ?').run(year, month);
}

/** Усі (рік, місяць), які охоплює діапазон дат [from, to] включно. */
function monthsInRange(from, to) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);

  const months = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Кидає 409, якщо хоч один місяць з [from, to] закритий - виклик перед
 * створенням/зміною/видаленням шляхового листа (worklogService.js). */
export function assertPeriodUnlocked(from, to) {
  for (const { year, month } of monthsInRange(from, to)) {
    if (isPeriodLocked(year, month)) {
      const label = `${String(month).padStart(2, '0')}.${year}`;
      throw conflict(`Період ${label} закрито для редагування — спершу відкрийте його в «Відомості ЗП»`);
    }
  }
}
