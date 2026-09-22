// Розбір багатоаркушних звітів OVERSEER (Мотогодини / Поїздки / Заправки).
// Порт з overseer-bas (src/lib/tripWorkbook.mjs), логіка не змінена.
//
// ВАЖЛИВО: батьківським "денним" рядкам довіряти не можна - OVERSEER групує їх за
// безперервністю активності, а не за календарним днем. Якщо двигун лишили увімкненим
// на кілька діб поспіль, один дочірній запис розтягує весь батьківський підсумок на
// кілька днів (реальний випадок, знайдений на справжніх даних). Тому рахуємо з
// дочірніх рядків (Групування = дата+час) і для мотогодин розподіляємо тривалість
// по календарних днях, якщо запис перетинає північ.
import ExcelJS from 'exceljs';
import { normalizeHeader, parseDuration, parseNumber, parseDateTime, dateKey, splitHoursAcrossDays } from './normalize.js';

function findSheet(workbook, aliases) {
  const norm = aliases.map((a) => a.trim().toLowerCase());
  return workbook.worksheets.find((s) => norm.includes(s.name.trim().toLowerCase())) || null;
}

function sheetGrid(sheet) {
  const grid = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    const raw = row.values;
    for (let i = 1; i < raw.length; i++) {
      let v = raw[i];
      if (v && typeof v === 'object' && 'result' in v) v = v.result;
      if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
      values.push(v === undefined ? '' : v);
    }
    grid.push(values);
  });
  return grid;
}

function findColumns(headerRow, columnAliases) {
  const lookup = new Map();
  for (const [key, variants] of Object.entries(columnAliases)) {
    if (key.startsWith('_')) continue;
    for (const v of variants) lookup.set(normalizeHeader(v), key);
  }
  const colIndex = {};
  headerRow.forEach((h, i) => {
    const key = lookup.get(normalizeHeader(h));
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });
  return colIndex;
}

/** true, якщо "Групування" відповідає дочірньому рядку (дата+час, є пробіл). Батьківські
 * підсумкові рядки (без пробілу - сама дата) свідомо ігноруємо. */
function isChildGrouping(value) {
  if (value === null || value === undefined || value === '') return false;
  return String(value).includes(' ');
}

function addTo(map, key, field, value) {
  if (value === null || value === undefined || isNaN(value)) return;
  if (!map.has(key)) map.set(key, {});
  const entry = map.get(key);
  entry[field] = (entry[field] || 0) + value;
}

/** Читає одну книгу OVERSEER. Повертає {machineName, perDay: Map<dateKey, entry>}
 * entry містить ЛИШЕ ті поля, які реально знайдено в цьому файлі (для мерджу між файлами). */
export async function readTripWorkbook(filePath, mapping) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const statsSheet = findSheet(wb, mapping.sheets.stats);
  let machineName = null;
  if (statsSheet) {
    statsSheet.eachRow((row) => {
      const label = String(row.getCell(1).value || '').trim().toLowerCase();
      if (mapping.columns.machine_name.some((v) => v.trim().toLowerCase() === label)) {
        machineName = String(row.getCell(2).value || '').trim();
      }
    });
  }

  const perDay = new Map();

  const motohoursSheet = findSheet(wb, mapping.sheets.motohours);
  if (motohoursSheet) {
    const grid = sheetGrid(motohoursSheet);
    const cols = findColumns(grid[0] || [], mapping.columns);
    if (cols.grouping !== undefined && cols.motohours_total !== undefined) {
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row || !isChildGrouping(row[cols.grouping])) continue;
        const start = parseDateTime(row[cols.grouping]);
        const hours = parseDuration(row[cols.motohours_total]);
        if (!start || hours === null) continue;
        for (const [key, h] of splitHoursAcrossDays(start, hours)) {
          addTo(perDay, key, 'engine_hours', h);
        }
      }
    }
  }

  const tripsSheet = findSheet(wb, mapping.sheets.trips);
  if (tripsSheet) {
    const grid = sheetGrid(tripsSheet);
    const cols = findColumns(grid[0] || [], mapping.columns);
    if (cols.grouping !== undefined) {
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row || !isChildGrouping(row[cols.grouping])) continue;
        const start = parseDateTime(row[cols.grouping]);
        if (!start) continue;
        const key = dateKey(start);
        if (cols.distance_km !== undefined) addTo(perDay, key, 'distance_km', parseNumber(row[cols.distance_km]));
        if (cols.fuel_consumed_dut !== undefined) addTo(perDay, key, 'fuel_consumed', parseNumber(row[cols.fuel_consumed_dut]));
      }
    }
  }

  const refuelsSheet = findSheet(wb, mapping.sheets.refuels);
  if (refuelsSheet) {
    const grid = sheetGrid(refuelsSheet);
    const cols = findColumns(grid[0] || [], mapping.columns);
    if (cols.grouping !== undefined && cols.fuel_refueled !== undefined) {
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row || !isChildGrouping(row[cols.grouping])) continue;
        const start = parseDateTime(row[cols.grouping]);
        if (!start) continue;
        addTo(perDay, dateKey(start), 'fuel_refueled', parseNumber(row[cols.fuel_refueled]));
      }
    }
  }

  // Округлення - інакше сума з десятків дочірніх рядків дає потворні хвости на кшталт 9.809999999997
  for (const entry of perDay.values()) {
    for (const f of ['engine_hours', 'distance_km', 'fuel_consumed', 'fuel_refueled']) {
      if (entry[f] !== undefined) entry[f] = Math.round(entry[f] * 100) / 100;
    }
  }

  return { machineName, perDay, hasAnyData: !!(motohoursSheet || tripsSheet || refuelsSheet) };
}
