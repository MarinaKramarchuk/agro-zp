// Розбір "брудних" значень зі звітів OVERSEER: дати у форматі ДД.ММ.РРРР або серійні
// дати Excel, числа з комою чи крапкою, тривалості виду "5 дні 9:56:50".
// Порт з overseer-bas (src/lib/normalize.mjs), логіка не змінена.

/** Приводить довільний варіант заголовка до "нормальної" форми для порівняння. */
export function normalizeHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Парсить дату: рядок "ДД.ММ.РРРР" / "РРРР-ММ-ДД" або число - серійна дата Excel. */
export function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return toDateOnly(value);
  if (typeof value === "number") {
    // Excel serial date (система відліку 1899-12-30)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return toDateOnly(new Date(ms));
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return toDateOnly(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toDateOnly(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return toDateOnly(new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toDateOnly(d);
  return null;
}

function toDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Форматує дату в ДД.ММ.РРРР */
export function formatDate(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Ключ дати для порівняння/сортування/зберігання: РРРР-ММ-ДД */
export function dateKey(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Парсить дату+час "РРРР-ММ-ДД ГГ:ХХ:СС" або "ДД.ММ.РРРР ГГ:ХХ:СС" (як у "дочірніх"
 * рядках звітів OVERSEER - на відміну від parseDate, тут час не відкидається). */
export function parseDateTime(text) {
  if (!text) return null;
  const s = String(text).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2}):(\d{2})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  return parseDate(s);
}

/** Розподіляє тривалість (у годинах), що починається з startDateTime, по календарних днях -
 * потрібно, бо OVERSEER інколи групує запис, що триває кілька діб поспіль (двигун лишили
 * увімкненим), і без розподілу все навантаження впаде на один день. Повертає Map dateKey -> години. */
export function splitHoursAcrossDays(startDateTime, hours) {
  const result = new Map();
  if (!startDateTime || !hours) return result;
  let cursor = new Date(startDateTime.getTime());
  let remainingMs = hours * 3600 * 1000;
  let guard = 0;
  while (remainingMs > 0.5 && guard < 60) {
    guard++;
    const key = dateKey(cursor);
    const midnightNext = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0);
    const msUntilMidnight = midnightNext.getTime() - cursor.getTime();
    const msThisDay = Math.min(remainingMs, msUntilMidnight);
    result.set(key, (result.get(key) || 0) + msThisDay / 3600000);
    remainingMs -= msThisDay;
    cursor = midnightNext;
  }
  return result;
}

/** Парсить тривалість у форматі OVERSEER: "6:32:21" або "5 дні 9:56:50" -> десяткові години. */
export function parseDuration(text) {
  if (text === null || text === undefined || text === "") return null;
  const s = String(text).trim();
  // "6:32:21" або "4 дня 2:54:23" / "5 дні 9:56:50" - день-слово не валідуємо суворо
  // (українська/російська мають купу відмінків: день/дні/дня/днів), просто пропускаємо будь-яке слово.
  const m = s.match(/^(?:(\d+)\s+\S+\s+)?(\d+):(\d{2}):(\d{2})$/u);
  if (!m) return null;
  const days = m[1] ? Number(m[1]) : 0;
  const h = Number(m[2]), mi = Number(m[3]), se = Number(m[4]);
  return Math.round((days * 24 + h + mi / 60 + se / 3600) * 100) / 100;
}

/** Парсить число: підтримує кому як десятковий роздільник і пробіли-розділювачі тисяч. */
export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const s = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** true, якщо дата d потрапляє в [from, to] (обидва можуть бути null - відкритий інтервал). */
export function inRange(d, from, to) {
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
