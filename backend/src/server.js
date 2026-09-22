import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { backupDatabaseIfNeeded } from './db/backup.js';

// Перевіряємо, що міграція виконана — інакше перші запити падатимуть незрозуміло.
const hasSchema = db
  .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'worklogs'")
  .get().c;

if (!hasSchema) {
  console.error('БД не ініціалізована. Виконайте: npm run db:migrate');
  process.exit(1);
}

// Не блокує старт сервера - копія робиться паралельно, помилка лише логується.
backupDatabaseIfNeeded();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Сервер запущено: http://localhost:${config.port}`);
  console.log(`БД: ${config.dbPath}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Порт ${config.port} вже зайнятий - схоже, програма вже запущена в іншому вікні.`);
    console.log(`Просто відкрийте у браузері: http://localhost:${config.port}`);
  } else {
    console.error('Не вдалося запустити сервер:', err.message);
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
