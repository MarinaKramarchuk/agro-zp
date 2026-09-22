import { Router } from 'express';
import { z } from 'zod';
import XLSX from 'xlsx';
import { badRequest, notFound } from '../lib/errors.js';
import { boolInt, compact, isoDate, optionalId, optionalNumber, parseOrThrow, partialUpdate } from '../lib/validate.js';
import { UNIT_KEYS, UNITS } from '../services/payrollCalc.js';
import { CROP_KEYS, CROPS } from '../services/crops.js';
import { CARGO_TYPE_KEYS } from '../services/cargoTypes.js';
import {
  assertDateRange,
  bulkSetConfirmed,
  createWorklog,
  deleteWorklog,
  findWorklog,
  listWorklogs,
  previewWorklog,
  updateWorklog,
} from '../services/worklogService.js';
import { renderWaybillTemplate } from '../services/waybillTemplateService.js';

const metricsShape = {
  hours: optionalNumber,
  area_ha: optionalNumber,
  tons: optionalNumber,
  distance_km: optionalNumber,
  cargo_tons: optionalNumber,
  trips: optionalNumber,
  bales: optionalNumber,
  days: optionalNumber,
};

const baseShape = {
  work_date: isoDate,
  // необов'язковий кінець періоду — шляховий може охоплювати кілька дат
  work_date_to: isoDate.nullish(),
  employee_id: z.coerce.number().int().positive(),
  equipment_id: optionalId.nullable(),
  field_id: optionalId.nullable(),
  crop: z.enum(CROP_KEYS).nullish(),
  // вид вантажу для транспортних рейсів (напр. САЗ - полова/зерновідходи);
  // на розрахунок суми не впливає
  cargo_type: z.enum(CARGO_TYPE_KEYS).nullish(),
  work_type_id: z.coerce.number().int().positive(),
  tariff_rate_id: optionalId.nullable(),
  route_id: optionalId.nullable(),
  // з якої підказки Hecterra зроблено запис - area_ha_auto сервер сам підтягує з неї
  // (снімок на момент збереження), клієнт його не передає. area_ha лишається тим,
  // що ввела/підтвердила людина - воно й тільки воно йде в розрахунок.
  hecterra_activity_id: optionalId.nullable(),
  // з якого плану (work_plans) погоджено/скориговано цей запис - необов'язкове,
  // передається лише коли форму відкрито через "Погодити" зі сторінки планів
  plan_id: optionalId.nullable(),
  unit: z.enum(UNIT_KEYS).optional(),
  ...metricsShape,
  // 'tariff' — за видом робіт (тариф/маршрут/вручну), 'hourly' — за особистою
  // погодинною ставкою працівника
  pay_mode: z.enum(['tariff', 'hourly']).default('tariff'),
  // розцінка вручну, коли підходящого тарифу немає в довіднику
  manual_rate: optionalNumber,
  manual_amount: optionalNumber.nullable(),
  // "хімік 50%" - хімік відсутній, водій отримує 50% від обраного тарифу
  // хіміка за area_ha; helper_tariff_rate_id обов'язковий, коли helper_absent=1
  helper_absent: boolInt.default(0),
  helper_tariff_rate_id: optionalId.nullable(),
  // оплата за транспортним тарифом - фактичний вид робіт/обсяг фіксуються як
  // завжди, сума рахується як hours × ставка тарифу work_types.is_transport_rate
  // (замість тарифу цього виду робіт); лише pay_mode='tariff', несумісне з helper_absent
  transport_pay: boolInt.default(0),
  note: z.string().trim().max(1000).nullish(),
  // звірено з паперовим шляховим листом водія - незалежно від GPS-підказки
  // Hecterra (hecterra_activity_id/area_ha_auto); сервер сам не скидає
  confirmed: boolInt.default(0),
  // ім'я людини, що зберігає запис - вписується в браузері без логіну,
  // легкий облік "хто вніс/востаннє змінив", не захист доступу
  created_by: z.string().trim().max(120).nullish(),
  updated_by: z.string().trim().max(120).nullish(),
};

const createSchema = z.object(baseShape);
const updateSchema = partialUpdate(createSchema);

// Для розрахунку «на льоту» дата не потрібна
const previewSchema = z.object({ ...baseShape, work_date: isoDate.optional() });

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Некоректний id');
  return id;
};

export const worklogsRouter = Router();

const listQuerySchema = z.object({
  date: isoDate.optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  employee_id: optionalId,
  equipment_id: optionalId,
  field_id: optionalId,
  crop: z.enum(CROP_KEYS).optional(),
  work_type_id: optionalId,
  route_id: optionalId,
  confirmed: boolInt.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

worklogsRouter.get('/', (req, res) => {
  const filters = parseOrThrow(listQuerySchema, req.query);
  assertDateRange(filters.date_from, filters.date_to);
  res.json(listWorklogs(filters));
});

/** Журнал робіт у форматі Excel (.xlsx) - ті самі фільтри, без ліміту рядків. */
worklogsRouter.get('/export.xlsx', (req, res) => {
  const filters = parseOrThrow(listQuerySchema.omit({ limit: true, offset: true }), req.query);
  assertDateRange(filters.date_from, filters.date_to);
  const { items } = listWorklogs({ ...filters, limit: 100000, offset: 0 });

  const header = [
    'Дата з', 'Дата по', 'Працівник', 'Техніка', 'Поле', 'Вид роботи', 'Культура',
    'Обсяг', 'Од.', 'Годин', 'Сума', 'Хімік 50%', 'Разом', 'Вніс',
  ];
  const rows = items.map((i) => [
    i.work_date,
    i.work_date_to,
    i.employee_name,
    i.equipment_name ?? '',
    i.field_name ?? '',
    i.work_type_name + (i.route_name ? ` (${i.route_name})` : ''),
    i.crop ? (CROPS[i.crop] ?? i.crop) : '',
    i.quantity,
    UNITS[i.unit]?.label ?? i.unit,
    i.hours,
    i.total_amount - (i.helper_absent === 1 ? i.helper_amount ?? 0 : 0),
    i.helper_absent === 1 ? i.helper_amount : '',
    i.total_amount,
    i.updated_by ?? '',
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 12 },
    { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 13 }, { wch: 10 }, { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Журнал робіт');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="worklogs-${filters.date_from ?? 'all'}_${filters.date_to ?? 'all'}.xlsx"`);
  res.send(buffer);
});

const WAYBILL_TEMPLATE_LABELS = {
  68: 'Дорожній листок трактора (форма №68)',
  2: 'Подорожній лист вантажного автомобіля (типова форма №2)',
  '67b': 'Обліковий лист тракториста-машиніста (форма №67-б)',
};

const waybillQuerySchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  // один шляховий лист = одна одиниця техніки (форми №68/№2/№67-б однаково)
  equipment_id: z.coerce.number().int().positive(),
  date_from: isoDate,
  date_to: isoDate,
  template: z.enum(['68', '2', '67b']).default('68'),
  org_name: z.string().trim().max(200).optional(),
  // лише для форми №68 - звести весь період в одну суцільну таблицю замість
  // окремого аркуша на кожен день (waybillTemplateService.renderWaybillTemplate).
  combine_period: boolInt.optional(),
});

/**
 * Той самий бланк, що на сторінці "Друк бланка шляхового" (WaybillPrintPage.jsx),
 * але у форматі Excel - щоб можна було відредагувати перед друком/збереженням.
 * Фільтрація записів дублює логіку фронтенду: без ремонту, лише записи з
 * ненульовою сумою й на конкретну техніку - один шляховий лист = одна
 * одиниця техніки.
 */
worklogsRouter.get('/waybill.xlsx', async (req, res) => {
  const q = parseOrThrow(waybillQuerySchema, req.query);
  assertDateRange(q.date_from, q.date_to);

  const { items: rawItems } = listWorklogs({
    employee_id: q.employee_id,
    equipment_id: q.equipment_id,
    date_from: q.date_from,
    date_to: q.date_to,
    limit: 100000,
    offset: 0,
  });

  const items = rawItems
    .filter((i) => !i.work_type_is_repair)
    .filter((i) => (i.total_amount ?? 0) > 0)
    .sort((a, b) => (a.work_date < b.work_date ? -1 : 1));

  if (items.length === 0) {
    throw notFound('Немає записів для друку за цих умов');
  }

  const employeeName = `${items[0].employee_name}${items[0].employee_position ? `, ${items[0].employee_position}` : ''}`;
  const vehicle = [...new Set(items.map((i) => [i.equipment_name, i.equipment_plate].filter(Boolean).join(' · ')).filter(Boolean))].join('; ');
  const implementsList = [...new Set(items.map((i) => i.tariff_implement_label).filter(Boolean))].join('; ');
  const unitLabel = (i) => UNITS[i.unit]?.label ?? i.unit;

  // Форми №68 і №2 - точна копія офіційних бланків (`шаблони/`), заповнена
  // по днях (окремий аркуш на кожен робочий день, як і фізичний папір).
  if (q.template === '68' || q.template === '2') {
    const itemsByDate = new Map();
    for (const i of items) {
      if (!itemsByDate.has(i.work_date)) itemsByDate.set(i.work_date, []);
      itemsByDate.get(i.work_date).push(i);
    }
    const buffer = await renderWaybillTemplate({
      template: q.template === '68' ? 68 : 2,
      orgName: q.org_name,
      employeeName,
      vehicleLabel: [...new Set(items.map((i) => i.equipment_name).filter(Boolean))].join('; '),
      plateNumber: [...new Set(items.map((i) => i.equipment_plate).filter(Boolean))].join('; '),
      implementLabel: implementsList,
      trailerLabel: implementsList,
      itemsByDate,
      crops: CROPS,
      units: UNITS,
      combinePeriod: q.template === '68' && q.combine_period === 1,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="waybill-${q.employee_id}-${q.date_from}_${q.date_to}.xlsx"`);
    res.send(buffer);
    return;
  }

  const aoa = [
    [q.org_name || 'Господарство: ____________________'],
    [WAYBILL_TEMPLATE_LABELS[q.template]],
    [`Період: ${q.date_from} — ${q.date_to}`],
    [],
  ];

  if (q.template === '67b') {
    aoa.push(
      ['Тракторист-машиніст:', employeeName],
      ['Марка, держ. номер трактора (машини):', vehicle],
      ['Табельний номер:', ''],
      ['Розряд, клас:', ''],
      [],
      [
        'Дата', 'Місце роботи (поле)', 'Вид виконаної роботи', 'Од. виміру', 'Норма виробітку',
        'Розцінка за од.', 'Обсяг виконаних робіт', 'Відпрацьовано, год',
        'Обприскування, грн', 'Хімік 50%, грн', 'Разом, грн',
      ],
    );
    let totalHours = 0;
    let totalTariff = 0;
    let totalHelper = 0;
    for (const i of items) {
      const helperAmt = i.helper_absent === 1 ? i.helper_amount ?? 0 : 0;
      const tariffAmt = (i.total_amount ?? 0) - helperAmt;
      totalHours += i.hours ?? 0;
      totalTariff += tariffAmt;
      totalHelper += helperAmt;
      aoa.push([
        i.work_date,
        i.field_name ?? '—',
        i.crop ? `${i.work_type_name} · ${CROPS[i.crop] ?? i.crop}` : i.work_type_name,
        unitLabel(i),
        '',
        i.rate,
        i.quantity,
        i.hours || '',
        tariffAmt,
        helperAmt || '',
        i.total_amount ?? 0,
      ]);
    }
    aoa.push(['Разом:', '', '', '', '', '', '', totalHours, totalTariff, totalHelper || '', totalTariff + totalHelper]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = Array.from({ length: 11 }, () => ({ wch: 16 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Бланк');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="waybill-${q.employee_id}-${q.date_from}_${q.date_to}.xlsx"`);
  res.send(buffer);
});

/** Розрахунок суми до збереження (для показу «Підсумкова сума за запис»). */
worklogsRouter.post('/preview', (req, res) => {
  const data = parseOrThrow(previewSchema, req.body ?? {});
  if (!data.employee_id || !data.work_type_id) {
    throw badRequest('Для розрахунку потрібні employee_id та work_type_id');
  }
  res.json(previewWorklog({ work_date: data.work_date ?? '1970-01-01', ...data }));
});

const bulkConfirmSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  confirmed: boolInt,
});

/** Масове підтвердження/зняття звірки з журналу робіт - вибрані рядки одним
 * запитом. Атомарно: якщо хоч один запис не вдалось оновити (не знайдено,
 * закритий період), жоден із вибраних не змінюється. */
worklogsRouter.patch('/bulk-confirm', (req, res) => {
  const { ids, confirmed } = parseOrThrow(bulkConfirmSchema, req.body ?? {});
  const items = bulkSetConfirmed(ids, confirmed);
  res.json({ items, updated: items.length });
});

worklogsRouter.get('/:id', (req, res) => {
  const item = findWorklog(parseId(req.params.id));
  if (!item) throw notFound(`Шляховий лист #${req.params.id} не знайдено`);
  res.json(item);
});

worklogsRouter.post('/', (req, res) => {
  res.status(201).json(createWorklog(parseOrThrow(createSchema, req.body ?? {})));
});

const update = (req, res) => {
  // compact прибирає undefined, щоб PATCH не перетирав уже збережені показники
  const patch = compact(parseOrThrow(updateSchema, req.body ?? {}));
  if (Object.keys(patch).length === 0) throw badRequest('Немає полів для оновлення');
  res.json(updateWorklog(parseId(req.params.id), patch));
};

worklogsRouter.put('/:id', update);
worklogsRouter.patch('/:id', update);

worklogsRouter.delete('/:id', (req, res) => {
  deleteWorklog(parseId(req.params.id));
  res.status(204).end();
});
