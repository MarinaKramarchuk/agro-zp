/**
 * Заповнення офіційних бланків (форма №68 "Дорожній листок трактора" і типова
 * форма №2 "Подорожній лист вантажного автомобіля") на основі справжніх
 * Excel-шаблонів із папки `шаблони/` (корінь проєкту, як і `tariffs/`).
 *
 * Файли-шаблони збережені з порожнім xdr:wsDr (drawing) без якорів - відомий
 * баг exceljs (читає model.drawings[name] як undefined і падає на
 * `drawing.anchors`). Тому перед завантаженням вирізаємо порожній
 * drawing-парт прямо з zip, решта стилів/об'єднань кому comments лишаються
 * незмінними.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { rootDir } from '../config.js';

const TEMPLATES_DIR = path.resolve(rootDir, '../шаблони');

const TEMPLATE_FILES = {
  68: 'Подорожній лист трактора.xlsx',
  2: 'Подорожній лист розширений.xlsx',
};

const UKR_MONTHS_GENITIVE = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

function dateParts(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function ukrDateLong(isoDate) {
  const { year, month, day } = dateParts(isoDate);
  return `${day} ${UKR_MONTHS_GENITIVE[month - 1]} ${year}`;
}

function ukrDateShort(isoDate) {
  const { year, month, day } = dateParts(isoDate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(day)}.${pad(month)}.${year}`;
}

const fixedBufferCache = new Map();

/** Вирізає порожній xl/drawings/*.xml (без якорів) із zip - інакше exceljs
 * падає при читанні. Решта частин файлу (стилі, об'єднання, коментарі)
 * лишаються без змін. */
async function stripEmptyDrawings(zip) {
  const sheetPaths = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));

  for (const sheetPath of sheetPaths) {
    const relsPath = sheetPath.replace('worksheets/', 'worksheets/_rels/').replace('.xml', '.xml.rels');
    const relsFile = zip.files[relsPath];
    if (!relsFile) continue;
    let relsXml = await relsFile.async('string');

    const drawingRels = [...relsXml.matchAll(
      /<Relationship Id="([^"]+)"[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"[^>]*\/>/g,
    )];
    for (const [, relId, target] of drawingRels) {
      const resolved = path.posix.normalize(path.posix.join('xl/worksheets', target));
      const drawingFile = zip.files[resolved];
      if (!drawingFile) continue;
      const drawingXml = (await drawingFile.async('string')).replace(/\s+/g, ' ');
      const isEmpty = !/<xdr:twoCellAnchor|<xdr:oneCellAnchor|<xdr:absoluteAnchor/i.test(drawingXml);
      if (!isEmpty) continue;

      let sheetXml = await zip.files[sheetPath].async('string');
      sheetXml = sheetXml.replace(new RegExp(`<drawing r:id="${relId}"\\s*/>`), '');
      zip.file(sheetPath, sheetXml);
      relsXml = relsXml.replace(new RegExp(`<Relationship Id="${relId}"[^>]*/>`), '');
      zip.file(relsPath, relsXml);
      zip.remove(resolved);
    }
  }
}

/**
 * exceljs парсить булеві теги шрифту (`<b>`, `<i>`, `<strike>`, `<outline>`,
 * `<shadow>`, `<condense>`, `<extend>`) лише за фактом ПРИСУТНОСТІ тега,
 * ігноруючи атрибут `val` (node_modules/exceljs BooleanXform.parseOpen
 * ставить `true` без перевірки val) - офіційний вигляд бланка, де ці теги
 * явно виписані як `val="false"`/`val="0"`, тому читається як суцільний
 * курсив/закреслення. Вирізаємо такі "хибно-хибні" теги зі styles.xml до
 * парсингу.
 */
async function sanitizeFalseBooleanFontFlags(zip) {
  const path_ = 'xl/styles.xml';
  const file = zip.files[path_];
  if (!file) return;
  let xml = await file.async('string');
  for (const tag of ['b', 'i', 'strike', 'outline', 'shadow', 'condense', 'extend']) {
    xml = xml.replace(new RegExp(`<${tag}\\s+val="(?:false|0)"\\s*/>`, 'g'), '');
  }
  zip.file(path_, xml);
}

async function loadFixedBuffer(templateKey) {
  if (fixedBufferCache.has(templateKey)) return fixedBufferCache.get(templateKey);
  const file = TEMPLATE_FILES[templateKey];
  const abs = path.join(TEMPLATES_DIR, file);
  if (!fs.existsSync(abs)) {
    throw new Error(`Шаблон бланка не знайдено: ${abs}`);
  }
  const raw = fs.readFileSync(abs);
  const zip = await JSZip.loadAsync(raw);
  await stripEmptyDrawings(zip);
  await sanitizeFalseBooleanFontFlags(zip);
  const fixed = await zip.generateAsync({ type: 'nodebuffer' });
  fixedBufferCache.set(templateKey, fixed);
  return fixed;
}

/** Завантажує чисту копію шаблону (один аркуш) - окремий workbook на кожен
 * виклик, щоб можна було клонувати аркуш у спільну вихідну книгу. */
async function loadTemplateSheet(templateKey) {
  const buffer = await loadFixedBuffer(templateKey);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}

/** Копіює аркуш (значення + стилі + об'єднання + ширини колонок/висоти
 * рядків) з чужого workbook у цільовий, під новою назвою. */
function cloneWorksheetInto(targetWorkbook, source, name) {
  const target = targetWorkbook.addWorksheet(name, {
    properties: source.properties,
    pageSetup: source.pageSetup,
    views: source.views,
  });
  target.columns = source.columns.map((c) => ({ width: c?.width }));
  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const targetRow = target.getRow(rowNumber);
    if (row.height) targetRow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const targetCell = targetRow.getCell(colNumber);
      targetCell.value = cell.value;
      targetCell.style = cell.style;
    });
    targetRow.commit();
  });
  for (const merge of source.model.merges) {
    target.mergeCells(merge);
  }
  return target;
}

/** Встановлює значення в комірку, лишаючи її стиль незмінним, і вмикає
 * перенос рядків, якщо значення багаторядкове. */
function setCell(ws, ref, value) {
  const cell = ws.getCell(ref);
  cell.value = value;
  if (typeof value === 'string' && value.includes('\n')) {
    cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'top' };
  }
}

const cropLabel = (crops) => (item) => (item.crop ? crops[item.crop] ?? item.crop : '—');
const unitLabel = (units) => (item) => units[item.unit]?.label ?? item.unit;

/** Рядки 26-37 у формі №68 - це не таблиця даних, а сама (розгорнута по
 * висоті, з повернутим на 90° текстом) шапка "ВИКОНАНЕ ЗАВДАННЯ": кожен
 * стовпець там - один суцільний об'єднаний заголовок ("Звідки", "Куди", ...)
 * на всю висоту 26-37. Реальні порожні рядки для записів - 38-46 (9 штук на
 * аркуш), нижче шапки. Раніше записи писались у саму шапку (рядок 26/27) -
 * тому в надрукованому бланку "робіт" видно не було: дані затирали заголовок
 * і виводились повернутими на 90°, а не в таблицю. */
const FORM68_TASK_ROWS = [38, 39, 40, 41, 42, 43, 44, 45, 46];

/** Коли форма №68 друкується не на один день, а суцільною таблицею на весь
 * період (`renderWaybillTemplate` -> `combinePeriod`), поля рік/місяць/число
 * не можуть показати діапазон - тож лишаються порожніми, а період виноситься
 * текстом в поле організації. */
function fillForm68Header(ws, { date, dateTo, orgName, employeeName, vehicleLabel, plateNumber, implementLabel }) {
  const isPeriod = dateTo && dateTo !== date;
  if (isPeriod) {
    // Шаблон-заготовка тримає приклад дати (рік/місяць/число) прямо в цих
    // комірках - для одного дня їх завжди перезаписує гілка нижче, а тут
    // діапазон туди не влазить, тож просто чистимо, щоб не лишався сміттєвий
    // приклад дати з шаблону.
    setCell(ws, 'A2', '');
    setCell(ws, 'C2', '');
    setCell(ws, 'E2', '');
    if (orgName) setCell(ws, 'G2', orgName);
    setCell(ws, 'AB3', `Організація  ${orgName ?? ''}   Період: ${ukrDateLong(date)} — ${ukrDateLong(dateTo)}`.trim());
  } else {
    const { year, month, day } = dateParts(date);
    setCell(ws, 'A2', year);
    setCell(ws, 'C2', month);
    setCell(ws, 'E2', day);
    if (orgName) setCell(ws, 'G2', orgName);
    if (orgName) setCell(ws, 'AB3', `Організація  ${orgName}`);
  }
  if (vehicleLabel) setCell(ws, 'S3', vehicleLabel);
  setCell(ws, 'R4', `Державний № ${plateNumber ?? ''}`);
  setCell(ws, 'R5', `Причіп № ${implementLabel ?? ''}`);
  if (employeeName) setCell(ws, 'C5', employeeName);
}

/**
 * Заповнює один рядок таблиці "ВИКОНАНЕ ЗАВДАННЯ" (рядки 38-46) - офіційний
 * бланк призначений для вантажних рейсів (Звідки/Куди/Назва вантажу/Клас
 * вантажу), тому за усталеною бухгалтерською практикою для тракторних
 * польових робіт у ці ж колонки записують поле/вид роботи/культуру - так
 * само, як і на паперовому бланку. У суцільній таблиці на весь період
 * (showDate) один рядок може стосуватись будь-якого дня періоду, тож дата
 * запису йде в колонку "Звідки" (A) - інакше в аркуші на один день вона й
 * так відома із шапки, колонка лишається порожньою.
 */
function fillForm68TaskRow(ws, row, item, { crops, units, showDate }) {
  const crop = cropLabel(crops)(item);
  const unit = unitLabel(units)(item);
  if (showDate) setCell(ws, `A${row}`, ukrDateShort(item.work_date));
  setCell(ws, `C${row}`, item.field_name ?? '—');
  setCell(ws, `E${row}`, item.work_type_name);
  setCell(ws, `G${row}`, crop);
  setCell(ws, `R${row}`, unit);
  setCell(ws, `U${row}`, item.hours ? item.hours : '');
  setCell(ws, `V${row}`, item.quantity);
  setCell(ws, `AC${row}`, Number(item.rate ?? 0));
  setCell(ws, `AE${row}`, Number(item.total_amount ?? 0));
}

/**
 * Заповнює одну копію типової форми №2 (Подорожній лист вантажного
 * автомобіля) для одного дня. Таблиця "ЗАВДАННЯ ВОДІЄВІ" має рівно два
 * вільні рядки (31, 32) - якщо записів за день більше, зайві переносяться
 * на аркуш-продовження з тією ж шапкою (див. `renderWaybillTemplate`).
 */
function fillForm2Header(ws, { date, orgName, employeeName, vehicleLabel, plateNumber, trailerLabel }) {
  setCell(ws, 'I5', ukrDateLong(date));
  if (orgName) setCell(ws, 'A4', `Місце для штампу підприємства  ${orgName}`);
  if (vehicleLabel || plateNumber) {
    setCell(ws, 'G11', [vehicleLabel, plateNumber ? `№ ${plateNumber}` : ''].filter(Boolean).join('  '));
  }
  if (employeeName) setCell(ws, 'G13', employeeName);
  if (trailerLabel) setCell(ws, 'G15', trailerLabel);
}

const FORM2_TASK_ROWS = [31, 32];

function fillForm2TaskRow(ws, row, item, { crops }) {
  const crop = cropLabel(crops)(item);
  setCell(ws, `Y${row}`, item.route_name ?? item.field_name ?? '—');
  setCell(ws, `AD${row}`, `${item.work_type_name}${item.crop ? ` · ${crop}` : ''}`);
  setCell(ws, `O${row}`, item.hours ? item.hours : '');
  setCell(ws, `AI${row}`, item.trips ? item.trips : '');
  setCell(ws, `AQ${row}`, item.unit === 'ton' ? item.quantity : '');
}

function fillForm2Totals(ws, pageItems) {
  const trips = pageItems.reduce((s, i) => s + (i.trips ?? 0), 0);
  const tons = pageItems.reduce((s, i) => s + (i.unit === 'ton' ? i.quantity ?? 0 : 0), 0);
  if (trips) setCell(ws, 'AI33', trips);
  if (tons) setCell(ws, 'AQ33', tons);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Формує готову книгу Excel із заповненими копіями офіційного бланка - один
 * аркуш на кожен робочий день у вибраному періоді (а для форми №2 - ще й на
 * кожні два записи цього дня, якщо їх більше). Для форми №68 можна замість
 * цього (`combinePeriod`) звести весь період в одну суцільну таблицю
 * (декілька аркушів-продовжень, якщо записів більше, ніж влазить рядків) -
 * зручніше для обліковця, хоч і відходить від "один документ - один день",
 * як має бути з офіційним бланком.
 */
export async function renderWaybillTemplate({
  template,
  orgName,
  employeeName,
  vehicleLabel,
  plateNumber,
  implementLabel,
  trailerLabel,
  itemsByDate,
  crops,
  units,
  combinePeriod = false,
}) {
  const sourceWs = await loadTemplateSheet(template);
  const workbook = new ExcelJS.Workbook();
  const dates = [...itemsByDate.keys()].sort();

  if (template === 68 && combinePeriod) {
    const allItems = dates.flatMap((date) => itemsByDate.get(date));
    const periodFrom = dates[0];
    const periodTo = dates[dates.length - 1];
    const pages = chunk(allItems, FORM68_TASK_ROWS.length);
    pages.forEach((pageItems, pageIndex) => {
      const sheetName = pageIndex === 0 ? `${periodFrom}_${periodTo}` : `${periodFrom}_${periodTo} (${pageIndex + 1})`;
      const ws = cloneWorksheetInto(workbook, sourceWs, sheetName);
      fillForm68Header(ws, { date: periodFrom, dateTo: periodTo, orgName, employeeName, vehicleLabel, plateNumber, implementLabel });
      pageItems.forEach((item, i) => fillForm68TaskRow(ws, FORM68_TASK_ROWS[i], item, { crops, units, showDate: true }));
    });
    return workbook.xlsx.writeBuffer();
  }

  for (const date of dates) {
    const items = itemsByDate.get(date);
    if (template === 68) {
      const pages = chunk(items, FORM68_TASK_ROWS.length);
      pages.forEach((pageItems, pageIndex) => {
        const sheetName = pageIndex === 0 ? date : `${date} (${pageIndex + 1})`;
        const ws = cloneWorksheetInto(workbook, sourceWs, sheetName);
        fillForm68Header(ws, { date, orgName, employeeName, vehicleLabel, plateNumber, implementLabel });
        pageItems.forEach((item, i) => fillForm68TaskRow(ws, FORM68_TASK_ROWS[i], item, { crops, units }));
      });
    } else {
      const pages = chunk(items, FORM2_TASK_ROWS.length);
      pages.forEach((pageItems, pageIndex) => {
        const sheetName = pageIndex === 0 ? date : `${date} (${pageIndex + 1})`;
        const ws = cloneWorksheetInto(workbook, sourceWs, sheetName);
        fillForm2Header(ws, { date, orgName, employeeName, vehicleLabel, plateNumber, trailerLabel });
        pageItems.forEach((item, i) => fillForm2TaskRow(ws, FORM2_TASK_ROWS[i], item, { crops }));
        fillForm2Totals(ws, pageItems);
      });
    }
  }

  return workbook.xlsx.writeBuffer();
}
