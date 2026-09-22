import { Router } from 'express';
import { z } from 'zod';
import XLSX from 'xlsx';
import { isoDate, optionalId, parseOrThrow } from '../lib/validate.js';
import { getDayDetails, getMonthGrid } from '../services/timesheetService.js';

export const timesheetRouter = Router();

const monthSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  employee_id: optionalId,
});

/** Табель за місяць: працівники × дні, години та колір комірки. */
timesheetRouter.get('/', (req, res) => {
  const now = new Date();
  const params = parseOrThrow(monthSchema, {
    year: req.query.year ?? now.getFullYear(),
    month: req.query.month ?? now.getMonth() + 1,
    employee_id: req.query.employee_id,
  });

  res.json(getMonthGrid(params));
});

/** Та сама сітка табеля у форматі Excel (.xlsx). */
timesheetRouter.get('/export.xlsx', (req, res) => {
  const now = new Date();
  const params = parseOrThrow(monthSchema, {
    year: req.query.year ?? now.getFullYear(),
    month: req.query.month ?? now.getMonth() + 1,
    employee_id: req.query.employee_id,
  });
  const grid = getMonthGrid(params);

  const header = ['Працівник', 'Посада', ...Array.from({ length: grid.total_days }, (_, i) => i + 1), 'Днів', 'Годин', 'Овертайм', 'Нараховано'];
  const rows = grid.rows.map((row) => [
    row.employee.full_name,
    row.employee.position ?? '',
    ...Array.from({ length: grid.total_days }, (_, i) => row.days[i + 1].hours || ''),
    row.totals.days_worked,
    row.totals.hours,
    row.totals.overtime_hours,
    row.totals.total_amount,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([
    [`Табель робочих днів: ${params.month}.${params.year}`],
    [],
    header,
    ...rows,
  ]);
  sheet['!cols'] = [{ wch: 28 }, { wch: 18 }, ...Array(grid.total_days).fill({ wch: 5 }), { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Табель');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="timesheet-${params.year}-${String(params.month).padStart(2, '0')}.xlsx"`);
  res.send(buffer);
});

/** Деталізація одного дня працівника (pop-up при кліку на комірку). */
timesheetRouter.get('/day', (req, res) => {
  const params = parseOrThrow(
    z.object({ employee_id: z.coerce.number().int().positive(), date: isoDate }),
    req.query,
  );
  res.json(getDayDetails(params));
});
