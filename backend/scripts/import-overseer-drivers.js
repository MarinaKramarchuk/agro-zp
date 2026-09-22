/**
 * Імпорт довідника "Водії" з експорту OVERSEER у employees. CSV колонки:
 * Назва;Код;Опис;Номер телефону;Мобільний ключ;Виключаючий
 *
 * Це реєстр ключів/міток OVERSEER для ідентифікації водія на техніці, а не
 * чистий кадровий список - трапляються службові записи ("Заблокована",
 * "Тестова"), назви техніки замість імені ("Тайота", "ДАФ7680 загублена")
 * і порожні назви. Employees в цій програмі не має поля overseer_name
 * (воно є лише в equipment - для мотогодин), тому тут лише переносимо ім'я
 * в довідник "Працівники" (staff_group='driver"), а код/телефон - у note.
 *
 * Використання:
 *   node scripts/import-overseer-drivers.js "шлях/до/Водії.csv" --dry-run
 *   node scripts/import-overseer-drivers.js "шлях/до/Водії.csv"
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/index.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const file = argv.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('Вкажіть шлях до .csv файлу: node scripts/import-overseer-drivers.js <файл.csv>');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`Файл не знайдено: ${filePath}`);
  process.exit(1);
}

// Службові позначки OVERSEER, які точно не є іменем людини
const JUNK_NAMES = ['заблокована', 'тестова', 'тайота', 'тойота'];
// Слова-примітки в кінці назви ("... загублена") - переносимо в note, не в ім'я
const NOTE_SUFFIX_RE = /\s*(загублена|заблокован\w*)\s*$/i;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    return row;
  });
}

function cleanName(raw) {
  // "14.Васильченко В.В." / "1 Іванов" / "18 .Миколаєнко" -> прибираємо ведучий номер ключа
  let name = raw.replace(/^\d+\s*\.?\s*/, '').trim();
  let suffixNote = null;
  const suffixMatch = NOTE_SUFFIX_RE.exec(name);
  if (suffixMatch) {
    suffixNote = suffixMatch[1];
    name = name.slice(0, suffixMatch.index).trim();
  }
  return { name, suffixNote };
}

function run() {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);

  const ready = [];
  const excluded = [];

  for (const row of rows) {
    const raw = row['Назва']?.trim();
    if (!raw) continue;
    const { name, suffixNote } = cleanName(raw);

    if (!name || JUNK_NAMES.includes(name.toLowerCase())) {
      excluded.push({ raw, reason: !name ? 'порожнє ім\'я' : 'службова позначка' });
      continue;
    }

    const noteParts = [];
    if (row['Код']) noteParts.push(`OVERSEER код: ${row['Код']}`);
    if (row['Номер телефону']) noteParts.push(`тел.: ${row['Номер телефону']}`);
    if (suffixNote) noteParts.push(suffixNote);

    ready.push({ raw, full_name: name, note: noteParts.length ? noteParts.join('; ') : null });
  }

  // Одне й те саме ім'я могло отримати кілька різних ключів OVERSEER (одна
  // людина з двома ключами - або, що небезпечніше, дві різні людини з однаковим
  // прізвищем). Не вгадуємо - зводимо в один запис, але зберігаємо ВСІ коди
  // і попереджаємо, щоб людина сама перевірила.
  const byName = new Map();
  for (const item of ready) {
    if (!byName.has(item.full_name)) byName.set(item.full_name, []);
    byName.get(item.full_name).push(item);
  }
  const merged = [...byName.entries()].map(([full_name, items]) => ({
    full_name,
    note: items.map((i) => i.note).filter(Boolean).join(' | ') || null,
    occurrences: items.length,
  }));
  const collisions = merged.filter((m) => m.occurrences > 1);

  console.log(`Файл: ${filePath}`);
  console.log(`Рядків: ${rows.length}`);
  console.log(`До імпорту готові: ${ready.length} (унікальних імен: ${merged.length})`);
  console.log(`Виключено (${excluded.length}):`);
  for (const e of excluded) console.log(`  - "${e.raw}" (${e.reason})`);

  if (collisions.length > 0) {
    console.log(
      `\nУВАГА: однакове ім'я зустрілось кілька разів у OVERSEER (${collisions.length}) -` +
        ` можливо, це РІЗНІ люди з однаковим прізвищем. Зведено в один запис, обидва коди` +
        ` збережено в примітці - перевірте вручну:`,
    );
    for (const c of collisions) console.log(`  - ${c.full_name}  [${c.note}]`);
  }

  console.log(`\nСписок до імпорту (staff_group = "driver"):`);
  for (const item of merged) {
    console.log(`  - ${item.full_name}${item.note ? '  [' + item.note + ']' : ''}`);
  }

  if (dryRun) {
    console.log('\n' + '='.repeat(60));
    console.log('ПРОБНИЙ ЗАПУСК - нічого не записано.');
    return;
  }

  const selectByName = db.prepare('SELECT id FROM employees WHERE full_name = ?');
  const insertEmp = db.prepare(
    `INSERT INTO employees (full_name, staff_group, note) VALUES (@full_name, 'driver', @note)`,
  );
  const updateNote = db.prepare(`UPDATE employees SET note = @note, updated_at = datetime('now') WHERE id = @id`);

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const applyAll = db.transaction(() => {
    for (const item of merged) {
      const existing = selectByName.get(item.full_name);
      if (!existing) {
        insertEmp.run(item);
        added += 1;
      } else {
        const current = db.prepare('SELECT note FROM employees WHERE id = ?').get(existing.id);
        if (current.note !== item.note) {
          updateNote.run({ id: existing.id, note: item.note });
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
    }
  });
  applyAll();

  console.log('\n' + '='.repeat(60));
  console.log('ІМПОРТ ЗАВЕРШЕНО');
  console.log(`Додано:   ${added}`);
  console.log(`Оновлено: ${updated}`);
  console.log(`Без змін: ${unchanged}`);
}

run();
