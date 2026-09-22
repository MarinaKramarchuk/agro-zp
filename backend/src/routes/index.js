import { Router } from 'express';
import { db } from '../db/index.js';
import { alertsRouter } from './alerts.js';
import { employeesRouter } from './employees.js';
import { equipmentRouter } from './equipment.js';
import { fieldControlRouter } from './fieldControl.js';
import { fieldsRouter } from './fields.js';
import { hecterraRouter } from './hecterra.js';
import { overseerRouter } from './overseer.js';
import { payrollRouter } from './payroll.js';
import { repairHoursRouter } from './repairHours.js';
import { routesRouter } from './routes.js';
import { settingsRouter } from './settings.js';
import { tariffsRouter } from './tariffs.js';
import { timesheetRouter } from './timesheet.js';
import { workPlansRouter } from './workPlans.js';
import { workTypesRouter } from './workTypes.js';
import { worklogsRouter } from './worklogs.js';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/** Зведення для головного екрана / перевірки, що довідники заповнені. */
apiRouter.get('/stats', (req, res) => {
  const count = (table, where = '') =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c;

  res.json({
    employees: count('employees'),
    equipment: count('equipment'),
    equipment_models: count('equipment_models'),
    fields: count('fields'),
    work_types: count('work_types'),
    tariff_rates: count('tariff_rates'),
    routes: count('routes'),
    worklogs: count('worklogs'),
  });
});

apiRouter.use('/employees', employeesRouter);
apiRouter.use('/equipment', equipmentRouter);
apiRouter.use('/fields', fieldsRouter);
apiRouter.use('/field-control', fieldControlRouter);
apiRouter.use('/work-types', workTypesRouter);
apiRouter.use('/tariffs', tariffsRouter);
apiRouter.use('/routes', routesRouter);
apiRouter.use('/worklogs', worklogsRouter);
apiRouter.use('/work-plans', workPlansRouter);
apiRouter.use('/timesheet', timesheetRouter);
apiRouter.use('/repair-hours', repairHoursRouter);
apiRouter.use('/payroll', payrollRouter);
apiRouter.use('/overseer', overseerRouter);
apiRouter.use('/hecterra', hecterraRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/settings', settingsRouter);

// Задел на майбутнє: приймання геоданих/площ із системи "Gektera".
apiRouter.post('/integrations/gektera/fields', (req, res) => {
  res.status(501).json({
    error: 'Інтеграція з Gektera ще не реалізована',
    hint: 'Ендпоінт зарезервовано: тут будуть прийматися поля (gektera_field_id, name, area_ha, crop)',
  });
});
