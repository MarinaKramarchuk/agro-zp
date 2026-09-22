import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Field, SearchableSelect, Spinner, useConfirm, useToast } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { api, query } from '../lib/api.js';
import { dateLabel, num, pad } from '../lib/format.js';

/** Декади місяця — той самий патерн, що у "Відомості ЗП". */
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

export function FieldControlPage() {
  const { year, month, range: globalRange } = usePeriod();
  const [urlFilters, setUrlFilters] = useUrlState({
    date_from: () => globalRange.date_from,
    date_to: () => globalRange.date_to,
    fieldId: '',
    allWorkTypes: '',
  });
  const range = { date_from: urlFilters.date_from, date_to: urlFilters.date_to };
  const { fieldId } = urlFilters;
  const allWorkTypes = urlFilters.allWorkTypes === '1';

  const { data: fieldsData, reload: reloadFields } = useQuery('/fields');
  const fields = fieldsData?.items ?? [];
  const unwatchedFields = fields.filter((f) => !f.is_watched);

  const filters = { ...range, field_id: fieldId || undefined, all_work_types: allWorkTypes ? 1 : undefined };
  const { data, loading, error, reload } = useQuery(`/field-control${query(filters)}`);
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  const reloadAll = () => {
    reload();
    reloadFields();
  };

  const setWatched = async (field, is_watched) => {
    if (!is_watched) {
      const ok = await confirm(`Прибрати «${field.name}» з контролю гектарів?`, {
        confirmLabel: 'Прибрати',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/fields/${field.id}`, { is_watched });
      toast(is_watched ? `«${field.name}» додано до контролю` : `«${field.name}» прибрано з контролю`);
      reloadAll();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Контроль гектарів"
        subtitle={`Перевищення площі — лише оранка, посів, обмолот (разові операції) · ${dateLabel(range.date_from)} — ${dateLabel(range.date_to)}`}
        actions={
          <button type="button" className="btn-secondary" onClick={reload}>
            Оновити
          </button>
        }
      />

      <div className="card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Field label="Поле">
          <SearchableSelect
            placeholder="Усі"
            value={fieldId}
            options={fields.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(e) => setUrlFilters({ fieldId: e.target.value })}
          />
        </Field>

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
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

          <label className="ml-auto flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allWorkTypes}
              onChange={(e) => setUrlFilters({ allWorkTypes: e.target.checked ? '1' : '' })}
            />
            Показати всі види робіт (не лише оранку/посів/обмолот)
          </label>
        </div>
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
        <Field label="Додати поле під контроль" className="min-w-[16rem] flex-1" hint="Список нижче — лише поля, які ви стежите">
          <SearchableSelect
            placeholder={unwatchedFields.length ? 'Знайти поле…' : 'Усі поля вже під контролем'}
            value=""
            disabled={unwatchedFields.length === 0}
            options={unwatchedFields.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(e) => {
              const field = fields.find((f) => f.id === Number(e.target.value));
              if (field) setWatched(field, 1);
            }}
          />
        </Field>
        <span className="pb-2.5 text-sm text-slate-500">
          Під контролем: {fields.length - unwatchedFields.length} з {fields.length}
        </span>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && data.items.length === 0 && (
        <EmptyState
          title="Немає полів під контролем"
          hint="Додайте поля вище — інакше список тут порожній"
        />
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Поле</th>
                <th className="text-right">Площа, га</th>
                <th>Культура поля</th>
                <th>Вид роботи</th>
                <th className="text-right">Оброблено, га</th>
                <th className="text-right">% від площі</th>
                <th className="text-right">Перевищення, га</th>
                <th className="text-right">Записів</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const rows = item.breakdown.length > 0 ? item.breakdown : [null];
                return rows.map((row, index) => (
                  <tr key={`${item.field_id}-${row?.work_type_id ?? 'none'}`}>
                    {index === 0 && (
                      <>
                        <td rowSpan={rows.length} className="align-top font-medium">
                          {item.field_name}
                        </td>
                        <td rowSpan={rows.length} className="align-top text-right tabular-nums">
                          {item.field_area_ha != null ? num(item.field_area_ha) : '—'}
                        </td>
                        <td rowSpan={rows.length} className="align-top text-slate-500">
                          {item.field_crop || '—'}
                        </td>
                      </>
                    )}
                    {row ? (
                      <>
                        <td className={row.is_area_checked ? '' : 'text-slate-400'}>
                          {row.work_type_name}
                          {!row.is_area_checked && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                              не контролюється
                            </span>
                          )}
                        </td>
                        <td className={`text-right tabular-nums ${row.is_area_checked ? '' : 'text-slate-400'}`}>
                          {num(row.worked_ha)}
                        </td>
                        <td className={`text-right tabular-nums ${row.is_area_checked ? '' : 'text-slate-400'}`}>
                          {row.percent_of_field != null ? `${num(row.percent_of_field)}%` : '—'}
                        </td>
                        <td className="text-right tabular-nums">
                          {row.excess_ha > 0 ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                              +{num(row.excess_ha)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={`text-right tabular-nums ${row.is_area_checked ? '' : 'text-slate-400'}`}>
                          {row.entries}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="text-slate-400">
                        {allWorkTypes
                          ? 'Немає записів за цей період'
                          : 'Немає записів з контролем площі за цей період (оранка/посів/обмолот)'}
                      </td>
                    )}
                    {index === 0 && (
                      <td rowSpan={rows.length} className="align-top text-right">
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700"
                          title="Прибрати поле з контролю"
                          onClick={() => setWatched({ id: item.field_id, name: item.field_name }, 0)}
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmElement}
    </>
  );
}
