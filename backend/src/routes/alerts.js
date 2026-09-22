import { Router } from 'express';
import { getAlerts } from '../services/alertsService.js';

export const alertsRouter = Router();

/** Зведення сповіщень (немаплені OVERSEER/Hecterra, перевищення площі) - для дзвіночка в шапці. */
alertsRouter.get('/', (req, res) => {
  res.json(getAlerts());
});
