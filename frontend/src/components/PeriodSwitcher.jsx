import { Select } from './ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { MONTH_NAMES } from '../lib/format.js';

/** Глобальний перемикач звітного місяця - керує періодом одразу на всіх
 * сторінках (Відомість ЗП, Табель, Контроль гектарів тощо), щоб не
 * переставляти місяць окремо на кожній. */
export function PeriodSwitcher() {
  const { year, month, monthLabel, setPeriod, shift } = usePeriod();

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          title="Попередній місяць"
        >
          ←
        </button>
        <span className="text-sm font-medium text-slate-700">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          title="Наступний місяць"
        >
          →
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={month}
          options={MONTH_NAMES.map((name, index) => ({ value: index + 1, label: name }))}
          onChange={(e) => setPeriod(year, Number(e.target.value))}
        />
        <Select
          value={year}
          options={[year - 2, year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }))}
          onChange={(e) => setPeriod(Number(e.target.value), month)}
        />
      </div>
    </div>
  );
}
