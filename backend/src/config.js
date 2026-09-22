import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const resolveFromRoot = (p) => (path.isAbsolute(p) ? p : path.resolve(rootDir, p));

const dbPath = resolveFromRoot(process.env.DB_PATH ?? 'data/agro.db');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath,
  // поруч із базою даних, що зараз активна - у тестах DB_PATH вказує на тимчасовий
  // файл поза проєктом, тож і завантаження звітів OVERSEER ідуть туди, а не в
  // справжню backend\data\uploads
  uploadsDir: path.join(path.dirname(dbPath), 'uploads'),
  backupsDir: path.join(path.dirname(dbPath), 'backups'),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // тривалість нормальної зміни (год): понад неї комірка табеля стає червоною
  normalShiftHours: Number(process.env.NORMAL_SHIFT_HOURS ?? 8),
};
