import { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Spinner, useToast } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { api, query } from '../lib/api.js';
import { getCurrentUserName } from '../lib/currentUser.js';
import { isWeekend, money, num, weekdayOf } from '../lib/format.js';

/** Ключ комірки в локальному стані редагування (поки не збережено на blur). */
const cellKey = (employeeId, day) => `${employeeId}:${day}`;

export function RepairHoursPage() {
  const { year, month } = usePeriod();
  const [edits, setEdits] = useState({}); // те, що людина зараз друкує - до збереження на blur
  const [saving, setSaving] = useState({}); // cellKey -> true, поки йде запит

  const { data, error, reload } = useQuery(`/repair-hours${query({ year, month })}`);
  const toast = useToast();

  const days = data ? Array.from({ length: data.total_days }, (_, i) => i + 1) : [];

  const save = async (employeeId, day, rawValue) => {
    const key = cellKey(employeeId, day);
    const hours = rawValue.trim() === '' ? 0 : Number(rawValue.replace(',', '.'));

    if (!Number.isFinite(hours) || hours < 0) {
      toast('Години мають бути невід’ємним числом', 'error');
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      await api.put('/repair-hours', {
        employee_id: employeeId,
        date,
        hours,
        actor: getCurrentUserName() || undefined,
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <>
      <PageHeader
        title="Ремонт — швидке внесення годин"
        subtitle="Як табель: вписуєте години в потрібний день — рахується автоматично і йде в загальний табель"
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={reload}>
              Оновити
            </button>
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        {data && data.repair_types.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {data.repair_types.map((rt) => (
              <span key={rt.id} className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                🔧 {rt.name}: {rt.rate != null ? `${num(rt.rate)} грн/год` : 'немає тарифу'}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <Spinner />}

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
                    className={`sticky top-0 z-20 w-14 bg-slate-50 text-center ${isWeekend(year, month, day) ? 'text-red-500' : ''}`}
                  >
                    <div>{day}</div>
                    <div className="text-[10px] font-normal text-slate-400">{weekdayOf(year, month, day)}</div>
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Годин</th>
                <th className="sticky top-0 z-20 bg-slate-50 text-right">Сума</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const disabled = !row.work_type;
                return (
                  <tr key={row.employee.id}>
                    <td className="sticky left-0 z-10 bg-white">
                      <div className="font-medium text-slate-800">{row.employee.full_name}</div>
                      <div className="text-xs text-slate-500">
                        {row.work_type ? row.work_type.name : 'немає тарифу "ремонт" для цієї групи'}
                      </div>
                    </td>

                    {days.map((day) => {
                      const key = cellKey(row.employee.id, day);
                      const cell = row.days[day];
                      const value = edits[key] ?? (cell.hours ? String(cell.hours) : '');
                      return (
                        <td key={day} className="p-0.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={disabled || saving[key]}
                            value={value}
                            title={
                              disabled
                                ? 'Немає тарифу "ремонт" для цієї групи працівників'
                                : cell.updated_by
                                  ? `вніс: ${cell.updated_by}`
                                  : ''
                            }
                            placeholder="—"
                            className={`h-7 w-14 rounded border text-center text-xs outline-none transition ${
                              disabled
                                ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                                : cell.hours > 0
                                  ? 'border-amber-200 bg-amber-50 font-semibold text-amber-800 focus:border-green-500 focus:ring-2 focus:ring-green-200'
                                  : 'border-slate-200 bg-white focus:border-green-500 focus:ring-2 focus:ring-green-200'
                            }`}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                            onBlur={(e) => {
                              if ((edits[key] ?? null) === null) return;
                              save(row.employee.id, day, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.target.blur();
                            }}
                          />
                        </td>
                      );
                    })}

                    <td className="text-right tabular-nums">{num(row.totals.hours)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(row.totals.total_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
