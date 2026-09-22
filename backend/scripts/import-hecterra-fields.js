/**
 * Імпорт списку полів із KMZ-експорту Hecterra (Google Earth) у довідник fields.
 *
 * Hecterra ще не дає програмного доступу до даних (див. коментар у
 * services/hecterra/importService.js), але вручну вивантажений .kmz з межами
 * полів вже містить те, що нам треба: id поля в Hecterra (Placemark id) і його
 * назву. Назва, як правило, містить площу в кінці ("... 0.24 га"), тому площу
 * дістаємо звідти - геометрію (координати меж) не зберігаємо, у fields її нема.
 *
 * Використання:
 *   node scripts/import-hecterra-fields.js "шлях/до/файлу.kmz"
 *   node scripts/import-hecterra-fields.js "шлях/до/файлу.kmz" --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { db } from '../src/db/index.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('Вкажіть шлях до .kmz файлу: node scripts/import-hecterra-fields.js <файл.kmz>');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`Файл не знайдено: ${filePath}`);
  process.exit(1);
}

/** "0.24 га" / "0,25га" / "0, 25 га" -> 0.24 / 0.25 / 0.25 */
function parseArea(name) {
  const withUnit = /([\d]+(?:[.,]\s?\d+)?)\s*га/i.exec(name);
  if (withUnit) return Number(withUnit[1].replace(/\s+/g, '').replace(',', '.'));

  // Без "га" в назві площа зазвичай останнє дробове число в рядку
  // ("Олексієнко О.І. 1.60", "Васильченко 0.43 за кошти"). Цілі числа без коми/крапки
  // навмисно ігноруємо - це, як правило, номер ділянки, а не площа.
  const decimals = [...name.matchAll(/\d+[.,]\d+/g)];
  if (decimals.length > 0) return Number(decimals.at(-1)[0].replace(',', '.'));

  return null;
}

async function readKmlText(kmzPath) {
  const buffer = fs.readFileSync(kmzPath);
  const zip = await JSZip.loadAsync(buffer);
  const kmlEntry = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name));
  if (!kmlEntry) throw new Error('У .kmz не знайдено файл .kml');
  return kmlEntry.async('text');
}

function extractPlacemarks(xml) {
  const re = /<Placemark id="(\d+)">\s*<name>([^<]*)<\/name>/g;
  const items = [];
  let m;
  while ((m = re.exec(xml))) {
    const name = m[2].replace(/\s+/g, ' ').trim();
    if (!name) continue;
    items.push({ gektera_field_id: m[1], name, area_ha: parseArea(name) });
  }
  return items;
}

const selectByGektera = db.prepare('SELECT * FROM fields WHERE gektera_field_id = ?');
const insertField = db.prepare(
  `INSERT INTO fields (name, area_ha, gektera_field_id)
   VALUES (@name, @area_ha, @gektera_field_id)`,
);
const updateField = db.prepare(
  `UPDATE fields SET name = @name, area_ha = @area_ha, updated_at = datetime('now')
    WHERE id = @id`,
);

function upsertField(item) {
  const existing = selectByGektera.get(item.gektera_field_id);
  if (!existing) {
    insertField.run(item);
    return 'added';
  }
  if (existing.name === item.name && existing.area_ha === item.area_ha) return 'unchanged';
  updateField.run({ ...item, id: existing.id });
  return 'updated';
}

async function run() {
  const xml = await readKmlText(filePath);
  const items = extractPlacemarks(xml);
  if (items.length === 0) {
    console.error('У файлі не знайдено жодного поля (Placemark)');
    process.exit(1);
  }

  const noArea = items.filter((i) => i.area_ha === null);
  console.log(`Файл: ${filePath}`);
  console.log(`Знайдено полів: ${items.length}`);
  console.log(`Без розпізнаної площі: ${noArea.length}`);

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const applyAll = db.transaction(() => {
    for (const item of items) {
      const status = upsertField(item);
      if (status === 'added') added += 1;
      else if (status === 'updated') updated += 1;
      else unchanged += 1;
    }
    if (dryRun) throw new Error('__DRY_RUN__');
  });

  try {
    applyAll();
  } catch (error) {
    if (error.message !== '__DRY_RUN__') throw error;
  }

  console.log('\n' + '='.repeat(60));
  console.log(dryRun ? 'ПРОБНИЙ ЗАПУСК (зміни відкочено)' : 'ІМПОРТ ЗАВЕРШЕНО');
  console.log(`Додано:     ${added}`);
  console.log(`Оновлено:   ${updated}`);
  console.log(`Без змін:   ${unchanged}`);

  if (noArea.length > 0) {
    console.log(`\nБез площі в назві (${noArea.length}) - перевірте вручну в довіднику "Поля":`);
    for (const item of noArea) console.log(`  - [${item.gektera_field_id}] ${item.name}`);
  }
}

run();
