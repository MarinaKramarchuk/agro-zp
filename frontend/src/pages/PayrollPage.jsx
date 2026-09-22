import { Fragment, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import {
  EmptyState,
  ErrorBox,
  Field,
  Modal,
  SearchableSelect,
  Select,
  SortTh,
  Spinner,
  toggleSort,
  useConfirm,
  useToast,
} from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { api, query } from '../lib/api.js';
import { getCurrentUserName } from '../lib/currentUser.js';
import {
  CROP_LABELS,
  STAFF_GROUPS,
  UNIT_LABELS,
  dateLabel,
  money,
  num,
  pad,
} from '../lib/format.js';

/** Декади місяця — обліковці часто закривають період по 10 днів. */
function decadeRange(year, month, decade) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ranges = {
    1: [1, 10],
    2: [11, 20],
    3: [21, last],
  };
  const [from, to] = ranges[decade];
  return { date_from: `${year}-${pad(month)}-${pad(from)}`, date_to: `${year}-${pad(month)}-${pad(to)}` };
}

export function PayrollPage() {
  const { year, month, monthLabel, range: globalRange } = usePeriod();
  const [urlFilters, setUrlFilters] = useUrlState({
    date_from: () => globalRange.date_from,
    date_to: () => globalRange.date_to,
    employeeId: '',
    staffGroup: '',
  });
  const range = { date_from: urlFilters.date_from, date_to: urlFilters.date_to };
  const { employeeId, staffGroup } = urlFilters;
  const [detailEmployee, setDetailEmployee] = useState(null);
  const [expandedCrops, setExpandedCrops] = useState(() => new Set());
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const { data: lockedPeriods, reload: reloadLocks } = useQuery('/payroll/locked-periods');
  const currentLock = lockedPeriods?.items?.find((p) => p.year === year && p.month === month);

  const toggleLock = async () => {
    if (currentLock) {
      const ok = await confirm(`Відкрити ${monthLabel} для редагування шляхових листів?`, {
        confirmLabel: 'Відкрити',
        danger: false,
      });
      if (!ok) return;
      try {
        await api.del(`/payroll/locked-periods/${year}/${month}`);
        toast(`${monthLabel} відкрито для редагування`);
        reloadLocks();
      } catch (e) {
        toast(e.message, 'error');
      }
      return;
    }

    const ok = await confirm(
      `Закрити ${monthLabel}? Після цього шляхові листи за цей місяць не можна буде створювати, редагувати чи видаляти, доки місяць знову не відкрити.`,
      { confirmLabel: 'Закрити місяць', danger: false },
    );
    if (!ok) return;
    try {
      await api.post('/payroll/locked-periods', { year, month, locked_by: getCurrentUserName() || undefined });
      toast(`${monthLabel} закрито`);
      reloadLocks();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const toggleCrop = (key) => {
    setExpandedCrops((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { data: employeesData } = useQuery('/employees');
  const employees = employeesData?.items ?? [];

  const filters = { ...range, employee_id: employeeId || undefined, staff_group: staffGroup || undefined };
  const { data, loading, error, reload } = useQuery(`/payroll/summary${query(filters)}`);
  const { data: cropData, loading: cropLoading, error: cropError, reload: reloadCrop } = useQuery(
    `/payroll/by-crop${query(filters)}`,
  );

  const { data: detail, loading: detailLoading } = useQuery(
    detailEmployee
      ? `/payroll/employee/${detailEmployee.employee_id}${query({ date_from: range.date_from, date_to: range.date_to })}`
      : null,
  );

  const { data: employeeCropData, loading: employeeCropLoading } = useQuery(
    detailEmployee
      ? `/payroll/by-crop${query({
          employee_id: detailEmployee.employee_id,
          date_from: range.date_from,
          date_to: range.date_to,
        })}`
      : null,
  );

  const totals = data?.totals;

  const NUMERIC_SORT_KEYS = new Set([
    'days_worked', 'hours', 'overtime_hours', 'total_ha', 'total_tons',
    'total_km', 'total_tkm', 'total_trips', 'total_amount',
  ]);
  const sortedItems = useMemo(() => {
    if (!data?.items || !sort.key) return data?.items ?? [];
    const numeric = NUMERIC_SORT_KEYS.has(sort.key);
    const items = [...data.items];
    items.sort((a, b) => {
      const cmp = numeric
        ? (a[sort.key] ?? 0) - (b[sort.key] ?? 0)
        : String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'uk');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort]);

  return (
    <>
      <PageHeader
        title="Відомість нарахування ЗП"
        subtitle={`Період: ${dateLabel(range.date_from)} — ${dateLabel(range.date_to)}`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/payroll/summary.xlsx${query(filters)}`}>
              ⤓ Excel
            </a>
            <a
              className="btn-secondary"
              href={`/api/payroll/bas.xlsx${query({ date_from: range.date_from, date_to: range.date_to })}`}
            >
              ⤓ Вивантажити в BAS
            </a>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              🖨 Друк
            </button>
            <button type="button" className="btn-secondary" onClick={reload}>
              Оновити
            </button>
            <button
              type="button"
              className={currentLock ? 'btn-secondary' : 'btn-primary'}
              onClick={toggleLock}
            >
              {currentLock ? `🔓 Відкрити ${monthLabel}` : `🔒 Закрити ${monthLabel}`}
            </button>
          </>
        }
      />
      {confirmElement}

      {currentLock && (
        <div className="no-print card mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          🔒 {monthLabel} закрито{currentLock.locked_by ? ` (${currentLock.locked_by})` : ''} —
          шляхові листи за цей місяць не можна створювати, редагувати чи видаляти, доки місяць не відкрити.
        </div>
      )}

      <div className="no-print card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Від">
          <input
            type="date"
            className="field-input"
            value={range.date_from}
            onChange={(e) => setUrlFilters({ date_from: e.target.value })}
          />
        </Field>
        <Field label="До">
          <input
            type="date"
            className="field-input"
            value={range.date_to}
            onChange={(e) => setUrlFilters({ date_to: e.target.value })}
          />
        </Field>
        <Field label="Працівник">
          <SearchableSelect
            placeholder="Усі"
            value={employeeId}
            options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
            onChange={(e) => setUrlFilters({ employeeId: e.target.value })}
          />
        </Field>
        <Field label="Група">
          <Select
            placeholder="Усі"
            value={staffGroup}
            options={Object.entries(STAFF_GROUPS).map(([value, label]) => ({ value, label }))}
            onChange={(e) => setUrlFilters({ staffGroup: e.target.value })}
          />
        </Field>

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <span className="pb-2 text-sm text-slate-500">Швидкий вибір:</span>
          <button
            type="button"
            className="btn-secondary py-1.5"
            onClick={() => setUrlFilters({ date_from: globalRange.date_from, date_to: globalRange.date_to })}
          >
            Весь місяць
          </button>
          {[1, 2, 3].map((decade) => (
            <button
              key={decade}
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => setUrlFilters(decadeRange(year, month, decade))}
            >
              {decade}-а декада
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && data.items.length === 0 && (
        <EmptyState title="За цей період немає нарахувань" hint="Перевірте період або внесіть шляхові листи" />
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <SortTh label="ПІБ" sortKey="employee_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortTh label="Посада" sortKey="position" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                <SortTh label="Днів" sortKey="days_worked" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Годин" sortKey="hours" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Овертайм" sortKey="overtime_hours" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Га" sortKey="total_ha" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Тонн" sortKey="total_tons" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Км" sortKey="total_km" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="т·км" sortKey="total_tkm" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Ходок" sortKey="total_trips" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <SortTh label="Разом, грн" sortKey="total_amount" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.employee_id}>
                  <td className="font-medium">{item.employee_name}</td>
                  <td className="text-slate-500">{item.position ?? '—'}</td>
                  <td className="text-right tabular-nums">{item.days_worked}</td>
                  <td className="text-right tabular-nums">{num(item.hours)}</td>
                  <td className="text-right tabular-nums text-red-600">
                    {item.overtime_hours > 0 ? num(item.overtime_hours) : '—'}
                  </td>
                  <td className="text-right tabular-nums">{num(item.total_ha)}</td>
                  <td className="text-right tabular-nums">{num(item.total_tons)}</td>
                  <td className="text-right tabular-nums">{num(item.total_km)}</td>
                  <td className="text-right tabular-nums">{num(item.total_tkm)}</td>
                  <td className="text-right tabular-nums">{num(item.total_trips)}</td>
                  <td className="text-right font-semibold tabular-nums">{money(item.total_amount)}</td>
                  <td className="no-print text-right">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-sm text-green-700 hover:bg-green-50"
                      onClick={() => setDetailEmployee(item)}
                    >
                      Деталі
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={2}>РАЗОМ ({totals.employees})</td>
                <td className="text-right tabular-nums">—</td>
                <td className="text-right tabular-nums">{num(totals.hours)}</td>
                <td className="text-right tabular-nums text-red-600">{num(totals.overtime_hours)}</td>
                <td className="text-right tabular-nums">{num(totals.total_ha)}</td>
                <td className="text-right tabular-nums">{num(totals.total_tons)}</td>
                <td className="text-right tabular-nums">{num(totals.total_km)}</td>
                <td className="text-right tabular-nums">{num(totals.total_tkm)}</td>
                <td className="text-right tabular-nums">{num(totals.total_trips)}</td>
                <td className="text-right tabular-nums">{money(totals.total_amount)}</td>
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-6">
        <PageHeader
          title="Зведення по культурах"
          subtitle="Групування виробітку по культурах за той самий період — клік на рядок розкриває розбивку по працівниках"
          actions={
            <a className="btn-secondary" href={`/api/payroll/by-crop.xlsx${query(filters)}`}>
              ⤓ Excel
            </a>
          }
        />

        {cropLoading && <Spinner />}
        {cropError && <ErrorBox error={cropError} onRetry={reloadCrop} />}

        {cropData && cropData.items.length === 0 && (
          <EmptyState title="За цей період немає записів" hint="Внесіть шляхові листи з культурою" />
        )}

        {cropData && cropData.items.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Культура</th>
                  <th className="text-right">Днів</th>
                  <th className="text-right">Записів</th>
                  <th className="text-right">Годин</th>
                  <th className="text-right">Га</th>
                  <th className="text-right">Тонн</th>
                  <th className="text-right">Км</th>
                  <th className="text-right">т·км</th>
                  <th className="text-right">Ходок</th>
                  <th className="text-right">Разом, грн</th>
                </tr>
              </thead>
              <tbody>
                {cropData.items.map((item) => {
                  const key = item.crop ?? 'none';
                  const expanded = expandedCrops.has(key);
                  return (
                    <Fragment key={key}>
                      <tr className="cursor-pointer hover:bg-slate-50" onClick={() => toggleCrop(key)}>
                        <td className={item.crop ? 'font-medium' : 'font-medium text-slate-400'}>
                          <span className="mr-1.5 inline-block w-3 text-slate-400">{expanded ? '▾' : '▸'}</span>
                          {item.crop_label}
                        </td>
                        <td className="text-right tabular-nums">{item.days_worked}</td>
                        <td className="text-right tabular-nums">{item.entries}</td>
                        <td className="text-right tabular-nums">{num(item.hours)}</td>
                        <td className="text-right tabular-nums">{num(item.total_ha)}</td>
                        <td className="text-right tabular-nums">{num(item.total_tons)}</td>
                        <td className="text-right tabular-nums">{num(item.total_km)}</td>
                        <td className="text-right tabular-nums">{num(item.total_tkm)}</td>
                        <td className="text-right tabular-nums">{num(item.total_trips)}</td>
                        <td className="text-right font-semibold tabular-nums">{money(item.total_amount)}</td>
                      </tr>
                      {expanded &&
                        item.employees.map((emp) => (
                          <tr key={emp.employee_id} className="bg-slate-50/70 text-slate-600">
                            <td className="pl-8">{emp.employee_name}</td>
                            <td className="text-right tabular-nums">{emp.days_worked}</td>
                            <td className="text-right tabular-nums">{emp.entries}</td>
                            <td className="text-right tabular-nums">{num(emp.hours)}</td>
                            <td className="text-right tabular-nums">{num(emp.total_ha)}</td>
                            <td className="text-right tabular-nums">{num(emp.total_tons)}</td>
                            <td className="text-right tabular-nums">{num(emp.total_km)}</td>
                            <td className="text-right tabular-nums">{num(emp.total_tkm)}</td>
                            <td className="text-right tabular-nums">{num(emp.total_trips)}</td>
                            <td className="text-right tabular-nums">{money(emp.total_amount)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td>РАЗОМ</td>
                  <td className="text-right tabular-nums">—</td>
                  <td className="text-right tabular-nums">{cropData.totals.entries}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.hours)}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.total_ha)}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.total_tons)}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.total_km)}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.total_tkm)}</td>
                  <td className="text-right tabular-nums">{num(cropData.totals.total_trips)}</td>
                  <td className="text-right tabular-nums">{money(cropData.totals.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(detailEmployee)}
        wide
        title={detailEmployee ? `Розрахунок: ${detailEmployee.employee_name}` : ''}
        onClose={() => setDetailEmployee(null)}
        footer={
          detailEmployee && (
            <>
              <a
                className="btn-secondary"
                target="_blank"
                rel="noreferrer"
                href={`/payroll/print${query({
                  employee_id: detailEmployee.employee_id,
                  date_from: range.date_from,
                  date_to: range.date_to,
                })}`}
              >
                🖨 Розрахунковий листок
              </a>
              <a
                className="btn-secondary"
                href={`/api/payroll/employee/${detailEmployee.employee_id}/export.xlsx${query({
                  date_from: range.date_from,
                  date_to: range.date_to,
                })}`}
              >
                ⤓ Excel («корінець»)
              </a>
              <button type="button" className="btn-secondary" onClick={() => setDetailEmployee(null)}>
                Закрити
              </button>
            </>
          )
        }
      >
        {detailLoading && <Spinner />}
        {detail && (
          <>
            <div className="mb-4 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-slate-50 px-3 py-2">
                Днів: <b>{detail.totals.days_worked}</b>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-2">
                Годин: <b>{num(detail.totals.hours)}</b>
              </span>
              <span className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
                Понаднормово: <b>{num(detail.totals.overtime_hours)}</b>
              </span>
              <span className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
                Разом: <b>{money(detail.totals.total_amount)} грн</b>
              </span>
            </div>

            <div className="mb-4">
              <div className="mb-1 text-sm font-semibold text-slate-700">Розбивка по культурах</div>
              {employeeCropLoading && <Spinner />}
              {employeeCropData && employeeCropData.items.length === 0 && (
                <div className="text-sm text-slate-400">Немає записів за період</div>
              )}
              {employeeCropData && employeeCropData.items.length > 0 && (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Культура</th>
                      <th className="text-right">Днів</th>
                      <th className="text-right">Годин</th>
                      <th className="text-right">Га</th>
                      <th className="text-right">Тонн</th>
                      <th className="text-right">Разом, грн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeCropData.items.map((item) => (
                      <tr key={item.crop ?? 'none'}>
                        <td className={item.crop ? undefined : 'text-slate-400'}>{item.crop_label}</td>
                        <td className="text-right tabular-nums">{item.days_worked}</td>
                        <td className="text-right tabular-nums">{num(item.hours)}</td>
                        <td className="text-right tabular-nums">{num(item.total_ha)}</td>
                        <td className="text-right tabular-nums">{num(item.total_tons)}</td>
                        <td className="text-right font-medium tabular-nums">{money(item.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {detail.days.map((day) => (
                <div key={day.date} className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-700">
                    <span>
                      {dateLabel(day.date)} · {num(day.hours)} год
                      {day.overtime_hours > 0 && (
                        <span className="ml-2 text-red-600">(+{num(day.overtime_hours)} понаднормово)</span>
                      )}
                    </span>
                    <span className="tabular-nums">{money(day.total_amount)} грн</span>
                  </div>
                  <table className="table-base">
                    <tbody>
                      {day.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.work_type_name}
                            {item.route_name ? ` · ${item.route_name}` : ''}
                            {item.pay_mode === 'hourly' && (
                              <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                                погодинно
                              </span>
                            )}
                            {item.helper_absent === 1 && (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                                хімік 50%
                              </span>
                            )}
                            {item.transport_pay === 1 && (
                              <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-xs text-teal-800">
                                транспортні роботи
                              </span>
                            )}
                          </td>
                          <td className="text-slate-500">{item.equipment_name ?? '—'}</td>
                          <td className="text-slate-500">{item.field_name ?? '—'}</td>
                          <td className="text-slate-500">{item.crop ? CROP_LABELS[item.crop] : '—'}</td>
                          <td className="text-right tabular-nums">
                            {num(item.quantity)} {UNIT_LABELS[item.unit]}
                          </td>
                          <td className="text-right tabular-nums">{num(item.hours)} год</td>
                          <td className="text-right font-medium tabular-nums">
                            {money(item.total_amount)}
                            {item.helper_absent === 1 && (
                              <div className="text-xs font-normal text-amber-700">
                                у т.ч. {money(item.helper_amount)} хімік
                                <br />
                                (Б {money(item.helper_amount_p)} / К {money(item.helper_amount_l)})
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
