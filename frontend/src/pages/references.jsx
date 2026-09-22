import { useState } from 'react';
import { CrudPage } from '../components/CrudPage.jsx';
import { Field, Input, useToast } from '../components/ui.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { api } from '../lib/api.js';
import { getCurrentUserName } from '../lib/currentUser.js';
import { EQUIPMENT_CATEGORIES, STAFF_GROUPS, UNIT_LABELS, money, num } from '../lib/format.js';

const toOptions = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

const STAFF_OPTIONS = toOptions(STAFF_GROUPS);
const CATEGORY_OPTIONS = toOptions(EQUIPMENT_CATEGORIES);
const UNIT_OPTIONS = toOptions(UNIT_LABELS);

const YES_NO = [
  { value: 1, label: 'Так' },
  { value: 0, label: 'Ні' },
];

/** Єдине місце для мінімальної ЗП — щоб не переписувати оклад кожному
 * працівнику вручну щоразу, коли держава її підвищує. Працівники, яким не
 * вказано власний оклад, автоматично рахуються за цим значенням (на майбутні
 * шляхові — вже збережені записи не змінюються).
 * current/onSaved приходять від батька (EmployeesPage), а не окремим
 * useQuery тут - інакше таблиця нижче лишається зі старим значенням, бо
 * useQuery не має спільного кешу між компонентами. */
function MinimumWageCard({ current, onSaved }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch('/settings', {
        minimum_wage: Number(value),
        updated_by: getCurrentUserName() || undefined,
      });
      toast('Мінімальну ЗП оновлено');
      setValue('');
      onSaved();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
      <div>
        <div className="text-sm font-semibold text-slate-700">Мінімальна ЗП</div>
        <div className="text-xs text-slate-500">
          Поточне значення: <span className="font-medium text-slate-700">{money(current)} грн/міс</span> — його
          автоматично отримують працівники, яким не вказано власний оклад.
        </div>
      </div>
      <Field label="Нове значення, грн/міс" className="w-48">
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder={String(current)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <button type="submit" className="btn-primary" disabled={saving || value === ''}>
        Зберегти
      </button>
    </form>
  );
}

/* --- Працівники ------------------------------------------------------------ */
export function EmployeesPage() {
  const { data: settings, reload: reloadSettings } = useQuery('/settings');
  const minimumWage = settings?.minimum_wage ?? 0;

  return (
    <CrudPage
      title="Працівники"
      subtitle="Група визначає, які види робіт і тарифи пропонуються у шляховому листі"
      endpoint="/employees"
      defaultValues={{ staff_group: 'tractor' }}
      extra={<MinimumWageCard current={minimumWage} onSaved={reloadSettings} />}
      columns={[
        { key: 'full_name', label: 'ПІБ' },
        { key: 'position', label: 'Посада' },
        { key: 'staff_group', label: 'Група', render: (i) => STAFF_GROUPS[i.staff_group] },
        {
          key: 'monthly_rate',
          label: 'Оклад, грн/міс',
          align: 'right',
          render: (i) =>
            i.monthly_rate ? (
              num(i.monthly_rate)
            ) : (
              <span className="font-medium text-green-700">{money(minimumWage)} (мін. ЗП)</span>
            ),
        },
        { key: 'bas_code', label: 'Код BAS' },
      ]}
      fields={[
        { name: 'full_name', label: 'ПІБ', required: true, wide: true },
        { name: 'position', label: 'Посада', placeholder: 'Механізатор, Водій ДАФ…' },
        { name: 'staff_group', label: 'Група', type: 'select', options: STAFF_OPTIONS, required: true },
        {
          name: 'monthly_rate',
          label: 'Оклад, грн/місяць',
          type: 'number',
          hint: 'Для запису "Погодинно" у шляховому листі — погодинна ставка вираховується автоматично (оклад / норма годин місяця). Якщо не вказано — автоматично рахується за поточною мінімальною ЗП (картка вище)',
        },
        { name: 'bas_code', label: 'Код водія в BAS', hint: 'Для вивантаження у BAS FOR AGRO' },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
      filters={[{ name: 'staff_group', label: 'Група', options: STAFF_OPTIONS }]}
      emptyHint="Додайте працівників — без них не можна вносити шляхові листи"
    />
  );
}

/* --- Техніка --------------------------------------------------------------- */
export function EquipmentPage() {
  const { data: models } = useQuery('/equipment/models');
  const modelOptions = (models?.items ?? []).map((m) => ({ value: m.id, label: m.label }));

  return (
    <CrudPage
      title="Техніка"
      subtitle="Марка визначає, який тариф підбереться автоматично (МТЗ, Джон Дір, ДАФ…)"
      endpoint="/equipment"
      defaultValues={{ category: 'tractor' }}
      columns={[
        { key: 'name', label: 'Назва / модель' },
        { key: 'plate_number', label: 'Держ. номер' },
        { key: 'category', label: 'Категорія', render: (i) => EQUIPMENT_CATEGORIES[i.category] },
        {
          key: 'model_id',
          label: 'Марка (для тарифів)',
          render: (i) => modelOptions.find((m) => m.value === i.model_id)?.label ?? '—',
        },
        { key: 'overseer_name', label: 'Назва в OVERSEER', render: (i) => i.overseer_name ?? '—' },
        { key: 'bas_code', label: 'Код BAS' },
      ]}
      fields={[
        { name: 'name', label: 'Назва / модель', required: true },
        { name: 'plate_number', label: 'Держ. номер' },
        { name: 'category', label: 'Категорія', type: 'select', options: CATEGORY_OPTIONS, required: true },
        {
          name: 'model_id',
          label: 'Марка з тарифів',
          type: 'select',
          searchable: true,
          options: modelOptions,
          hint: 'Звʼязок із розцінками наказу',
        },
        {
          name: 'overseer_name',
          label: 'Назва в OVERSEER/Hecterra',
          hint: 'Як у аркуші "Статистика" звіту OVERSEER — за нею підтягуються мотогодини/пробіг/паливо і, надалі, поле/га з Hecterra. Зручніше прив’язувати з екрана "Дані з техніки"',
        },
        { name: 'bas_code', label: 'Код техніки в BAS' },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
      filters={[{ name: 'category', label: 'Категорія', options: CATEGORY_OPTIONS }]}
    />
  );
}

/* --- Поля ------------------------------------------------------------------ */
export function FieldsPage() {
  return (
    <CrudPage
      title="Поля"
      subtitle="Площа підставляється у форму; ID Gektera — задел на майбутню інтеграцію"
      endpoint="/fields"
      columns={[
        { key: 'name', label: 'Назва / номер' },
        { key: 'area_ha', label: 'Площа, га', align: 'right', render: (i) => num(i.area_ha) },
        { key: 'crop', label: 'Культура' },
        { key: 'gektera_field_id', label: 'ID Gektera' },
        { key: 'bas_code', label: 'Код BAS' },
      ]}
      fields={[
        { name: 'name', label: 'Назва / номер поля', required: true },
        { name: 'area_ha', label: 'Площа, га', type: 'number' },
        { name: 'crop', label: 'Культура' },
        {
          name: 'gektera_field_id',
          label: 'ID поля в Hecterra',
          hint: 'За ним підтягується оброблена площа з Hecterra в чернетку шляхового',
        },
        { name: 'bas_code', label: 'Код поля в BAS' },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
    />
  );
}

/* --- Види робіт ------------------------------------------------------------ */
export function WorkTypesPage() {
  return (
    <CrudPage
      title="Види робіт"
      subtitle="Розцінки задаються окремо — в довіднику «Тарифи»"
      endpoint="/work-types"
      defaultValues={{
        staff_group: 'tractor',
        requires_field: 0,
        is_repair: 0,
        is_area_checked: 0,
        is_helper_role: 0,
        is_transport_rate: 0,
      }}
      columns={[
        { key: 'name', label: 'Назва роботи' },
        { key: 'staff_group', label: 'Група', render: (i) => STAFF_GROUPS[i.staff_group] },
        { key: 'requires_field', label: 'Поле обовʼязкове', render: (i) => (i.requires_field ? 'Так' : 'Ні') },
        { key: 'is_repair', label: 'Ремонт', render: (i) => (i.is_repair ? 'Так' : 'Ні') },
        {
          key: 'is_area_checked',
          label: 'Контроль площі',
          render: (i) => (i.is_area_checked ? 'Так' : 'Ні'),
        },
        { key: 'is_helper_role', label: 'Хімік/помічник', render: (i) => (i.is_helper_role ? 'Так' : 'Ні') },
        {
          key: 'is_transport_rate',
          label: 'Транспортний тариф',
          render: (i) => (i.is_transport_rate ? 'Так' : 'Ні'),
        },
        { key: 'bas_code', label: 'Код BAS' },
      ]}
      fields={[
        { name: 'name', label: 'Назва роботи', required: true, wide: true },
        { name: 'staff_group', label: 'Група', type: 'select', options: STAFF_OPTIONS, required: true },
        { name: 'requires_field', label: 'Поле обовʼязкове', type: 'select', options: YES_NO, required: true },
        {
          name: 'is_repair',
          label: 'Ремонт',
          type: 'select',
          options: YES_NO,
          required: true,
          hint: 'Позначені записи окремо виділяються в Табелі',
        },
        {
          name: 'is_area_checked',
          label: 'Контроль площі',
          type: 'select',
          options: YES_NO,
          required: true,
          hint: 'Разова операція на все поле (оранка/посів/обмолот) - у "Контролі гектарів" перевіряється на перевищення площі. Роботи, що можуть повторюватись (обприскування, культивація тощо), лишайте "Ні"',
        },
        {
          name: 'is_helper_role',
          label: 'Хімік/помічник',
          type: 'select',
          options: YES_NO,
          required: true,
          hint: 'Тарифи цього виду робіт з\'являються у виборі "тариф хіміка" на формі оприскування (доплата "хімік 50%")',
        },
        {
          name: 'is_transport_rate',
          label: 'Транспортний тариф',
          type: 'select',
          options: YES_NO,
          required: true,
          hint: 'Позначте вид робіт "Транспортні роботи по господарству" — за ним підбирається ставка для чекбокса "Оплатити за транспортним тарифом" у шляховому листі. Має бути позначений рівно один вид робіт.',
        },
        { name: 'bas_code', label: 'Код виду робіт у BAS' },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
      filters={[{ name: 'staff_group', label: 'Група', options: STAFF_OPTIONS }]}
    />
  );
}

/* --- Тарифи ---------------------------------------------------------------- */
export function TariffsPage() {
  const { data: workTypes } = useQuery('/work-types');
  const workTypeOptions = (workTypes?.items ?? []).map((w) => ({
    value: w.id,
    label: `${w.name} · ${STAFF_GROUPS[w.staff_group]}`,
  }));

  const { data: models } = useQuery('/equipment/models');
  const modelOptions = (models?.items ?? []).map((m) => ({ value: m.id, label: m.label }));

  return (
    <CrudPage
      title="Тарифи"
      subtitle="Актуальні розцінки: вид робіт × техніка × інвентар × одиниця виміру, нараховується одній людині"
      endpoint="/tariffs"
      defaultValues={{ unit: 'ha', rate: 0, is_manual: 0, is_default_rate: 0, model_ids: [] }}
      columns={[
        { key: 'work_type_name', label: 'Вид роботи' },
        {
          key: 'model_labels',
          label: 'Марки (підбір у шляховому)',
          render: (i) => i.model_labels ?? <span className="text-slate-400">будь-яка</span>,
        },
        { key: 'implement_label', label: 'Інвентар' },
        { key: 'unit', label: 'Од.', render: (i) => i.unit_label ?? UNIT_LABELS[i.unit] },
        {
          key: 'rate',
          label: 'Ставка, грн',
          align: 'right',
          render: (i) => <span className="font-semibold">{money(i.rate)}</span>,
        },
        {
          key: 'extras',
          label: 'Особливості',
          render: (i) => (
            <span className="text-xs text-slate-500">
              {i.secondary_unit
                ? `+ ${money(i.secondary_rate)} грн/${UNIT_LABELS[i.secondary_unit]}`
                : ''}
              {i.is_manual ? 'сума вручну' : ''}
              {i.is_default_rate ? (i.is_manual ? ', типова ставка' : 'типова ставка') : ''}
              {!i.secondary_unit && !i.is_manual && !i.is_default_rate ? '—' : ''}
            </span>
          ),
        },
      ]}
      fields={[
        {
          name: 'work_type_id',
          label: 'Вид роботи',
          type: 'select',
          searchable: true,
          options: workTypeOptions,
          required: true,
          wide: true,
        },
        {
          name: 'model_ids',
          label: 'Марки техніки',
          type: 'multiselect',
          options: modelOptions,
          side: true,
          hint: 'Саме за цим списком система підбирає розцінку в шляховому листі — порожньо означає "підходить будь-якій техніці цього виду робіт". Щоб додати ще одну марку до вже наявної розцінки (напр. третій комбайн з такою самою ставкою), просто відмітьте її тут — не треба створювати новий рядок тарифу.',
        },
        { name: 'implement_label', label: 'Інвентар', placeholder: 'БЗ 14 м' },
        { name: 'unit', label: 'Одиниця виміру', type: 'select', options: UNIT_OPTIONS, required: true },
        { name: 'rate', label: 'Розцінка, грн', type: 'number', required: true },
        {
          name: 'secondary_unit',
          label: 'Друга складова: одиниця',
          type: 'select',
          options: UNIT_OPTIONS,
          hint: 'Напр. «72,5 грн/год + 5 грн/т» → тут «тонни»',
        },
        { name: 'secondary_rate', label: 'Друга складова, грн', type: 'number' },
        { name: 'is_manual', label: 'Сума вводиться вручну', type: 'select', options: YES_NO },
        {
          name: 'is_default_rate',
          label: 'Типова ставка (без техніки)',
          type: 'select',
          options: YES_NO,
          hint: 'Для тарифу "Транспортні роботи по господарству": ця ставка застосовується, коли в шляховому листі техніку не вказано або вона не належить жодній з марок вище (напр. позначте так ставку МТЗ/Джон Дір).',
        },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
      filters={[
        { name: 'staff_group', label: 'Група', options: STAFF_OPTIONS },
        { name: 'unit', label: 'Одиниця', options: UNIT_OPTIONS },
      ]}
      emptyHint="Додайте тариф вручну кнопкою вище"
    />
  );
}

/* --- Міжміські рейси ------------------------------------------------------- */
export function RoutesPage() {
  const { data: kmRates } = useQuery('/routes/km-rates');

  return (
    <CrudPage
      title="Міжміські рейси"
      subtitle="Фіксована сума за рейс"
      endpoint="/routes"
      defaultValues={{ rate: 0 }}
      columns={[
        { key: 'name', label: 'Маршрут' },
        { key: 'distance_km', label: 'Км (у 2 сторони)', align: 'right', render: (i) => num(i.distance_km) },
        {
          key: 'rate',
          label: 'Сума, грн',
          align: 'right',
          render: (i) => <span className="font-semibold">{money(i.rate)}</span>,
        },
      ]}
      fields={[
        { name: 'name', label: 'Маршрут', required: true, wide: true },
        { name: 'distance_km', label: 'Відстань у дві сторони, км', type: 'number' },
        { name: 'rate', label: 'Грн за рейс', type: 'number', required: true },
        { name: 'note', label: 'Примітка', type: 'textarea', wide: true },
      ]}
      extra={
        kmRates?.items?.length ? (
          <div className="card mb-4 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">
              Ставки грн/км за відстанню (для маршрутів, яких немає в списку)
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {kmRates.items.map((rate) => (
                <span key={rate.id} className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700">
                  {rate.from_km}–{rate.to_km ?? '∞'} км: {num(rate.rate)} грн/км
                </span>
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}
