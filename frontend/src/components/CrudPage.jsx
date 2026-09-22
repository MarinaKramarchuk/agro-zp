import { useState } from 'react';
import { PageHeader } from './Layout.jsx';
import {
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  SearchableSelect,
  Select,
  Spinner,
  Textarea,
  useConfirm,
  useToast,
} from './ui.jsx';
import { api, query } from '../lib/api.js';
import { useQuery } from '../hooks/useQuery.js';

/** Чекбокс-список для поля типу 'multiselect' — значення масив value з options.
 * Для довгих списків (напр. марки техніки) над чекбоксами є пошук по назві. */
function MultiSelectBox({ options, value, onChange, className = '' }) {
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div className={`flex flex-col ${className}`}>
      {options.length > 8 && (
        <input
          type="text"
          className="field-input mb-2 shrink-0"
          placeholder="Пошук…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {filtered.length === 0 && <div className="px-1 py-1 text-sm text-slate-400">Нічого не знайдено</div>}
      {filtered.map((option) => {
        const selected = (value ?? []).map(String).includes(String(option.value));
        return (
          <label key={option.value} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-green-600"
              checked={selected}
              onChange={(e) => {
                const current = value ?? [];
                onChange(
                  e.target.checked
                    ? [...current, option.value]
                    : current.filter((v) => String(v) !== String(option.value)),
                );
              }}
            />
            {option.label}
          </label>
        );
      })}
      </div>
    </div>
  );
}

/**
 * Універсальна сторінка довідника: таблиця + модальна форма створення/редагування.
 *
 * columns: [{ key, label, render?, align? }]
 * fields:  [{ name, label, type: text|number|select|textarea|checkbox|multiselect, options?, required?, hint?, step?, wide?, side?, searchable? }]
 *   multiselect: значення - масив value з options (галочки); порожній масив = не звужувати;
 *   пошук над списком з'являється сам, коли варіантів більше 8
 *   select + searchable: true - той самий Select, але з полем пошуку (SearchableSelect) -
 *   для довгих довідників (вид роботи, марка техніки тощо)
 *   side: true - винести поле в бічну колонку модалки (напр. довгий чекбокс-список),
 *   а не в основну сітку - модалка сама стає ширшою (wide), щоб було місце
 * filters: [{ name, label, options, placeholder? }]
 */
export function CrudPage({
  title,
  subtitle,
  endpoint,
  columns,
  fields,
  filters = [],
  searchable = true,
  defaultValues = {},
  emptyHint,
  extra,
}) {
  const [filterValues, setFilterValues] = useState({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // об'єкт або {} для нового
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  const listPath = `${endpoint}${query({ ...filterValues, q: search || undefined })}`;
  const { data, loading, error, reload } = useQuery(listPath);
  const items = data?.items ?? [];

  const openNew = () => {
    setFormError(null);
    setEditing({ ...defaultValues });
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    // Порожні значення надсилаємо як null, щоб очистити поле в БД
    const payload = {};
    for (const field of fields) {
      const value = editing[field.name];
      if (field.type === 'number') {
        payload[field.name] = value === '' || value === undefined ? null : Number(value);
      } else if (field.type === 'checkbox') {
        payload[field.name] = value ? 1 : 0;
      } else {
        payload[field.name] = value === '' || value === undefined ? null : value;
      }
    }

    try {
      if (editing.id) {
        await api.put(`${endpoint}/${editing.id}`, payload);
        toast('Зміни збережено');
      } else {
        await api.post(endpoint, payload);
        toast('Запис додано');
      }
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    const label = item.full_name ?? item.name ?? `#${item.id}`;
    if (!(await confirm(`Видалити «${label}»?`))) return;

    try {
      await api.del(`${endpoint}/${item.id}`);
      toast('Запис видалено');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <button type="button" className="btn-primary" onClick={openNew}>
            + Додати
          </button>
        }
      />

      {(filters.length > 0 || searchable) && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          {searchable && (
            <Field label="Пошук" className="min-w-[16rem] flex-1">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Почніть вводити…"
              />
            </Field>
          )}
          {filters.map((filter) => (
            <Field key={filter.name} label={filter.label} className="min-w-[12rem]">
              <Select
                options={filter.options}
                placeholder={filter.placeholder ?? 'Усі'}
                value={filterValues[filter.name] ?? ''}
                onChange={(e) =>
                  setFilterValues((prev) => ({ ...prev, [filter.name]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      )}

      {extra}

      <div className="card overflow-x-auto">
        {loading && <Spinner />}
        {error && (
          <div className="p-4">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyState title="Записів немає" hint={emptyHint} />
        )}

        {!loading && !error && items.length > 0 && (
          <table className="table-base">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={column.align === 'right' ? 'text-right' : ''}>
                    {column.label}
                  </th>
                ))}
                <th className="w-32 text-right">Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align === 'right' ? 'text-right tabular-nums' : ''}
                    >
                      {column.render ? column.render(item) : (item[column.key] ?? '—')}
                    </td>
                  ))}
                  <td className="text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                      onClick={() => {
                        setFormError(null);
                        setEditing(item);
                      }}
                    >
                      Змінити
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => remove(item)}
                    >
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        wide={fields.some((f) => f.side)}
        title={editing?.id ? 'Редагування' : 'Новий запис'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              Скасувати
            </button>
            <button type="submit" form="crud-form" className="btn-primary" disabled={saving}>
              {saving ? 'Збереження…' : 'Зберегти'}
            </button>
          </>
        }
      >
        {editing && (
          <form
            id="crud-form"
            onSubmit={save}
            className={
              fields.some((f) => f.side)
                ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]'
                : ''
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.filter((f) => !f.side).map((field) => {
              const value = editing[field.name];
              const onChange = (newValue) =>
                setEditing((prev) => ({ ...prev, [field.name]: newValue }));

              return (
                <Field
                  key={field.name}
                  label={field.label}
                  hint={field.hint}
                  className={field.wide ? 'sm:col-span-2' : ''}
                >
                  {field.type === 'select' && field.searchable ? (
                    <SearchableSelect
                      options={field.options}
                      placeholder={field.required ? 'Виберіть…' : '—'}
                      value={value ?? ''}
                      required={field.required}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  ) : field.type === 'select' ? (
                    <Select
                      options={field.options}
                      placeholder={field.required ? undefined : '—'}
                      value={value ?? ''}
                      required={field.required}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  ) : field.type === 'multiselect' ? (
                    <MultiSelectBox options={field.options} value={value} onChange={onChange} className="max-h-48" />
                  ) : field.type === 'textarea' ? (
                    <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
                  ) : field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      className="mt-2 h-5 w-5 rounded border-slate-300 text-green-600"
                      checked={Boolean(Number(value))}
                      onChange={(e) => onChange(e.target.checked ? 1 : 0)}
                    />
                  ) : (
                    <Input
                      type={field.type === 'number' ? 'number' : 'text'}
                      step={field.step ?? (field.type === 'number' ? '0.01' : undefined)}
                      value={value ?? ''}
                      required={field.required}
                      placeholder={field.placeholder}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  )}
                </Field>
              );
            })}

            {formError && (
              <div className="sm:col-span-2">
                <ErrorBox error={formError} />
              </div>
            )}
            </div>

            {fields.some((f) => f.side) && (
              <div className="flex flex-col gap-4">
                {fields.filter((f) => f.side).map((field) => {
                  const value = editing[field.name];
                  const onChange = (newValue) =>
                    setEditing((prev) => ({ ...prev, [field.name]: newValue }));

                  return (
                    <Field key={field.name} label={field.label} hint={field.hint} className="flex min-h-0 flex-1 flex-col">
                      {field.type === 'multiselect' ? (
                        <MultiSelectBox options={field.options} value={value} onChange={onChange} className="flex-1 lg:max-h-[28rem]" />
                      ) : null}
                    </Field>
                  );
                })}
              </div>
            )}
          </form>
        )}
      </Modal>

      {confirmElement}
    </>
  );
}
