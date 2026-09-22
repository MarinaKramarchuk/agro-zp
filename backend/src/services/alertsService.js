import { getFieldControl } from './fieldControlService.js';
import { listUnmappedHecterraDrivers, listUnmappedHecterraFields, listUnmappedHecterraWorkTypes } from './hecterra/importService.js';
import { listUnmappedMachines } from './overseerImportService.js';
import { listOverduePlans } from './workPlanService.js';
import { countUnconfirmedWorklogs } from './worklogService.js';

const UNCONFIRMED_WORKLOG_DAYS = 10;

const pad = (n) => String(n).padStart(2, '0');

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    date_from: `${year}-${pad(month)}-01`,
    date_to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/**
 * Агрегує вже наявну detection-логіку (немаплені OVERSEER/Hecterra сутності,
 * перевищення площі поля, прострочені плани робіт) в один список для
 * дзвіночка сповіщень у шапці - щоб ці сигнали було видно з будь-якої
 * сторінки, а не тільки на "Огляді"/"Планах робіт".
 */
export function getAlerts() {
  const fieldControl = getFieldControl(currentMonthRange());

  const candidates = [
    { key: 'overseer_machines', label: 'Техніка з OVERSEER', count: listUnmappedMachines().length, link: '/machine-data' },
    { key: 'hecterra_drivers', label: 'Водії з Hecterra', count: listUnmappedHecterraDrivers().length, link: '/machine-data' },
    { key: 'hecterra_work_types', label: 'Види робіт з Hecterra', count: listUnmappedHecterraWorkTypes().length, link: '/machine-data' },
    { key: 'hecterra_fields', label: 'Поля з Hecterra', count: listUnmappedHecterraFields().length, link: '/machine-data' },
    { key: 'field_excess', label: 'Поля з перевищенням площі', count: fieldControl.totals.fields_with_excess, link: '/field-control' },
    { key: 'overdue_plans', label: 'Прострочені плани робіт', count: listOverduePlans().length, link: '/work-plans' },
    {
      key: 'unconfirmed_worklogs',
      label: 'Непідтверджені шляхові',
      count: countUnconfirmedWorklogs(UNCONFIRMED_WORKLOG_DAYS),
      link: '/worklogs/journal?confirmed=0',
    },
  ];

  const items = candidates.filter((c) => c.count > 0);
  return { items, total: items.reduce((sum, c) => sum + c.count, 0) };
}
