import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import {
  EmptyState,
  ErrorBox,
  Field,
  Input,
  SearchableSelect,
  Select,
  Spinner,
  Textarea,
  useConfirm,
  useToast,
} from '../components/ui.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { api, query } from '../lib/api.js';
import { getCurrentUserName } from '../lib/currentUser.js';
import { CROP_LABELS, dateLabel, money, today } from '../lib/format.js';

const CROP_OPTIONS = Object.entries(CROP_LABELS).map(([value, label]) => ({ value, label }));

const EMPTY_FORM = {
  id: null,
  plan_date: today(),
  employee_id: '',
  work_type_id: '',
  equipment_id: '',
  field_id: '',
  crop: '',
  note: '',
};

function toPayload(form) {
  return {
    plan_date: form.plan_date,
    employee_id: form.employee_id ? Number(form.employee_id) : null,
    work_type_id: form.work_type_id ? Number(form.work_type_id) : null,
    equipment_id: form.equipment_id ? Number(form.equipment_id) : null,
    field_id: form.field_id ? Number(form.field_id) : null,
    crop: form.crop || null,
    note: form.note || null,
    created_by: form.id ? undefined : getCurrentUserName() || undefined,
    updated_by: getCurrentUserName() || undefined,
  };
}

/** Посилання "Погодити" — веде на форму Реєстрації роботи з передзаповненням
 * із плану, за тим самим патерном, що й перехід із "Даних з техніки"
 * (worklogDraftLink у MachineDataPage.jsx). Обсяг робіт (години/га/...) у
 * плані відсутній — обліковець завжди дозаповнює його з паперового шляхового,
 * заразом підтверджуючи чи виправляючи решту полів. */
function confirmLink(plan) {
  return `/worklogs${query({
    date: plan.plan_date,
    employee_id: plan.employee_id,
    equipment_id: plan.equipment_id ?? undefined,
    field_id: plan.field_id ?? undefined,
    work_type_id: plan.work_type_id,
    crop: plan.crop ?? undefined,
    plan_id: plan.id,
  })}`;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Очікує' },
  { value: 'confirmed', label: 'Погоджено' },
  { value: '', label: 'Усі' },
];

export function WorkPlansPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterStatus, setFilterStatus] = useState('pending');

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const { data: employeesData } = useQuery('/employees');
  const { data: equipmentData } = useQuery('/equipment');
  const { data: fieldsData } = useQuery('/fields');
  const { data: plansData, loading: plansLoading, error: plansError, reload: reloadPlans } = useQuery(
    `/work-plans${query({ employee_id: filterEmployeeId || undefined, status: filterStatus || undefined })}`,
  );

  const employees = employeesData?.items ?? [];
  const equipment = equipmentData?.items ?? [];
  const fields = fieldsData?.items ?? [];
  const plans = plansData?.items ?? [];

  const employee = employees.find((e) => e.id === Number(form.employee_id));
  const { data: workTypesData } = useQuery(`/work-types${query({ staff_group: employee?.staff_group })}`);
  const workTypes = workTypesData?.items ?? [];

  const resetForm = () => setForm(EMPTY_FORM);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (form.id) {
        await api.patch(`/work-plans/${form.id}`, toPayload(form));
        toast('План оновлено');
      } else {
        await api.post('/work-plans', toPayload(form));
        toast('План додано');
      }
      resetForm();
      reloadPlans();
    } catch (error) {
      setSaveError(error);
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const editPlan = (plan) => {
    setSaveError(null);
    setForm({
      id: plan.id,
      plan_date: plan.plan_date,
      employee_id: String(plan.employee_id),
      work_type_id: String(plan.work_type_id),
      equipment_id: plan.equipment_id ? String(plan.equipment_id) : '',
      field_id: plan.field_id ? String(plan.field_id) : '',
      crop: plan.crop ?? '',
      note: plan.note ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removePlan = async (plan) => {
    if (!(await confirm(`Видалити план «${plan.work_type_name}» (${plan.employee_name}, ${dateLabel(plan.plan_date)})?`))) return;
    try {
      await api.del(`/work-plans/${plan.id}`);
      toast('План видалено');
      if (form.id === plan.id) resetForm();
      reloadPlans();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Плани робіт"
        subtitle="Що агроном сказав кому робити — доки не з'явиться шляховий, план лишається тут незавершеним"
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,28rem)_1fr]">
        <form onSubmit={submit} className="card p-5">
          <div className="grid grid-cols-1 gap-4">
            <Field label="Дата">
              <Input type="date" value={form.plan_date} required onChange={(e) => set({ plan_date: e.target.value })} />
            </Field>
            <Field label="Працівник">
              <SearchableSelect
                options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
                value={form.employee_id}
                required
                onChange={(e) => set({ employee_id: e.target.value, work_type_id: '' })}
                placeholder="Оберіть працівника…"
              />
            </Field>
            <Field label="Вид роботи">
              <Select
                options={workTypes.map((w) => ({ value: w.id, label: w.name }))}
                value={form.work_type_id}
                required
                disabled={!form.employee_id}
                placeholder={form.employee_id ? 'Оберіть вид роботи…' : 'Спершу оберіть працівника'}
                onChange={(e) => set({ work_type_id: e.target.value })}
              />
            </Field>
            <Field label="Техніка (необов'язково)">
              <SearchableSelect
                options={equipment.map((e) => ({ value: e.id, label: e.name }))}
                value={form.equipment_id}
                onChange={(e) => set({ equipment_id: e.target.value })}
                placeholder="Не обрано"
              />
            </Field>
            <Field label="Поле (необов'язково)">
              <SearchableSelect
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
                value={form.field_id}
                onChange={(e) => set({ field_id: e.target.value })}
                placeholder="Не обрано"
              />
            </Field>
            <Field label="Культура (необов'язково)">
              <Select options={CROP_OPTIONS} value={form.crop} placeholder="Не обрано" onChange={(e) => set({ crop: e.target.value })} />
            </Field>
            <Field label="Нотатка (необов'язково)" hint="Напр. очікуваний обсяг — «~40 га»">
              <Textarea value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>

          <ErrorBox error={saveError} />

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {form.id ? 'Зберегти зміни' : 'Додати план'}
            </button>
            {form.id && (
              <button type="button" className="btn-secondary" onClick={resetForm}>
                Скасувати редагування #{form.id}
              </button>
            )}
          </div>
        </form>

        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-700">
              Плани {plans.length > 0 && `(${plans.length})`}
            </div>
            <div className="flex flex-wrap gap-2">
              <SearchableSelect
                className="w-56"
                options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                placeholder="Усі працівники"
              />
              <Select
                className="w-40"
                options={STATUS_OPTIONS}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              />
            </div>
          </div>
          {plansLoading && <Spinner />}
          <ErrorBox error={plansError} onRetry={reloadPlans} />
          {!plansLoading && plans.length === 0 && (
            <EmptyState
              title={filterEmployeeId || filterStatus !== 'pending' ? 'Нічого не знайдено за фільтром' : 'Немає незавершених планів'}
              hint={
                filterEmployeeId || filterStatus !== 'pending'
                  ? 'Спробуйте змінити працівника або статус.'
                  : 'Усе заплановане вже підтверджено шляховими листами.'
              }
            />
          )}
          {plans.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-3">Дата</th>
                    <th className="py-2 pr-3">Працівник</th>
                    <th className="py-2 pr-3">Вид роботи</th>
                    <th className="py-2 pr-3">Техніка / поле</th>
                    <th className="py-2 pr-3">Нотатка</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const overdue = plan.plan_date < today();
                    const confirmed = Boolean(plan.confirmed_worklog_id);
                    return (
                      <tr key={plan.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <div>{dateLabel(plan.plan_date)}</div>
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                              confirmed
                                ? 'bg-green-100 text-green-700'
                                : overdue
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {confirmed ? 'Погоджено' : overdue ? 'Прострочено' : 'Очікує'}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{plan.employee_name}</td>
                        <td className="py-2 pr-3">{plan.work_type_name}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {plan.equipment_name ?? '—'} / {plan.field_name ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{plan.note ?? ''}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {confirmed ? (
                              <span className="text-xs text-slate-500">{money(plan.confirmed_amount)} грн</span>
                            ) : (
                              <Link to={confirmLink(plan)} className="btn-primary px-2 py-1 text-xs">
                                Погодити
                              </Link>
                            )}
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => editPlan(plan)}>
                              Редагувати
                            </button>
                            <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => removePlan(plan)}>
                              Видалити
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {confirmElement}
    </>
  );
}
