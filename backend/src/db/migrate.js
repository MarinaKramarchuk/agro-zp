import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes('--reset');

if (reset) {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(config.dbPath + suffix, { force: true });
  }
  console.log(`Видалено попередню БД: ${config.dbPath}`);
}

// імпортуємо після можливого видалення файлу
const { db } = await import('./index.js');

// Доповнення схеми для вже створених БД (CREATE TABLE IF NOT EXISTS не додає
// нові колонки в наявну таблицю) — виконуємо ДО schema.sql, бо там є
// CREATE INDEX/REFERENCES на ці колонки.
function addColumnIfMissing(table, column, ddl) {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!tableExists) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (columns.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`Додано колонку ${table}.${column}`);
  return true;
}

addColumnIfMissing('worklogs', 'crop', `crop TEXT CHECK (crop IS NULL OR crop IN
  ('wheat', 'rye', 'barley', 'corn', 'sunflower', 'rapeseed', 'soy', 'pea', 'future_harvest'))`);
// Вид вантажу для транспортних рейсів (напр. САЗ - полова/зерновідходи) -
// суто інформаційне поле, на розрахунок суми не впливає (тариф годинний).
addColumnIfMissing('worklogs', 'cargo_type', `cargo_type TEXT CHECK (cargo_type IS NULL OR cargo_type IN
  ('chaff', 'grain_waste'))`);
addColumnIfMissing('worklogs', 'hecterra_activity_id', 'hecterra_activity_id INTEGER REFERENCES hecterra_activities (id) ON DELETE SET NULL');
addColumnIfMissing('worklogs', 'plan_id', 'plan_id INTEGER REFERENCES work_plans (id) ON DELETE SET NULL');
addColumnIfMissing(
  'employees',
  'uses_minimum_wage',
  'uses_minimum_wage INTEGER NOT NULL DEFAULT 0 CHECK (uses_minimum_wage IN (0, 1))',
);
addColumnIfMissing('worklogs', 'area_ha_auto', 'area_ha_auto REAL CHECK (area_ha_auto IS NULL OR area_ha_auto >= 0)');
addColumnIfMissing('employees', 'bas_code', 'bas_code TEXT');
addColumnIfMissing('equipment', 'overseer_name', 'overseer_name TEXT');
addColumnIfMissing('equipment', 'bas_code', 'bas_code TEXT');
addColumnIfMissing('fields', 'bas_code', 'bas_code TEXT');
addColumnIfMissing('fields', 'overseer_name', 'overseer_name TEXT');
addColumnIfMissing('work_types', 'bas_code', 'bas_code TEXT');
addColumnIfMissing('hecterra_activities', 'field_area_ha', 'field_area_ha REAL CHECK (field_area_ha IS NULL OR field_area_ha >= 0)');
addColumnIfMissing('hecterra_activities', 'driver_name_raw', 'driver_name_raw TEXT');
addColumnIfMissing('employees', 'overseer_name', 'overseer_name TEXT');
addColumnIfMissing('work_types', 'overseer_name', 'overseer_name TEXT');
addColumnIfMissing('hecterra_activities', 'crop', `crop TEXT CHECK (crop IS NULL OR crop IN
  ('wheat', 'rye', 'barley', 'corn', 'sunflower', 'rapeseed', 'soy', 'pea', 'future_harvest'))`);
addColumnIfMissing('hecterra_activities', 'distance_km', 'distance_km REAL CHECK (distance_km IS NULL OR distance_km >= 0)');
addColumnIfMissing('hecterra_activities', 'fuel_consumed', 'fuel_consumed REAL CHECK (fuel_consumed IS NULL OR fuel_consumed >= 0)');
addColumnIfMissing('hecterra_activities', 'hours', 'hours REAL CHECK (hours IS NULL OR hours >= 0)');

const addedIsRepair = addColumnIfMissing(
  'work_types',
  'is_repair',
  'is_repair INTEGER NOT NULL DEFAULT 0 CHECK (is_repair IN (0, 1))',
);
// DEFAULT 1 - усі наявні поля відразу лишаються в списку "Контролю гектарів"
// (як і було, без фільтра), а не зникають після міграції; звужувати список
// користувач тепер керує сам на сторінці.
addColumnIfMissing('fields', 'is_watched', 'is_watched INTEGER NOT NULL DEFAULT 1 CHECK (is_watched IN (0, 1))');
addColumnIfMissing('worklogs', 'created_by', 'created_by TEXT');
addColumnIfMissing('worklogs', 'updated_by', 'updated_by TEXT');

const addedAreaChecked = addColumnIfMissing(
  'work_types',
  'is_area_checked',
  'is_area_checked INTEGER NOT NULL DEFAULT 0 CHECK (is_area_checked IN (0, 1))',
);
if (addedAreaChecked) {
  // Разові операції на всю площу поля (оранка/посів/обмолот) - на відміну від
  // обприскування/культивації/внесення добрив тощо, які можуть повторюватись
  // за сезон, тож перевищення площі для них не показник проблеми.
  // startsWith, не includes - "Доставка та заправка посівмату+добрива" це
  // логістика для водіїв, не сама операція сівби, хоч і містить "посів".
  const AREA_CHECKED_MARKERS = ['оранка', 'посів', 'обмолот'];
  const matchIds = db
    .prepare('SELECT id, name FROM work_types')
    .all()
    .filter((w) => AREA_CHECKED_MARKERS.some((marker) => w.name.trim().toLowerCase().startsWith(marker)))
    .map((w) => w.id);
  if (matchIds.length > 0) {
    const update = db.prepare('UPDATE work_types SET is_area_checked = 1 WHERE id = ?');
    for (const id of matchIds) update.run(id);
    console.log(`Позначено як "контроль площі": ${matchIds.length} вид(и) робіт`);
  }
}

if (addedIsRepair) {
  // Позначаємо вже наявні "ремонтні" види робіт автоматично, щоб не
  // доводилось руками клацати чекбокс у довіднику для того, що вже є.
  // Фільтруємо в JS, а не через SQL LIKE - SQLite LOWER()/LIKE регістронезалежні
  // лише для ASCII, кирилицю "Ремонт" від "ремонт" так не відрізнити.
  const repairIds = db
    .prepare('SELECT id, name FROM work_types')
    .all()
    .filter((w) => w.name.toLowerCase().includes('ремонт'))
    .map((w) => w.id);
  if (repairIds.length > 0) {
    const update = db.prepare('UPDATE work_types SET is_repair = 1 WHERE id = ?');
    for (const id of repairIds) update.run(id);
    console.log(`Позначено як ремонт: ${repairIds.length} вид(и) робіт`);
  }
}

const addedHelperRole = addColumnIfMissing(
  'work_types',
  'is_helper_role',
  'is_helper_role INTEGER NOT NULL DEFAULT 0 CHECK (is_helper_role IN (0, 1))',
);
addColumnIfMissing('worklogs', 'helper_absent', 'helper_absent INTEGER NOT NULL DEFAULT 0 CHECK (helper_absent IN (0, 1))');
addColumnIfMissing('worklogs', 'helper_tariff_rate_id', 'helper_tariff_rate_id INTEGER REFERENCES tariff_rates (id) ON DELETE SET NULL');
addColumnIfMissing('worklogs', 'helper_rate', 'helper_rate REAL CHECK (helper_rate IS NULL OR helper_rate >= 0)');
addColumnIfMissing('worklogs', 'helper_amount', 'helper_amount REAL CHECK (helper_amount IS NULL OR helper_amount >= 0)');

if (addedHelperRole) {
  // Позначаємо вже наявні види робіт "хіміка/помічника" автоматично - так само,
  // як is_repair вище (JS-фільтр, не SQL LIKE - кирилицю LOWER()/LIKE в SQLite
  // регістронезалежно не розрізняє).
  const helperIds = db
    .prepare('SELECT id, name FROM work_types')
    .all()
    .filter((w) => w.name.toLowerCase().includes('помічник'))
    .map((w) => w.id);
  if (helperIds.length > 0) {
    const update = db.prepare('UPDATE work_types SET is_helper_role = 1 WHERE id = ?');
    for (const id of helperIds) update.run(id);
    console.log(`Позначено як роль хіміка/помічника: ${helperIds.length} вид(и) робіт`);
  }
}

const addedTransportRate = addColumnIfMissing(
  'work_types',
  'is_transport_rate',
  'is_transport_rate INTEGER NOT NULL DEFAULT 0 CHECK (is_transport_rate IN (0, 1))',
);
addColumnIfMissing('tariff_rates', 'is_default_rate', 'is_default_rate INTEGER NOT NULL DEFAULT 0 CHECK (is_default_rate IN (0, 1))');
addColumnIfMissing('worklogs', 'transport_pay', 'transport_pay INTEGER NOT NULL DEFAULT 0 CHECK (transport_pay IN (0, 1))');
addColumnIfMissing('worklogs', 'transport_tariff_rate_id', 'transport_tariff_rate_id INTEGER REFERENCES tariff_rates (id) ON DELETE SET NULL');
addColumnIfMissing('worklogs', 'transport_rate', 'transport_rate REAL CHECK (transport_rate IS NULL OR transport_rate >= 0)');
addColumnIfMissing('worklogs', 'confirmed', 'confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1))');

if (addedTransportRate) {
  // Позначаємо вид робіт "Транспортні роботи по господарству" автоматично -
  // той самий патерн, що й is_helper_role/is_repair вище.
  const transportIds = db
    .prepare('SELECT id, name FROM work_types')
    .all()
    .filter((w) => w.name.toLowerCase().includes('транспортні роботи'))
    .map((w) => w.id);
  if (transportIds.length > 0) {
    const update = db.prepare('UPDATE work_types SET is_transport_rate = 1 WHERE id = ?');
    for (const id of transportIds) update.run(id);
    console.log(`Позначено як транспортний тариф: ${transportIds.length} вид(и) робіт`);
  }

  // Позначаємо ставку МТЗ/Джон Дір "типовою" в межах уже позначених видів
  // робіт - фолбек для оплати за транспортним тарифом без техніки.
  if (transportIds.length > 0) {
    const placeholders = transportIds.map(() => '?').join(', ');
    const defaultRateIds = db
      .prepare(`SELECT id, equipment_label FROM tariff_rates WHERE work_type_id IN (${placeholders})`)
      .all(...transportIds)
      .filter((r) => (r.equipment_label ?? '').toLowerCase().includes('мтз'))
      .map((r) => r.id);
    if (defaultRateIds.length > 0) {
      const update = db.prepare('UPDATE tariff_rates SET is_default_rate = 1 WHERE id = ?');
      for (const id of defaultRateIds) update.run(id);
      console.log(`Позначено як типову ставку транспортного тарифу: ${defaultRateIds.length} тариф(и)`);
    }
  }
}

// Розширення CHECK-обмеження crop (додавання нових культур, напр. 'soy',
// 'pea') для БД, де колонка crop вже існує зі старим списком - ADD COLUMN
// вище цього не чіпає, бо колонка вже є, а ALTER TABLE ... CHECK у SQLite
// взагалі нема. Тому перейменовуємо стару таблицю, даємо schema.sql нижче
// створити нову (вже з повним поточним списком), переносимо дані й видаляємо
// стару - у транзакції з вимкненими foreign_keys (їх не можна вимкнути
// посеред транзакції), щоб не впертись у власні FK-посилання між
// worklogs/hecterra_activities/work_plans.
// Маркер перевірки - завжди НАЙНОВІША додана культура: її відсутність означає,
// що таблицю (незалежно від того, на якій саме попередній культурі вона
// відстала) треба перебудувати до поточного повного списку зі schema.sql.
function rebuildTablesForCropCheck(tables) {
  const need = tables.filter((t) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    return row && !row.sql.includes("'pea'");
  });
  if (need.length === 0) return;

  const wasForeignKeysOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (wasForeignKeysOn) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const tmpName = (t) => `${t}__crop_migration_old`;
      const droppedIndexes = [];
      for (const t of need) {
        // індекси старої таблиці запам'ятовуємо заздалегідь - після RENAME
        // вони лишаються прив'язані до перейменованої таблиці й заважають
        // CREATE INDEX IF NOT EXISTS нижче створити їх наново для нової
        droppedIndexes.push(
          ...db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(t).map((r) => r.name),
        );
        db.exec(`ALTER TABLE "${t}" RENAME TO "${tmpName(t)}"`);
      }
      for (const name of droppedIndexes) db.exec(`DROP INDEX IF EXISTS "${name}"`);

      db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

      for (const t of need) {
        const oldCols = db.prepare(`PRAGMA table_info("${tmpName(t)}")`).all().map((c) => c.name);
        const newCols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
        const cols = newCols.filter((c) => oldCols.includes(c)).map((c) => `"${c}"`).join(', ');
        db.exec(`INSERT INTO "${t}" (${cols}) SELECT ${cols} FROM "${tmpName(t)}"`);
        db.exec(`DROP TABLE "${tmpName(t)}"`);
      }
    })();
  } finally {
    if (wasForeignKeysOn) db.pragma('foreign_keys = ON');
  }
  console.log(`Оновлено CHECK-обмеження crop (перебудовано до поточного списку культур): ${need.join(', ')}`);
}
rebuildTablesForCropCheck(['worklogs', 'hecterra_activities', 'work_plans']);

// uq_hecterra_activities раніше не включав field_name_raw - два різні поля
// без hecterra_field_id в один день зливались в один запис (schema.sql нижче
// перестворить індекс з правильним визначенням).
db.exec('DROP INDEX IF EXISTS uq_hecterra_activities');

db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`БД готова: ${config.dbPath}`);
console.log(`Таблиці: ${tables.join(', ')}`);
