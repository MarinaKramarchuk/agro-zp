import { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Modal, Spinner } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { query } from '../lib/api.js';
import {
  UNIT_LABELS,
  dateLabel,
  isWeekend,
  money,
  num,
  weekdayOf,
} from '../lib/format.js';

// Кольори комірок: 0 год — сірий, 1–8 — зелений, >8 — червоний (овертайм)
const CELL_STYLES = {
  empty: 'bg-slate-50 text-slate-300',
  no_hours: 'bg-sky-100 text-sky-800 font-medium',
  normal: 'bg-green-100 text-green-800 font-semibold',
  overtime: 'bg-red-500 text-white font-bold',
};

export function TimesheetPage() {
  const { year, month } = usePeriod();
  const [dayCell, setDayCell] = useState(null); // { employee, date }

  const { data, loading, error, reload } = useQuery(`/timesheet${query({ year, month })}`);

  const { data: dayData, loading: dayLoading } = useQuery(
    dayCell ? `/timesheet/day${query({ employee_id: dayCell.employee.id, date: dayCell.date })}` : null,
  );

  const days = data ? Array.from({ length: data.total_days }, (_, i) => i + 1) : [];

  return (
    <>
      <PageHeader
        title="Табель робочих днів"
        subtitle={`Сума годин за день: 0 — сірий, 1–${data?.normal_shift_hours ?? 8} — зелений, більше — червоний (овертайм).`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/timesheet/export.xlsx${query({ year, month })}`}>
              ⤓ Excel
            </a>
            <button type="button" className="btn-secondary" onClick={reload}>
              Оновити
            </button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className={`rounded px-2 py-1 ${CELL_STYLES.empty}`}>0 год</span>
          <span className={`rounded px-2 py-1 ${CELL_STYLES.normal}`}>1–{data?.normal_shift_hours ?? 8} год</span>
          <span className={`rounded px-2 py-1 ${CELL_STYLES.overtime}`}>овертайм</span>
          <span className={`rounded px-2 py-1 ${CELL_STYLES.no_hours}`}>лист без годин</span>
          <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-amber-800">
            <span aria-hidden>🔧</span> є ремонт
          </span>
        </div>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && data.rows.length === 0 && (
        <EmptyState title="Немає працівників" hint="Додайте працівників у довіднику" />
      )}

      {/* max-h + overflow-auto (замість лише overflow-x-auto) - інакше цей div
          стає власним, але нескінченно високим скрол-контейнером, і sticky
          всередині "прилипає" відносно нього, а не сторінки: візуально не липне. */}
      {data && data.rows.length > 0 && (
        <div className="card max-h-[75vh] overflow-auto">
          {/* border-separate замість зі спадковим border-collapse - інакше sticky
              на th/td у Chrome/Firefox мовчки ігнорується (відомий баг специфікації). */}
          <table className="table-base border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[14rem] bg-slate-50">Працівник</th>
                {days.map((day) => (
                  <th
                    key={day}
                    className={`sticky top-0 z-20 w-12 bg-slate-50 text-center ${isWeekend(year, month, day) ? 'text-red-500' : ''}`}
                  >
                    <div>{day}</div>
                    <div className="text-[10px] font-normal text-slate-400">
                      {weekdayOf(year, month, day)}
                    </div>
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Днів</th>
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Годин</th>
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Овертайм</th>
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Нараховано</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                return (
                  <tr key={row.employee.id}>
                    <td className="sticky left-0 z-10 bg-white">
                      <div>
                        <div className="font-medium text-slate-800">
                          {row.employee.full_name}
                        </div>
                        <div className="text-xs text-slate-500">{row.employee.position}</div>
                      </div>
                    </td>

                    {days.map((day) => {
                      const cell = row.days[day];
                      const clickable = cell.entries > 0;
                      const hasRepair = cell.repair_hours > 0;
                      return (
                        <td key={day} className="p-0.5 text-center">
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => setDayCell({ employee: row.employee, date: cell.date })}
                            className={`relative h-10 w-full rounded text-xs ${CELL_STYLES[cell.status]} ${
                              clickable ? 'cursor-pointer hover:ring-2 hover:ring-green-400' : 'cursor-default'
                            }`}
                            title={
                              clickable
                                ? `${num(cell.hours)} год${hasRepair ? ` (з них ремонт: ${num(cell.repair_hours)})` : ''} · ${money(cell.total_amount)} грн · робіт: ${cell.entries}`
                                : ''
                            }
                          >
                            {hasRepair && (
                              <span className="absolute right-0 top-0 text-[9px] leading-none" aria-hidden>
                                🔧
                              </span>
                            )}
                            {cell.entries === 0 ? '' : num(cell.hours)}
                            {cell.entries > 1 && <sup className="ml-0.5">{cell.entries}</sup>}
                          </button>
                        </td>
                      );
                    })}

                    <td className="text-right tabular-nums">{row.totals.days_worked}</td>
                    <td className="text-right tabular-nums">{num(row.totals.hours)}</td>
                    <td className="text-right tabular-nums text-red-600">
                      {row.totals.overtime_hours > 0 ? num(row.totals.overtime_hours) : '—'}
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      {money(row.totals.total_amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(dayCell)}
        wide
        title={dayCell ? `${dayCell.employee.full_name} · ${dateLabel(dayCell.date)}` : ''}
        onClose={() => setDayCell(null)}
      >
        {dayLoading && <Spinner />}
        {dayData && (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-sm">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                Годин: <span className="font-semibold">{num(dayData.totals.hours)}</span>
              </div>
              {dayData.totals.repair_hours > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  🔧 З них ремонт: <span className="font-semibold">{num(dayData.totals.repair_hours)} год</span>
                </div>
              )}
              {dayData.totals.overtime_hours > 0 && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
                  Понаднормово: <span className="font-semibold">{num(dayData.totals.overtime_hours)} год</span>
                </div>
              )}
              <div className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
                Нараховано: <span className="font-semibold">{money(dayData.totals.total_amount)} грн</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Робота</th>
                    <th>Техніка</th>
                    <th>Поле</th>
                    <th className="text-right">Виробіток</th>
                    <th className="text-right">Год</th>
                    <th className="text-right">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {dayData.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.work_type_name}
                        {item.route_name ? ` · ${item.route_name}` : ''}
                        {item.work_type_is_repair ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            🔧 ремонт
                          </span>
                        ) : null}
                        {item.pay_mode === 'hourly' && (
                          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                            погодинно
                          </span>
                        )}
                        {item.transport_pay === 1 && (
                          <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-xs text-teal-800">
                            транспортні роботи
                          </span>
                        )}
                        {item.work_date !== item.work_date_to && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            {item.work_date} — {item.work_date_to}
                          </span>
                        )}
                        {item.updated_by && <div className="text-xs text-slate-400">вніс: {item.updated_by}</div>}
                      </td>
                      <td>{item.equipment_name ?? '—'}</td>
                      <td>{item.field_name ?? '—'}</td>
                      <td className="text-right tabular-nums">
                        {num(item.quantity)} {UNIT_LABELS[item.unit]}
                      </td>
                      <td className="text-right tabular-nums">{num(item.hours)}</td>
                      <td className="text-right font-medium tabular-nums">
                        {money(item.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
