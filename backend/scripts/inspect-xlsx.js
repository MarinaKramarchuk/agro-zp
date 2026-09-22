/**
 * Допоміжний скрипт: показує структуру Excel-файлів (аркуші та перші рядки).
 * Використання: node scripts/inspect-xlsx.js ../tariffs/1.xlsx [--rows 20]
 */
import path from 'node:path';
import XLSX from 'xlsx';

const args = process.argv.slice(2);
const rowsFlagIndex = args.indexOf('--rows');
const maxRows = rowsFlagIndex === -1 ? 15 : Number(args[rowsFlagIndex + 1]);
const files = args.filter((a, i) => !a.startsWith('--') && i !== rowsFlagIndex + 1);

if (files.length === 0) {
  console.error('Вкажіть шлях до .xlsx файлу');
  process.exit(1);
}

for (const file of files) {
  const abs = path.resolve(file);
  console.log(`\n${'='.repeat(80)}\nФАЙЛ: ${abs}`);

  const wb = XLSX.readFile(abs);
  console.log(`Аркуші (${wb.SheetNames.length}): ${wb.SheetNames.join(' | ')}`);

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    console.log(`\n--- Аркуш "${sheetName}" (рядків: ${rows.length}, діапазон: ${sheet['!ref'] ?? '-'})`);

    rows.slice(0, maxRows).forEach((row, i) => {
      const cells = row.map((c) => String(c).replace(/\s+/g, ' ').trim());
      while (cells.length > 0 && cells.at(-1) === '') cells.pop();
      console.log(`${String(i).padStart(3)} | ${cells.join(' ¦ ')}`);
    });

    if (rows.length > maxRows) console.log(`   ... ще ${rows.length - maxRows} рядк(ів)`);
  }
}
