import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Field, SearchableSelect, Select, SortTh, Spinner, toggleSort, useConfirm, useToast } from '../components/ui.jsx';
import { worklogFormFromRecord } from '../components/WorklogForm.jsx';
import { WorklogModal } from '../components/WorklogModal.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { api, query } from '../lib/api.js';
import { CROP_LABELS, UNIT_LABELS, dateLabel, money, num, pad } from '../lib/format.js';

const PAGE_SIZE = 200;

/** Декади місяця — той самий патерн, що у "Відомості ЗП" / "Контролі гектарів". */
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

const GROUP_OPTIONS = [
  { value: 'field', label: 'По полях' },
  { value: 'equipment', label: 'По техніці' },
  { value: 'employee', label: 'По працівниках' },
];

const CONFIRMED_FILTER_OPTIONS = [
  { value: 'all', label: 'Усі' },
  { value: '1', label: 'Підтверджені' },
  { value: '0', label: 'Непідтверджені' },
];

const GROUP_CONFIG = {
  field: { title: 'Поле', label: (item) => item.field_name ?? 'Без поля' },
  equipment: { title: 'Техніка', label: (item) => item.equipment_name ?? 'Без техніки' },
  employee: { title: 'Працівник', label: (item) => item.employee_name },
};

const ROW_SORT_GETTERS = {
  work_date: (i) => i.work_date,
  employee_name: (i) => i.employee_name ?? '',
  equipment_name: (i) => i.equipment_name ?? '',
  field_name: (i) => i.field_name ?? '',
  work_type_name: (i) => i.work_type_name ?? '',
  crop: (i) => (i.crop ? CROP_LABELS[i.crop] : ''),
  quantity: (i) => i.quantity ?? 0,
  total_amount: (i) => i.total_amount ?? 0,
};
const NUMERIC_ROW_SORT_KEYS = new Set(['quantity', 'total_amount']);

function groupItems(items, groupBy, sort) {
  const { label } = GROUP_CONFIG[groupBy];
  const groups = new Map();

  for (const item of items) {
    const key = label(item);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        items: [],
        entries: 0,
        hours: 0,
        area_ha: 0,
        tons: 0,
        trips: 0,
        total_amount: 0,
      });
    }
    const group = groups.get(key);
    group.items.push(item);
    group.entries += 1;
    group.hours += item.hours ?? 0;
    group.area_ha += item.area_ha ?? 0;
    group.tons += item.tons ?? 0;
    group.trips += item.trips ?? 0;
    group.total_amount += item.total_amount ?? 0;
  }

  const getter = ROW_SORT_GETTERS[sort.key] ?? ROW_SORT_GETTERS.work_date;
  const numeric = NUMERIC_ROW_SORT_KEYS.has(sort.key);
  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      const cmp = numeric ? av - bv : String(av).localeCompare(String(bv), 'uk');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }

  const noneKeys = new Set(['Без поля', 'Без техніки']);
  return [...groups.values()].sort((a, b) => {
    if (noneKeys.has(a.key) !== noneKeys.has(b.key)) return noneKeys.has(a.key) ? 1 : -1;
    return a.key.localeCompare(b.key, 'uk');
  });
}

export function WorklogsJournalPage() {
  const { year, month, range: globalRange } = usePeriod();
  const [filters, setFilters] = useUrlState({
    date_from: () => globalRange.date_from,
    date_to: () => globalRange.date_to,
    groupBy: 'employee',
    confirmed: 'all',
    employee: '',
    field: '',
  });
  const range = { date_from: filters.date_from, date_to: filters.date_to };
  const [offset, setOffset] = useState(0);
  const [accumulated, setAccumulated] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'work_date', dir: 'asc' });

  // Зміна діапазону/фільтрів (не групування — воно клієнтське) — почати з першої сторінки
  // й скинути вибір (записи, що були на екрані, могли зникнути з вибірки).
  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [range.date_from, range.date_to, filters.confirmed, filters.employee, filters.field]);

  const { data: employeesData } = useQuery('/employees');
  const { data: fieldsData } = useQuery('/fields');
  const employees = employeesData?.items ?? [];
  const fields = fieldsData?.items ?? [];

  const queryFilters = {
    ...range,
    limit: PAGE_SIZE,
    offset,
    ...(filters.confirmed !== 'all' ? { confirmed: filters.confirmed } : {}),
    ...(filters.employee ? { employee_id: filters.employee } : {}),
    ...(filters.field ? { field_id: filters.field } : {}),
  };
  const { data, loading, error, reload } = useQuery(`/worklogs${query(queryFilters)}`);

  useEffect(() => {
    if (!data) return;
    setAccumulated((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const total = data?.total ?? accumulated.length;
  const hasMore = accumulated.length < total;
  const exportFilters = { ...queryFilters, limit: undefined, offset: undefined };

  const groups = useMemo(() => groupItems(accumulated, filters.groupBy, sort), [accumulated, filters.groupBy, sort]);

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  /** Скидає на першу сторінку й перезавантажує — щоб не задвоювати вже підвантажені рядки. */
  const reloadFromStart = () => {
    if (offset === 0) reload();
    else setOffset(0);
  };

  const removeItem = async (item) => {
    if (!(await confirm(`Видалити запис «${item.work_type_name}» (${item.employee_name}) за ${dateLabel(item.work_date)}?`))) {
      return;
    }
    try {
      await api.del(`/worklogs/${item.id}`);
      toast('Запис видалено');
      reloadFromStart();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const toggleConfirmed = async (item) => {
    if (item.confirmed === 1) {
      const ok = await confirm(
        `Зняти підтвердження звірки для запису «${item.work_type_name}» (${item.employee_name}) за ${dateLabel(item.work_date)}?`,
        { confirmLabel: 'Зняти', danger: false },
      );
      if (!ok) return;
    }
    try {
      await api.patch(`/worklogs/${item.id}`, { confirmed: item.confirmed ? 0 : 1 });
      toast(item.confirmed ? 'Знято підтвердження' : 'Підтверджено шляховим листом');
      reloadFromStart();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupSelected = (group) => {
    const allSelected = group.items.every((i) => selected.has(i.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of group.items) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  };

  const bulkConfirm = async (confirmed) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirmed) {
      const ok = await confirm(`Зняти підтвердження звірки з ${ids.length} вибраних записів?`, {
        confirmLabel: 'Зняти',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await api.patch('/worklogs/bulk-confirm', { ids, confirmed: confirmed ? 1 : 0 });
      toast(confirmed ? `Підтверджено ${ids.length} записів` : `Знято підтвердження з ${ids.length} записів`);
      setSelected(new Set());
      reloadFromStart();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Журнал робіт"
        subtitle={`Усі записи, згруповані за вибором · ${dateLabel(range.date_from)} — ${dateLabel(range.date_to)}`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/worklogs/export.xlsx${query(exportFilters)}`}>
              ⤓ Excel
            </a>
            <button type="button" className="btn-secondary" onClick={reloadFromStart}>
              Оновити
            </button>
          </>
        }
      />

      <div className="card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Від">
          <input
            type="date"
            className="field-input"
            value={range.date_from}
            onChange={(e) => setFilters({ date_from: e.target.value })}
          />
        </Field>
        <Field label="До">
          <input
            type="date"
            className="field-input"
            value={range.date_to}
            onChange={(e) => setFilters({ date_to: e.target.value })}
          />
        </Field>
        <Field label="Групувати">
          <Select value={filters.groupBy} options={GROUP_OPTIONS} onChange={(e) => setFilters({ groupBy: e.target.value })} />
        </Field>
        <Field label="Підтвердження">
          <Select
            value={filters.confirmed}
            options={CONFIRMED_FILTER_OPTIONS}
            onChange={(e) => setFilters({ confirmed: e.target.value })}
          />
        </Field>
        <Field label="Працівник">
          <SearchableSelect
            placeholder="Усі працівники"
            value={filters.employee}
            options={employees.map((e) => ({
              value: e.id,
              label: `${e.full_name}${e.position ? ` · ${e.position}` : ''}`,
            }))}
            onChange={(e) => setFilters({ employee: e.target.value })}
          />
        </Field>
        <Field label="Поле">
          <SearchableSelect
            placeholder="Усі поля"
            value={filters.field}
            options={fields.map((f) => ({
              value: f.id,
              label: `${f.name}${f.area_ha ? ` · ${num(f.area_ha)} га` : ''}`,
            }))}
            onChange={(e) => setFilters({ field: e.target.value })}
          />
        </Field>

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <span className="pb-2 text-sm text-slate-500">Швидкий вибір:</span>
          <button
            type="button"
            className="btn-secondary py-1.5"
            onClick={() => setFilters({ date_from: globalRange.date_from, date_to: globalRange.date_to })}
          >
            Весь місяць
          </button>
          {[1, 2, 3].map((decade) => (
            <button
              key={decade}
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => setFilters(decadeRange(year, month, decade))}
            >
              {decade}-а декада
            </button>
          ))}
        </div>
      </div>

      {loading && offset === 0 && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reloadFromStart} />}

      {data && accumulated.length === 0 && (
        <EmptyState title="Немає записів" hint="За обраний період записів ще немає" />
      )}

      {data && accumulated.length > 0 && (
        <div className="space-y-3">
          {selected.size > 0 && (
            <div className="card flex flex-wrap items-center gap-3 border-green-200 bg-green-50 p-3">
              <span className="text-sm font-medium text-green-900">Вибрано: {selected.size}</span>
              <button type="button" className="btn-primary py-1.5" onClick={() => bulkConfirm(true)}>
                ✓ Підтвердити вибрані
              </button>
              <button type="button" className="btn-secondary py-1.5" onClick={() => bulkConfirm(false)}>
                – Зняти підтвердження
              </button>
              <button
                type="button"
                className="ml-auto text-sm text-slate-500 hover:text-slate-700"
                onClick={() => setSelected(new Set())}
              >
                Скасувати вибір
              </button>
            </div>
          )}

          {groups.map((group) => (
            <details key={group.key} className="card overflow-hidden" open>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                <span>
                  {GROUP_CONFIG[filters.groupBy].title}: {group.key}
                  <span className="ml-2 font-normal text-slate-500">· {group.entries} записів</span>
                </span>
                <span className="flex flex-wrap gap-3 font-normal text-slate-600">
                  {group.hours > 0 && <span>{num(group.hours)} год</span>}
                  {group.area_ha > 0 && <span>{num(group.area_ha)} га</span>}
                  {group.tons > 0 && <span>{num(group.tons)} т</span>}
                  {group.trips > 0 && <span>{num(group.trips)} ходок</span>}
                  <span className="font-semibold text-slate-800">{money(group.total_amount)} грн</span>
                </span>
              </summary>

              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <input
                          type="checkbox"
                          checked={group.items.length > 0 && group.items.every((i) => selected.has(i.id))}
                          onChange={() => toggleGroupSelected(group)}
                          aria-label={`Вибрати всі в групі «${group.key}»`}
                        />
                      </th>
                      <SortTh label="Дата" sortKey="work_date" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Працівник" sortKey="employee_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Техніка" sortKey="equipment_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Поле" sortKey="field_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Вид роботи" sortKey="work_type_name" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Культура" sortKey="crop" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k))} />
                      <SortTh label="Обсяг" sortKey="quantity" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                      <SortTh label="Сума, грн" sortKey="total_amount" sort={sort} onSort={(k) => setSort((s) => toggleSort(s, k, 'desc'))} align="right" />
                      <th title="Звірено з паперовим шляховим листом водія">Звірено</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            onChange={() => toggleSelected(item.id)}
                            aria-label={`Вибрати запис за ${dateLabel(item.work_date)}`}
                          />
                        </td>
                        <td className="whitespace-nowrap">
                          {dateLabel(item.work_date)}
                          {item.work_date !== item.work_date_to ? ` — ${dateLabel(item.work_date_to)}` : ''}
                          {item.updated_by && <div className="text-xs text-slate-400">вніс: {item.updated_by}</div>}
                        </td>
                        <td>{item.employee_name}</td>
                        <td className="text-slate-500">{item.equipment_name ?? '—'}</td>
                        <td className="text-slate-500">{item.field_name ?? '—'}</td>
                        <td>
                          {item.work_type_name}
                          {item.route_name ? ` · ${item.route_name}` : ''}
                          {item.helper_absent === 1 && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                              хімік 50%
                            </span>
                          )}
                          {item.transport_pay === 1 && (
                            <span className="ml-1.5 rounded bg-teal-100 px-1.5 py-0.5 text-xs text-teal-800">
                              транспортні роботи
                            </span>
                          )}
                        </td>
                        <td className="text-slate-500">{item.crop ? CROP_LABELS[item.crop] : '—'}</td>
                        <td className="text-right tabular-nums whitespace-nowrap">
                          {num(item.quantity)} {UNIT_LABELS[item.unit]}
                        </td>
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
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => toggleConfirmed(item)}
                            title={item.confirmed === 1 ? 'Підтверджено шляховим листом — клік, щоб зняти' : 'Не підтверджено — клік, щоб підтвердити'}
                            className={
                              item.confirmed === 1
                                ? 'rounded bg-green-100 px-2 py-0.5 text-sm font-medium text-green-800 hover:bg-green-200'
                                : 'rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-400 hover:bg-slate-200'
                            }
                          >
                            {item.confirmed === 1 ? '✓' : '–'}
                          </button>
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-sm text-green-700 hover:bg-green-50"
                            onClick={() => setEditingItem(item)}
                          >
                            Редагувати
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => removeItem(item)}
                          >
                            Видалити
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}

          {hasMore && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
              >
                {loading ? 'Завантаження…' : `Показати ще (${accumulated.length} з ${total})`}
              </button>
            </div>
          )}
        </div>
      )}

      <WorklogModal
        open={Boolean(editingItem)}
        initialForm={editingItem ? worklogFormFromRecord(editingItem) : null}
        hecterraHintHa={editingItem?.area_ha_auto ?? null}
        onClose={() => setEditingItem(null)}
        onSaved={reloadFromStart}
      />

      {confirmElement}
    </>
  );
}
