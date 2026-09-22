import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Field, SearchableSelect, Select, Spinner, useConfirm, useToast } from '../components/ui.jsx';
import { EMPTY_WORKLOG_FORM } from '../components/WorklogForm.jsx';
import { WorklogModal } from '../components/WorklogModal.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { api, query, uploadFiles } from '../lib/api.js';
import { CROP_LABELS, dateLabel, num, pad } from '../lib/format.js';

/** Декади місяця — той самий патерн, що у "Відомості ЗП" і "Контролі гектарів". */
function decadeRange(year, month, decade) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ranges = { 1: [1, 10], 2: [11, 20], 3: [21, last] };
  const [from, to] = ranges[decade];
  return { date_from: `${year}-${pad(month)}-${pad(from)}`, date_to: `${year}-${pad(month)}-${pad(to)}` };
}

/** Чернетка форми шляхового листа з факту техніки й, за наявності, з
 * конкретної активності Hecterra (поле/га) — підтвердження людиною лишається
 * обов'язковим, чернетка лише економить набір. Відкривається як модальне
 * вікно (WorklogModal), тож "Дані з техніки" не втрачають фільтр/прокрутку. */
function formFromDraft(row, activity) {
  return {
    ...EMPTY_WORKLOG_FORM,
    work_date: row.fact_date,
    equipment_id: row.equipment_id,
    hours: row.engine_hours ?? activity?.hours ?? '',
    distance_km: row.distance_km ?? '',
    field_id: activity?.field_id ?? '',
    area_ha: activity?.area_ha ?? '',
    hecterra_activity_id: activity?.id ?? '',
    employee_id: activity?.employee_id ?? '',
    work_type_id: activity?.work_type_id ?? '',
    crop: activity?.crop ?? '',
  };
}

/** Поле ще не в довіднику - хай хоч підказка з сирою назвою/площею дійде до форми. */
function draftFieldHint(activity) {
  if (!activity || activity.field_id || !activity.field_name_raw) return null;
  return { name: activity.field_name_raw, area: activity.field_area_ha ?? null };
}

const hecterraKey = (date, overseerName) => `${date}|${overseerName}`;

function UploadZone({ onFiles, uploading }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`no-print card mb-4 flex flex-col items-center gap-2 border-2 border-dashed p-8 text-center transition ${
        dragOver ? 'border-green-500 bg-green-50' : 'border-slate-300'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) onFiles([...e.dataTransfer.files]);
      }}
    >
      {uploading ? (
        <Spinner label="Завантажую та розбираю звіти…" />
      ) : (
        <>
          <div className="text-3xl" aria-hidden>
            🛰
          </div>
          <div className="text-slate-700">
            Перетягніть сюди файли звітів OVERSEER (.xlsx) або
          </div>
          <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
            Обрати файли
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

export function MachineDataPage() {
  const { year, month, range: globalRange } = usePeriod();
  const [range, setRange] = useState(globalRange);
  useEffect(() => setRange(globalRange), [globalRange.date_from, globalRange.date_to]);
  const [showRegistered, setShowRegistered] = useState(false);
  const [draftFor, setDraftFor] = useState(null); // { row, activity } - для модалки реєстрації роботи
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [linking, setLinking] = useState(null); // overseer_name, що зараз прив'язується
  const [linkingField, setLinkingField] = useState(null); // hecterra_field_id, що зараз прив'язується
  const [linkingDriver, setLinkingDriver] = useState(null); // driver_name_raw, що зараз прив'язується

  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const [deletingActivity, setDeletingActivity] = useState(null); // id активності, що зараз видаляється

  const { data: equipmentData } = useQuery('/equipment');
  const equipment = equipmentData?.items ?? [];

  const { data: employeesData } = useQuery('/employees');
  const employees = employeesData?.items ?? [];

  const { data: workTypesAllData } = useQuery('/work-types');
  const workTypesAll = workTypesAllData?.items ?? [];

  const { data: fieldsData } = useQuery('/fields');
  const fields = fieldsData?.items ?? [];

  const { data: unmappedData, reload: reloadUnmapped } = useQuery('/overseer/unmapped');
  const unmapped = unmappedData?.items ?? [];

  const { data: unmappedDriversData, reload: reloadUnmappedDrivers } = useQuery('/hecterra/unmapped-drivers');
  const unmappedDrivers = unmappedDriversData?.items ?? [];

  const { data: unmappedWorkTypesData, reload: reloadUnmappedWorkTypes } = useQuery('/hecterra/unmapped-work-types');
  const unmappedWorkTypes = unmappedWorkTypesData?.items ?? [];
  const [linkingWorkType, setLinkingWorkType] = useState(null); // work_type_raw, що зараз прив'язується

  const filters = { date_from: range.date_from, date_to: range.date_to };
  const { data: factsData, loading, error, reload: reloadFacts } = useQuery(`/overseer/facts${query(filters)}`);
  const facts = factsData?.items ?? [];

  const { data: unmappedFieldsData, reload: reloadUnmappedFields } = useQuery('/hecterra/unmapped');
  const unmappedFields = unmappedFieldsData?.items ?? [];

  const { data: hecterraData, reload: reloadHecterra } = useQuery(`/hecterra/activities${query(filters)}`);
  const activitiesByDayMachine = {};
  for (const activity of hecterraData?.items ?? []) {
    const key = hecterraKey(activity.activity_date, activity.overseer_name);
    (activitiesByDayMachine[key] ??= []).push(activity);
  }

  // Hecterra іноді дає дані (обприскувач/агрегат) без окремого звіту OVERSEER
  // за мотогодини на цю дату - без цього такі дні взагалі не показались би на
  // екрані. Домальовуємо "порожні" рядки факту лише під ці дні/техніку.
  const factKeys = new Set(facts.map((row) => hecterraKey(row.fact_date, row.overseer_name)));
  const hecterraOnlyRows = [];
  for (const key of Object.keys(activitiesByDayMachine)) {
    if (factKeys.has(key)) continue;
    const [fact_date, overseer_name] = key.split('|');
    const eq = equipment.find((e) => e.overseer_name === overseer_name);
    hecterraOnlyRows.push({
      id: `hecterra:${key}`,
      fact_date,
      overseer_name,
      engine_hours: null,
      distance_km: null,
      fuel_consumed: null,
      fuel_refueled: null,
      equipment_id: eq?.id ?? null,
      equipment_name: eq?.name ?? null,
      has_worklog: false,
      hecterraOnly: true,
    });
  }
  const displayRows = [...facts, ...hecterraOnlyRows].sort(
    (a, b) => b.fact_date.localeCompare(a.fact_date) || a.overseer_name.localeCompare(b.overseer_name),
  );

  // Один рядок таблиці = один запис (поле × дата × техніка), а не кілька полів
  // в одній комірці - водій/робота/культура тоді нормально влазять у свої
  // колонки. Мотогодини/пробіг/паливо - вони per день×техніка, не per поле,
  // тому повторюються на кожному рядку того самого дня.
  //
  // registered рахуємо per-рядок: якщо є конкретна активність Hecterra (a) -
  // за a.has_worklog (точно ця активність, бо кілька полів за один день/техніку
  // мають різний статус); якщо активності немає (чиста доба OVERSEER) - за
  // row.has_worklog (день×техніка - тут інакше й бути не може).
  const flatRows = [];
  for (const row of displayRows) {
    const activities = activitiesByDayMachine[hecterraKey(row.fact_date, row.overseer_name)] ?? [];
    if (activities.length === 0) {
      flatRows.push({ row, activity: null, registered: Boolean(row.has_worklog) });
    } else {
      for (const activity of activities) {
        flatRows.push({ row, activity, registered: Boolean(activity.has_worklog) });
      }
    }
  }
  // Уже зареєстровані ховаємо за замовчуванням - інакше кнопка "Зареєструвати
  // роботу" лишається клікабельною на них і легко задублити запис.
  const registeredCount = flatRows.filter((r) => r.registered).length;
  const visibleRows = showRegistered ? flatRows : flatRows.filter((r) => !r.registered);

  const reloadAll = () => {
    reloadFacts();
    reloadUnmapped();
    reloadHecterra();
    reloadUnmappedFields();
    reloadUnmappedDrivers();
    reloadUnmappedWorkTypes();
  };

  const handleFiles = async (files) => {
    setUploading(true);
    setImportResult(null);
    try {
      const result = await uploadFiles('/overseer/import', files);
      setImportResult(result);
      const problems = result.fileErrors.length + result.filesWithNoData.length;
      const hecterraNote = result.hecterra?.activitiesProcessed
        ? ` · Hecterra: додано ${result.hecterra.added}, оновлено ${result.hecterra.updated}, без змін ${result.hecterra.unchanged}`
        : '';
      if (problems) {
        toast(`Імпорт завершено з зауваженнями: перевірте деталі нижче${hecterraNote}`, 'info');
      } else {
        toast(`Імпортовано: додано ${result.added}, оновлено ${result.updated}, без змін ${result.unchanged}${hecterraNote}`);
      }
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const deleteActivity = async (activity) => {
    const label = activity.field_name ?? activity.field_name_raw ?? activity.hecterra_field_id;
    if (!(await confirm(`Видалити рядок «${label}» (${num(activity.area_ha)} га)? Це лише чернетка з Hecterra — вже збережені шляхові листи не постраждають.`))) {
      return;
    }
    setDeletingActivity(activity.id);
    try {
      await api.del(`/hecterra/activities/${activity.id}`);
      toast('Рядок видалено');
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeletingActivity(null);
    }
  };

  const linkMachine = async (overseerName, equipmentId) => {
    if (!equipmentId) return;
    setLinking(overseerName);
    try {
      await api.patch(`/equipment/${equipmentId}`, { overseer_name: overseerName });
      toast(`«${overseerName}» прив'язано до техніки`);
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLinking(null);
    }
  };

  const linkDriver = async (driverNameRaw, employeeId) => {
    if (!employeeId) return;
    setLinkingDriver(driverNameRaw);
    try {
      // /overseer-aliases, а не PATCH overseer_name - той самий працівник
      // іноді трапляється під іншим написанням в іншому звіті Hecterra
      // ("Гнотюк" й "Гнатюк"); PATCH просто затер би вже наявне
      // написання, і щойно прив'язане одразу стало б "нерозпізнаним" саме.
      await api.post(`/employees/${employeeId}/overseer-aliases`, { alias: driverNameRaw });
      toast(`«${driverNameRaw}» прив'язано до працівника`);
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLinkingDriver(null);
    }
  };

  const linkWorkType = async (workTypeRaw, workTypeId) => {
    if (!workTypeId) return;
    setLinkingWorkType(workTypeRaw);
    try {
      await api.patch(`/work-types/${workTypeId}`, { overseer_name: workTypeRaw });
      toast(`«${workTypeRaw}» прив'язано до виду роботи`);
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLinkingWorkType(null);
    }
  };

  // Два джерела Hecterra: KMZ дає числовий ID поля (gektera_field_id) - він
  // стабільний, прив'язуємо через PATCH. Звіт "Оброблено полів" ID не дає
  // взагалі - лише назву, яка між імпортами міняється разом із площею в ній
  // ("...47 га" -> "...51 га"), тож прив'язуємо як ЩЕ ОДНЕ написання
  // (/overseer-aliases) - інакше нове написання затре старе, і воно саме
  // стане "нерозпізнаним" при наступному імпорті.
  const linkField = async (unmappedItem, fieldId) => {
    if (!fieldId) return;
    setLinkingField(unmappedItem.key);
    try {
      if (unmappedItem.hecterra_field_id) {
        await api.patch(`/fields/${fieldId}`, { gektera_field_id: unmappedItem.hecterra_field_id });
      } else {
        await api.post(`/fields/${fieldId}/overseer-aliases`, { alias: unmappedItem.field_name_raw });
      }
      toast(`Поле «${unmappedItem.field_name_raw ?? unmappedItem.key}» прив'язано до довідника`);
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLinkingField(null);
    }
  };

  // Немаплена назва, якій нема куди прив'язатись (одноразова помилка друку в
  // телематиці тощо) - "Ігнорувати" ховає саму назву назавжди (нова таблиця
  // alert_dismissals), сирі дані (факти/активності) не чіпає.
  const dismissUnmapped = async (endpoint, value, label) => {
    if (!(await confirm(`Приховати «${label}» зі сповіщень назавжди? Дані з техніки не видаляються — лише сповіщення.`))) {
      return;
    }
    try {
      await api.post(endpoint, { value });
      toast(`«${label}» приховано зі сповіщень`);
      reloadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Дані з техніки"
        subtitle="Звіти OVERSEER (мотогодини, пробіг, паливо) — чернетка для реєстрації роботи, підтверджує людина"
        actions={
          <button type="button" className="btn-secondary" onClick={reloadAll}>
            Оновити
          </button>
        }
      />

      <UploadZone onFiles={handleFiles} uploading={uploading} />

      {importResult && (importResult.fileErrors.length > 0 || importResult.filesWithNoData.length > 0) && (
        <div className="no-print mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {importResult.fileErrors.map((e) => (
            <div key={e.file}>⚠ {e.file}: {e.message}</div>
          ))}
          {importResult.filesWithNoData.map((name) => (
            <div key={name}>⚠ {name}: у файлі не знайдено даних (перевірте формат звіту)</div>
          ))}
        </div>
      )}

      {unmapped.length > 0 && (
        <div className="no-print card mb-4 border-sky-200 bg-sky-50 p-4">
          <div className="mb-2 text-sm font-semibold text-sky-900">
            Нерозпізнана техніка — є дані з OVERSEER, але немає прив'язаної техніки в довіднику
          </div>
          <div className="flex flex-col gap-2">
            {unmapped.map((u) => (
              <div key={u.overseer_name} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-[10rem] font-medium text-slate-800">{u.overseer_name}</span>
                <span className="text-slate-500">
                  {u.days} дн. · {dateLabel(u.first_date)} — {dateLabel(u.last_date)}
                </span>
                <SearchableSelect
                  className="max-w-xs"
                  placeholder="Прив'язати до техніки…"
                  value=""
                  disabled={linking === u.overseer_name}
                  options={equipment.map((e) => ({
                    value: e.id,
                    label: e.overseer_name && e.overseer_name !== u.overseer_name
                      ? `${e.name} (вже: ${e.overseer_name})`
                      : e.name,
                  }))}
                  onChange={(e) => linkMachine(u.overseer_name, Number(e.target.value))}
                />
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => dismissUnmapped('/overseer/unmapped/dismiss', u.overseer_name, u.overseer_name)}
                >
                  Ігнорувати
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {unmappedDrivers.length > 0 && (
        <div className="no-print card mb-4 border-sky-200 bg-sky-50 p-4">
          <div className="mb-2 text-sm font-semibold text-sky-900">
            Нерозпізнані водії Hecterra — є активність, але немає прив'язаного працівника в довіднику
          </div>
          <div className="flex flex-col gap-2">
            {unmappedDrivers.map((u) => {
              const isMulti = u.driver_name_raw.includes(',');
              return (
                <div key={u.driver_name_raw} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="min-w-[12rem] font-medium text-slate-800">{u.driver_name_raw}</span>
                  <span className="text-slate-500">
                    {u.activities} дн. · {dateLabel(u.first_date)} — {dateLabel(u.last_date)}
                  </span>
                  {isMulti ? (
                    <span className="text-slate-500" title="Кілька водіїв в одному проході - прив'язати як єдине ім'я не можна. Якщо котрийсь із них є в довіднику, підставиться сам; інших прив'яжіть, коли їхнє ім'я зустрінеться окремо.">
                      кілька водіїв разом — прив'язка тут недоступна
                    </span>
                  ) : (
                    <SearchableSelect
                      className="max-w-xs"
                      placeholder="Прив'язати до працівника…"
                      value=""
                      disabled={linkingDriver === u.driver_name_raw}
                      options={employees.map((e) => ({
                        value: e.id,
                        label: e.overseer_name && e.overseer_name !== u.driver_name_raw
                          ? `${e.full_name} (уже: ${e.overseer_name} — додасться ще одне написання)`
                          : e.full_name,
                      }))}
                      onChange={(e) => linkDriver(u.driver_name_raw, Number(e.target.value))}
                    />
                  )}
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-red-600"
                    onClick={() => dismissUnmapped('/hecterra/unmapped-drivers/dismiss', u.driver_name_raw, u.driver_name_raw)}
                  >
                    Ігнорувати
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {unmappedWorkTypes.length > 0 && (
        <div className="no-print card mb-4 border-sky-200 bg-sky-50 p-4">
          <div className="mb-2 text-sm font-semibold text-sky-900">
            Нерозпізнані операції Hecterra — є активність, але немає прив'язаного виду роботи в довіднику
          </div>
          <div className="flex flex-col gap-2">
            {unmappedWorkTypes.map((u) => (
              <div key={u.work_type_raw} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-[14rem] font-medium text-slate-800">{u.work_type_raw}</span>
                <span className="text-slate-500">
                  {u.activities} дн. · {dateLabel(u.first_date)} — {dateLabel(u.last_date)}
                </span>
                <Select
                  className="max-w-xs"
                  placeholder="Прив'язати до виду роботи…"
                  value=""
                  disabled={linkingWorkType === u.work_type_raw}
                  options={workTypesAll.map((w) => ({
                    value: w.id,
                    label: w.overseer_name && w.overseer_name !== u.work_type_raw
                      ? `${w.name} (вже: ${w.overseer_name})`
                      : w.name,
                  }))}
                  onChange={(e) => linkWorkType(u.work_type_raw, Number(e.target.value))}
                />
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => dismissUnmapped('/hecterra/unmapped-work-types/dismiss', u.work_type_raw, u.work_type_raw)}
                >
                  Ігнорувати
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {unmappedFields.length > 0 && (
        <div className="no-print card mb-4 border-sky-200 bg-sky-50 p-4">
          <div className="mb-2 text-sm font-semibold text-sky-900">
            Нерозпізнані поля Hecterra — є оброблена площа, але немає прив'язаного поля в довіднику
          </div>
          <div className="flex flex-col gap-2">
            {unmappedFields.map((u) => (
              <div key={u.key} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-[10rem] font-medium text-slate-800">
                  {u.field_name_raw ?? u.hecterra_field_id}
                </span>
                <span className="text-slate-500">
                  {u.activities} акт. · {dateLabel(u.first_date)} — {dateLabel(u.last_date)}
                </span>
                <SearchableSelect
                  className="max-w-xs"
                  placeholder="Прив'язати до поля…"
                  value=""
                  disabled={linkingField === u.key}
                  options={fields.map((f) => {
                    const existingKey = u.hecterra_field_id ? f.gektera_field_id : f.overseer_name;
                    return {
                      value: f.id,
                      label: existingKey && existingKey !== u.key ? `${f.name} (вже: ${existingKey})` : f.name,
                    };
                  })}
                  onChange={(e) => linkField(u, Number(e.target.value))}
                />
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => dismissUnmapped('/hecterra/unmapped/dismiss', u.key, u.field_name_raw ?? u.hecterra_field_id)}
                >
                  Ігнорувати
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Від">
          <input
            type="date"
            className="field-input"
            value={range.date_from}
            onChange={(e) => setRange((prev) => ({ ...prev, date_from: e.target.value }))}
          />
        </Field>
        <Field label="До">
          <input
            type="date"
            className="field-input"
            value={range.date_to}
            onChange={(e) => setRange((prev) => ({ ...prev, date_to: e.target.value }))}
          />
        </Field>

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1">
          {[1, 2, 3].map((decade) => (
            <button
              key={decade}
              type="button"
              className="btn-secondary py-1.5"
              onClick={() => setRange(decadeRange(year, month, decade))}
            >
              {decade}-а декада
            </button>
          ))}
        </div>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reloadFacts} />}

      {flatRows.length === 0 && !loading && (
        <EmptyState
          title="За цей період немає даних з техніки"
          hint="Перетягніть звіти OVERSEER у зону завантаження вище або імпортуйте звіт Hecterra"
        />
      )}

      {flatRows.length > 0 && (
        <label className="no-print mb-3 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-green-600"
            checked={showRegistered}
            onChange={(e) => setShowRegistered(e.target.checked)}
          />
          Показати вже зареєстровані{registeredCount > 0 ? ` (приховано ${registeredCount})` : ''}
        </label>
      )}

      {flatRows.length > 0 && visibleRows.length === 0 && (
        <EmptyState
          title="Усе за цей період уже зареєстровано"
          hint="Увімкніть «Показати вже зареєстровані» вище, щоб побачити ці рядки знову"
        />
      )}

      {visibleRows.length > 0 && (
        // max-h + overflow-auto (не лише overflow-x-auto) - інакше цей div
        // стає власним, але нескінченно високим скрол-контейнером: при
        // великому імпорті горизонтальний повзунок опиняється в самому низу
        // сторінки, до нього доводиться щоразу докручувати (той самий
        // патерн, що й у TimesheetPage.jsx для табеля)
        <div className="card max-h-[75vh] overflow-auto">
          <table className="table-base border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 z-10">Дата</th>
                <th className="sticky top-0 z-10">Техніка</th>
                <th className="sticky top-0 z-10 text-right">Мотогодини</th>
                <th className="sticky top-0 z-10 text-right">Год. (Hecterra)</th>
                <th className="sticky top-0 z-10 text-right">Пробіг, км</th>
                <th className="sticky top-0 z-10 text-right">Паливо витр., л</th>
                <th className="sticky top-0 z-10 text-right">Паливо запр., л</th>
                <th className="sticky top-0 z-10">Поле (Hecterra)</th>
                <th className="sticky top-0 z-10 text-right">Оброблено, га</th>
                <th className="sticky top-0 z-10 text-right">Загалом, га</th>
                <th className="sticky top-0 z-10">Водій</th>
                <th className="sticky top-0 z-10">Вид роботи</th>
                <th className="sticky top-0 z-10">Культура</th>
                <th className="sticky top-0 z-10">Статус</th>
                <th className="sticky top-0 z-10" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ row, activity: a, registered }) => (
                <tr key={`${row.id}-${a?.id ?? 'none'}`}>
                  <td className="whitespace-nowrap">{dateLabel(row.fact_date)}</td>
                  <td className={row.equipment_id ? 'font-medium' : 'text-amber-700'}>
                    {row.equipment_name ?? `${row.overseer_name} (нерозпізнано)`}
                  </td>
                  <td className="text-right tabular-nums">{row.engine_hours != null ? num(row.engine_hours) : '—'}</td>
                  <td className="text-right tabular-nums">{a?.hours != null ? num(a.hours) : '—'}</td>
                  {/* Пробіг/паливо: спершу денний підсумок OVERSEER (row), якщо його
                      немає - за цей конкретний прохід з Hecterra (a) */}
                  <td className="text-right tabular-nums">
                    {row.distance_km != null ? num(row.distance_km) : a?.distance_km != null ? num(a.distance_km) : '—'}
                  </td>
                  <td className="text-right tabular-nums">
                    {row.fuel_consumed != null ? num(row.fuel_consumed) : a?.fuel_consumed != null ? num(a.fuel_consumed) : '—'}
                  </td>
                  <td className="text-right tabular-nums">{row.fuel_refueled != null ? num(row.fuel_refueled) : '—'}</td>
                  <td>{a ? (a.field_name ?? a.field_name_raw ?? a.hecterra_field_id) : <span className="text-slate-400">—</span>}</td>
                  <td className="text-right tabular-nums">{a ? num(a.area_ha) : '—'}</td>
                  <td className="text-right tabular-nums">{a?.field_area_ha != null ? num(a.field_area_ha) : '—'}</td>
                  <td className={a?.driver_name_raw && !a.employee_id ? 'text-amber-700' : ''}>
                    {a?.driver_name_raw ? (a.employee_name ?? `${a.driver_name_raw} (нерозпізнано)`) : a ? '—' : ''}
                  </td>
                  <td className={a?.work_type_raw && !a.work_type_id ? 'text-amber-700' : ''}>
                    {a?.work_type_raw ? (a.work_type_name ?? `${a.work_type_raw} (нерозпізнано)`) : a ? '—' : ''}
                  </td>
                  <td>{a ? (a.crop ? CROP_LABELS[a.crop] : '—') : ''}</td>
                  <td>
                    {registered ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
                        зареєстровано
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">немає</span>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {row.equipment_id && !registered && (
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-sm text-green-700 hover:bg-green-50"
                        onClick={() => setDraftFor({ row, activity: a })}
                        title={a ? 'Зареєструвати роботу з цим полем/га (оброблено + пропуски; скоригуйте, якщо датчик схибив)' : undefined}
                      >
                        Зареєструвати роботу
                      </button>
                    )}
                    {a && (
                      <button
                        type="button"
                        className="ml-1 rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                        title="Видалити цей рядок (непотрібний запис)"
                        disabled={deletingActivity === a.id}
                        onClick={() => deleteActivity(a)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorklogModal
        open={Boolean(draftFor)}
        initialForm={draftFor ? formFromDraft(draftFor.row, draftFor.activity) : null}
        source="draft"
        hecterraHintHa={draftFor?.activity ? (draftFor.activity.area_ha ?? null) : null}
        hecterraFieldHint={draftFor ? draftFieldHint(draftFor.activity) : null}
        onClose={() => setDraftFor(null)}
        onSaved={reloadAll}
      />

      {confirmElement}
    </>
  );
}
