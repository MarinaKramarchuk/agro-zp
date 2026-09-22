/**
 * Імпорт звіту Hecterra "Cultivations for unit ..." (.xlsx) у hecterra_activities,
 * щоб на "Дані з техніки" та в чернетці шляхового підтягувалась площа по полях.
 *
 * Використання:
 *   node scripts/import-hecterra-cultivations.js "шлях/до/Cultivations_for_unit_X.xlsx"
 *   node scripts/import-hecterra-cultivations.js "шлях/до/файлу.xlsx" --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { parseCultivationsRows } from '../src/services/hecterra/parseCultivationsExport.js';
import { importHecterraActivities } from '../src/services/hecterra/importService.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('Вкажіть шлях до .xlsx файлу: node scripts/import-hecterra-cultivations.js <файл.xlsx>');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`Файл не знайдено: ${filePath}`);
  process.exit(1);
}

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames.find((n) => XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1 }).length > 1);
if (!sheetName) {
  console.error('У файлі не знайдено аркуша з даними');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: '' });
const activities = parseCultivationsRows(rows, { sourceFile: path.basename(filePath) });

console.log(`Файл: ${filePath}`);
console.log(`Аркуш: ${sheetName}`);
console.log(`Записів (згруповано дата+поле): ${activities.length}`);
for (const a of activities) {
  const total = a.field_area_ha != null ? ` з ${a.field_area_ha}` : '';
  const driver = a.driver_name_raw ? `  водій: ${a.driver_name_raw}` : '';
  console.log(`  - ${a.activity_date}  ${a.overseer_name}  ${a.field_name_raw}: ${a.area_ha}${total} га  [${a.work_type_raw ?? '—'}]${driver}`);
}

if (activities.length === 0) {
  console.log('\nНемає записів для імпорту.');
  process.exit(0);
}

if (dryRun) {
  console.log('\nПРОБНИЙ ЗАПУСК - нічого не записано.');
  process.exit(0);
}

const result = importHecterraActivities(activities);
console.log('\n' + '='.repeat(60));
console.log('ІМПОРТ ЗАВЕРШЕНО');
console.log(`Оброблено: ${result.activitiesProcessed}`);
console.log(`Додано:    ${result.added}`);
console.log(`Оновлено:  ${result.updated}`);
console.log(`Без змін:  ${result.unchanged}`);
