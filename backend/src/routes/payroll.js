import { Router } from 'express';
import { z } from 'zod';
import XLSX from 'xlsx';
import { isoDate, optionalId, parseOrThrow } from '../lib/validate.js';
import { UNITS } from '../services/payrollCalc.js';
import { CROPS } from '../services/crops.js';
import { getCropSummary, getEmployeeReport, getPayrollSummary } from '../services/payrollService.js';
import { getBasExportRows } from '../services/basExportService.js';
import { listLockedPeriods, lockPeriod, unlockPeriod } from '../services/periodLockService.js';

export const payrollRouter = Router();

const filtersSchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  employee_id: optionalId,
  staff_group: z.enum(['driver', 'tractor', 'other']).optional(),
});

const GROUP_LABELS = { driver: 'Водій', tractor: 'Тракторист', other: 'Інше' };

const periodLabel = (from, to) =>
  from || to ? `${from ?? '...'} – ${to ?? '...'}` : 'весь період';

function sendWorkbook(res, workbook, filename) {
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

/** Зведена відомість ЗП за період. */
payrollRouter.get('/summary', (req, res) => {
  res.json(getPayrollSummary(parseOrThrow(filtersSchema, req.query)));
});

/** Та сама відомість у форматі Excel (.xlsx). */
payrollRouter.get('/summary.xlsx', (req, res) => {
  const filters = parseOrThrow(filtersSchema, req.query);
  const { items, totals } = getPayrollSummary(filters);

  const header = [
    'ПІБ',
    'Посада',
    'Група',
    'Днів',
    'Записів',
    'Годин',
    'у т.ч. понаднормових',
    'Га',
    'Тонн',
    'Км',
    'т·км',
    'Ходок/рейсів',
    'Тюків',
    'Сума, грн',
  ];

  const rows = items.map((i) => [
    i.employee_name,
    i.position ?? '',
    GROUP_LABELS[i.staff_group] ?? i.staff_group,
    i.days_worked,
    i.entries,
    i.hours,
    i.overtime_hours,
    i.total_ha,
    i.total_tons,
    i.total_km,
    i.total_tkm,
    i.total_trips,
    i.total_bales,
    i.total_amount,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([
    [`Відомість нарахування ЗП за період: ${periodLabel(filters.date_from, filters.date_to)}`],
    [],
    header,
    ...rows,
    [],
    [
      'РАЗОМ',
      '',
      '',
      '',
      totals.entries,
      totals.hours,
      totals.overtime_hours,
      totals.total_ha,
      totals.total_tons,
      totals.total_km,
      totals.total_tkm,
      totals.total_trips,
      totals.total_bales,
      totals.total_amount,
    ],
  ]);

  sheet['!cols'] = header.map((h, idx) => ({ wch: idx === 0 ? 32 : Math.max(10, h.length + 2) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Відомість ЗП');
  sendWorkbook(res, workbook, `payroll-${filters.date_from ?? 'all'}_${filters.date_to ?? 'all'}.xlsx`);
});

/** Зведення по культурах за той самий період (для групування у відомості). */
payrollRouter.get('/by-crop', (req, res) => {
  res.json(getCropSummary(parseOrThrow(filtersSchema, req.query)));
});

/** Те саме зведення по культурах у форматі Excel (.xlsx). */
payrollRouter.get('/by-crop.xlsx', (req, res) => {
  const filters = parseOrThrow(filtersSchema, req.query);
  const { items, totals } = getCropSummary(filters);

  const header = [
    'Культура',
    'Днів',
    'Записів',
    'Годин',
    'Га',
    'Тонн',
    'Км',
    'т·км',
    'Ходок/рейсів',
    'Тюків',
    'Сума, грн',
  ];

  const rows = [];
  for (const i of items) {
    rows.push([
      i.crop_label,
      i.days_worked,
      i.entries,
      i.hours,
      i.total_ha,
      i.total_tons,
      i.total_km,
      i.total_tkm,
      i.total_trips,
      i.total_bales,
      i.total_amount,
    ]);
    for (const emp of i.employees) {
      rows.push([
        `    ${emp.employee_name}`,
        emp.days_worked,
        emp.entries,
        emp.hours,
        emp.total_ha,
        emp.total_tons,
        emp.total_km,
        emp.total_tkm,
        emp.total_trips,
        emp.total_bales,
        emp.total_amount,
      ]);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet([
    [`Зведення по культурах за період: ${periodLabel(filters.date_from, filters.date_to)}`],
    [],
    header,
    ...rows,
    [],
    [
      'РАЗОМ',
      '',
      totals.entries,
      totals.hours,
      totals.total_ha,
      totals.total_tons,
      totals.total_km,
      totals.total_tkm,
      totals.total_trips,
      totals.total_bales,
      totals.total_amount,
    ],
  ]);

  sheet['!cols'] = header.map((h, idx) => ({ wch: idx === 0 ? 24 : Math.max(10, h.length + 2) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'По культурах');
  sendWorkbook(res, workbook, `payroll-by-crop-${filters.date_from ?? 'all'}_${filters.date_to ?? 'all'}.xlsx`);
});

const basFiltersSchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
});

/** Вивантаження шляхових листів у формат для завантаження в BAS FOR AGRO. */
payrollRouter.get('/bas.xlsx', (req, res) => {
  const filters = parseOrThrow(basFiltersSchema, req.query);
  const rows = getBasExportRows(filters);

  const header = [
    'Дата', 'Код техніки', 'Найменування техніки', 'Код поля', 'Найменування поля',
    'Код культури', 'Культура', 'Код водія', 'Водій', 'Код типу роботи', 'Тип роботи',
    'Мотогодини', 'Га', 'Паливо, л', 'Сума, грн',
  ];

  const aoa = [
    header,
    ...rows.map((r) => [
      r.date, r.equipment_bas_code, r.equipment_name, r.field_bas_code, r.field_name,
      r.crop_code, r.crop_label, r.employee_bas_code, r.employee_name, r.work_type_bas_code, r.work_type_name,
      r.engine_hours, r.area_ha, r.fuel_consumed, r.amount,
    ]),
    [],
    ['Формат орієнтовний - узгодьте з реальним шаблоном завантаження BAS і повідомте, що поправити.'],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 18 },
    { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 20 },
    { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Завантаження BAS');
  sendWorkbook(res, workbook, `BAS_${filters.date_from ?? 'all'}_${filters.date_to ?? 'all'}.xlsx`);
});

const employeeParams = (req) =>
  parseOrThrow(
    z.object({
      employee_id: z.coerce.number().int().positive(),
      date_from: isoDate.optional(),
      date_to: isoDate.optional(),
    }),
    { employee_id: req.params.id, date_from: req.query.date_from, date_to: req.query.date_to },
  );

/** Деталізований розрахунок по працівнику за кожен день. */
payrollRouter.get('/employee/:id', (req, res) => {
  res.json(getEmployeeReport(employeeParams(req)));
});

/** Деталізований розрахунок по працівнику у форматі Excel (для «корінця»). */
payrollRouter.get('/employee/:id/export.xlsx', (req, res) => {
  const params = employeeParams(req);
  const report = getEmployeeReport(params);

  const aoa = [
    [`Розрахунок ЗП: ${report.employee.full_name}`],
    [`Період: ${periodLabel(params.date_from, params.date_to)}`],
    [],
    ['Дата', 'Вид роботи', 'Техніка', 'Поле', 'Культура', 'Од.', 'Обсяг', 'Спосіб оплати', 'Год', 'Сума, грн'],
  ];

  for (const day of report.days) {
    for (const item of day.items) {
      aoa.push([
        item.work_date !== item.work_date_to ? `${item.work_date} — ${item.work_date_to}` : item.work_date,
        item.work_type_name + (item.route_name ? ` (${item.route_name})` : ''),
        item.equipment_name ?? '',
        item.field_name ?? '',
        item.crop ? (CROPS[item.crop] ?? item.crop) : '',
        UNITS[item.unit]?.label ?? item.unit,
        item.quantity,
        item.pay_mode === 'hourly' ? 'погодинно' : item.tariff_rate_id || item.route_id ? 'тариф' : 'вручну',
        item.hours,
        item.total_amount,
      ]);
    }
    aoa.push([
      day.date,
      `Разом за день${day.overtime_hours > 0 ? ` (понаднормово ${day.overtime_hours} год)` : ''}`,
      '',
      '',
      '',
      '',
      '',
      '',
      day.hours,
      day.total_amount,
    ]);
  }

  const t = report.totals;
  aoa.push(
    [],
    ['ВСЬОГО', `${t.days_worked} дн.`, '', '', '', '', '', '', t.hours, t.total_amount],
    ['у т.ч. понаднормових, год', t.overtime_hours],
    ['Виробіток: га', t.total_ha, 'тонн', t.total_tons, 'км', t.total_km, 'т·км', t.total_tkm],
  );

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [
    { wch: 12 }, { wch: 42 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 8 },
    ...Array(4).fill({ wch: 12 }),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Розрахунок');
  sendWorkbook(
    res,
    workbook,
    `payroll-employee-${params.employee_id}-${params.date_from ?? 'all'}_${params.date_to ?? 'all'}.xlsx`,
  );
});

const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** Список закритих місяців (замикання після виплати - редагування/видалення
 * шляхових у них заблоковано, див. periodLockService.js). */
payrollRouter.get('/locked-periods', (req, res) => {
  res.json({ items: listLockedPeriods() });
});

/** Закрити місяць. locked_by - легкий облік "хто закрив", без логіну. */
payrollRouter.post('/locked-periods', (req, res) => {
  const { year, month } = parseOrThrow(periodSchema, req.body ?? {});
  const locked_by = req.body?.locked_by ? String(req.body.locked_by).trim().slice(0, 120) : null;
  res.status(201).json(lockPeriod(year, month, locked_by));
});

/** Відкрити місяць назад - без підтвердження на бекенді, рішення обліковця. */
payrollRouter.delete('/locked-periods/:year/:month', (req, res) => {
  const { year, month } = parseOrThrow(periodSchema, req.params);
  unlockPeriod(year, month);
  res.status(204).end();
});
