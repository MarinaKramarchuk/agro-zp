import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import { Spinner, useToast } from '../components/ui.jsx';
import { EMPTY_WORKLOG_FORM, WorklogForm, worklogFormFromRecord } from '../components/WorklogForm.jsx';
import { api } from '../lib/api.js';

// Чернетка з екрана "Даних з техніки" (?date=&equipment_id=&hours=&distance_km=
// &field_id=&area_ha=&hecterra_activity_id=&plan_id=) - заповнює форму, людина
// перевіряє й дозаповнює решту. Основний перехід сюди зараз - модальні вікна
// (WorklogModal з WorklogsJournalPage/MachineDataPage); ці query-параметри
// лишаються як робочий прямий deep-link (напр. для збереженого посилання).
const PREFILL_PARAMS = [
  'work_date', 'employee_id', 'equipment_id', 'work_type_id', 'crop', 'hours', 'distance_km', 'field_id', 'area_ha',
  'hecterra_activity_id', 'plan_id',
];

function formFromSearchParams(params) {
  const patch = {};
  const date = params.get('date');
  if (date) patch.work_date = date;
  for (const key of PREFILL_PARAMS) {
    if (key === 'work_date') continue;
    const value = params.get(key);
    if (value !== null && value !== '') patch[key] = value;
  }
  return { ...EMPTY_WORKLOG_FORM, ...patch };
}

function hecterraHintFromSearchParams(params) {
  if (!params.has('hecterra_activity_id')) return null;
  const area = params.get('area_ha');
  return area !== null && area !== '' ? Number(area) : null;
}

/** Поле ще не прив'язане в довіднику (fields.gektera_field_id) - показуємо
 * сиру назву/площу з Hecterra, щоб людина хоч бачила, що це за поле, поки
 * не заведе його в довідник "Поля" або не обере найближче вручну. */
function hecterraFieldHintFromSearchParams(params) {
  const name = params.get('hecterra_field_name');
  if (!name) return null;
  const area = params.get('hecterra_field_area');
  return { name, area: area !== null && area !== '' ? Number(area) : null };
}

export function WorklogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Обчислюємо один раз при монтуванні - прибирання query-параметрів нижче
  // не повинно заново переініціалізовувати форму.
  const [initial] = useState(() => ({
    prefilled: searchParams.has('equipment_id') || searchParams.has('date'),
    fromPlan: searchParams.has('plan_id'),
    editId: searchParams.get('edit'),
    form: formFromSearchParams(searchParams),
    hecterraHintHa: hecterraHintFromSearchParams(searchParams),
    hecterraFieldHint: hecterraFieldHintFromSearchParams(searchParams),
  }));

  // undefined - ще з'ясовуємо, чи є ?edit=; null - немає/не потрібен; обʼєкт - завантажено
  const [editItem, setEditItem] = useState(initial.editId ? undefined : null);

  // Query-параметри - лише для одноразового заповнення форми; прибираємо з
  // адресного рядка, щоб не застосувались повторно (напр. після F5).
  useEffect(() => {
    setSearchParams({}, { replace: true });
    if (!initial.editId) return;
    api
      .get(`/worklogs/${initial.editId}`)
      .then(setEditItem)
      .catch((error) => {
        toast(error.message, 'error');
        setEditItem(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editItem === undefined) {
    return (
      <>
        <PageHeader title="Реєстрація роботи" subtitle="Швидке щоденне внесення записів; сума рахується автоматично" />
        <Spinner />
      </>
    );
  }

  const initialForm = editItem ? worklogFormFromRecord(editItem) : initial.form;
  const source = editItem ? null : initial.fromPlan ? 'plan' : initial.prefilled ? 'draft' : null;

  return (
    <>
      <PageHeader
        title="Реєстрація роботи"
        subtitle="Швидке щоденне внесення записів; сума рахується автоматично"
      />
      <WorklogForm
        key={editItem?.id ?? 'initial'}
        initialForm={initialForm}
        source={source}
        hecterraHintHa={editItem ? (editItem.area_ha_auto ?? null) : initial.hecterraHintHa}
        hecterraFieldHint={editItem ? null : initial.hecterraFieldHint}
        continuous
      />
    </>
  );
}
