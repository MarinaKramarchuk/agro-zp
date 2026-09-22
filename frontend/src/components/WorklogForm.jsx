import { useEffect, useMemo, useState } from 'react';
import {
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  SearchableSelect,
  Spinner,
  Textarea,
  useConfirm,
  useToast,
} from './ui.jsx';
import { api, query } from '../lib/api.js';
import { useQuery } from '../hooks/useQuery.js';
import { CARGO_TYPE_LABELS, CROP_LABELS, METRIC_LABELS, UNIT_LABELS, money, num, today } from '../lib/format.js';
import { findDuplicateWorklog } from '../lib/worklogDuplicate.js';
import { getCurrentUserName } from '../lib/currentUser.js';

const UNIT_OPTIONS = Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }));
const CROP_OPTIONS = Object.entries(CROP_LABELS).map(([value, label]) => ({ value, label }));
const CARGO_TYPE_OPTIONS = Object.entries(CARGO_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export const EMPTY_WORKLOG_FORM = {
  id: null,
  work_date: today(),
  work_date_to: '',
  employee_id: '',
  work_type_id: '',
  tariff_rate_id: '',
  equipment_id: '',
  field_id: '',
  hecterra_activity_id: '',
  plan_id: '',
  crop: '',
  cargo_type: '',
  route_id: '',
  pay_mode: 'tariff',
  unit: '',
  manual_rate: '',
  hours: '',
  area_ha: '',
  tons: '',
  distance_km: '',
  cargo_tons: '',
  trips: '',
  bales: '',
  days: '',
  manual_amount: '',
  helper_absent: 0,
  helper_tariff_rate_id: '',
  transport_pay: 0,
  note: '',
};

const isRouteWork = (name) => /рейс|маршрут/i.test(name ?? '');

// Сентинел у полі "Маршрут" — коли потрібного маршруту немає в довіднику
// (напр. міжнародний рейс ДАФ) і розцінку/кілометри вводять вручну.
const MANUAL_ROUTE = '__manual__';

/** Перетворює вже збережений запис (з Журналу робіт або бічної панелі "Записи
 * за дату") на форму для редагування - визначає ручну розцінку/ручний маршрут
 * і зливає з порожньою формою, щоб відсутні в записі поля не лишали "undefined". */
export function worklogFormFromRecord(item) {
  const isManualRate = item.pay_mode === 'tariff' && !item.tariff_rate_id && !item.route_id;
  const isManualRouteItem = isManualRate && isRouteWork(item.work_type_name);
  return {
    ...EMPTY_WORKLOG_FORM,
    ...Object.fromEntries(
      Object.keys(EMPTY_WORKLOG_FORM).map((key) => [key, item[key] === null || item[key] === undefined ? '' : item[key]]),
    ),
    route_id: isManualRouteItem ? MANUAL_ROUTE : (item.route_id ?? ''),
    manual_rate: isManualRate ? item.rate : '',
    id: item.id,
    work_date: item.work_date,
    // не входить у EMPTY_WORKLOG_FORM (не надсилається в payload) - лише щоб
    // WorklogForm міг одразу ініціалізувати ним свій helperWorkTypeId, коли
    // форма приходить через initialForm (WorklogModal), а не через editItem
    // всередині самої форми (де це робиться окремим setHelperWorkTypeId).
    helper_work_type_id: item.helper_absent === 1 ? (item.helper_work_type_id ?? '') : '',
  };
}

/** Числові поля -> число або null; порожні рядки прибираємо. */
export function toPayload(form) {
  const numeric = [
    'employee_id', 'work_type_id', 'tariff_rate_id', 'equipment_id', 'field_id', 'hecterra_activity_id', 'plan_id',
    'hours', 'area_ha', 'tons', 'distance_km', 'cargo_tons', 'trips', 'bales', 'days',
    'manual_amount', 'manual_rate', 'helper_tariff_rate_id',
  ];

  const payload = {
    work_date: form.work_date,
    work_date_to: form.work_date_to || null,
    pay_mode: form.pay_mode === 'hourly' ? 'hourly' : 'tariff',
    unit: form.unit || undefined,
    crop: form.crop || null,
    cargo_type: form.cargo_type || null,
    route_id: form.route_id && form.route_id !== MANUAL_ROUTE ? Number(form.route_id) : null,
    helper_absent: form.helper_absent ? 1 : 0,
    transport_pay: form.transport_pay ? 1 : 0,
    note: form.note || null,
    // created_by шлється лише при створенні - на редагуванні поле відсутнє
    // в payload, тож на бекенді не перетирає вже збережене значення.
    created_by: form.id ? undefined : getCurrentUserName() || undefined,
    updated_by: getCurrentUserName() || undefined,
  };
  for (const key of numeric) {
    payload[key] = form[key] === '' || form[key] === null ? null : Number(form[key]);
  }
  return payload;
}

const BANNER_TEXT = {
  plan: 'Форму заповнено з планової роботи — перевірте й підтвердіть або скоригуйте дані, тоді впишіть фактичні показники з шляхового.',
  draft: 'Форму заповнено даними з техніки (дата, машина, мотогодини/пробіг) — перевірте й дозаповніть працівника, поле, гектари та вид роботи.',
};

/**
 * Форма шляхового листа — підбір тарифу/маршруту, live-розрахунок суми,
 * перевірка дублів, бічна панель "Записи за дату". Використовується і як
 * повноцінна сторінка "Реєстрація роботи" (WorklogPage.jsx), і як вміст
 * модального вікна (WorklogModal.jsx) з Журналу робіт/Даних з техніки —
 * тому стан ініціюється пропсами, а не query-рядком напряму.
 */
export function WorklogForm({
  initialForm,
  source = null,
  hecterraHintHa: initialHecterraHintHa = null,
  hecterraFieldHint = null,
  onSaved,
  continuous = true,
  onCancel,
}) {
  const [form, setForm] = useState(initialForm);
  const [hecterraHintHa, setHecterraHintHa] = useState(initialHecterraHintHa);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(null);

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const { data: employeesData } = useQuery('/employees');
  const { data: equipmentData } = useQuery('/equipment');
  const { data: fieldsData } = useQuery('/fields');
  const { data: routesData } = useQuery('/routes');
  const { data: unitsData } = useQuery('/work-types/units');
  const { data: settingsData } = useQuery('/settings');

  const employees = employeesData?.items ?? [];
  const equipment = equipmentData?.items ?? [];
  const fields = fieldsData?.items ?? [];
  const routes = routesData?.items ?? [];
  const unitsMeta = useMemo(
    () => Object.fromEntries((unitsData?.items ?? []).map((u) => [u.unit, u])),
    [unitsData],
  );

  const employee = employees.find((e) => e.id === Number(form.employee_id));
  const isHourly = form.pay_mode === 'hourly';

  // Види робіт — за групою обраного працівника (водій / тракторист)
  const { data: workTypesData } = useQuery(
    `/work-types${query({ staff_group: employee?.staff_group })}`,
  );
  const workTypes = workTypesData?.items ?? [];
  const workType = workTypes.find((w) => w.id === Number(form.work_type_id));

  // Варіанти тарифів для роботи (з урахуванням обраної техніки)
  const ratesPath = form.work_type_id && !isHourly
    ? `/work-types/${form.work_type_id}/rates${query({ equipment_id: form.equipment_id || undefined })}`
    : null;
  const { data: ratesData, loading: ratesLoading } = useQuery(ratesPath);
  const rates = ratesData?.items ?? [];

  const isRoute = isRouteWork(workType?.name);
  // Транспортний тариф прямо як основний вид робіт (напр. САЗ везе полову чи
  // зерновідходи, оплата годинна) - тонаж і вид вантажу фіксуємо для обліку,
  // на суму не впливають.
  const isSazTransportWork = Boolean(workType?.is_transport_rate);
  const showManualRate = Boolean(form.work_type_id) && !isHourly && !isRoute && rates.length === 0;
  const isManualRoute = form.route_id === MANUAL_ROUTE;
  const route = routes.find((r) => r.id === Number(form.route_id));
  const rate = rates.find((r) => r.id === Number(form.tariff_rate_id));

  // Один варіант тарифу — обираємо автоматично
  useEffect(() => {
    if (rates.length === 1 && !form.tariff_rate_id) set({ tariff_rate_id: rates[0].id });
    if (form.tariff_rate_id && !rates.some((r) => r.id === Number(form.tariff_rate_id))) {
      set({ tariff_rate_id: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesPath, ratesData]);

  // "Хімік 50%" — доплата водієві за відсутнього хіміка: 50% від обраного
  // тарифу хіміка за area_ha. Недоступно для погодинної оплати й для самого
  // виду роботи хіміка (щоб хімік не нараховував доплату сам собі).
  const [helperWorkTypeId, setHelperWorkTypeId] = useState(initialForm?.helper_work_type_id ?? '');
  const { data: helperWorkTypesData } = useQuery('/work-types?is_helper_role=1');
  const helperWorkTypes = helperWorkTypesData?.items ?? [];
  const helperRatesPath = helperWorkTypeId ? `/work-types/${helperWorkTypeId}/rates` : null;
  const { data: helperRatesData, loading: helperRatesLoading } = useQuery(helperRatesPath);
  const helperRates = helperRatesData?.items ?? [];
  const showHelperBonus = !isHourly && Boolean(workType) && !workType.is_helper_role && !form.transport_pay;

  // Оплата за транспортним тарифом — фактичний вид робіт і обсяг (напр.
  // area_ha) лишаються як завжди, але сума рахується як hours × ставка
  // тарифу "Транспортні роботи по господарству" (підбирається на бекенді за
  // технікою, з фолбеком на "типову ставку", якщо техніку не вказано чи вона
  // не підходить під жодну групу). Взаємовиключна з доплатою "хімік 50%".
  const showTransportPay = !isHourly && Boolean(workType) && !workType.is_transport_rate && !form.helper_absent;

  // Один варіант розцінки хіміка — обираємо автоматично, за тим самим
  // патерном, що й для основної розцінки вище. Чистимо обраний тариф лише
  // коли список ТОЧНО завантажений (!helperRatesLoading) - інакше під час
  // редагування запису з доплатою короткий момент, поки /work-types/:id/rates
  // ще не відповів (helperRates=[]), хибно виглядав би як "тарифу нема" і
  // стирав би вже збережений helper_tariff_rate_id ще до дій користувача.
  useEffect(() => {
    if (helperRatesLoading) return;
    if (helperRates.length === 1 && !form.helper_tariff_rate_id) set({ helper_tariff_rate_id: helperRates[0].id });
    if (form.helper_tariff_rate_id && !helperRates.some((r) => r.id === Number(form.helper_tariff_rate_id))) {
      set({ helper_tariff_rate_id: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperRatesPath, helperRatesData, helperRatesLoading]);

  // Обраний тариф хіміка й вид роботи хіміка чистимо, коли галочку явно
  // знято (helper_absent сама скидається лише в onChange - способу оплати
  // й виду роботи, - НЕ тут: showHelperBonus залежить від workType, який
  // короткий час після відкриття форми на редагування ще не завантажений,
  // і хибне "недоступно" стерло б уже збережену доплату ще до дій людини).
  useEffect(() => {
    if (!form.helper_absent) {
      if (form.helper_tariff_rate_id) set({ helper_tariff_rate_id: '' });
      if (helperWorkTypeId) setHelperWorkTypeId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.helper_absent]);

  // Ручна розцінка: типова одиниця виміру, коли поле ще порожнє; і очищення
  // залишкових значень, коли розділ не показується (щоб не перекрити тариф/маршрут)
  useEffect(() => {
    if (showManualRate) {
      if (!form.unit) set({ unit: 'ha' });
    } else if (!isManualRoute && form.manual_rate !== '') {
      set({ manual_rate: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showManualRate, isManualRoute]);

  // Маршруту немає в довіднику: рахуємо як "рейс" (ходка), 1 ходка типово
  useEffect(() => {
    if (isManualRoute) {
      if (form.unit !== 'trip') set({ unit: 'trip' });
      if (!form.trips) set({ trips: '1' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualRoute]);

  const estimateFromKm = async () => {
    setEstimateError(null);
    setEstimating(true);
    try {
      const result = await api.get(`/routes/estimate${query({ distance_km: form.distance_km })}`);
      set({ manual_rate: result.rate });
    } catch (error) {
      setEstimateError(error.message);
    } finally {
      setEstimating(false);
    }
  };

  // Які показники виробітку показувати
  const activeUnit = isHourly ? 'hour' : route ? 'trip' : isManualRoute ? 'trip' : showManualRate ? form.unit : rate?.unit;
  const metricFields = useMemo(() => {
    if (isHourly) return ['hours'];
    const list = new Set(['hours']);
    for (const unit of [activeUnit, rate?.secondary_unit]) {
      if (unit) for (const metric of unitsMeta[unit]?.required_metrics ?? []) list.add(metric);
    }
    // Міжміський рейс (ДАФ): поки оплата й далі за ходкою, але вантаж і
    // відстань фіксуємо вже зараз — знадобляться, коли узгодять розцінку
    // грн/т·км (розрахунок суми це поки не зачіпає, unit лишається 'trip').
    if (isRoute || isManualRoute) {
      list.add('cargo_tons');
      if (!isManualRoute) list.add('distance_km');
    }
    // Рейс САЗ (полова/зерновідходи): тонаж не впливає на суму (тариф
    // годинний), фіксуємо лише для обліку - коли відомий.
    if (isSazTransportWork) list.add('tons');
    return [...list];
  }, [isHourly, activeUnit, rate?.secondary_unit, unitsMeta, isRoute, isManualRoute, isSazTransportWork]);

  // Розрахунок «на льоту»
  const previewKey = JSON.stringify({
    ...toPayload(form),
    work_date: undefined,
    note: undefined,
    id: undefined,
  });

  useEffect(() => {
    if (!form.employee_id || !form.work_type_id) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        setPreview(await api.post('/worklogs/preview', toPayload(form)));
        setPreviewError(null);
      } catch (error) {
        setPreview(null);
        setPreviewError(error);
      }
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // Записи за обрану дату
  const { data: dayData, loading: dayLoading, reload: reloadDay } = useQuery(
    `/worklogs${query({ date: form.work_date, limit: 100 })}`,
  );
  const dayItems = dayData?.items ?? [];

  const resetAfterSave = () => {
    setForm((prev) => ({
      ...EMPTY_WORKLOG_FORM,
      work_date: prev.work_date,
      employee_id: prev.employee_id,
      equipment_id: prev.equipment_id,
    }));
    setHecterraHintHa(null);
    setHelperWorkTypeId('');
  };

  const submit = async (event) => {
    event.preventDefault();

    const duplicate = findDuplicateWorklog(dayItems, form);
    if (duplicate) {
      const ok = await confirm(
        `Схожий запис уже є на ${duplicate.work_date} — той самий працівник, вид роботи ` +
          `("${duplicate.work_type_name}"), техніка й поле (${money(duplicate.total_amount)} грн). ` +
          `Зберегти ще один? Це задублює суму в Табелі й Відомості ЗП.`,
        { confirmLabel: 'Зберегти ще один', danger: false },
      );
      if (!ok) return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      let saved;
      if (form.id) {
        saved = await api.put(`/worklogs/${form.id}`, toPayload(form));
        toast('Запис оновлено');
      } else {
        saved = await api.post('/worklogs', toPayload(form));
        toast('Запис збережено');
      }
      if (continuous) {
        resetAfterSave();
        setPreview(null);
        reloadDay();
      }
      onSaved?.(saved);
    } catch (error) {
      setSaveError(error);
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const editItem = (item) => {
    setSaveError(null);
    setForm(worklogFormFromRecord(item));
    setHecterraHintHa(item.area_ha_auto ?? null);
    setHelperWorkTypeId(item.helper_absent === 1 ? (item.helper_work_type_id ?? '') : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeItem = async (item) => {
    if (!(await confirm(`Видалити запис «${item.work_type_name}» (${item.employee_name})?`))) return;
    try {
      await api.del(`/worklogs/${item.id}`);
      toast('Запис видалено');
      if (form.id === item.id) resetAfterSave();
      reloadDay();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const variantLabel = (variant) =>
    [
      variant.equipment_label ?? 'будь-яка техніка',
      variant.implement_label,
      variant.unit_label ?? UNIT_LABELS[variant.unit],
      `${num(variant.rate)} грн`,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      {source && BANNER_TEXT[source] && (
        <div className="no-print mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {BANNER_TEXT[source]}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem_20rem]">
        <form onSubmit={submit} className="card p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Дата з">
              <Input
                type="date"
                value={form.work_date}
                required
                onChange={(e) => set({ work_date: e.target.value })}
              />
            </Field>

            <Field label="Дата по" hint="Заповніть, якщо шляховий охоплює кілька днів (напр. дальній рейс)">
              <Input
                type="date"
                value={form.work_date_to}
                min={form.work_date}
                onChange={(e) => set({ work_date_to: e.target.value })}
              />
            </Field>

            <Field label="Працівник">
              <SearchableSelect
                placeholder="Виберіть працівника"
                required
                value={form.employee_id}
                options={employees.map((e) => ({
                  value: e.id,
                  label: `${e.full_name}${e.position ? ` · ${e.position}` : ''}`,
                }))}
                onChange={(e) =>
                  set({ employee_id: e.target.value, work_type_id: '', tariff_rate_id: '', route_id: '', unit: '' })
                }
              />
            </Field>

            <Field
              label="Вид роботи"
              hint={employee ? undefined : 'Спочатку виберіть працівника'}
            >
              <Select
                placeholder={employee ? 'Виберіть вид роботи' : '—'}
                required
                disabled={!employee}
                value={form.work_type_id}
                options={workTypes.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(e) =>
                  set({
                    work_type_id: e.target.value,
                    tariff_rate_id: '',
                    route_id: '',
                    unit: '',
                    helper_absent: 0,
                    transport_pay: 0,
                  })
                }
              />
            </Field>

            <Field label="Техніка" hint="Впливає на підбір розцінки">
              <SearchableSelect
                placeholder="Без техніки"
                value={form.equipment_id}
                options={equipment.map((e) => ({
                  value: e.id,
                  label: `${e.name}${e.plate_number ? ` (${e.plate_number})` : ''}`,
                }))}
                onChange={(e) => set({ equipment_id: e.target.value, tariff_rate_id: '' })}
              />
            </Field>

            <Field
              label="Поле"
              hint={
                !form.field_id && hecterraFieldHint ? (
                  <span className="font-medium text-amber-700">
                    Hecterra: {hecterraFieldHint.name}
                    {hecterraFieldHint.area != null ? ` (${num(hecterraFieldHint.area)} га)` : ''} — немає в довіднику,
                    оберіть найближче або заведіть нове поле
                  </span>
                ) : (
                  'Можна пропустити (ДАФ, погодинні роботи)'
                )
              }
            >
              <SearchableSelect
                placeholder="Без поля"
                value={form.field_id}
                options={fields.map((f) => ({
                  value: f.id,
                  label: `${f.name}${f.area_ha ? ` · ${num(f.area_ha)} га` : ''}`,
                }))}
                onChange={(e) => set({ field_id: e.target.value })}
              />
            </Field>
          </div>

          {/* Спосіб оплати: за видом робіт (тариф) чи погодинно за особистою ставкою */}
          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">Спосіб оплати</div>
            <div className="flex flex-wrap gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm has-[:checked]:border-green-500 has-[:checked]:ring-1 has-[:checked]:ring-green-500">
                <input
                  type="radio"
                  name="pay_mode"
                  checked={form.pay_mode === 'tariff'}
                  onChange={() => set({ pay_mode: 'tariff', tariff_rate_id: '', route_id: '', unit: '' })}
                />
                За видом робіт (тариф)
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm has-[:checked]:border-green-500 has-[:checked]:ring-1 has-[:checked]:ring-green-500">
                <input
                  type="radio"
                  name="pay_mode"
                  checked={form.pay_mode === 'hourly'}
                  onChange={() =>
                    set({
                      pay_mode: 'hourly',
                      tariff_rate_id: '',
                      route_id: '',
                      unit: '',
                      helper_absent: 0,
                      transport_pay: 0,
                    })
                  }
                />
                Погодинно (оклад)
              </label>
            </div>

            {isHourly && (
              <p className="mt-2 text-sm text-slate-500">
                {employee
                  ? employee.monthly_rate
                    ? `Оклад працівника: ${num(employee.monthly_rate)} грн/міс — погодинна ставка вирахується автоматично за нормою годин місяця`
                    : settingsData?.minimum_wage
                      ? `Оклад у працівника не вказано — рахуватиметься за мінімальною ЗП (${num(settingsData.minimum_wage)} грн/міс)`
                      : `У працівника "${employee.full_name}" не вказано оклад, а мінімальна ЗП ще не задана — вкажіть одне з двох на сторінці «Працівники»`
                  : 'Спочатку виберіть працівника'}
              </p>
            )}
          </div>

          {showHelperBonus && (
            <div className="mt-5 rounded-lg border border-slate-200 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.helper_absent === 1 || form.helper_absent === true}
                  onChange={(e) => set({ helper_absent: e.target.checked ? 1 : 0, transport_pay: 0 })}
                />
                Хімік 50% — хіміка не було, водій виконав його роботу
              </label>

              {(form.helper_absent === 1 || form.helper_absent === true) && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Вид роботи хіміка">
                    <Select
                      placeholder="Виберіть вид роботи хіміка"
                      required
                      value={helperWorkTypeId}
                      options={helperWorkTypes.map((w) => ({ value: w.id, label: w.name }))}
                      onChange={(e) => {
                        setHelperWorkTypeId(e.target.value);
                        set({ helper_tariff_rate_id: '' });
                      }}
                    />
                  </Field>
                  <Field
                    label="Розцінка хіміка"
                    hint={helperRatesLoading ? 'Завантаження…' : helperWorkTypeId ? `Варіантів: ${helperRates.length}` : undefined}
                  >
                    <Select
                      placeholder="Виберіть розцінку"
                      required
                      disabled={!helperWorkTypeId}
                      value={form.helper_tariff_rate_id}
                      options={helperRates.map((r) => ({ value: r.id, label: variantLabel(r) }))}
                      onChange={(e) => set({ helper_tariff_rate_id: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {showTransportPay && (
            <div className="mt-5 rounded-lg border border-slate-200 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.transport_pay === 1 || form.transport_pay === true}
                  onChange={(e) => set({ transport_pay: e.target.checked ? 1 : 0, helper_absent: 0 })}
                />
                Оплатити за транспортним тарифом (замість тарифу виду робіт)
              </label>
              {(form.transport_pay === 1 || form.transport_pay === true) && (
                <p className="mt-2 text-sm text-slate-500">
                  {form.equipment_id
                    ? 'Сума порахується як внесені години × ставка транспортного тарифу для обраної техніки.'
                    : 'Техніку не вказано — буде застосовано типову ставку транспортного тарифу.'}
                </p>
              )}
            </div>
          )}

          {!isHourly && form.work_type_id && !isRoute && rates.length > 0 && (
            <div className="mt-5">
              <Field
                label="Розцінка"
                hint={ratesLoading ? 'Завантаження…' : `Варіантів: ${rates.length}`}
              >
                <SearchableSelect
                  placeholder="Виберіть розцінку"
                  required
                  value={form.tariff_rate_id}
                  options={rates.map((r) => ({ value: r.id, label: variantLabel(r) }))}
                  onChange={(e) => set({ tariff_rate_id: e.target.value })}
                />
              </Field>
            </div>
          )}

          {!isHourly && isRoute && (
            <div className="mt-5">
              <Field label="Маршрут рейсу">
                <SearchableSelect
                  placeholder="Виберіть маршрут"
                  required
                  value={form.route_id}
                  options={[
                    ...routes.map((r) => ({
                      value: r.id,
                      label: `${r.name} · ${r.distance_km ? `${num(r.distance_km)} км · ` : ''}${num(r.rate)} грн`,
                    })),
                    { value: MANUAL_ROUTE, label: '— Маршруту немає в переліку: ввести вручну —' },
                  ]}
                  onChange={(e) => set({ route_id: e.target.value })}
                />
              </Field>
            </div>
          )}

          {isManualRoute && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Маршруту немає в довіднику (напр. міжнародний рейс) — вкажіть кілометри та розцінку вручну
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Відстань, км (в дві сторони)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.distance_km}
                    onChange={(e) => set({ distance_km: e.target.value })}
                  />
                </Field>
                <Field label="Розцінка, грн" hint="За рейс">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.manual_rate}
                    onChange={(e) => set({ manual_rate: e.target.value })}
                  />
                </Field>
              </div>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={!form.distance_km || estimating}
                onClick={estimateFromKm}
              >
                {estimating ? 'Рахую…' : 'Порахувати за тарифом грн/км'}
              </button>
              {estimateError && <p className="mt-2 text-sm text-red-600">{estimateError}</p>}
              <p className="mt-2 text-xs text-slate-500">
                Опишіть маршрут у полі «Примітка» нижче (напр. «Діброва – Варшава»).
              </p>
            </div>
          )}

          {showManualRate && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Тарифу для цієї роботи немає в довіднику — вкажіть розцінку вручну
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Одиниця виміру">
                  <Select
                    required
                    value={form.unit}
                    options={UNIT_OPTIONS}
                    onChange={(e) => set({ unit: e.target.value })}
                  />
                </Field>
                <Field label="Розцінка, грн">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.manual_rate}
                    onChange={(e) => set({ manual_rate: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* Показники виробітку — залежать від одиниці виміру розцінки */}
          {(isHourly || rate || route || showManualRate || isManualRoute) && (
            <div className="mt-5 rounded-lg bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Показники виробітку
                {activeUnit && (
                  <span className="ml-2 font-normal text-slate-500">
                    (оплата за {UNIT_LABELS[activeUnit]}
                    {rate?.secondary_unit ? ` + ${UNIT_LABELS[rate.secondary_unit]}` : ''})
                  </span>
                )}
              </div>
              <div className="mb-4">
                <Field label="Культура" hint="Пшениця, жито, ячмінь, кукурудза, соняшник, ріпак, соя, горох або майбутній врожай">
                  <SearchableSelect
                    placeholder="Без культури"
                    value={form.crop}
                    options={CROP_OPTIONS}
                    onChange={(e) => set({ crop: e.target.value })}
                  />
                </Field>
              </div>

              {isSazTransportWork && (
                <div className="mb-4">
                  <Field label="Вид вантажу" hint="Полова чи зерновідходи — не впливає на суму, лише для обліку">
                    <SearchableSelect
                      placeholder="Не вказано"
                      value={form.cargo_type}
                      options={CARGO_TYPE_OPTIONS}
                      onChange={(e) => set({ cargo_type: e.target.value })}
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {metricFields.map((metric) => {
                  const showHecterraHint = metric === 'area_ha' && hecterraHintHa != null;
                  const currentHa = form.area_ha === '' ? null : Number(form.area_ha);
                  const mismatch = showHecterraHint && currentHa != null && Math.abs(currentHa - hecterraHintHa) > 0.01;
                  return (
                    <Field
                      key={metric}
                      label={METRIC_LABELS[metric]}
                      hint={
                        showHecterraHint ? (
                          <span className={mismatch ? 'font-medium text-amber-700' : ''}>
                            Hecterra: {num(hecterraHintHa)} га
                            {mismatch && ` (введено ${num(currentHa)})`}
                          </span>
                        ) : metric === 'hours' ? (
                          'для табеля'
                        ) : undefined
                      }
                    >
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form[metric]}
                        onChange={(e) => set({ [metric]: e.target.value })}
                      />
                    </Field>
                  );
                })}
              </div>

              {rate?.is_manual === 1 && (
                <div className="mt-4">
                  <Field
                    label="Сума вручну, грн"
                    hint={`Тариф не фіксований: ${rate.raw_text ?? 'вводиться вручну'}`}
                  >
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.manual_amount}
                      onChange={(e) => set({ manual_amount: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          <div className="mt-3">
            <Field label="Примітка">
              <Textarea value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>

          {saveError && (
            <div className="mt-4">
              <ErrorBox error={saveError} />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary px-8 py-3 text-lg" disabled={saving}>
              {saving ? 'Збереження…' : form.id ? `Зберегти зміни #${form.id}` : 'Зберегти запис'}
            </button>
            {form.id && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (onCancel) {
                    onCancel();
                  } else {
                    resetAfterSave();
                    setSaveError(null);
                  }
                }}
              >
                Скасувати редагування{onCancel ? '' : ` #${form.id}`}
              </button>
            )}
            {!onCancel && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setForm({ ...EMPTY_WORKLOG_FORM, work_date: form.work_date });
                  setHelperWorkTypeId('');
                  setPreview(null);
                  setSaveError(null);
                }}
              >
                Очистити
              </button>
            )}
          </div>
        </form>

        {/* Розрахунок на льоту */}
        <div className="card sticky top-4 self-start p-5">
          <div className="text-sm font-semibold text-slate-700">Сума за запис</div>

            {!preview && !previewError && (
              <p className="mt-3 text-sm text-slate-500">
                Заповніть працівника, вид роботи та показники — сума порахується автоматично.
              </p>
            )}

            {previewError && (
              <div className="mt-3">
                <ErrorBox error={previewError} />
              </div>
            )}

            {preview && (
              <>
                <div className="mt-3 text-4xl font-bold tabular-nums text-green-700">
                  {money(preview.total_amount)} <span className="text-lg font-medium text-slate-400">грн</span>
                </div>

                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Обсяг</dt>
                    <dd className="tabular-nums">
                      {num(preview.quantity)} {UNIT_LABELS[preview.unit]}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Розцінка</dt>
                    <dd className="tabular-nums">{num(preview.rate)} грн</dd>
                  </div>
                  {preview.secondary_unit && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Друга складова</dt>
                      <dd className="tabular-nums">
                        {num(preview.secondary_quantity)} {UNIT_LABELS[preview.secondary_unit]} ×{' '}
                        {num(preview.secondary_rate)} грн
                      </dd>
                    </div>
                  )}
                  {Boolean(preview.transport_pay) && (
                    <div className="flex justify-between text-teal-700">
                      <dt>нараховано за транспортним тарифом</dt>
                      <dd className="tabular-nums">
                        {num(preview.hours)} год × {num(preview.transport_rate)} грн/год
                      </dd>
                    </div>
                  )}
                  {Boolean(preview.helper_amount) && (
                    <div className="flex justify-between text-amber-700">
                      <dt>у т.ч. хімік 50%</dt>
                      <dd className="font-medium tabular-nums">{money(preview.helper_amount)} грн</dd>
                    </div>
                  )}
                </dl>
              </>
            )}
          </div>

        <div className="card sticky top-4 self-start p-5">
          <div className="text-sm font-semibold text-slate-700">
            Записи за {form.work_date} · {dayItems.length}
          </div>
            {dayLoading && <Spinner label="" />}
            {!dayLoading && dayItems.length === 0 && (
              <p className="mt-2 text-sm text-slate-500">Записів за цю дату ще немає.</p>
            )}
            <ul className="mt-3 space-y-2">
              {dayItems.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-800">
                        {item.employee_name}
                      </div>
                      <div className="text-slate-600">
                        {item.work_type_name}
                        {item.route_name ? ` · ${item.route_name}` : ''}
                        {item.pay_mode === 'hourly' && (
                          <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                            погодинно
                          </span>
                        )}
                        {item.pay_mode === 'tariff' && !item.tariff_rate_id && !item.route_id && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                            вручну
                          </span>
                        )}
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
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[
                          item.equipment_name,
                          item.field_name,
                          item.crop ? CROP_LABELS[item.crop] : null,
                          `${num(item.quantity)} ${UNIT_LABELS[item.unit]}`,
                          `${num(item.hours)} год`,
                          item.work_date !== item.work_date_to
                            ? `з ${item.work_date} по ${item.work_date_to}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums text-slate-800">
                        {money(item.total_amount)}
                      </div>
                      <div className="mt-1 flex gap-1">
                        <button
                          type="button"
                          className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                          onClick={() => editItem(item)}
                        >
                          Змінити
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => removeItem(item)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {dayItems.length > 0 && (
              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-sm font-semibold">
                <span>Разом за день</span>
                <span className="tabular-nums">{money(dayData?.totals?.total_amount)} грн</span>
              </div>
            )}
          </div>
      </div>

      {!employees.length && (
        <div className="mt-5">
          <EmptyState
            title="Немає працівників"
            hint="Додайте їх у довіднику «Працівники» — без цього шляховий лист внести не можна"
          />
        </div>
      )}

      {confirmElement}
    </>
  );
}
