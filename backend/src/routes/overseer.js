import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import { isoDate, optionalId, parseOrThrow } from '../lib/validate.js';
import { importOverseerFiles, listMachineFacts, listUnmappedMachines } from '../services/overseerImportService.js';
import { dismissAlert } from '../services/alertDismissalsService.js';

const dismissSchema = z.object({ value: z.string().trim().min(1) });

const uploadsDir = config.uploadsDir;
fs.mkdirSync(uploadsDir, { recursive: true });

/**
 * multer/busboy декодує ім'я файлу з multipart-заголовка як latin1 (так велить
 * RFC 2388 для полів без явного RFC 2231-кодування) - реальні кириличні імена
 * від браузера через це псуються ("Китаєць" -> "ÐÐ¸ÑÐ°ÑÑÑ"). Перекодовуємо
 * назад у UTF-8; для ASCII-імен це без ефекту (латинські байти в latin1 і utf8
 * однакові). Побите ім'я файлу тут ламало розпізнавання техніки в overseer-bas,
 * бо назва машини бралась із префікса імені файлу, коли аркуш "Статистика"
 * її не давав.
 */
function fixFilenameEncoding(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const decoded = fixFilenameEncoding(file.originalname);
    const ext = path.extname(decoded) || '.xlsx';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${path.basename(decoded, ext)}__${stamp}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

export const overseerRouter = Router();

/** Завантаження звітів OVERSEER (xlsx, drag-and-drop зі сторінки) -> machine_facts. */
overseerRouter.post('/import', upload.array('files'), async (req, res) => {
  const uploaded = req.files || [];
  if (!uploaded.length) throw badRequest('Не передано жодного файлу');

  const files = uploaded.map((f) => ({
    path: f.path,
    originalName: fixFilenameEncoding(f.originalname),
  }));

  const result = await importOverseerFiles(files);
  res.json(result);
});

const factsFiltersSchema = z.object({
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  equipment_id: optionalId,
  only_unlinked: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).optional(),
});

/** Денні факти по техніці (мотогодини/пробіг/паливо), з позначкою наявності шляхового. */
overseerRouter.get('/facts', (req, res) => {
  res.json({ items: listMachineFacts(parseOrThrow(factsFiltersSchema, req.query)) });
});

/** Назви з OVERSEER, для яких є дані, але немає прив'язаної техніки. */
overseerRouter.get('/unmapped', (req, res) => {
  res.json({ items: listUnmappedMachines() });
});

/** Назавжди приховати одну назву техніки зі сповіщень "нерозпізнана техніка"
 * (дані не чіпає - лише виключає з listUnmappedMachines()). */
overseerRouter.post('/unmapped/dismiss', (req, res) => {
  const { value } = parseOrThrow(dismissSchema, req.body ?? {});
  dismissAlert('overseer_machine', value);
  res.status(204).end();
});
