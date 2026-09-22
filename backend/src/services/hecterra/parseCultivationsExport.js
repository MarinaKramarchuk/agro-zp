// Парсер реального експорту Hecterra "Cultivations for unit ..." (.xlsx) у наш
// внутрішній масив активностей (див. коментар у importService.js). Це перший
// реальний формат Hecterra, який ми побачили - раніше єдиним джерелом полів
// був KMZ з межами (окремий парсер, інша задача: там дрібні орендні ділянки,
// тут - робочі поля для операцій).
//
// Формат аркуша (перший рядок - заголовок), кожен рядок - один прохід техніки:
//   Поле; Площа, га; Культура; Операція; Початок; Закінчення; Тривалість;
//   Об'єкт; Водій; Агрегат; Захоплення, м; Пробіг, км; Оброблена площа, га;
//   Оброблено, %; Пропуски, га; Пропуски, %; Перекриття, га; ...
// Останній рядок аркуша - підсумок ("Обробки N") без дати початку - пропускаємо.
//
// Поле/Площа/Культура/Операція - об'єднані комірки Excel: коли прохід
// перервався (зупинка, об'їзд перешкоди тощо), Hecterra пише ці 4 колонки на
// ПІДСУМКОВОМУ рядку проходу (Початок/Закінчення проходу - від першого до
// останнього відрізка), а нижче додає розбивку того самого проходу по
// відрізках - у них ці 4 колонки порожні (в XLSX.utils.sheet_to_json це
// порожній рядок, не повторення). Це деталізація вже врахованого підсумку,
// НЕ додаткова площа - Оброблена площа/Пропуски/Пробіг/Паливо/Тривалість
// підсумкового рядка вже дорівнюють сумі відрізків нижче (перевірено на
// реальному звіті: сума "Оброблена площа" лише підсумкових рядків збіглась
// день-в-день з офіційним підсумком аркуша "Обробки N", а разом з
// відрізками давала майже вдвічі більше). Тому рядки з порожнім "Поле"
// просто пропускаємо - раніше їх сумували з підсумковим рядком (форвард-філ
// + додавання), і площа з файлу в програму потрапляла в 2-3 рази завищеною
// (був живий баг).
//
// "Тривалість" ("16 хв.", "2 г. 49 хв.") - тривалість проходу; хвилини людині
// в чернетці не потрібні, тож суму кількох проходів округлюємо до цілих годин.
//
// Полів з ID в цьому звіті немає (на відміну від KMZ) - лише назва поля з
// площею в тексті. Тому group по (дата, назва поля, Об'єкт/техніка) - той
// самий атомарний ключ "поле × дата × техніка", що документований в
// importService.js: кілька проходів ОДНІЄЮ технікою по одному полю за день
// (буває - обприскувач інколи їде "в два заходи") зводимо в один запис, а
// "Пропуски" рахуємо в оброблене (за вимогою власниці - датчики іноді хибно
// позначають оброблене як пропуск під час тривоги), інакше площа в чернетці
// шляхового буде занижена. Без техніки в ключі (лише дата+поле) операція
// ДРУГОЇ техніки на тому самому полі того самого дня (типово - трактор, що
// підвозить добрива, поки сіялка сіє) тихо зливалась в один запис із першою
// технікою і губилась як окремий рядок - був живий баг.

import { CROPS } from '../crops.js';

const HEADER_ROW = 0;

const CROP_ENTRIES = Object.entries(CROPS).map(([key, label]) => [key, label.toLowerCase()]);

/** "Ріпак" -> "rapeseed"; "Озима пшениця"/"Пшениця озима" -> "wheat" (Hecterra
 * додає "озима"/"яра" - шукаємо назву культури як частину тексту, не точний
 * збіг); "—"/порожньо/незнайома культура -> null (закритий список
 * worklogs.crop, вгадувати нове значення небезпечно). */
function mapCrop(text) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return null;
  for (const [key, label] of CROP_ENTRIES) {
    if (raw.includes(label)) return key;
  }
  return null;
}

/** "10.08.2026 19:35" -> "2026-08-10" (беремо дату ПОЧАТКУ проходу) */
function parseStartDate(text) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function toNumber(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const value = Number(String(cell ?? '').trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** "16 хв." -> 16; "2 г. 49 хв." -> 169 (у хвилинах - округлюємо до годин лише
 * в кінці, після сумування кількох проходів, інакше похибка округлення
 * накопичується). */
function parseDurationMinutes(text) {
  const str = String(text ?? '').trim();
  if (!str) return null;
  const hoursMatch = /(\d+)\s*г\.?/.exec(str);
  const minutesMatch = /(\d+)\s*хв\.?/.exec(str);
  if (!hoursMatch && !minutesMatch) return null;
  const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
  return hours * 60 + minutes;
}

/** "19. Іванов" -> "Іванов" - той самий ключ OVERSEER/Hecterra видає для
 * водія, що й у довіднику "Водії" (scripts/import-overseer-drivers.js чистить
 * імена так само), тому порівнюємо з employees.overseer_name без хвостів. */
function cleanDriverName(raw) {
  return String(raw ?? '').replace(/^\d+\s*\.?\s*/, '').trim() || null;
}

/**
 * @param {any[][]} rows - результат XLSX.utils.sheet_to_json(sheet, {header:1})
 * @param {{ sourceFile?: string }} [options]
 * @returns масив у внутрішньому форматі для importHecterraActivities()
 */
export function parseCultivationsRows(rows, options = {}) {
  const header = rows[HEADER_ROW].map((h) => String(h ?? '').trim());
  const col = (name) => header.indexOf(name);

  const idx = {
    field: col('Поле'),
    fieldArea: col('Площа, га'),
    crop: col('Культура'),
    operation: col('Операція'),
    start: col('Початок'),
    duration: col('Тривалість'),
    object: col("Об'єкт"),
    driver: col('Водій'),
    processed: col('Оброблена площа, га'),
    gaps: col('Пропуски, га'),
    distance: col('Пробіг, км'),
    fuel: col('Витрачено палива, л'),
  };

  if (idx.field === -1 || idx.start === -1 || idx.object === -1) {
    throw new Error('Незнайомий формат файлу - очікувались колонки "Поле", "Початок", "Об\'єкт"');
  }

  // group за (дата, назва поля, техніка) - кілька ПІДСУМКОВИХ проходів того
  // самого поля тією самою технікою за день (буває - напр. обприскувач їде
  // "в два заходи") об'єднуємо в один запис чернетки
  const groups = new Map();

  for (const row of rows.slice(HEADER_ROW + 1)) {
    const activity_date = parseStartDate(row[idx.start]);
    if (!activity_date) continue; // підсумковий рядок ("Обробки N") чи порожній

    const field_name_raw = String(row[idx.field] ?? '').trim();
    // порожнє "Поле" - рядок-деталізація підсумкового проходу вище (об'єднана
    // комірка), його площа/пробіг/паливо вже враховані в підсумку - пропускаємо
    if (!field_name_raw) continue;

    // Об'єкт (техніка) - НЕ об'єднана комірка, є в кожному рядку окремо.
    const overseer_name = String(row[idx.object] ?? '').trim();

    const key = `${activity_date}|${field_name_raw}|${overseer_name}`;
    const processed = toNumber(row[idx.processed]) ?? 0;
    const gaps = toNumber(row[idx.gaps]) ?? 0;

    const fieldArea = idx.fieldArea !== -1 ? toNumber(row[idx.fieldArea]) : null;
    const crop = idx.crop !== -1 ? mapCrop(row[idx.crop]) : null;
    const operation = idx.operation !== -1 ? (String(row[idx.operation] ?? '').trim() || null) : null;
    const distance = idx.distance !== -1 ? toNumber(row[idx.distance]) : null;
    const fuel = idx.fuel !== -1 ? toNumber(row[idx.fuel]) : null;
    const durationMinutes = idx.duration !== -1 ? parseDurationMinutes(row[idx.duration]) : null;

    const existing = groups.get(key);
    if (existing) {
      existing.area_ha += processed + gaps;
      if (distance != null) existing.distance_km = (existing.distance_km ?? 0) + distance;
      if (fuel != null) existing.fuel_consumed = (existing.fuel_consumed ?? 0) + fuel;
      if (durationMinutes != null) existing.durationMinutes = (existing.durationMinutes ?? 0) + durationMinutes;
      if (fieldArea != null) existing.field_area_ha = fieldArea;
    } else {
      groups.set(key, {
        activity_date,
        overseer_name,
        field_name_raw,
        area_ha: processed + gaps,
        field_area_ha: fieldArea,
        crop,
        // кілька водіїв через кому в одному проході ("Петров П, 19. Іванов")
        // не розбираємо - неоднозначно, хай людина сама прив'яже вручну
        driver_name_raw: idx.driver !== -1 ? cleanDriverName(row[idx.driver]) : null,
        work_type_raw: operation,
        distance_km: distance,
        fuel_consumed: fuel,
        durationMinutes,
        source_files: options.sourceFile ?? null,
      });
    }
  }

  return [...groups.values()].map(({ durationMinutes, ...activity }) => ({
    ...activity,
    area_ha: Math.round(activity.area_ha * 100) / 100,
    distance_km: activity.distance_km != null ? Math.round(activity.distance_km * 100) / 100 : null,
    fuel_consumed: activity.fuel_consumed != null ? Math.round(activity.fuel_consumed * 100) / 100 : null,
    // хвилини не потрібні людині в чернетці - округлюємо до цілих годин
    hours: durationMinutes != null ? Math.round(durationMinutes / 60) : null,
  }));
}
