/**
 * Наповнює БД вигаданими демо-даними: працівники, техніка, поля, тарифи,
 * міжміські рейси, кілька десятків демо-шляхових листів. Призначено для
 * портфоліо/демонстрації — не для роботи з реальними даними підприємства.
 *
 * Запобіжник: якщо в employees/equipment/fields уже є записи, скрипт
 * відмовляється їх видаляти без явного `--force` (щоб не зачепити реальну
 * робочу БД випадковим запуском).
 *
 * Не чіпає довідники work_types/equipment_models — вони лишаються як є,
 * демо-тарифи прив'язуються до вже наявних видів робіт.
 */
import { db } from '../src/db/index.js';
import { CROP_KEYS } from '../src/services/crops.js';
import { unitMetrics } from '../src/services/payrollCalc.js';
import { createWorklog } from '../src/services/worklogService.js';

const FORCE = process.argv.includes('--force');
const IF_EMPTY = process.argv.includes('--if-empty');

function rnd(min, max) {
  return min + Math.random() * (max - min);
}
function rndInt(min, max) {
  return Math.floor(rnd(min, max + 1));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function pick(arr) {
  return arr[rndInt(0, arr.length - 1)];
}
function maybe(probability) {
  return Math.random() < probability;
}

function guard() {
  const counts = {
    employees: db.prepare('SELECT COUNT(*) c FROM employees').get().c,
    equipment: db.prepare('SELECT COUNT(*) c FROM equipment').get().c,
    fields: db.prepare('SELECT COUNT(*) c FROM fields').get().c,
  };
  const nonEmpty = Object.entries(counts).filter(([, c]) => c > 0);
  // --if-empty: для автоматичного старту на хостингу - наповнюємо лише чисту
  // БД, а наявні дані мовчки лишаємо (без помилки, щоб не зірвати запуск).
  if (nonEmpty.length > 0 && IF_EMPTY) {
    console.log('У БД вже є дані - демо-наповнення пропущено.');
    process.exit(0);
  }
  if (nonEmpty.length > 0 && !FORCE) {
    console.error(
      `У БД вже є дані (${nonEmpty.map(([k, c]) => `${k}: ${c}`).join(', ')}).\n` +
        'Запустіть з прапорцем --force, якщо дійсно хочете очистити й наповнити демо-даними.',
    );
    process.exit(1);
  }
}

function clear() {
  db.exec(`
    DELETE FROM worklogs;
    DELETE FROM work_plans;
    DELETE FROM hecterra_activities;
    DELETE FROM machine_facts;
    DELETE FROM alert_dismissals;
    DELETE FROM locked_periods;
    DELETE FROM tariff_rate_models;
    DELETE FROM tariff_rates;
    DELETE FROM routes;
    DELETE FROM route_km_rates;
    DELETE FROM employee_overseer_aliases;
    DELETE FROM field_overseer_aliases;
    DELETE FROM employees;
    DELETE FROM equipment;
    DELETE FROM fields;
    DELETE FROM work_types;
    DELETE FROM equipment_models;
  `);
  console.log('Очищено попередні виробничі дані та довідники (працівники/техніка/поля/тарифи/маршрути/види робіт/марки техніки).');
}

/* --- Марки техніки --------------------------------------------------------
 * Загальногалузеві назви марок (не ідентифікують підприємство) — раніше
 * наповнювались разом з тарифами через видалений import-tariffs.js, тепер
 * створюються тут, бо після db:reset таблиця порожня. */
const EQUIPMENT_MODELS = [
  { key: 'saz', label: 'САЗ', category: 'truck' },
  { key: 'kamaz', label: 'КАМАЗ', category: 'truck' },
  { key: 'daf', label: 'ДАФ', category: 'truck' },
  { key: 'mtz', label: 'МТЗ', category: 'tractor' },
  { key: 'kraz', label: 'КРАЗ', category: 'truck' },
  { key: 'john_deere', label: 'Джон Дір', category: 'tractor' },
  { key: 'chinese', label: 'Китаєць', category: 'tractor' },
  { key: 'case', label: 'Case', category: 'combine' },
  { key: 'claas', label: 'Claas', category: 'combine' },
  { key: 'new_holland', label: 'New Holland', category: 'combine' },
  { key: 'jcb', label: 'JCB', category: 'loader' },
  { key: 'bobcat', label: 'Бобкат', category: 'loader' },
  { key: 'atek', label: 'АТЕК', category: 'loader' },
];

function seedEquipmentModels() {
  const insert = db.prepare('INSERT INTO equipment_models (key, label, category, note) VALUES (@key, @label, @category, NULL)');
  for (const m of EQUIPMENT_MODELS) insert.run(m);
  console.log(`Додано марок техніки: ${EQUIPMENT_MODELS.length}`);
}

/* --- Види робіт -------------------------------------------------------------
 * Каталог видів робіт — узагальнена структура (без реальних топонімів
 * підприємства), раніше наповнювався разом з тарифами через видалений
 * import-tariffs.js, тепер створюється тут, бо після db:reset таблиця порожня. */
const WORK_TYPES = [
  { name: 'Перевезення зерна на ХПП (напрямок 1)', staff_group: 'driver' },
  { name: 'Перевезення зерна на ХПП (напрямок 2)', staff_group: 'driver' },
  { name: 'Перевезення соняшника на ХПП', staff_group: 'driver' },
  { name: 'Перевезення зерна ЗАВ-склад (сушка, площадка)', staff_group: 'driver' },
  { name: 'Перевезення соняшника ЗАВ-склад', staff_group: 'driver' },
  { name: 'Перевезення ріпаку ЗАВ-склад', staff_group: 'driver' },
  { name: 'Перевезення зерна з поля в склад', staff_group: 'driver' },
  { name: 'Перевезення зерна соняшника з поля в склад', staff_group: 'driver' },
  { name: 'Перевезення ріпаку поле-склад', staff_group: 'driver' },
  { name: 'Вивезення сміття', staff_group: 'driver' },
  { name: 'Вивезення навозу в поле (гноярку)', staff_group: 'driver' },
  { name: 'Помічник при внесенні гербіцидів (приготування розчину)', staff_group: 'driver', is_helper_role: 1 },
  { name: 'Доставка води до оприскувача', staff_group: 'driver' },
  { name: 'Доставка та заправка посівмату+м/добрива', staff_group: 'driver' },
  { name: 'Підвезення рідких добрив (розведених з водою)', staff_group: 'driver' },
  { name: 'Робота на крані', staff_group: 'driver' },
  { name: 'Підвезення по території господарства (корма, пісок, щебінь, металолом, бетон та інше)', staff_group: 'driver' },
  { name: 'Перевезення між відділеннями господарства (пісок, щебінь, металолом, бетон та інше)', staff_group: 'driver' },
  { name: 'Ремонтні роботи водіїв', staff_group: 'driver', is_repair: 1 },
  { name: 'Доставка та заправка посівмату+добрива', staff_group: 'driver' },
  { name: 'Водіям за простій в рейсі', staff_group: 'driver' },
  { name: 'Міжміський рейс (за маршрутом)', staff_group: 'driver' },
  { name: 'Боронування', staff_group: 'tractor' },
  { name: 'Боронування сходів', staff_group: 'tractor' },
  { name: 'Ротаційне боронування', staff_group: 'tractor' },
  { name: 'Культивація', staff_group: 'tractor' },
  { name: 'Культивація (городи)', staff_group: 'tractor' },
  { name: 'Культивація після ЗЗР', staff_group: 'tractor' },
  { name: 'Обприскування (самохідний)', staff_group: 'tractor' },
  { name: 'Обприскування МТЗ+заправник', staff_group: 'tractor' },
  { name: 'Обприскування (виїзне відділення)', staff_group: 'tractor' },
  { name: 'Помічник (хімік)', staff_group: 'tractor', is_helper_role: 1 },
  { name: 'Заробка ЗЗР (борона)', staff_group: 'tractor' },
  { name: 'Заробка ЗЗР', staff_group: 'tractor' },
  { name: 'Внесення добрив', staff_group: 'tractor' },
  { name: 'Внесення добрив по оранці', staff_group: 'tractor' },
  { name: 'Внесення фосфогіпсу', staff_group: 'tractor' },
  { name: 'Внесення КАС (аміак)', staff_group: 'tractor' },
  { name: 'Доставка води до дронів', staff_group: 'tractor' },
  { name: 'Коткування', staff_group: 'tractor' },
  { name: 'Коткування оранки', staff_group: 'tractor' },
  { name: 'Посів з добривами', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Посів без добрив', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Посів (городи)', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Дискування', staff_group: 'tractor' },
  { name: 'Дискування (городи)', staff_group: 'tractor' },
  { name: 'Оранка', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Оранка (городи)', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Мульчування', staff_group: 'tractor' },
  { name: 'Глибоке рихлення', staff_group: 'tractor' },
  { name: 'Лущення пожнивних рештків соняшника', staff_group: 'tractor' },
  { name: 'Тюкування (великий)', staff_group: 'tractor' },
  { name: 'Тюкування (малий)', staff_group: 'tractor' },
  { name: 'Перевезення тюків', staff_group: 'tractor' },
  { name: 'Обмолот зернових', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Обмолот кукурудзи', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Обмолот сої', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Обмолот соняшнику', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Обмолот льону', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Обмолот ріпаку', staff_group: 'tractor', is_area_checked: 1 },
  { name: 'Перегрузчик', staff_group: 'tractor' },
  { name: 'Ремонт трактористів', staff_group: 'tractor', is_repair: 1 },
  { name: 'Транспортні роботи по господарству', staff_group: 'tractor', is_transport_rate: 1 },
  { name: 'Вивіз гною в поле', staff_group: 'tractor' },
  { name: 'Розкидання перегною', staff_group: 'tractor' },
  { name: 'Доставка добрив', staff_group: 'tractor' },
  { name: 'Загрузка добрив', staff_group: 'tractor' },
  { name: 'Подрібнення гілок', staff_group: 'tractor' },
  { name: 'Косіння та обкошування', staff_group: 'tractor' },
  { name: 'ТО, перегони техніки', staff_group: 'tractor' },
  { name: 'Фумізація складу', staff_group: 'tractor' },
  { name: 'Вивезення землі', staff_group: 'driver' },
  { name: 'Інші роботи', staff_group: 'driver' },
  { name: 'Фрахт (дальній рейс)', staff_group: 'driver' },
  { name: 'Перевезення зерна (т·км)', staff_group: 'driver' },
  { name: 'Перевезення соняшника (т·км)', staff_group: 'driver' },
  { name: 'Перевезення щебеню/будматеріалів (т·км)', staff_group: 'driver' },
];

function seedWorkTypes() {
  const insert = db.prepare(`
    INSERT INTO work_types (name, staff_group, requires_field, is_repair, is_area_checked, is_helper_role, is_transport_rate, bas_code, overseer_name, note)
    VALUES (@name, @staff_group, 0, @is_repair, @is_area_checked, @is_helper_role, @is_transport_rate, NULL, NULL, NULL)
  `);
  for (const w of WORK_TYPES) {
    insert.run({
      name: w.name,
      staff_group: w.staff_group,
      is_repair: w.is_repair ?? 0,
      is_area_checked: w.is_area_checked ?? 0,
      is_helper_role: w.is_helper_role ?? 0,
      is_transport_rate: w.is_transport_rate ?? 0,
    });
  }
  console.log(`Додано видів робіт: ${WORK_TYPES.length}`);
}

/* --- Працівники ------------------------------------------------------- */
const EMPLOYEES = [
  { full_name: 'Іванов Іван Іванович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Петров Петро Петрович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Миколаєнко Микола Миколайович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Сидоренко Сидір Сидорович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Васильченко Василь Васильович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Дмитренко Дмитро Дмитрович', position: 'Водій', staff_group: 'driver' },
  { full_name: 'Андрієнко Андрій Андрійович', position: 'Тракторист-машиніст', staff_group: 'tractor' },
  { full_name: 'Олексієнко Олексій Олексійович', position: 'Тракторист-машиніст', staff_group: 'tractor' },
  { full_name: 'Степаненко Степан Степанович', position: 'Комбайнер', staff_group: 'tractor' },
  { full_name: 'Романенко Роман Романович', position: 'Тракторист-машиніст', staff_group: 'tractor' },
  { full_name: 'Григоренко Григорій Григорович', position: 'Механік', staff_group: 'other' },
  { full_name: 'Павленко Павло Павлович', position: 'Зварювальник', staff_group: 'other' },
];

function seedEmployees() {
  const insert = db.prepare(`
    INSERT INTO employees (full_name, position, staff_group, monthly_rate, bas_code, overseer_name, note)
    VALUES (@full_name, @position, @staff_group, @monthly_rate, NULL, NULL, NULL)
  `);
  for (const e of EMPLOYEES) {
    insert.run({ ...e, monthly_rate: rndInt(13000, 19000) });
  }
  console.log(`Додано працівників: ${EMPLOYEES.length}`);
  return db.prepare('SELECT * FROM employees').all();
}

/* --- Техніка ------------------------------------------------------------ */
const EQUIPMENT = [
  { name: 'МТЗ-82.1 №1', model_key: 'mtz', category: 'tractor', plate: 'AA1001BC' },
  { name: 'МТЗ-82.1 №2', model_key: 'mtz', category: 'tractor', plate: 'AA1002BC' },
  { name: 'Джон Дір 8320', model_key: 'john_deere', category: 'tractor', plate: 'AA1003BC' },
  { name: 'Джон Дір 6155M', model_key: 'john_deere', category: 'tractor', plate: 'AA1004BC' },
  { name: 'Case Axial-Flow', model_key: 'case', category: 'combine', plate: 'AA2001BC' },
  { name: 'Claas Tucano', model_key: 'claas', category: 'combine', plate: 'AA2002BC' },
  { name: 'САЗ-3507', model_key: 'saz', category: 'truck', plate: 'AA3001BC' },
  { name: 'КАМАЗ-5511', model_key: 'kamaz', category: 'truck', plate: 'AA3002BC' },
  { name: 'ДАФ XF', model_key: 'daf', category: 'truck', plate: 'AA3003BC' },
  { name: 'КрАЗ-6510', model_key: 'kraz', category: 'truck', plate: 'AA3004BC' },
  { name: 'JCB 3CX', model_key: 'jcb', category: 'loader', plate: 'AA4001BC' },
  { name: 'Обприскувач причіпний', model_key: null, category: 'sprayer', plate: 'AA5001BC' },
];

function seedEquipment() {
  const models = new Map(db.prepare('SELECT id, key FROM equipment_models').all().map((m) => [m.key, m.id]));
  const insert = db.prepare(`
    INSERT INTO equipment (name, model_id, plate_number, category, overseer_name, bas_code, note)
    VALUES (@name, @model_id, @plate_number, @category, NULL, NULL, NULL)
  `);
  for (const eq of EQUIPMENT) {
    insert.run({
      name: eq.name,
      model_id: eq.model_key ? (models.get(eq.model_key) ?? null) : null,
      plate_number: eq.plate,
      category: eq.category,
    });
  }
  console.log(`Додано техніки: ${EQUIPMENT.length}`);
  return db.prepare('SELECT * FROM equipment').all();
}

/* --- Поля ---------------------------------------------------------------- */
const FIELD_NAMES = [
  'Поле №1 (Східне)', 'Поле №2 (Західне)', 'Поле №3 (Ставкове)', 'Поле №4 (Балка)',
  'Поле №5 (Лугове)', 'Поле №6 (Долішнє)', 'Поле №7 (Горбисте)', 'Поле №8 (Прибережне)',
  'Поле №9 (Центральне)', 'Поле №10 (Степове)', 'Поле №11 (Північне)', 'Поле №12 (Південне)',
  'Поле №13 (Клинове)', 'Поле №14 (Рівнинне)', 'Поле №15 (Вітряне)', 'Поле №16 (Кутове)',
  'Поле №17 (Розлоге)', 'Поле №18 (Крайнє)',
];

function seedFields() {
  const insert = db.prepare(`
    INSERT INTO fields (name, area_ha, crop, is_watched, gektera_field_id, overseer_name, bas_code, note)
    VALUES (@name, @area_ha, @crop, 1, NULL, NULL, NULL, NULL)
  `);
  FIELD_NAMES.forEach((name, i) => {
    insert.run({ name, area_ha: round1(rnd(15, 120)), crop: CROP_KEYS[i % CROP_KEYS.length] });
  });
  console.log(`Додано полів: ${FIELD_NAMES.length}`);
  return db.prepare('SELECT * FROM fields').all();
}

/* --- Тарифи -------------------------------------------------------------- */
/** Евристика unit + діапазон ставки за назвою й прапорцями виду робіт —
 * орієнтовно на реальні порядки величин внутрішніх відрядних доплат у с/г
 * України (не повна ринкова оплата, а надбавка понад оклад). */
function classifyWorkType(wt) {
  const name = wt.name.toLowerCase();

  if (wt.is_transport_rate === 1) return { unit: 'hour', range: [60, 120], isDefault: true };
  if (wt.is_repair === 1) return { unit: 'hour', range: [60, 120] };
  if (wt.is_helper_role === 1) return { unit: 'ha', range: [150, 250] };

  if (wt.staff_group === 'driver') {
    if (/т·км/.test(name)) return { unit: 'tkm', range: [1, 5] };
    if (/фрахт/.test(name)) return { unit: 'trip', range: [1500, 4000] };
    if (/кран/.test(name)) return { unit: 'hour', range: [80, 150] };
    if (/(доставка|підвезення|заправ)/.test(name)) return { unit: 'hour', range: [60, 150] };
    if (/(простій|інші роботи)/.test(name)) return { unit: 'hour', range: [60, 100] };
    if (/(перевезення|вивезення|вивіз)/.test(name)) return { unit: 'ton', range: [150, 400] };
    return { unit: 'ton', range: [150, 300] };
  }

  // tractor
  if (/(обмолот)/.test(name)) return { unit: 'ton', range: [300, 900] };
  if (/(посів|оранка)/.test(name)) return { unit: 'ha', range: [400, 900] };
  if (/тюкування/.test(name)) return { unit: 'bale', range: [10, 30] };
  if (/перевезення тюків/.test(name)) return { unit: 'trip', range: [150, 400] };
  if (/(перегрузчик|то, перегони|фумізація|вивіз гною|розкидання перегною|доставка добрив|загрузка добрив|подрібнення гілок)/.test(name)) {
    return { unit: 'hour', range: [60, 150] };
  }
  return { unit: 'ha', range: [150, 500] };
}

function seedTariffs() {
  const workTypes = db.prepare('SELECT * FROM work_types').all();
  const routeWork = workTypes.find((w) => /рейс|маршрут/i.test(w.name));

  const insert = db.prepare(`
    INSERT INTO tariff_rates (work_type_id, equipment_label, implement_label, unit, rate, secondary_unit, secondary_rate, is_manual, is_default_rate, raw_text, source, note)
    VALUES (@work_type_id, NULL, NULL, @unit, @rate, NULL, 0, 0, @is_default_rate, NULL, NULL, NULL)
  `);

  let count = 0;
  for (const wt of workTypes) {
    if (routeWork && wt.id === routeWork.id) continue; // цей вид робіт оплачується за маршрутом, не за тарифом
    const { unit, range, isDefault } = classifyWorkType(wt);
    insert.run({
      work_type_id: wt.id,
      unit,
      rate: rndInt(range[0], range[1]),
      is_default_rate: isDefault ? 1 : 0,
    });
    count += 1;
  }
  console.log(`Додано тарифів: ${count}`);
}

/* --- Міжміські рейси ------------------------------------------------------ */
const ROUTES = [
  { name: 'с. Долинівка — м. Ясенів', distance_km: 60, rate: 1800 },
  { name: 'с. Річкове — м. Світлогірськ', distance_km: 120, rate: 3200 },
  { name: 'с. Діброва — м. Затишне', distance_km: 45, rate: 1500 },
  { name: 'м. Ясенів — м. Бузьк', distance_km: 200, rate: 5200 },
  { name: 'с. Долинівка — м. Бузьк', distance_km: 250, rate: 6300 },
  { name: 'с. Костянтинівка — м. Затишне', distance_km: 90, rate: 2600 },
  { name: 'м. Світлогірськ — м. Бузьк', distance_km: 310, rate: 7600 },
  { name: 'с. Річкове — с. Костянтинівка', distance_km: 35, rate: 1600 },
];

const ROUTE_KM_RATES = [
  { from_km: 0, to_km: 50, rate: 25 },
  { from_km: 50, to_km: 150, rate: 20 },
  { from_km: 150, to_km: 300, rate: 17 },
  { from_km: 300, to_km: null, rate: 14 },
];

function seedRoutes() {
  const insertRoute = db.prepare(
    'INSERT INTO routes (name, distance_km, rate, source, note) VALUES (@name, @distance_km, @rate, NULL, NULL)',
  );
  for (const r of ROUTES) insertRoute.run(r);

  const insertKm = db.prepare(
    'INSERT INTO route_km_rates (from_km, to_km, rate, note) VALUES (@from_km, @to_km, @rate, NULL)',
  );
  for (const r of ROUTE_KM_RATES) insertKm.run(r);

  console.log(`Додано маршрутів: ${ROUTES.length}, ставок грн/км: ${ROUTE_KM_RATES.length}`);
  return db.prepare('SELECT * FROM routes').all();
}

function seedSettings() {
  db.prepare("UPDATE payroll_settings SET minimum_wage = 8000, updated_by = 'Демо-скрипт' WHERE id = 1").run();
}

/* --- Демо-шляхові листи --------------------------------------------------- */
function metricValueFor(metric) {
  switch (metric) {
    case 'area_ha': return round1(rnd(5, 50));
    case 'tons': return round1(rnd(3, 50));
    case 'distance_km': return round1(rnd(5, 100));
    case 'cargo_tons': return round1(rnd(3, 20));
    case 'hours': return round1(rnd(2, 9));
    case 'trips': return rndInt(1, 3);
    case 'bales': return rndInt(20, 220);
    case 'days': return 1;
    default: return 1;
  }
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function seedWorklogs({ employees, equipment, fields, routes }) {
  const workTypes = db.prepare('SELECT * FROM work_types').all();
  const routeWork = workTypes.find((w) => /рейс|маршрут/i.test(w.name));
  const transportWork = workTypes.find((w) => w.is_transport_rate === 1);
  const helperTariffsByGroup = new Map();
  for (const wt of workTypes.filter((w) => w.is_helper_role === 1)) {
    const rate = db.prepare('SELECT * FROM tariff_rates WHERE work_type_id = ?').get(wt.id);
    if (rate) helperTariffsByGroup.set(wt.staff_group, { workType: wt, rate });
  }

  const tariffsByWorkType = new Map(
    db.prepare('SELECT * FROM tariff_rates').all().map((r) => [r.work_type_id, r]),
  );

  const equipmentByGroup = {
    driver: equipment.filter((e) => e.category === 'truck'),
    tractor: equipment.filter((e) => ['tractor', 'combine', 'sprayer'].includes(e.category)),
    other: equipment,
  };

  let created = 0;
  let skipped = 0;
  const TARGET = 42;
  let attempts = 0;

  while (created < TARGET && attempts < TARGET * 4) {
    attempts += 1;
    const employee = pick(employees);
    const group = employee.staff_group;
    const work_date = isoDaysAgo(rndInt(0, 55));
    let work_date_to = work_date;
    if (maybe(0.08)) {
      // кілька багатоденних записів (напр. дальній рейс)
      const to = new Date(work_date);
      to.setDate(to.getDate() + rndInt(1, 2));
      work_date_to = to.toISOString().slice(0, 10);
    }

    const eqPool = equipmentByGroup[group] ?? [];
    const equipment_id = eqPool.length && maybe(0.75) ? pick(eqPool).id : null;
    const created_by = 'Демо-дані';

    try {
      if (group === 'other') {
        // "інше" — немає власних видів робіт у довіднику, оплата лише погодинна
        const anyWorkType = pick(workTypes);
        createWorklog({
          work_date, work_date_to,
          employee_id: employee.id,
          equipment_id: null,
          work_type_id: anyWorkType.id,
          pay_mode: 'hourly',
          hours: round1(rnd(4, 9)),
          created_by, updated_by: created_by,
        });
        created += 1;
        continue;
      }

      if (group === 'driver' && routeWork && routes.length && maybe(0.12)) {
        const route = pick(routes);
        createWorklog({
          work_date, work_date_to,
          employee_id: employee.id,
          equipment_id,
          work_type_id: routeWork.id,
          route_id: route.id,
          unit: 'trip',
          trips: 1,
          hours: round1(rnd(6, 12)),
          created_by, updated_by: created_by,
        });
        created += 1;
        continue;
      }

      const candidateTypes = workTypes.filter(
        (w) => w.staff_group === group && w.id !== routeWork?.id && tariffsByWorkType.has(w.id),
      );
      if (candidateTypes.length === 0) { skipped += 1; continue; }
      const workType = pick(candidateTypes);
      const rate = tariffsByWorkType.get(workType.id);

      const input = {
        work_date, work_date_to,
        employee_id: employee.id,
        equipment_id,
        work_type_id: workType.id,
        unit: rate.unit,
        hours: round1(rnd(2, 9)),
        created_by, updated_by: created_by,
      };

      for (const metric of unitMetrics(rate.unit)) input[metric] = metricValueFor(metric);
      if (['area_ha', 'tons'].includes(unitMetrics(rate.unit)[0]) && fields.length && maybe(0.6)) {
        input.field_id = pick(fields).id;
        input.crop = pick(CROP_KEYS);
      }

      // Транспортний тариф — лише для видимого виду робіт, не для самого "Транспортні роботи"
      if (transportWork && workType.id !== transportWork.id && group === 'tractor' && maybe(0.1)) {
        input.transport_pay = 1;
        input.hours = round1(rnd(3, 8));
      } else {
        const helper = helperTariffsByGroup.get(group);
        if (helper && workType.id !== helper.workType.id && workType.is_helper_role !== 1 && input.area_ha > 0 && maybe(0.1)) {
          input.helper_absent = 1;
          input.helper_tariff_rate_id = helper.rate.id;
        }
      }

      createWorklog(input);
      created += 1;
    } catch (err) {
      skipped += 1;
    }
  }

  // Гарантований мінімум записів із доплатою "хімік 50%" — випадковий прохід
  // вище рідко на неї натрапляє (лише 'ha'-тарифи tractor-групи), а для
  // демонстрації функціонал має бути видно завжди.
  const tractorEmployees = employees.filter((e) => e.staff_group === 'tractor');
  const helper = helperTariffsByGroup.get('tractor');
  const haWorkTypes = workTypes.filter(
    (w) => w.staff_group === 'tractor' && w.is_helper_role !== 1 && tariffsByWorkType.get(w.id)?.unit === 'ha',
  );
  if (helper && haWorkTypes.length && tractorEmployees.length) {
    for (let i = 0; i < 2; i += 1) {
      const employee = pick(tractorEmployees);
      const workType = pick(haWorkTypes);
      const work_date = isoDaysAgo(rndInt(0, 55));
      try {
        createWorklog({
          work_date, work_date_to: work_date,
          employee_id: employee.id,
          equipment_id: (equipmentByGroup.tractor.length && pick(equipmentByGroup.tractor).id) || null,
          work_type_id: workType.id,
          unit: 'ha',
          area_ha: round1(rnd(10, 40)),
          hours: round1(rnd(4, 8)),
          helper_absent: 1,
          helper_tariff_rate_id: helper.rate.id,
          created_by: 'Демо-дані', updated_by: 'Демо-дані',
        });
        created += 1;
      } catch { skipped += 1; }
    }
  }

  console.log(`Додано демо-шляхових листів: ${created} (пропущено невдалих комбінацій: ${skipped})`);
}

/* --- Запуск ---------------------------------------------------------------- */
guard();
clear();
seedEquipmentModels();
seedWorkTypes();
const employees = seedEmployees();
const equipment = seedEquipment();
const fields = seedFields();
seedTariffs();
const routes = seedRoutes();
seedSettings();
seedWorklogs({ employees, equipment, fields, routes });

console.log('Демо-дані готові.');
