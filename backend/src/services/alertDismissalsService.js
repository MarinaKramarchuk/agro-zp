// "Ігнор-лист" немаплених сповіщень OVERSEER/Hecterra - див. коментар при
// alert_dismissals у schema.sql. Категорії відповідають чотирьом окремим
// "нерозпізнаним" спискам (overseerImportService.listUnmappedMachines,
// hecterra/importService.listUnmappedHecterraDrivers/WorkTypes/Fields), кожен
// з яких додає до свого NOT IN-запиту фільтр по своїй категорії.
import { db } from '../db/index.js';

const insertStmt = db.prepare(
  'INSERT OR IGNORE INTO alert_dismissals (category, value) VALUES (@category, @value)',
);

/** Ховає одну назву з відповідної категорії "нерозпізнаних" назавжди. */
export function dismissAlert(category, value) {
  insertStmt.run({ category, value: String(value) });
}
