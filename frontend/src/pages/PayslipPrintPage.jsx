import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Field, Input, SearchableSelect, Spinner } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { query } from '../lib/api.js';
import { UNIT_LABELS, dateLabel, money, num } from '../lib/format.js';

const ORG_NAME_KEY = 'agro-zp:org-name';

export function PayslipPrintPage() {
  const [searchParams] = useSearchParams();
  const { range: defaultRange } = usePeriod();

  const [employeeId, setEmployeeId] = useState(searchParams.get('employee_id') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') ?? defaultRange.date_from);
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') ?? defaultRange.date_to);
  const [orgName, setOrgName] = useState(() => localStorage.getItem(ORG_NAME_KEY) ?? '');

  useEffect(() => {
    localStorage.setItem(ORG_NAME_KEY, orgName);
  }, [orgName]);

  const { data: employeesData } = useQuery('/employees');
  const employees = employeesData?.items ?? [];
  const employee = employees.find((e) => e.id === Number(employeeId));

  const reportPath = employeeId
    ? `/payroll/employee/${employeeId}${query({ date_from: dateFrom, date_to: dateTo })}`
    : null;
  const { data: report, loading, error } = useQuery(reportPath);

  return (
    <>
      <PageHeader
        title="Розрахунковий листок"
        subtitle="Нарахування працівнику по днях за період — для видачі/надсилання"
        actions={
          report && (
            <>
              <a
                className="btn-secondary"
                href={`/api/payroll/employee/${employeeId}/export.xlsx${query({ date_from: dateFrom, date_to: dateTo })}`}
              >
                ⤓ Excel
              </a>
              <button type="button" className="btn-primary" onClick={() => window.print()}>
                🖨 Друкувати
              </button>
            </>
          )
        }
      />

      <div className="no-print card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Працівник" className="lg:col-span-2">
          <SearchableSelect
            placeholder="Виберіть працівника"
            value={employeeId}
            options={employees.map((e) => ({
              value: e.id,
              label: `${e.full_name}${e.position ? ` · ${e.position}` : ''}`,
            }))}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
        </Field>
        <Field label="Дата з">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </Field>
        <Field label="Дата по">
          <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
        <Field label="Назва господарства" className="sm:col-span-2 lg:col-span-4" hint="Для шапки бланка; запам'ятовується в цьому браузері">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="напр. ФГ «Приклад»" />
        </Field>
      </div>

      {!employeeId && <EmptyState title="Виберіть працівника" hint="І період — за який сформувати листок" />}
      {loading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {report && report.days.length === 0 && (
        <EmptyState title="Немає записів" hint="За обраний період у цього працівника немає нарахувань" />
      )}

      {report && employee && report.days.length > 0 && (
        <div className="card p-6 text-sm text-slate-900 print:border-0 print:p-4 print:shadow-none">
          <div className="mb-4 flex items-start justify-between border-b border-slate-300 pb-3">
            <div>
              <div className="text-base font-semibold">{orgName || 'Господарство: ____________________'}</div>
              <div className="mt-1 text-slate-600">Розрахунковий листок</div>
            </div>
            <div className="text-right text-slate-600">
              <div>
                Період: {dateLabel(dateFrom)} — {dateLabel(dateTo)}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <span className="text-slate-500">Працівник: </span>
            <b>{employee.full_name}</b>
            {employee.position ? `, ${employee.position}` : ''}
          </div>

          {report.days.map((day) => (
            <div key={day.date} className="mb-3">
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th className="w-28">{dateLabel(day.date)}</th>
                    <th>Робота</th>
                    <th>Техніка / поле</th>
                    <th className="text-right">Обсяг</th>
                    <th className="text-right">Год</th>
                    <th className="text-right">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((item) => (
                    <tr key={item.id}>
                      <td />
                      <td>
                        {item.work_type_name}
                        {item.route_name ? ` · ${item.route_name}` : ''}
                      </td>
                      <td className="text-slate-500">
                        {[item.equipment_name, item.field_name].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {num(item.quantity)} {UNIT_LABELS[item.unit]}
                      </td>
                      <td className="text-right tabular-nums">{item.hours ? num(item.hours) : '—'}</td>
                      <td className="text-right tabular-nums">{money(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={4} className="text-right">
                      Разом за {dateLabel(day.date)}
                      {day.overtime_hours > 0 ? ` (понаднормово ${num(day.overtime_hours)} год)` : ''}:
                    </td>
                    <td className="text-right tabular-nums">{num(day.hours)}</td>
                    <td className="text-right tabular-nums">{money(day.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <table className="table-base mt-4 w-full">
            <tbody>
              <tr className="bg-green-50 text-base font-semibold text-green-900">
                <td>ВСЬОГО за період</td>
                <td className="text-right tabular-nums">{report.totals.days_worked} дн.</td>
                <td className="text-right tabular-nums">{num(report.totals.hours)} год</td>
                <td className="text-right tabular-nums">{money(report.totals.total_amount)} грн</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-6 pt-4 text-sm">
            {['Видав (обліковець)', 'Отримав (працівник)'].map((label) => (
              <div key={label}>
                <div className="text-slate-500">{label}</div>
                <div className="mt-5 border-b border-slate-400" />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
