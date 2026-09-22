import fs from 'node:fs';
import path from 'node:path';
import { db } from './index.js';
import { config } from '../config.js';

const KEEP_BACKUPS = 30;
const NAME_RE = /^agro_(\d{4}-\d{2}-\d{2})\.db$/;

const pad = (n) => String(n).padStart(2, '0');
const todayName = () => {
  const d = new Date();
  return `agro_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`;
};

/**
 * Одна резервна копія на календарний день (не на кожен запуск - інакше при
 * частих перезапусках диск засмічується копіями з тим самим вмістом).
 * Через better-sqlite3 db.backup() - безпечно навіть у режимі WAL, на відміну
 * від простого копіювання файлу (пропустило б недописані у WAL зміни).
 * Помилка тут ніколи не має заважати старту сервера - лише лог.
 */
export async function backupDatabaseIfNeeded() {
  try {
    fs.mkdirSync(config.backupsDir, { recursive: true });

    const dest = path.join(config.backupsDir, todayName());
    if (fs.existsSync(dest)) return;

    await db.backup(dest);
    console.log(`Резервна копія БД: ${dest}`);

    const files = fs
      .readdirSync(config.backupsDir)
      .filter((f) => NAME_RE.test(f))
      .sort();
    const stale = files.slice(0, Math.max(0, files.length - KEEP_BACKUPS));
    for (const f of stale) fs.rmSync(path.join(config.backupsDir, f), { force: true });
  } catch (err) {
    console.error('Не вдалося створити резервну копію БД:', err.message);
  }
}
