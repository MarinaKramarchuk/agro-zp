import { db } from '../db/index.js';

/** Один рядок налаштувань розрахунку ЗП (зараз лише мінімальна ЗП). */
export const getSettings = () => db.prepare('SELECT * FROM payroll_settings WHERE id = 1').get();

export function updateSettings(patch) {
  const fields = ['minimum_wage', 'updated_by'];
  const current = getSettings();
  const merged = { ...current, ...patch };

  db.prepare(
    `UPDATE payroll_settings SET ${fields.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = 1`,
  ).run(Object.fromEntries(fields.map((k) => [k, merged[k] ?? null])));

  return getSettings();
}
