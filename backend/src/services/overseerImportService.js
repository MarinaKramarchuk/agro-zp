// Прийом звітів OVERSEER: файли -> machine_facts. Порт логіки з overseer-bas
// (src/lib/ingestCore.mjs + upsertFacts у src/lib/facts.mjs), перекладений із
// CSV-сховища на SQLite-UPSERT.
//
// Важлива відмінність від overseer-bas: там факт для нерозпізнаної техніки
// взагалі не писався (лишався тільки запис у unmapped.csv, який ніколи не
// очищувався навіть після того, як техніку додавали в довідник). Тут факт
// пишеться завжди під overseer_name, а прив'язку до техніки визначає JOIN по
// equipment.overseer_name (services/overseerFacts.js) - тому "нерозпізнана
// техніка" - це завжди актуальний стан, а не застаріла заглушка.
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { db } from '../db/index.js';
import { rootDir } from '../config.js';
import { readTripWorkbook } from './overseer/parseWorkbook.js';
import { parseCultivationsRows } from './hecterra/parseCultivationsExport.js';
import { importHecterraActivities } from './hecterra/importService.js';

function loadMapping() {
  const raw = fs.readFileSync(path.join(rootDir, 'config', 'overseer-mapping.json'), 'utf8');
  return JSON.parse(raw);
}

const NUMERIC_FIELDS = ['engine_hours', 'distance_km', 'fuel_consumed', 'fuel_refueled'];

function valuesDiffer(a, b) {
  const na = a === undefined || a === null ? null : Number(a);
  const nb = b === undefined || b === null ? null : Number(b);
  if (na === null && nb === null) return false;
  if (na === null || nb === null) return true;
  return na !== nb;
}

const selectFactStmt = db.prepare('SELECT * FROM machine_facts WHERE fact_date = ? AND overseer_name = ?');
const insertFactStmt = db.prepare(`
  INSERT INTO machine_facts (fact_date, overseer_name, engine_hours, distance_km, fuel_consumed, fuel_refueled, source_files)
  VALUES (@fact_date, @overseer_name, @engine_hours, @distance_km, @fuel_consumed, @fuel_refueled, @source_files)
`);
const updateFactStmt = db.prepare(`
  UPDATE machine_facts
     SET engine_hours = @engine_hours, distance_km = @distance_km,
         fuel_consumed = @fuel_consumed, fuel_refueled = @fuel_refueled,
         source_files = @source_files, ingested_at = datetime('now')
   WHERE id = @id
`);

/** UPSERT одного дня одної машини. Мерджить поля (звіт лише з паливом не стирає
 * мотогодини), а не перезаписує рядок цілком - бо OVERSEER віддає день×техніка
 * кількома окремими звітами, не завжди одночасно. Повертає 'added'|'updated'|'unchanged'. */
function upsertDay(factDate, overseerName, dayEntry, sourceFileName) {
  const existing = selectFactStmt.get(factDate, overseerName);
  const incomingSources = String(sourceFileName).split(';').map((s) => s.trim()).filter(Boolean);

  if (!existing) {
    const row = { fact_date: factDate, overseer_name: overseerName, source_files: incomingSources.join(';') };
    for (const f of NUMERIC_FIELDS) row[f] = dayEntry[f] ?? null;
    insertFactStmt.run(row);
    return 'added';
  }

  let changed = false;
  const merged = {};
  for (const f of NUMERIC_FIELDS) {
    if (dayEntry[f] === undefined) {
      merged[f] = existing[f];
      continue;
    }
    if (valuesDiffer(existing[f], dayEntry[f])) changed = true;
    merged[f] = dayEntry[f];
  }

  const sources = new Set((existing.source_files || '').split(';').filter(Boolean));
  for (const s of incomingSources) {
    if (!sources.has(s)) {
      sources.add(s);
      changed = true;
    }
  }

  if (!changed) return 'unchanged';

  updateFactStmt.run({ ...merged, source_files: [...sources].join(';'), id: existing.id });
  return 'updated';
}

/** Пробує прочитати файл як звіт Hecterra "Оброблено полів" (Cultivations for
 * unit ...) - той самий дропзон на "Дані з техніки" приймає обидва джерела
 * (OVERSEER і Hecterra, той самий розробник), людині не треба знати, який
 * перед нею формат. Повертає null, якщо файл не схожий на такий звіт (нема
 * очікуваних колонок) - тоді файл лишається на розгляд як OVERSEER-звіт. */
function tryParseAsHecterraCultivations(filePath, fileName) {
  let workbook;
  try {
    workbook = XLSX.readFile(filePath);
  } catch {
    return null;
  }
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: '' });
    if (rows.length < 2) continue;
    try {
      const activities = parseCultivationsRows(rows, { sourceFile: fileName });
      if (activities.length > 0) return activities;
    } catch {
      // не той аркуш/формат - пробуємо наступний або визнаємо файл не-Hecterra
    }
  }
  return null;
}

/**
 * files: масив { path: string, originalName: string } - шлях до тимчасового xlsx
 * на диску (напр. з multer diskStorage) і оригінальне ім'я файлу (вже коректно
 * декодоване в UTF-8 - див. коментар про кодування в routes/overseer.js).
 */
export async function importOverseerFiles(files) {
  const mapping = loadMapping();

  const perMachine = new Map(); // overseer_name -> Map(dateKey -> merged dayEntry)
  const filesByMachine = new Map(); // overseer_name -> Set(originalName)
  const fileErrors = [];
  const filesWithNoData = [];
  let hecterra = { activitiesProcessed: 0, added: 0, updated: 0, unchanged: 0 };

  for (const file of files) {
    const name = file.originalName;
    let result;
    try {
      result = await readTripWorkbook(file.path, mapping);
    } catch (err) {
      fileErrors.push({ file: name, message: err.message });
      continue;
    }
    if (!result.hasAnyData) {
      const hecterraActivities = tryParseAsHecterraCultivations(file.path, name);
      if (hecterraActivities) {
        const r = importHecterraActivities(hecterraActivities);
        hecterra = {
          activitiesProcessed: hecterra.activitiesProcessed + r.activitiesProcessed,
          added: hecterra.added + r.added,
          updated: hecterra.updated + r.updated,
          unchanged: hecterra.unchanged + r.unchanged,
        };
        continue;
      }
      filesWithNoData.push(name);
      continue;
    }
    if (!result.machineName) {
      // Деякі типи звітів (напр. "Поездки" без ДУТ) не пишуть об'єкт у Статистиці.
      // OVERSEER сам називає файл при вивантаженні як "<Техніка>_<ТипЗвіту>_...", тому
      // беремо назву техніки з початку імені файлу - надійно на практиці.
      result.machineName = name.split('_')[0].trim() || null;
    }
    if (!result.machineName) {
      filesWithNoData.push(name);
      continue;
    }

    const key = result.machineName;
    if (!perMachine.has(key)) perMachine.set(key, new Map());
    if (!filesByMachine.has(key)) filesByMachine.set(key, new Set());
    filesByMachine.get(key).add(name);

    const target = perMachine.get(key);
    for (const [dk, dayEntry] of result.perDay) {
      target.set(dk, { ...(target.get(dk) || {}), ...dayEntry });
    }
  }

  const existingOverseerNames = new Set(
    db.prepare('SELECT overseer_name FROM equipment WHERE overseer_name IS NOT NULL').all()
      .map((r) => r.overseer_name),
  );

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const unmapped = [];
  const daysTouched = new Set();

  const applyAll = db.transaction(() => {
    for (const [machineName, dayMap] of perMachine) {
      if (!existingOverseerNames.has(machineName)) {
        unmapped.push({ overseer_name: machineName, days: dayMap.size });
      }
      const sourceLabel = [...filesByMachine.get(machineName)].join(';');
      for (const [dk, dayEntry] of dayMap) {
        daysTouched.add(dk);
        const status = upsertDay(dk, machineName, dayEntry, sourceLabel);
        if (status === 'added') added += 1;
        else if (status === 'updated') updated += 1;
        else unchanged += 1;
      }
    }
  });
  applyAll();

  return {
    filesProcessed: files.length,
    daysTouched: daysTouched.size,
    added,
    updated,
    unchanged,
    unmapped,
    filesWithNoData,
    fileErrors,
    hecterra,
  };
}

/** Назви з OVERSEER і Hecterra (той самий розробник, той самий "Об'єкт"), для
 * яких є дані, але немає прив'язаної техніки (equipment.overseer_name). Техніка,
 * на яку є лише звіт Hecterra "Оброблено полів" (без мотогодин OVERSEER) - теж
 * має тут з'явитись, інакше прив'язати її неможливо (був живий баг: Claas
 * 25380ВА не показувався, бо unmapped дивився тільки в machine_facts). */
export function listUnmappedMachines() {
  return db
    .prepare(`
      SELECT overseer_name, MIN(first_date) AS first_date, MAX(last_date) AS last_date, SUM(days) AS days
        FROM (
          SELECT overseer_name, COUNT(*) AS days, MIN(fact_date) AS first_date, MAX(fact_date) AS last_date
            FROM machine_facts
           GROUP BY overseer_name
          UNION ALL
          SELECT overseer_name, COUNT(*) AS days, MIN(activity_date) AS first_date, MAX(activity_date) AS last_date
            FROM hecterra_activities
           GROUP BY overseer_name
        )
       WHERE overseer_name NOT IN (SELECT overseer_name FROM equipment WHERE overseer_name IS NOT NULL)
         AND overseer_name NOT IN (SELECT value FROM alert_dismissals WHERE category = 'overseer_machine')
       GROUP BY overseer_name
       ORDER BY overseer_name COLLATE NOCASE
    `)
    .all();
}

/** Денні факти по техніці, приєднані до довідника техніки й позначені, чи вже
 * є на цей день/техніку шляховий лист (для екрана "Дані з техніки"). */
export function listMachineFacts(filters = {}) {
  const where = [];
  const params = {};

  if (filters.date_from) {
    where.push('mf.fact_date >= @date_from');
    params.date_from = filters.date_from;
  }
  if (filters.date_to) {
    where.push('mf.fact_date <= @date_to');
    params.date_to = filters.date_to;
  }
  if (filters.equipment_id) {
    where.push('eq.id = @equipment_id');
    params.equipment_id = filters.equipment_id;
  }
  if (filters.only_unlinked) {
    where.push('eq.id IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db
    .prepare(`
      SELECT mf.*,
             eq.id   AS equipment_id,
             eq.name AS equipment_name,
             EXISTS(
               SELECT 1 FROM worklogs w
                WHERE w.equipment_id = eq.id
                  AND w.work_date <= mf.fact_date AND w.work_date_to >= mf.fact_date
             ) AS has_worklog
        FROM machine_facts mf
        LEFT JOIN equipment eq ON eq.overseer_name = mf.overseer_name
        ${whereSql}
       ORDER BY mf.fact_date DESC, mf.overseer_name
    `)
    .all(params);
}
