import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { METRIC_FIELDS, calcAmounts, round2 } from './payrollCalc.js';
import { assertPeriodUnlocked } from './periodLockService.js';
import { getSettings } from './settingsService.js';
import { listRateVariants, resolveRate } from './tariffService.js';

/** Кількість робочих годин у місяці (будні дні × норма зміни) — для переведення
 * особистого місячного окладу в погодинну ставку. */
function monthlyNormHours(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let workDays = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) workDays += 1;
  }
  return workDays * config.normalShiftHours;
}

export const WORKLOG_SELECT = `
  SELECT w.*,
         e.full_name     AS employee_name,
         e.position      AS employee_position,
         e.staff_group   AS employee_group,
         eq.name         AS equipment_name,
         eq.plate_number AS equipment_plate,
         eq.category     AS equipment_category,
         f.name          AS field_name,
         wt.name         AS work_type_name,
         wt.is_repair    AS work_type_is_repair,
         rt.name         AS route_name,
         tr.equipment_label AS tariff_equipment_label,
         tr.implement_label AS tariff_implement_label,
         htr.work_type_id   AS helper_work_type_id,
         ha.field_name_raw  AS hecterra_field_name
    FROM worklogs w
    JOIN employees   e  ON e.id  = w.employee_id
    JOIN work_types  wt ON wt.id = w.work_type_id
    LEFT JOIN equipment    eq ON eq.id = w.equipment_id
    LEFT JOIN fields       f  ON f.id  = w.field_id
    LEFT JOIN routes       rt ON rt.id = w.route_id
    LEFT JOIN tariff_rates tr  ON tr.id  = w.tariff_rate_id
    LEFT JOIN tariff_rates htr ON htr.id = w.helper_tariff_rate_id
    LEFT JOIN hecterra_activities ha ON ha.id = w.hecterra_activity_id
`;

const STORED_FIELDS = [
  'work_date',
  'work_date_to',
  'employee_id',
  'equipment_id',
  'field_id',
  'crop',
  'cargo_type',
  'work_type_id',
  'tariff_rate_id',
  'route_id',
  'hecterra_activity_id',
  'area_ha_auto',
  'plan_id',
  'pay_mode',
  ...METRIC_FIELDS,
  'unit',
  'rate',
  'quantity',
  'secondary_unit',
  'secondary_rate',
  'secondary_quantity',
  'manual_amount',
  'helper_absent',
  'helper_tariff_rate_id',
  'helper_rate',
  'helper_amount',
  'transport_pay',
  'transport_tariff_rate_id',
  'transport_rate',
  'total_amount',
  'note',
  'confirmed',
  'created_by',
  'updated_by',
];

function requireRef(table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(422, `${label} #${id} не знайдено`);
  return row;
}

/** "Хімік 50%" - коли хімік відсутній, водій-оприскувач бере на себе його
 * роботу і отримує 50% від тарифу хіміка за оброблену площу того дня (як
 * якби хімік сам відпрацював цю площу). Тариф хіміка обирається вручну з
 * довідника (як і власна розцінка водія) - без жорсткої прив'язки
 * "вид оприскування -> тариф хіміка". */
function resolveHelperBonus(input, pay_mode) {
  if (!input.helper_absent) {
    return {
      helper_absent: 0,
      helper_tariff_rate_id: null,
      helper_rate: null,
      helper_amount: null,
    };
  }

  if (pay_mode !== 'tariff') {
    throw new HttpError(422, 'Доплата "хімік 50%" можлива лише для тарифної оплати', [
      { path: 'helper_absent', message: 'Недоступно для погодинної оплати' },
    ]);
  }

  if (!input.helper_tariff_rate_id) {
    throw new HttpError(422, 'Виберіть тариф хіміка для розрахунку доплати', [
      { path: 'helper_tariff_rate_id', message: 'Обов’язкове поле' },
    ]);
  }

  const helperRate = requireRef('tariff_rates', input.helper_tariff_rate_id, 'Тариф хіміка');
  const helperWorkType = requireRef('work_types', helperRate.work_type_id, 'Вид роботи хіміка');
  if (helperWorkType.is_helper_role !== 1) {
    throw new HttpError(
      422,
      `Обраний тариф ("${helperWorkType.name}") не позначений як розцінка хіміка`,
      [{ path: 'helper_tariff_rate_id', message: 'Не є розцінкою хіміка' }],
    );
  }

  const area = input.area_ha == null || input.area_ha === '' ? 0 : Number(input.area_ha);
  if (!(area > 0)) {
    throw new HttpError(422, 'Для доплати "хімік 50%" потрібно вказати оброблену площу (га)', [
      { path: 'area_ha', message: 'Обов’язкове значення більше 0' },
    ]);
  }

  const helper_rate = Number(helperRate.rate ?? 0);
  const helper_amount = round2(0.5 * helper_rate * area);

  return {
    helper_absent: 1,
    helper_tariff_rate_id: helperRate.id,
    helper_rate,
    helper_amount,
  };
}

/** Оплата за транспортним тарифом - фактичний вид робіт і обсяг (area_ha
 * тощо) фіксуються як завжди (звичайний тариф резолвиться й далі, ідуть у
 * Контроль гектарів без змін), але сума рахується не за тарифом цього виду
 * робіт, а як hours × ставка тарифу work_types.is_transport_rate ("Транспортні
 * роботи по господарству"). Ставка підбирається за технікою запису, як і
 * звичайний тариф; якщо техніка не вказана або не належить жодній групі -
 * береться ставка, позначена "типовою" (tariff_rates.is_default_rate) в межах
 * транспортного виду робіт. */
function resolveTransportOverride(input, pay_mode, hours) {
  if (!input.transport_pay) {
    return {
      transport_pay: 0,
      transport_tariff_rate_id: null,
      transport_rate: null,
      override: null,
    };
  }

  if (pay_mode !== 'tariff') {
    throw new HttpError(422, 'Оплата за транспортним тарифом можлива лише для тарифної оплати', [
      { path: 'transport_pay', message: 'Недоступно для погодинної оплати' },
    ]);
  }

  if (!(hours > 0)) {
    throw new HttpError(422, 'Для оплати за транспортним тарифом вкажіть кількість годин', [
      { path: 'hours', message: 'Обов’язкове значення більше 0' },
    ]);
  }

  const transportWorkTypes = db.prepare('SELECT * FROM work_types WHERE is_transport_rate = 1').all();
  if (transportWorkTypes.length === 0) {
    throw new HttpError(
      422,
      'У довіднику "Види робіт" не позначено вид робіт "Транспортні роботи по господарству" — позначте прапорцем "Транспортний тариф"',
      [{ path: 'transport_pay', message: 'Не налаштовано транспортний вид робіт' }],
    );
  }
  if (transportWorkTypes.length > 1) {
    throw new HttpError(
      422,
      'У довіднику "Види робіт" транспортним тарифом позначено декілька видів робіт — лишіть один',
      [{ path: 'transport_pay', message: 'Позначено декілька транспортних видів робіт' }],
    );
  }
  const [transportWorkType] = transportWorkTypes;

  let rate = null;
  if (input.equipment_id) {
    // "Типова ставка" (is_default_rate) - лише фолбек нижче, не звичайний
    // варіант підбору за технікою: без цього виключення ставка без прив'язки
    // до моделі (як і будь-яка "універсальна") хибно підійшла б під будь-яку
    // техніку тут же, і фолбек ніколи не спрацював би для непідхожої техніки.
    const variants = listRateVariants({
      work_type_id: transportWorkType.id,
      equipment_id: input.equipment_id,
      unit: 'hour',
    }).filter((v) => !v.is_default_rate);
    if (variants.length === 1) {
      [rate] = variants;
    } else if (variants.length > 1) {
      throw new HttpError(
        422,
        'Для цієї техніки є кілька транспортних тарифів — перевірте прив’язку моделей у довіднику тарифів',
        {
          variants: variants.map((v) => ({
            id: v.id,
            equipment_label: v.equipment_label,
            rate: v.rate,
          })),
        },
      );
    }
    // 0 варіантів - техніка не належить жодній групі, переходимо до типової ставки нижче
  }

  if (!rate) {
    const defaults = listRateVariants({ work_type_id: transportWorkType.id, unit: 'hour', is_default_rate: true });
    if (defaults.length === 0) {
      throw new HttpError(
        422,
        'Не позначено "типову ставку" транспортного тарифу — позначте, напр., МТЗ/Джон Дір, у довіднику "Тарифи"',
        [{ path: 'transport_pay', message: 'Не знайдено типову ставку' }],
      );
    }
    if (defaults.length > 1) {
      throw new HttpError(422, 'Позначено декілька типових ставок транспортного тарифу — лишіть одну', [
        { path: 'transport_pay', message: 'Кілька типових ставок' },
      ]);
    }
    [rate] = defaults;
  }

  const transport_rate = Number(rate.rate ?? 0);

  return {
    transport_pay: 1,
    transport_tariff_rate_id: rate.id,
    transport_rate,
    override: {
      amount: round2(transport_rate * hours),
    },
  };
}

export const findWorklog = (id) => db.prepare(`${WORKLOG_SELECT} WHERE w.id = ?`).get(id);

/** Перевіряє довідники, визначає тариф і рахує суму запису. */
function buildRow(input) {
  const employee = requireRef('employees', input.employee_id, 'Працівника');
  const workType = requireRef('work_types', input.work_type_id, 'Вид роботи');

  const work_date_to = input.work_date_to || input.work_date;
  if (input.work_date && work_date_to < input.work_date) {
    throw new HttpError(422, '"Дата по" не може бути раніше "Дата з"', [
      { path: 'work_date_to', message: 'Має бути не раніше дати з' },
    ]);
  }

  if (input.equipment_id) requireRef('equipment', input.equipment_id, 'Техніку');

  if (input.field_id) {
    requireRef('fields', input.field_id, 'Поле');
  } else if (workType.requires_field === 1) {
    throw new HttpError(422, `Для роботи "${workType.name}" потрібно вказати поле`, [
      { path: 'field_id', message: 'Обов’язкове поле' },
    ]);
  }

  // area_ha_auto - завжди снімок area_ha з самої Hecterra-активності на момент
  // збереження (сервер - джерело правди), не те, що міг прислати клієнт. area_ha
  // (введене/підтверджене людиною) від цього не залежить і лишається пріоритетним.
  let area_ha_auto = null;
  if (input.hecterra_activity_id) {
    const activity = requireRef('hecterra_activities', input.hecterra_activity_id, 'Активність Hecterra');
    area_ha_auto = activity.area_ha;
  }

  // План (work_plans) погоджується щойно на нього посилається якийсь worklog -
  // тож інший запис на той самий план означало б, що він уже погоджений раніше
  // (id IS NOT ? на update виключає сам поточний запис зі своєї ж перевірки).
  if (input.plan_id) {
    requireRef('work_plans', input.plan_id, 'План');
    const conflictingWorklog = db
      .prepare('SELECT id FROM worklogs WHERE plan_id = ? AND id IS NOT ?')
      .get(input.plan_id, input.id ?? null);
    if (conflictingWorklog) {
      throw new HttpError(
        422,
        `План #${input.plan_id} уже погоджено іншим шляховим листом (#${conflictingWorklog.id})`,
        [{ path: 'plan_id', message: 'План уже погоджено' }],
      );
    }
  }

  const pay_mode = input.pay_mode === 'hourly' ? 'hourly' : 'tariff';

  let manual;
  if (pay_mode === 'hourly') {
    // Особистий оклад пріоритетний; якщо не вказаний у картці працівника —
    // автоматично рахуємо за поточною мінімальною ЗП, без окремого прапорця.
    const ownRate = Number(employee.monthly_rate ?? 0);
    const monthlyRate = ownRate > 0 ? ownRate : Number(getSettings().minimum_wage ?? 0);
    if (!(monthlyRate > 0)) {
      throw new HttpError(
        422,
        `У працівника "${employee.full_name}" не вказано оклад, а мінімальна ЗП ще не задана — вкажіть одне з двох на сторінці "Працівники"`,
        [{ path: 'employee_id', message: 'Немає окладу' }],
      );
    }
    const normHours = monthlyNormHours(input.work_date);
    const hourlyRate = round2(monthlyRate / normHours);
    manual = { unit: 'hour', rate: hourlyRate };
  } else if (input.manual_rate != null) {
    // Тарифу немає в довіднику — обліковець вказав розцінку прямо в шляховому.
    manual = { unit: input.unit, rate: input.manual_rate };
  } else if (!input.tariff_rate_id && !input.route_id && input.rate != null) {
    // Оновлення запису, де розцінку раніше введено вручну (rate вже знімок у
    // БД): PATCH без повторної відправки manual_rate (напр. лише confirmed
    // при "Погодити") не повинен губити цю розцінку чи мовчки підміняти її
    // першим-ліпшим тарифом з довідника.
    manual = { unit: input.unit, rate: input.rate };
  }

  const { rate, label, tariff_rate_id, route } = resolveRate({
    tariff_rate_id: manual ? null : input.tariff_rate_id ?? null,
    route_id: manual ? null : input.route_id ?? null,
    work_type_id: input.work_type_id,
    equipment_id: input.equipment_id ?? null,
    unit: input.unit ?? null,
    manual,
  });

  const calc = calcAmounts({ rate, input, label });

  const helper = resolveHelperBonus(input, pay_mode);

  // Оплата за транспортним тарифом (transport_pay) підміняє суму, порахувану
  // зі звичайного тарифу (unit/rate/quantity в calc лишаються
  // "інформаційними" - реальний тариф обраного виду робіт) на hours × ставку
  // тарифу is_transport_rate. Взаємовиключна з доплатою "хімік 50%" - обидві
  // рахуються від різних величин (area_ha тарифу хіміка vs hours транспорту),
  // поєднання не має однозначного сенсу.
  const transport = resolveTransportOverride(input, pay_mode, Number(input.hours ?? 0));
  if (transport.transport_pay && helper.helper_absent) {
    throw new HttpError(
      422,
      'Не можна одночасно використовувати доплату "хімік 50%" і оплату за транспортним тарифом',
      [{ path: 'transport_pay', message: 'Конфліктує з доплатою "хімік 50%"' }],
    );
  }

  const baseAmount = transport.override ? transport.override.amount : calc.total_amount;
  const total_amount = round2(baseAmount + (helper.helper_amount ?? 0));
  const finalCalc = {
    ...calc,
    helper_absent: helper.helper_absent,
    helper_tariff_rate_id: helper.helper_tariff_rate_id,
    helper_rate: helper.helper_rate,
    helper_amount: helper.helper_amount,
    transport_pay: transport.transport_pay,
    transport_tariff_rate_id: transport.transport_tariff_rate_id,
    transport_rate: transport.transport_rate,
    total_amount,
  };

  return {
    row: {
      work_date: input.work_date,
      work_date_to,
      employee_id: input.employee_id,
      equipment_id: input.equipment_id ?? null,
      field_id: input.field_id ?? null,
      crop: input.crop ?? null,
      cargo_type: input.cargo_type ?? null,
      work_type_id: input.work_type_id,
      tariff_rate_id,
      route_id: route ? route.id : null,
      // знімок підказки Hecterra - не впливає на розрахунок, лише показує розбіжність з area_ha
      hecterra_activity_id: input.hecterra_activity_id ?? null,
      area_ha_auto,
      plan_id: input.plan_id ?? null,
      pay_mode,
      note: input.note ?? null,
      confirmed: input.confirmed ?? 0,
      // created_by лишається тим, хто створив запис (patch на update його не
      // передає, тож тут проходить незмінне значення з existing); updated_by -
      // завжди останній, хто зберіг. Легкий облік без логіну, не захист.
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
      ...finalCalc,
    },
    calc: finalCalc,
    employee,
    workType,
    rate,
  };
}

/** Розрахунок «на льоту» для форми — без збереження. */
export function previewWorklog(input) {
  const { calc, employee, workType, rate, row } = buildRow(input);

  return {
    employee: { id: employee.id, full_name: employee.full_name, staff_group: employee.staff_group },
    work_type: { id: workType.id, name: workType.name },
    pay_mode: row.pay_mode,
    tariff: {
      id: row.tariff_rate_id,
      route_id: row.route_id,
      unit: rate.unit,
      rate: rate.rate,
      equipment_label: rate.equipment_label ?? null,
      implement_label: rate.implement_label ?? null,
      is_manual: rate.is_manual ?? 0,
      raw_text: rate.raw_text ?? null,
    },
    ...calc,
  };
}

export function createWorklog(input) {
  const { row } = buildRow(input);
  assertPeriodUnlocked(row.work_date, row.work_date_to);
  const keys = STORED_FIELDS.filter((k) => row[k] !== undefined);

  const info = db
    .prepare(`INSERT INTO worklogs (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`)
    .run(Object.fromEntries(keys.map((k) => [k, row[k]])));

  return findWorklog(info.lastInsertRowid);
}

export function updateWorklog(id, patch) {
  const existing = db.prepare('SELECT * FROM worklogs WHERE id = ?').get(id);
  if (!existing) throw notFound(`Шляховий лист #${id} не знайдено`);

  // Перерахунок завжди на об'єднаних даних (старі поля + нові).
  const { row } = buildRow({ ...existing, ...patch });

  // Забороняємо чіпати запис як у поточному закритому періоді, так і
  // переносити його дату В закритий період - перевіряємо обидва діапазони.
  assertPeriodUnlocked(existing.work_date, existing.work_date_to);
  assertPeriodUnlocked(row.work_date, row.work_date_to);

  db.prepare(
    `UPDATE worklogs SET ${STORED_FIELDS.map((k) => `${k} = @${k}`).join(', ')},
            updated_at = datetime('now')
      WHERE id = @id`,
  ).run({ ...Object.fromEntries(STORED_FIELDS.map((k) => [k, row[k] ?? null])), id });

  return findWorklog(id);
}

/** Підтвердити/зняти звірку для кількох записів одним запитом - атомарно
 * (усе або нічого), щоб не лишити журнал у наполовину зміненому стані, якщо
 * один із записів, наприклад, потрапляє в закритий період. */
export function bulkSetConfirmed(ids, confirmed) {
  const apply = db.transaction((ids) => ids.map((id) => updateWorklog(id, { confirmed })));
  return apply(ids);
}

export function deleteWorklog(id) {
  const existing = db.prepare('SELECT work_date, work_date_to FROM worklogs WHERE id = ?').get(id);
  if (!existing) throw notFound(`Шляховий лист #${id} не знайдено`);
  assertPeriodUnlocked(existing.work_date, existing.work_date_to);

  const info = db.prepare('DELETE FROM worklogs WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound(`Шляховий лист #${id} не знайдено`);
}

export function listWorklogs(filters) {
  const where = [];
  const params = {};

  const eq = {
    equipment_id: 'w.equipment_id',
    field_id: 'w.field_id',
    crop: 'w.crop',
    work_type_id: 'w.work_type_id',
    route_id: 'w.route_id',
    confirmed: 'w.confirmed',
  };

  for (const [key, column] of Object.entries(eq)) {
    if (filters[key] !== undefined) {
      where.push(`${column} = @${key}`);
      params[key] = filters[key];
    }
  }

  if (filters.employee_id !== undefined) {
    where.push('w.employee_id = @employee_id');
    params.employee_id = filters.employee_id;
  }

  // Перетин періоду запису [work_date, work_date_to] з фільтром дат
  if (filters.date) {
    where.push('w.work_date <= @date AND w.work_date_to >= @date');
    params.date = filters.date;
  }
  if (filters.date_from) {
    where.push('w.work_date_to >= @date_from');
    params.date_from = filters.date_from;
  }
  if (filters.date_to) {
    where.push('w.work_date <= @date_to');
    params.date_to = filters.date_to;
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit ?? 200;
  const offset = filters.offset ?? 0;

  const items = db
    .prepare(`${WORKLOG_SELECT}${whereSql} ORDER BY w.work_date DESC, w.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  const totals = db
    .prepare(
      `SELECT COUNT(*)                          AS count,
              COALESCE(SUM(w.hours), 0)         AS hours,
              COALESCE(SUM(w.total_amount), 0)  AS total_amount
         FROM worklogs w${whereSql}`,
    )
    .get(params);

  return { items, total: totals.count, totals, limit, offset };
}

export function assertDateRange(from, to) {
  if (from && to && from > to) throw badRequest('date_from не може бути пізніше date_to');
}

/** Кількість шляхових, які досі не звірено з паперовим шляховим листом водія
 * (confirmed=0) і які вже точно завершились (work_date_to не пізніше "зараз
 * мінус days" - щоб не смикати ще триваючий багатоденний рейс) - для
 * сповіщення "Потребує уваги" (alertsService.js). */
export function countUnconfirmedWorklogs(days) {
  return db
    .prepare(`
      SELECT COUNT(*) AS c FROM worklogs
       WHERE confirmed = 0 AND work_date_to <= date('now', @offset)
    `)
    .get({ offset: `-${days} days` }).c;
}

const nextDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * Усі календарні дати, які запис шляхового листа охоплює в межах [boundFrom, boundTo]
 * (шляховий може тривати кілька днів: work_date..work_date_to).
 */
export function eachWorklogDate(worklog, boundFrom, boundTo) {
  const from = boundFrom && boundFrom > worklog.work_date ? boundFrom : worklog.work_date;
  const to = boundTo && boundTo < worklog.work_date_to ? boundTo : worklog.work_date_to;

  const dates = [];
  for (let d = from; d <= to; d = nextDay(d)) dates.push(d);
  return dates;
}
