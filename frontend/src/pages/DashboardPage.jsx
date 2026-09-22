import { Link } from 'react-router-dom';
import { AlertItems } from '../components/AlertsBell.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { ErrorBox, Spinner } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { query } from '../lib/api.js';
import { money, num, today } from '../lib/format.js';

function StatTile({ label, value, hint, to, tone = 'slate' }) {
  const TONES = {
    slate: 'bg-white border-slate-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    amber: 'bg-amber-50 border-amber-200',
  };
  const content = (
    <div className={`card h-full border p-4 ${TONES[tone]}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block transition hover:-translate-y-0.5 hover:shadow-md">
      {content}
    </Link>
  ) : (
    content
  );
}

export function DashboardPage() {
  const { year, month, range, monthLabel } = usePeriod();

  const { data: payroll, error: payrollError, reload: reloadPayroll } = useQuery(`/payroll/summary${query(range)}`);
  const { data: todayWorklogs, error: todayError, reload: reloadToday } = useQuery(
    `/worklogs${query({ date: today(), limit: 1 })}`,
  );
  const { data: fieldControl, error: fieldControlError, reload: reloadFieldControl } = useQuery(
    `/field-control${query(range)}`,
  );
  const { data: repairHours, error: repairError, reload: reloadRepair } = useQuery(
    `/repair-hours${query({ year, month })}`,
  );
  const { data: alerts, error: alertsError, reload: reloadAlerts } = useQuery('/alerts');

  const errors = [payrollError, todayError, fieldControlError, repairError, alertsError].filter(Boolean);
  const reloadAllErrors = () => {
    reloadPayroll();
    reloadToday();
    reloadFieldControl();
    reloadRepair();
    reloadAlerts();
  };

  const repairTotalHours = repairHours
    ? repairHours.rows.reduce((sum, r) => sum + (r.totals.hours ?? 0), 0)
    : null;

  return (
    <>
      <PageHeader title="Огляд" subtitle={`Період: ${monthLabel}`} />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Нараховано за ${monthLabel}`}
          value={payroll ? `${money(payroll.totals.total_amount)} грн` : payrollError ? '—' : <Spinner label="" />}
          hint={
            payroll
              ? `${payroll.totals.employees} працівників`
              : undefined
          }
          to="/payroll"
          tone="green"
        />
        <StatTile
          label="Записів сьогодні"
          value={todayWorklogs ? num(todayWorklogs.totals.count) : todayError ? '—' : <Spinner label="" />}
          to="/worklogs/journal"
        />
        <StatTile
          label={`Ремонт за ${monthLabel}`}
          value={repairTotalHours != null ? `${num(repairTotalHours)} год` : repairError ? '—' : <Spinner label="" />}
          to="/repair-hours"
          tone="amber"
        />
        <StatTile
          label="Поля з перевищенням площі"
          value={fieldControl ? num(fieldControl.totals.fields_with_excess) : fieldControlError ? '—' : <Spinner label="" />}
          hint={fieldControl ? `оранка/посів/обмолот · ${monthLabel}` : undefined}
          to="/field-control"
          tone={fieldControl?.totals.fields_with_excess > 0 ? 'red' : 'slate'}
        />
      </div>

      {errors.length > 0 && (
        <div className="mb-4">
          <ErrorBox error={errors[0]} onRetry={reloadAllErrors} />
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 text-sm font-semibold text-slate-700">Потребує уваги</div>
        {!alerts && !alertsError && <Spinner />}
        {alertsError && <p className="text-sm text-slate-400">Не вдалося завантажити — див. помилку вище.</p>}
        {alerts && <AlertItems items={alerts.items} variant="chips" />}
      </div>
    </>
  );
}
