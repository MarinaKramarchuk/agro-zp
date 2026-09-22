-- Схема БД "Агро-Зарплата & Облік Шляхових Листів"
-- SQLite. SQL тримаємо простим, щоб перенести на PostgreSQL
-- (INTEGER PRIMARY KEY AUTOINCREMENT -> IDENTITY, datetime('now') -> now()).
--
-- Тарифи — простий редагований довідник актуальних розцінок:
--   вид робіт × техніка × інвентар × одиниця виміру -> одна ставка (rate),
--   нараховується одній людині.
-- Довідники не мають статусів активний/неактивний — лише видалення запису.

PRAGMA foreign_keys = ON;

-- 1. Працівники ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name   TEXT    NOT NULL,
  position    TEXT,
  -- група для фільтрації доступних робіт: водій / тракторист / інше
  staff_group TEXT    NOT NULL DEFAULT 'other'
              CHECK (staff_group IN ('driver', 'tractor', 'other')),
  -- особистий оклад за місяць (для запису "Погодинно" у шляховому листі —
  -- погодинна ставка вираховується як оклад / норма робочих годин місяця);
  -- якщо не вказано - береться поточна payroll_settings.minimum_wage (див.
  -- секцію 12), тож підвищення мінімалки одразу діє на таких працівників
  -- без ручного редагування кожної картки
  monthly_rate REAL   CHECK (monthly_rate IS NULL OR monthly_rate >= 0),
  -- застаріла, більше не використовується (раніше - прапорець "оклад = мінімалка");
  -- лишається в схемі, бо міграції в цьому проєкті лише додають колонки, не видаляють
  uses_minimum_wage INTEGER NOT NULL DEFAULT 0 CHECK (uses_minimum_wage IN (0, 1)),
  bas_code    TEXT,                       -- код водія в BAS FOR AGRO (для вивантаження)
  -- ім'я водія в OVERSEER/Hecterra (як у колонці "Водій" звітів) - за ним
  -- підставляється працівник у чернетку шляхового; full_name можна вільно
  -- переписати на гарне ПІБ, це поле від того не зламається (як overseer_name
  -- у техніці - окремий ключ прив'язки, не показова назва)
  overseer_name TEXT,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- часткова: щоб кілька працівників могли мати overseer_name = NULL (ще не прив'язана)
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_overseer_name
  ON employees (overseer_name) WHERE overseer_name IS NOT NULL;

-- 2. Марки техніки (як у тарифах: МТЗ, Джон Дір, ДАФ, КАМАЗ, Claas ...) -------
CREATE TABLE IF NOT EXISTS equipment_models (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,   -- нормалізований ключ: 'mtz', 'john_deere', 'daf'
  label      TEXT    NOT NULL,          -- назва як у наказі/тарифі
  category   TEXT    NOT NULL DEFAULT 'other'
             CHECK (category IN ('tractor', 'truck', 'combine', 'loader', 'sprayer', 'other')),
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 3. Техніка (конкретні одиниці з держ. номером) ------------------------------
CREATE TABLE IF NOT EXISTS equipment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  model_id      INTEGER REFERENCES equipment_models (id) ON DELETE SET NULL,
  plate_number  TEXT,
  category      TEXT    NOT NULL DEFAULT 'other'
                CHECK (category IN ('tractor', 'truck', 'combine', 'loader', 'sprayer', 'implement', 'other')),
  -- назва об'єкта в OVERSEER/Hecterra (той самий розробник, той самий ключ для
  -- обох систем) - за нею мерджаться денні факти з machine_facts/hecterra_activities
  overseer_name TEXT,
  bas_code      TEXT,                      -- код техніки в BAS FOR AGRO
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_model  ON equipment (model_id);
-- часткова: щоб кілька одиниць техніки могли мати overseer_name = NULL (ще не прив'язана)
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_overseer_name
  ON equipment (overseer_name) WHERE overseer_name IS NOT NULL;

-- 4. Поля ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fields (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  area_ha          REAL    CHECK (area_ha IS NULL OR area_ha >= 0),
  crop             TEXT,
  -- чи стежити за полем у "Контролі гектарів" (не всі поля цікаві - список
  -- керується прямо з тієї сторінки); на розрахунок ЗП не впливає
  is_watched       INTEGER NOT NULL DEFAULT 1 CHECK (is_watched IN (0, 1)),
  gektera_field_id TEXT    UNIQUE,        -- ключ поля в Hecterra (той самий розробник, що й OVERSEER)
  -- назва поля за Hecterra ("Поле" у звіті "Оброблено полів") - там немає ID,
  -- лише текст, тому окремий ключ прив'язки, як overseer_name у техніки/водіїв
  overseer_name    TEXT,
  bas_code         TEXT,                  -- код поля в BAS FOR AGRO
  note             TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- часткова: щоб кілька полів могли мати overseer_name = NULL (ще не прив'язане)
CREATE UNIQUE INDEX IF NOT EXISTS uq_fields_overseer_name
  ON fields (overseer_name) WHERE overseer_name IS NOT NULL;

-- 5. Види робіт (каталог назв) ------------------------------------------------
CREATE TABLE IF NOT EXISTS work_types (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  staff_group    TEXT    NOT NULL DEFAULT 'other'
                 CHECK (staff_group IN ('driver', 'tractor', 'other')),
  requires_field INTEGER NOT NULL DEFAULT 0 CHECK (requires_field IN (0, 1)),
  -- ремонтні роботи (не рейс/польова робота) - позначені записи окремо
  -- виділяються в Табелі, щоб було видно, скільки годин пішло на ремонт
  is_repair      INTEGER NOT NULL DEFAULT 0 CHECK (is_repair IN (0, 1)),
  -- чи контролювати площу в "Контролі гектарів" (оранка/посів/обмолот - разова
  -- операція, не може бути більше площі поля; решта - можуть повторюватись)
  is_area_checked INTEGER NOT NULL DEFAULT 0 CHECK (is_area_checked IN (0, 1)),
  -- роль хіміка/помічника (не самостійна операція) - за цим прапорцем
  -- фільтрується список тарифів-кандидатів для доплати "хімік 50%" на
  -- шляховому листі водія (worklogs.helper_tariff_rate_id)
  is_helper_role  INTEGER NOT NULL DEFAULT 0 CHECK (is_helper_role IN (0, 1)),
  -- вид робіт "Транспортні роботи по господарству" - за цим прапорцем
  -- бекенд шукає тариф для оплати worklogs.transport_pay (оплата за
  -- транспортним тарифом × hours замість тарифу фактичного виду робіт).
  -- Має бути позначений рівно один вид робіт.
  is_transport_rate INTEGER NOT NULL DEFAULT 0 CHECK (is_transport_rate IN (0, 1)),
  bas_code       TEXT,                    -- код виду робіт у BAS FOR AGRO
  -- назва операції в Hecterra (як у колонці "Операція" звітів, напр.
  -- "Обприскування (виїзне відділення)") - за нею підставляється вид роботи в чернетку
  overseer_name  TEXT,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_types ON work_types (name, staff_group);
-- часткова: щоб кілька видів робіт могли мати overseer_name = NULL (ще не прив'язана)
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_types_overseer_name
  ON work_types (overseer_name) WHERE overseer_name IS NOT NULL;

-- 6. Тарифи (актуальні розцінки; веде диспетчер) ------------------------------
-- unit: ha | ton | km | tkm | hour | trip (ходка/рейс) | bale (тюк) | day
-- Одна ставка на комбінацію робота × техніка × інвентар × одиниця.
-- secondary_* — складені тарифи, напр. "72,5 грн/год + 5 грн/т".
CREATE TABLE IF NOT EXISTS tariff_rates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  work_type_id     INTEGER NOT NULL REFERENCES work_types (id) ON DELETE CASCADE,
  equipment_label  TEXT,        -- як у наказі: 'МТЗ, Джон Дір, Китаєць'
  implement_label  TEXT,        -- інвентар: 'БЗ 14 м', 'жатка зернова'
  unit             TEXT    NOT NULL
                   CHECK (unit IN ('ha', 'ton', 'km', 'tkm', 'hour', 'trip', 'bale', 'day')),
  rate             REAL    NOT NULL DEFAULT 0 CHECK (rate >= 0),
  secondary_unit   TEXT    CHECK (secondary_unit IS NULL OR
                                  secondary_unit IN ('ha', 'ton', 'km', 'tkm', 'hour', 'trip', 'bale', 'day')),
  secondary_rate   REAL    NOT NULL DEFAULT 0 CHECK (secondary_rate >= 0),
  is_manual        INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),  -- 'від мінімалки'
  -- "типова ставка" в межах виду робіт - фолбек для оплати за транспортним
  -- тарифом (worklogs.transport_pay), коли техніка не вказана або не
  -- належить жодній з груп у довіднику (напр. ставка МТЗ/Джон Дір)
  is_default_rate  INTEGER NOT NULL DEFAULT 0 CHECK (is_default_rate IN (0, 1)),
  raw_text         TEXT,        -- оригінальний текст тарифу з файлу
  source           TEXT,        -- файл!аркуш:рядок (звідки імпортовано)
  note             TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tariff_rates_work ON tariff_rates (work_type_id);

-- один тариф на комбінацію робота × техніка × інвентар × одиниця
CREATE UNIQUE INDEX IF NOT EXISTS uq_tariff_rates ON tariff_rates (
  work_type_id, IFNULL(equipment_label, ''), IFNULL(implement_label, ''), unit
);

-- Прив'язка тарифу до марок техніки (розбір equipment_label) ------------------
CREATE TABLE IF NOT EXISTS tariff_rate_models (
  rate_id  INTEGER NOT NULL REFERENCES tariff_rates (id)     ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES equipment_models (id) ON DELETE CASCADE,
  PRIMARY KEY (rate_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_trm_model ON tariff_rate_models (model_id);

-- 7. Міжміські рейси (фіксована сума за маршрут) -------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  distance_km REAL    CHECK (distance_km IS NULL OR distance_km >= 0),  -- в дві сторони
  rate        REAL    NOT NULL DEFAULT 0 CHECK (rate >= 0),
  source      TEXT,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ставки грн/км за діапазонами відстані (для маршрутів, яких немає в довіднику)
CREATE TABLE IF NOT EXISTS route_km_rates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_km    REAL    NOT NULL DEFAULT 0,
  to_km      REAL,                 -- NULL = і більше
  rate       REAL    NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 8. Шляхові листи ------------------------------------------------------------
-- Один рядок = один запис зі шляхового листа однієї людини (двох людей в одному
-- записі не буває). Розцінка та суми фіксуються (snapshot), щоб зміна тарифу
-- не переписувала минулі нарахування.
-- Шляховий може охоплювати кілька дат (work_date..work_date_to, напр. дальній
-- рейс): у Табелі години й сума показуються на кожен день періоду, а у
-- Відомості ЗП сума враховується один раз.
-- pay_mode: 'tariff' — за видом робіт (тариф/маршрут/вручну), 'hourly' — за
-- особистою погодинною ставкою працівника (employees.hourly_rate).
-- Якщо в довіднику немає потрібного тарифу, rate можна ввести вручну
-- прямо в шляховому (tariff_rate_id лишається NULL, "raw_text" це позначає).
CREATE TABLE IF NOT EXISTS worklogs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date           TEXT    NOT NULL,                -- 'YYYY-MM-DD', початок періоду
  work_date_to        TEXT    NOT NULL,                -- кінець періоду (= work_date для одного дня)
  employee_id         INTEGER NOT NULL REFERENCES employees (id)    ON DELETE RESTRICT,
  equipment_id        INTEGER          REFERENCES equipment (id)    ON DELETE RESTRICT,
  field_id            INTEGER          REFERENCES fields (id)       ON DELETE RESTRICT,
  -- культура, з якою пов'язаний запис (для робіт з га/тонни/перевезення/погрузки);
  -- 'future_harvest' — майбутній врожай (напр. передпосівні роботи)
  crop                TEXT    CHECK (crop IS NULL OR crop IN
                      ('wheat', 'rye', 'barley', 'corn', 'sunflower', 'rapeseed', 'soy', 'pea', 'future_harvest')),
  -- вид вантажу для транспортних рейсів (напр. САЗ - полова/зерновідходи);
  -- суто інформаційне, на розрахунок суми не впливає (тариф годинний)
  cargo_type          TEXT    CHECK (cargo_type IS NULL OR cargo_type IN ('chaff', 'grain_waste')),
  work_type_id        INTEGER NOT NULL REFERENCES work_types (id)   ON DELETE RESTRICT,
  tariff_rate_id      INTEGER          REFERENCES tariff_rates (id) ON DELETE SET NULL,
  route_id            INTEGER          REFERENCES routes (id)       ON DELETE SET NULL,
  -- з якої підказки Hecterra зроблено запис (лише для довідки, не в розрахунок)
  hecterra_activity_id INTEGER         REFERENCES hecterra_activities (id) ON DELETE SET NULL,
  -- знімок площі, яку підказала Hecterra на момент створення запису; ручне
  -- area_ha завжди головніше й саме воно йде в розрахунок ЗП/відомість/BAS
  area_ha_auto        REAL    CHECK (area_ha_auto IS NULL OR area_ha_auto >= 0),
  -- який план (work_plans) підтверджує цей запис - якщо є; статус плану
  -- ("очікує"/"погоджено") ніде не зберігається, а завжди похідний від
  -- наявності worklogs.plan_id, що на нього посилається (див. секцію 11)
  plan_id             INTEGER REFERENCES work_plans (id) ON DELETE SET NULL,

  pay_mode            TEXT    NOT NULL DEFAULT 'tariff' CHECK (pay_mode IN ('tariff', 'hourly')),

  -- фактично відпрацьовані години (для табеля — навіть коли оплата за га/тонни)
  hours               REAL    NOT NULL DEFAULT 0 CHECK (hours >= 0),

  -- показники виробітку
  area_ha             REAL    CHECK (area_ha     IS NULL OR area_ha     >= 0),
  tons                REAL    CHECK (tons        IS NULL OR tons        >= 0),
  distance_km         REAL    CHECK (distance_km IS NULL OR distance_km >= 0),
  cargo_tons          REAL    CHECK (cargo_tons  IS NULL OR cargo_tons  >= 0),
  trips               REAL    CHECK (trips       IS NULL OR trips       >= 0),
  bales               REAL    CHECK (bales       IS NULL OR bales       >= 0),
  days                REAL    CHECK (days        IS NULL OR days        >= 0),

  -- snapshot розцінки
  unit                TEXT    NOT NULL
                      CHECK (unit IN ('ha', 'ton', 'km', 'tkm', 'hour', 'trip', 'bale', 'day')),
  rate                REAL    NOT NULL DEFAULT 0,
  quantity            REAL    NOT NULL DEFAULT 0,
  secondary_unit      TEXT,
  secondary_rate      REAL    NOT NULL DEFAULT 0,
  secondary_quantity  REAL    NOT NULL DEFAULT 0,

  manual_amount       REAL    CHECK (manual_amount IS NULL OR manual_amount >= 0),

  -- доплата "хімік 50%" - коли хімік був відсутній, водій-оприскувач бере
  -- на себе його роботу і отримує 50% від тарифу хіміка за оброблену площу.
  -- helper_rate - знімок ПОВНОЇ (не половинної) ставки хіміка на момент
  -- збереження (щоб було видно, з чого порахували "50% від"); helper_amount -
  -- сама доплата (round2(0.5 * helper_rate * area_ha)), вона вже включена в
  -- total_amount нижче.
  helper_absent         INTEGER NOT NULL DEFAULT 0 CHECK (helper_absent IN (0, 1)),
  helper_tariff_rate_id INTEGER          REFERENCES tariff_rates (id) ON DELETE SET NULL,
  helper_rate            REAL    CHECK (helper_rate IS NULL OR helper_rate >= 0),
  helper_amount           REAL    CHECK (helper_amount IS NULL OR helper_amount >= 0),

  -- оплата за транспортним тарифом - фактичний вид робіт і обсяг (area_ha
  -- тощо) фіксуються як завжди (Контроль гектарів без змін), але сума
  -- рахується як hours × ставка тарифу work_types.is_transport_rate (замість
  -- rate цього запису). unit/rate/quantity вище лишаються "інформаційними"
  -- (реальний тариф обраного виду робіт), а total_amount нижче вже замінена
  -- транспортною. transport_rate - знімок ставки на момент збереження.
  transport_pay            INTEGER NOT NULL DEFAULT 0 CHECK (transport_pay IN (0, 1)),
  transport_tariff_rate_id INTEGER          REFERENCES tariff_rates (id) ON DELETE SET NULL,
  transport_rate            REAL    CHECK (transport_rate IS NULL OR transport_rate >= 0),

  -- результат: сума за запис (уже включно з доплатою "хімік 50%")
  total_amount        REAL    NOT NULL DEFAULT 0,

  note                TEXT,
  -- звірено з паперовим шляховим листом водія (окремо від GPS-підказки
  -- Hecterra вище - та лише допомагає ЗАПОВНИТИ запис). Простий прапорець без
  -- історії (хто/коли) - сервер його ніколи сам не скидає.
  confirmed           INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  -- ім'я людини, що зберегла запис (вписується в браузері, без логіну -
  -- легкий облік "хто вніс", не захист доступу)
  created_by          TEXT,
  updated_by          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_worklogs_date          ON worklogs (work_date);
CREATE INDEX IF NOT EXISTS idx_worklogs_date_to       ON worklogs (work_date_to);
CREATE INDEX IF NOT EXISTS idx_worklogs_employee_date ON worklogs (employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_worklogs_equipment     ON worklogs (equipment_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_field         ON worklogs (field_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_work_type     ON worklogs (work_type_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_crop          ON worklogs (crop);
CREATE INDEX IF NOT EXISTS idx_worklogs_hecterra      ON worklogs (hecterra_activity_id);
CREATE INDEX IF NOT EXISTS idx_worklogs_plan          ON worklogs (plan_id);

-- 9. Денні факти по техніці з OVERSEER (мотогодини/пробіг/паливо) -------------
-- Зберігається overseer_name, а не equipment_id: техніка приєднується через
-- equipment.overseer_name, тож прив'язка техніки заднім числом одразу підбирає
-- вже завантажені факти (без "фантомних" нерозпізнаних записів).
-- Один звіт OVERSEER = один файл на одну машину; кілька звітів за той самий
-- день мерджаться по колонках (UPSERT), не перезаписують рядок цілком.
CREATE TABLE IF NOT EXISTS machine_facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_date     TEXT    NOT NULL,          -- 'YYYY-MM-DD'
  overseer_name TEXT    NOT NULL,          -- назва об'єкта в OVERSEER, як у звіті
  engine_hours  REAL    CHECK (engine_hours  IS NULL OR engine_hours  >= 0),
  distance_km   REAL    CHECK (distance_km   IS NULL OR distance_km   >= 0),
  fuel_consumed REAL    CHECK (fuel_consumed IS NULL OR fuel_consumed >= 0),
  fuel_refueled REAL    CHECK (fuel_refueled IS NULL OR fuel_refueled >= 0),
  source_files  TEXT,                      -- імена вихідних xlsx через ';'
  ingested_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_facts ON machine_facts (fact_date, overseer_name);

-- 10. Оброблені площі по полях з Hecterra (той самий розробник, що й OVERSEER) -
-- Так само за overseer_name, не equipment_id - див. коментар до machine_facts.
-- Hecterra лише підказує чернетку шляхового; підтверджує й, за потреби,
-- коригує площу людина (worklogs.area_ha) - це завжди пріоритетне значення.
CREATE TABLE IF NOT EXISTS hecterra_activities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_date     TEXT    NOT NULL,
  overseer_name     TEXT    NOT NULL,
  hecterra_field_id TEXT,                  -- ключ поля в Hecterra; звіряється з fields.gektera_field_id
  field_name_raw    TEXT,                  -- назва поля, як її дала Hecterra
  area_ha           REAL    CHECK (area_ha IS NULL OR area_ha >= 0),
  -- загальна площа поля за Hecterra (колонка "Площа, га" у звіті "Оброблено
  -- полів") - для порівняння з area_ha (оброблено+пропуски) в UI; на відміну
  -- від fields.area_ha, це знімок з конкретного звіту, не довідникове значення
  field_area_ha     REAL    CHECK (field_area_ha IS NULL OR field_area_ha >= 0),
  driver_name_raw   TEXT,                  -- ім'я водія за Hecterra; звіряється з employees.overseer_name
  -- культура з колонки "Культура" - той самий закритий список, що й worklogs.crop
  -- (маленький, фіксований - на відміну від полів/техніки/водіїв/видів робіт,
  -- окремої прив'язки не потребує, парсер мапить текст напряму)
  crop              TEXT    CHECK (crop IS NULL OR crop IN
                    ('wheat', 'rye', 'barley', 'corn', 'sunflower', 'rapeseed', 'soy', 'pea', 'future_harvest')),
  work_type_raw     TEXT,                  -- вид роботи, якщо Hecterra його дає
  -- пробіг/паливо саме за цей прохід (колонки "Пробіг, км" і "Витрачено
  -- палива, л") - на відміну від machine_facts (весь день техніки), це за
  -- конкретне поле; в "Дані з техніки" - запасний варіант, коли немає звіту
  -- OVERSEER за цей день
  distance_km       REAL    CHECK (distance_km IS NULL OR distance_km >= 0),
  fuel_consumed     REAL    CHECK (fuel_consumed IS NULL OR fuel_consumed >= 0),
  -- тривалість проходу за Hecterra ("Тривалість"), округлена до цілих годин
  -- (хвилини людині в чернетці не потрібні) - запасний варіант для години
  -- шляхового, коли немає звіту OVERSEER за мотогодини цього дня
  hours             REAL    CHECK (hours IS NULL OR hours >= 0),
  external_id       TEXT,                  -- ідентифікатор запису в самій Hecterra
  source_files      TEXT,
  ingested_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- IFNULL(field_name_raw, '') у ключі - бо hecterra_field_id часто відсутній
-- (звіти "Оброблено полів" не дають ID поля, лише назву), і без назви в ключі
-- два різні поля техніки в один день злилися б в один запис (був живий баг).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hecterra_activities
  ON hecterra_activities (activity_date, overseer_name, IFNULL(hecterra_field_id, ''), IFNULL(field_name_raw, ''));

-- 11. Планові роботи (диспетчеризація до підтвердження шляховим листом) -------
-- Агроном каже обліковцю "хто де що робить" - вона вносить сюди план, а коли
-- водій приносить шляховий, погоджує (як є) або коригує - обидва випадки
-- зберігаються звичайним записом worklogs із worklogs.plan_id на цей рядок.
-- Статус ("очікує"/"погоджено") тут НЕ зберігається - лише похідний від
-- наявності worklogs.plan_id = work_plans.id (WORK_PLAN_SELECT рахує це
-- через LEFT JOIN), щоб не тримати два джерела правди в синхроні.
-- Обсяг робіт (га/тонни/...) свідомо не зберігається - у плані його ще нема
-- (прийде зі шляхового), лише вільний текст-орієнтир у note.
CREATE TABLE IF NOT EXISTS work_plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date     TEXT    NOT NULL,                                  -- 'YYYY-MM-DD', один день на план
  employee_id   INTEGER NOT NULL REFERENCES employees (id)  ON DELETE RESTRICT,
  equipment_id  INTEGER          REFERENCES equipment (id)  ON DELETE RESTRICT,
  field_id      INTEGER          REFERENCES fields (id)     ON DELETE RESTRICT,
  work_type_id  INTEGER NOT NULL REFERENCES work_types (id) ON DELETE RESTRICT,
  crop          TEXT    CHECK (crop IS NULL OR crop IN
                ('wheat', 'rye', 'barley', 'corn', 'sunflower', 'rapeseed', 'soy', 'pea', 'future_harvest')),
  note          TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_plans_date     ON work_plans (plan_date);
CREATE INDEX IF NOT EXISTS idx_work_plans_employee ON work_plans (employee_id, plan_date);

-- 12. Налаштування розрахунку ЗП (один рядок) ----------------------------------
-- Зараз лише мінімальна ЗП - погодинна оплата (worklogs.pay_mode='hourly')
-- бере її автоматично для будь-якого працівника без employees.monthly_rate,
-- тож підвищення мінімалки достатньо змінити тут в одному місці.
CREATE TABLE IF NOT EXISTS payroll_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  minimum_wage  REAL    NOT NULL DEFAULT 0 CHECK (minimum_wage >= 0),
  updated_by    TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO payroll_settings (id, minimum_wage) VALUES (1, 0);

-- 13. Додаткові написання водія в OVERSEER/Hecterra ----------------------------
-- Той самий працівник іноді трапляється під різними написаннями імені в
-- різних звітах Hecterra ("Гнотюк" й "Гнатюк" - помилка на боці
-- джерела даних) - employees.overseer_name тримає лише ОДНЕ значення, тож
-- прив'язка нового написання раніше просто затирала старе (і щойно
-- працююча прив'язка сама ставала "нерозпізнаною"). Другі й наступні
-- написання йдуть сюди, не замінюючи основне.
CREATE TABLE IF NOT EXISTS employee_overseer_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  alias       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_overseer_aliases_alias ON employee_overseer_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_employee_overseer_aliases_employee ON employee_overseer_aliases (employee_id);

-- Усі відомі написання (основне + додаткові) в одному місці - щоб запити
-- зіставлення (Hecterra/OVERSEER driver_name_raw) не дублювали UNION вручну.
CREATE VIEW IF NOT EXISTS employee_overseer_names AS
  SELECT id AS employee_id, overseer_name AS name FROM employees WHERE overseer_name IS NOT NULL
  UNION ALL
  SELECT employee_id, alias AS name FROM employee_overseer_aliases;

-- 14. Додаткові написання поля в Hecterra ---------------------------------------
-- Той самий фізичний "клин" на звіті "Оброблено полів" (без gektera_field_id)
-- часом приходить з різною площею в назві ("Поле № 4-В 47 га" -> "...51 га" -
-- перемір/уточнення меж на боці Hecterra) - fields.overseer_name тримає лише
-- ОДНЕ значення, тож прив'язка нового написання раніше просто затирала старе,
-- і щойно працююча прив'язка сама ставала "нерозпізнаною" при наступному
-- імпорті. Той самий патерн, що employee_overseer_aliases для водіїв.
CREATE TABLE IF NOT EXISTS field_overseer_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  field_id   INTEGER NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
  alias      TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_overseer_aliases_alias ON field_overseer_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_field_overseer_aliases_field ON field_overseer_aliases (field_id);

-- Усі відомі написання (основне + додаткові) в одному місці - як
-- employee_overseer_names для водіїв.
CREATE VIEW IF NOT EXISTS field_overseer_names AS
  SELECT id AS field_id, overseer_name AS name FROM fields WHERE overseer_name IS NOT NULL
  UNION ALL
  SELECT field_id, alias AS name FROM field_overseer_aliases;

-- 15. "Ігнор-лист" немаплених сповіщень OVERSEER/Hecterra --------------------
-- Назва (техніка/водій/вид робіт/поле), яку користувачка позначила "більше не
-- показувати" в "нерозпізнаних" (напр. одноразова помилка друку в
-- телематиці) - сирі дані (machine_facts/hecterra_activities) не чіпає, лише
-- виключається з NOT IN-запитів списків "нерозпізнаних".
CREATE TABLE IF NOT EXISTS alert_dismissals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT    NOT NULL CHECK (category IN
                 ('overseer_machine', 'hecterra_driver', 'hecterra_work_type', 'hecterra_field')),
  value        TEXT    NOT NULL,
  dismissed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_dismissals ON alert_dismissals (category, value);

-- 16. Закриті періоди (замикання після виплати) ------------------------------
-- Календарний місяць, позначений закритим після того, як відомість ЗП
-- сформована й виплачена - worklogs, що потрапляють у закритий місяць (за
-- work_date..work_date_to), більше не можна створити/змінити/видалити, щоб
-- уже видана відомість/BAS-вивантаження не розійшлися з базою заднім числом.
-- Відкрити назад можна в будь-який момент без підтвердження на бекенді
-- (рішення обліковця) - історія попередніх закриттів не ведеться.
CREATE TABLE IF NOT EXISTS locked_periods (
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  locked_by TEXT,
  locked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (year, month)
);
