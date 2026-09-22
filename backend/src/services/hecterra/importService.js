// Прийом оброблених площ по полях з Hecterra (той самий розробник, що й OVERSEER) ->
// hecterra_activities. Доступу до реального формату Hecterra ще немає (з'явиться
// найближчим часом), тому цей модуль приймає вже наш ВНУТРІШНІЙ масив активностей -
// коли зʼявиться формат Hecterra, окремий hecterra/parseExport.js перетворюватиме
// його файл/відповідь API в цей самий масив і викликатиме importHecterraActivities;
// цей файл і все, що на ньому побудовано (роут, підстановка в чернетку, тести),
// від формату не залежить і не зміниться.
//
// На відміну від machine_facts (мердж полів з кількох звітів), одна активність
// Hecterra - це вже завершений атомарний запис (поле × дата × техніка), тому UPSERT
// тут - повна заміна рядка за природним ключем, а не часткове злиття.
import { db } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';

const FIELDS = [
  'field_name_raw', 'area_ha', 'field_area_ha', 'driver_name_raw', 'crop', 'work_type_raw',
  'distance_km', 'fuel_consumed', 'hours', 'external_id', 'source_files',
];

function normalize(value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function valuesDiffer(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === null && nb === null) return false;
  if (na === null || nb === null) return true;
  if (typeof na === 'number' || typeof nb === 'number') return Number(na) !== Number(nb);
  return String(na) !== String(nb);
}

const selectStmt = db.prepare(`
  SELECT * FROM hecterra_activities
   WHERE activity_date = @activity_date
     AND overseer_name = @overseer_name
     AND IFNULL(hecterra_field_id, '') = IFNULL(@hecterra_field_id, '')
     AND IFNULL(field_name_raw, '') = IFNULL(@field_name_raw, '')
`);
const insertStmt = db.prepare(`
  INSERT INTO hecterra_activities
    (activity_date, overseer_name, hecterra_field_id, field_name_raw, area_ha, field_area_ha, driver_name_raw,
     crop, work_type_raw, distance_km, fuel_consumed, hours, external_id, source_files)
  VALUES
    (@activity_date, @overseer_name, @hecterra_field_id, @field_name_raw, @area_ha, @field_area_ha, @driver_name_raw,
     @crop, @work_type_raw, @distance_km, @fuel_consumed, @hours, @external_id, @source_files)
`);
const updateStmt = db.prepare(`
  UPDATE hecterra_activities
     SET field_name_raw = @field_name_raw, area_ha = @area_ha, field_area_ha = @field_area_ha,
         driver_name_raw = @driver_name_raw, crop = @crop, work_type_raw = @work_type_raw,
         distance_km = @distance_km, fuel_consumed = @fuel_consumed, hours = @hours,
         external_id = @external_id, source_files = @source_files, ingested_at = datetime('now')
   WHERE id = @id
`);

/** UPSERT однієї активності. Повертає 'added'|'updated'|'unchanged'. */
function upsertActivity(activity) {
  const key = {
    activity_date: activity.activity_date,
    overseer_name: activity.overseer_name,
    hecterra_field_id: activity.hecterra_field_id ?? null,
    // потрібне в ключі, коли hecterra_field_id відсутній - інакше різні поля
    // того самого дня зливаються в один запис (див. коментар при індексі)
    field_name_raw: activity.field_name_raw ?? null,
  };
  const existing = selectStmt.get(key);

  const row = {
    ...key,
    field_name_raw: activity.field_name_raw ?? null,
    area_ha: activity.area_ha ?? null,
    field_area_ha: activity.field_area_ha ?? null,
    driver_name_raw: activity.driver_name_raw ?? null,
    crop: activity.crop ?? null,
    work_type_raw: activity.work_type_raw ?? null,
    distance_km: activity.distance_km ?? null,
    fuel_consumed: activity.fuel_consumed ?? null,
    hours: activity.hours ?? null,
    external_id: activity.external_id ?? null,
    source_files: activity.source_files ?? null,
  };

  if (!existing) {
    insertStmt.run(row);
    return 'added';
  }

  const changed = FIELDS.some((f) => valuesDiffer(existing[f], row[f]));
  if (!changed) return 'unchanged';

  updateStmt.run({ ...row, id: existing.id });
  return 'updated';
}

/**
 * activities: масив { activity_date, overseer_name, hecterra_field_id?, field_name_raw?,
 * area_ha?, work_type_raw?, external_id?, source_files? } - уже в нашому внутрішньому
 * форматі (див. коментар угорі файлу).
 */
export function importHecterraActivities(activities) {
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const applyAll = db.transaction(() => {
    for (const activity of activities) {
      const status = upsertActivity(activity);
      if (status === 'added') added += 1;
      else if (status === 'updated') updated += 1;
      else unchanged += 1;
    }
  });
  applyAll();

  return { activitiesProcessed: activities.length, added, updated, unchanged };
}

/** Поля Hecterra, для яких є активності, але немає прив'язаного поля в
 * довіднику. Два джерела: звіт з межами (KMZ) дає числовий hecterra_field_id
 * (fields.gektera_field_id, прив'язка через PATCH - цей ключ стабільний), а
 * звіт "Оброблено полів" ID не дає взагалі - лише назву, яка між імпортами
 * міняється разом із площею в ній ("...47 га" -> "...51 га"), тож прив'язка
 * йде через POST /fields/:id/overseer-aliases (field_overseer_names) - не
 * затирає попереднє написання, як зробив би PATCH overseer_name. За key
 * фронтенд визначає, який зі шляхів прив'язки використати. */
export function listUnmappedHecterraFields() {
  const byId = db
    .prepare(`
      SELECT hecterra_field_id,
             (SELECT field_name_raw FROM hecterra_activities h2
               WHERE h2.hecterra_field_id = h.hecterra_field_id
               ORDER BY h2.activity_date DESC LIMIT 1) AS field_name_raw,
             COUNT(*) AS activities, MIN(activity_date) AS first_date, MAX(activity_date) AS last_date
        FROM hecterra_activities h
       WHERE hecterra_field_id IS NOT NULL
         AND hecterra_field_id NOT IN (SELECT gektera_field_id FROM fields WHERE gektera_field_id IS NOT NULL)
         AND hecterra_field_id NOT IN (SELECT value FROM alert_dismissals WHERE category = 'hecterra_field')
       GROUP BY hecterra_field_id
       ORDER BY hecterra_field_id
    `)
    .all()
    .map((r) => ({ key: r.hecterra_field_id, hecterra_field_id: r.hecterra_field_id, ...r }));

  const byName = db
    .prepare(`
      SELECT field_name_raw, COUNT(*) AS activities,
             MIN(activity_date) AS first_date, MAX(activity_date) AS last_date
        FROM hecterra_activities
       WHERE hecterra_field_id IS NULL
         AND field_name_raw IS NOT NULL AND field_name_raw != ''
         AND field_name_raw NOT IN (SELECT name FROM field_overseer_names)
         AND field_name_raw NOT IN (SELECT value FROM alert_dismissals WHERE category = 'hecterra_field')
       GROUP BY field_name_raw
       ORDER BY field_name_raw COLLATE NOCASE
    `)
    .all()
    .map((r) => ({ key: r.field_name_raw, hecterra_field_id: null, ...r }));

  return [...byId, ...byName];
}

/** Операції Hecterra ("Операція" у звіті), для яких є активності, але немає
 * прив'язаного виду роботи (work_types.overseer_name). */
export function listUnmappedHecterraWorkTypes() {
  return db
    .prepare(`
      SELECT work_type_raw, COUNT(*) AS activities,
             MIN(activity_date) AS first_date, MAX(activity_date) AS last_date
        FROM hecterra_activities
       WHERE work_type_raw IS NOT NULL AND work_type_raw != ''
         AND work_type_raw NOT IN (SELECT overseer_name FROM work_types WHERE overseer_name IS NOT NULL)
         AND work_type_raw NOT IN (SELECT value FROM alert_dismissals WHERE category = 'hecterra_work_type')
       GROUP BY work_type_raw
       ORDER BY work_type_raw COLLATE NOCASE
    `)
    .all();
}

/** Активності, приєднані до довідника полів/техніки/водіїв - для екрана "Дані
 * з техніки" і для підстановки в чернетку шляхового. */
export function listHecterraActivities(filters = {}) {
  const where = [];
  const params = {};

  if (filters.date_from) {
    where.push('h.activity_date >= @date_from');
    params.date_from = filters.date_from;
  }
  if (filters.date_to) {
    where.push('h.activity_date <= @date_to');
    params.date_to = filters.date_to;
  }
  if (filters.overseer_name) {
    where.push('h.overseer_name = @overseer_name');
    params.overseer_name = filters.overseer_name;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT h.*,
             f.id   AS field_id,
             f.name AS field_name,
             eq.id  AS equipment_id,
             emp.id AS employee_id,
             emp.full_name AS employee_name,
             wt.id  AS work_type_id,
             wt.name AS work_type_name,
             -- точна перевірка САМЕ цього проходу (на відміну від
             -- machine_facts.has_worklog, який лише per день×техніка і не
             -- розрізняє кілька полів за один день) - для "Даних з техніки",
             -- щоб кнопка "Зареєструвати роботу" зникала рівно там, де вже
             -- зареєстровано, а не на всіх рядках того самого дня/машини
             EXISTS (SELECT 1 FROM worklogs w WHERE w.hecterra_activity_id = h.id) AS has_worklog
        FROM hecterra_activities h
        LEFT JOIN fields      f   ON (h.hecterra_field_id IS NOT NULL AND f.gektera_field_id = h.hecterra_field_id)
                                   OR (h.hecterra_field_id IS NULL AND f.id = (
                                        SELECT field_id FROM field_overseer_names fon WHERE fon.name = h.field_name_raw
                                      ))
        LEFT JOIN equipment   eq  ON eq.overseer_name     = h.overseer_name
        -- через в'юху employee_overseer_names (основне ім'я + додаткові
        -- написання), а не напряму employees.overseer_name - інакше друге
        -- написання того самого водія ("Гнотюк" поряд з "Гнатюк")
        -- ніколи б не резолвилось
        LEFT JOIN employee_overseer_names eon ON eon.name = h.driver_name_raw
        LEFT JOIN employees   emp ON emp.id = eon.employee_id
        LEFT JOIN work_types  wt  ON wt.overseer_name      = h.work_type_raw
        ${whereSql}
       ORDER BY h.activity_date DESC, h.overseer_name
    `)
    .all(params);

  // Кілька водіїв в одному проході ("Петров П, 19. Іванов") не збігаються з
  // жодним overseer_name цілком - пробуємо кожне ім'я окремо, щоб хоча б
  // одного з них підставити в чернетку. Саму комбіновану назву НІКОЛИ не
  // пишемо в employees.overseer_name (це б зламало точний збіг для інших,
  // "чистих" активностей того самого водія - був живий баг).
  const needsSplit = rows.some((r) => r.employee_id == null && r.driver_name_raw?.includes(','));
  if (needsSplit) {
    const byOverseerName = employeesByOverseerName();
    for (const row of rows) {
      if (row.employee_id != null || !row.driver_name_raw?.includes(',')) continue;
      const match = resolveSplitDriverName(row.driver_name_raw, byOverseerName);
      if (match) {
        row.employee_id = match.id;
        row.employee_name = match.full_name;
      }
    }
  }

  return rows;
}

// Через в'юху employee_overseer_names - основне написання й усі додаткові
// (employee_overseer_aliases) в одній мапі "написання -> працівник".
const employeesByOverseerName = () =>
  new Map(
    db.prepare(`
      SELECT eon.name AS overseer_name, e.id, e.full_name
        FROM employee_overseer_names eon
        JOIN employees e ON e.id = eon.employee_id
    `).all()
      .map((e) => [e.overseer_name, e]),
  );

/** "Петров П, 19. Іванов" -> пробує кожне ім'я через кому окремо проти вже
 * прив'язаних написань (основне + аліаси); повертає першого знайденого
 * працівника або null. Той самий розбір, що й у listHecterraActivities() - тут винесено,
 * щоб listUnmappedHecterraDrivers() міг застосувати ту саму перевірку і не
 * висіти вічно на комбінованому імені, частину якого вже розпізнано. */
function resolveSplitDriverName(rawName, byOverseerName) {
  for (const part of rawName.split(',')) {
    const match = byOverseerName.get(part.replace(/^\s*\d+\s*\.?\s*/, '').trim());
    if (match) return match;
  }
  return null;
}

/** Імена водіїв Hecterra, для яких є активності, але немає прив'язаного
 * працівника (employees.overseer_name) - той самий патерн, що й unmapped для
 * техніки/полів: завжди актуальний запит, самоочищується після прив'язки.
 *
 * Комбіновані імена ("Петров П, 19. Іванов") тут не збігаються побуквено
 * жодним overseer_name і висіли б вічно, навіть коли одну з людей у зв'язці
 * вже прив'язано - listHecterraActivities() це вже враховує (розбиває ім'я
 * по комі для показу в чернетці), тож і тут прибираємо такий рядок зі
 * списку, щойно хоч одна частина розпізнається. Прив'язати сам комбінований
 * рядок через UI все одно не можна (SearchableSelect для нього вимкнено) -
 * тому такі записи інакше не зникають ніяк.
 */
export function listUnmappedHecterraDrivers() {
  const rows = db
    .prepare(`
      SELECT driver_name_raw, COUNT(*) AS activities,
             MIN(activity_date) AS first_date, MAX(activity_date) AS last_date
        FROM hecterra_activities
       WHERE driver_name_raw IS NOT NULL AND driver_name_raw != ''
         AND driver_name_raw NOT IN (SELECT name FROM employee_overseer_names)
         AND driver_name_raw NOT IN (SELECT value FROM alert_dismissals WHERE category = 'hecterra_driver')
       GROUP BY driver_name_raw
       ORDER BY driver_name_raw COLLATE NOCASE
    `)
    .all();

  const combined = rows.filter((r) => r.driver_name_raw.includes(','));
  if (combined.length === 0) return rows;

  const byOverseerName = employeesByOverseerName();
  return rows.filter(
    (r) => !r.driver_name_raw.includes(',') || !resolveSplitDriverName(r.driver_name_raw, byOverseerName),
  );
}

/** Видалити одну активність - "рядок, який не потрібен" (помилковий/зайвий
 * запис із чернетки). worklogs.hecterra_activity_id -> ON DELETE SET NULL,
 * тож уже збережені шляхові листи не постраждають, лише втратять посилання
 * на підказку. */
export function deleteHecterraActivity(id) {
  const info = db.prepare('DELETE FROM hecterra_activities WHERE id = ?').run(id);
  if (info.changes === 0) throw notFound('Активність Hecterra не знайдено');
}
