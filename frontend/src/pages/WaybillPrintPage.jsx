import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import { EmptyState, ErrorBox, Field, Input, SearchableSelect, Select, Spinner } from '../components/ui.jsx';
import { usePeriod } from '../context/PeriodContext.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { query } from '../lib/api.js';
import { CROP_LABELS, UNIT_LABELS, dateLabel, money, num } from '../lib/format.js';

const ORG_NAME_KEY = 'agro-zp:org-name';

const TEMPLATES = [
  { value: '68', label: 'Форма №68 (дорожній листок трактора)' },
  { value: '2', label: 'Типова форма №2 (подорожній лист вантажівки)' },
  { value: '67b', label: 'Форма №67-б (обліковий лист тракториста-машиніста)' },
];

function templateForGroup(group) {
  if (group === 'tractor') return '68';
  if (group === 'driver') return '2';
  return '68';
}

/** Порожня лінія для ручного заповнення (пальне, одометр, підписи тощо). */
function BlankLine({ width = '100%' }) {
  return <span className="inline-block border-b border-slate-400" style={{ width, minHeight: '1.1em' }} />;
}

export function WaybillPrintPage() {
  const [searchParams] = useSearchParams();
  const { range } = usePeriod();

  const [employeeId, setEmployeeId] = useState(searchParams.get('employee_id') ?? '');
  const [equipmentId, setEquipmentId] = useState(searchParams.get('equipment_id') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date') ?? range.date_from);
  const [dateTo, setDateTo] = useState(searchParams.get('date') ?? range.date_to);
  const [template, setTemplate] = useState('');
  const [combinePeriod, setCombinePeriod] = useState(false);
  const [orgName, setOrgName] = useState(() => localStorage.getItem(ORG_NAME_KEY) ?? '');

  useEffect(() => {
    localStorage.setItem(ORG_NAME_KEY, orgName);
  }, [orgName]);

  const { data: employeesData } = useQuery('/employees');
  const employees = employeesData?.items ?? [];
  const employee = employees.find((e) => e.id === Number(employeeId));

  const { data: equipmentData } = useQuery('/equipment');
  const equipmentList = equipmentData?.items ?? [];
  const selectedEquipment = equipmentList.find((e) => e.id === Number(equipmentId));

  // Типова форма підставляється за групою працівника, поки її не змінили вручну
  useEffect(() => {
    if (employee && !template) setTemplate(templateForGroup(employee.staff_group));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.staff_group]);

  const activeTemplate = template || '68';

  const worklogsPath = employeeId && equipmentId
    ? `/worklogs${query({
        employee_id: employeeId,
        equipment_id: equipmentId,
        date_from: dateFrom,
        date_to: dateTo,
        limit: 500,
      })}`
    : null;
  const { data, loading, error } = useQuery(worklogsPath);
  const items = useMemo(
    // Ремонт у бланки (68/2/67-б) не потрапляє - він рахується окремо в Табелі,
    // не за конкретний рейс/поле, тож у шляховому чи обліковому листі його не показуємо.
    () =>
      (data?.items ?? [])
        .filter((i) => !i.work_type_is_repair)
        .sort((a, b) => (a.work_date < b.work_date ? -1 : 1)),
    [data],
  );

  const displayItems = useMemo(
    () => items.filter((i) => (i.total_amount ?? 0) > 0),
    [items],
  );

  const helperAmountOf = (item) => (item.helper_absent === 1 ? item.helper_amount ?? 0 : 0);

  const implements_ = [...new Set(displayItems.map((i) => i.tariff_implement_label).filter(Boolean))];

  const totals67b = displayItems.reduce(
    (acc, i) => ({
      hours: acc.hours + (i.hours ?? 0),
      amount: acc.amount + (i.total_amount ?? 0),
      helper: acc.helper + helperAmountOf(i),
    }),
    { hours: 0, amount: 0, helper: 0 },
  );

  const isOfficialTemplate = activeTemplate === '68' || activeTemplate === '2';
  const waybillXlsxHref = `/api/worklogs/waybill.xlsx${query({
    employee_id: employeeId,
    equipment_id: equipmentId,
    date_from: dateFrom,
    date_to: dateTo,
    template: activeTemplate,
    org_name: orgName || undefined,
    combine_period: activeTemplate === '68' && combinePeriod ? 1 : undefined,
  })}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Друк бланка шляхового"
          subtitle="Форма №68, типова форма №2 або форма №67-б — за даними внесених записів"
          actions={
            displayItems.length > 0 && (
              <>
                <a className="btn-secondary" href={waybillXlsxHref}>
                  ⤓ Excel
                </a>
                {isOfficialTemplate ? (
                  <a className="btn-primary" href={waybillXlsxHref} target="_blank" rel="noopener noreferrer">
                    🖨 Друкувати (офіційний бланк)
                  </a>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => window.print()}>
                    🖨 Друкувати
                  </button>
                )}
              </>
            )
          }
        />
        {isOfficialTemplate && displayItems.length > 0 && (
          <p className="-mt-3 mb-2 text-xs text-slate-500">
            Відкриється готовий Excel-файл — офіційний бланк з усіма даними. Друкуй звідти (Ctrl+P).
            {activeTemplate === '68' && combinePeriod && (
              <>
                {' '}Форма №68 офіційно оформлюється на один день — при об'єднанні періоду шапка (рік/місяць/число) не
                заповнюється, замість неї над таблицею йде «Період: … — …», а дата кожного запису — у першій колонці таблиці.
              </>
            )}
          </p>
        )}
      </div>

      <div className="no-print card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Працівник" className="lg:col-span-2">
          <SearchableSelect
            placeholder="Виберіть працівника"
            value={employeeId}
            options={employees.map((e) => ({
              value: e.id,
              label: `${e.full_name}${e.position ? ` · ${e.position}` : ''}`,
            }))}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setEquipmentId('');
              setTemplate('');
            }}
          />
        </Field>
        <Field label="Дата з">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </Field>
        <Field label="Дата по">
          <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
        <Field label="Шаблон">
          <Select value={activeTemplate} options={TEMPLATES} onChange={(e) => setTemplate(e.target.value)} />
        </Field>
        {activeTemplate === '68' && (
          <Field label="Excel-бланк" hint="Стосується лише кнопки «Excel» / «Друкувати» — офіційний бланк">
            <label className="flex h-[2.375rem] cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={combinePeriod} onChange={(e) => setCombinePeriod(e.target.checked)} />
              Об'єднати період в одну таблицю
            </label>
          </Field>
        )}
        <Field label="Техніка" className="lg:col-span-2" hint="Один шляховий лист = одна одиниця техніки">
          <SearchableSelect
            placeholder="Виберіть техніку"
            value={equipmentId}
            options={equipmentList.map((e) => ({
              value: e.id,
              label: `${e.name}${e.plate_number ? ` (${e.plate_number})` : ''}`,
            }))}
            onChange={(e) => setEquipmentId(e.target.value)}
          />
        </Field>
        <Field label="Назва господарства" className="sm:col-span-2 lg:col-span-6" hint="Для шапки бланка; запам'ятовується в цьому браузері">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="напр. ФГ «Приклад»" />
        </Field>
      </div>

      {!employeeId && <EmptyState title="Виберіть працівника" hint="І період — для якого друкувати бланк" />}
      {employeeId && !equipmentId && (
        <EmptyState title="Виберіть техніку" hint="Один шляховий лист друкується на одну людину й одну одиницю техніки" />
      )}
      {loading && <Spinner />}
      {error && <ErrorBox error={error} />}
      {employeeId && equipmentId && !loading && !error && displayItems.length === 0 && (
        <EmptyState
          title="Немає записів"
          hint="За обраний період у цього працівника на цій техніці немає записів"
        />
      )}

      {employeeId && employee && equipmentId && displayItems.length > 0 && (
        <div className="card p-6 text-sm text-slate-900 print:border-0 print:p-4 print:shadow-none">
          <div className="mb-4 flex items-start justify-between border-b border-slate-300 pb-3">
            <div>
              <div className="text-base font-semibold">{orgName || 'Господарство: ____________________'}</div>
              <div className="mt-1 text-slate-600">
                {activeTemplate === '68'
                  ? 'Дорожній листок трактора (форма №68)'
                  : activeTemplate === '67b'
                    ? 'Обліковий лист тракториста-машиніста (форма №67-б)'
                    : 'Подорожній лист вантажного автомобіля (типова форма №2)'}
              </div>
            </div>
            <div className="text-right text-slate-600">
              <div>
                Період: {dateLabel(dateFrom)}
                {dateTo !== dateFrom ? ` — ${dateLabel(dateTo)}` : ''}
              </div>
            </div>
          </div>

          {activeTemplate === '68' ? (
            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <span className="text-slate-500">Тракторист: </span>
                <b>{employee.full_name}</b>
                {employee.position ? `, ${employee.position}` : ''}
              </div>
              <div>
                <span className="text-slate-500">Трактор: </span>
                {selectedEquipment
                  ? `${selectedEquipment.name}${selectedEquipment.plate_number ? ` (${selectedEquipment.plate_number})` : ''}`
                  : <BlankLine width="12rem" />}
              </div>
              <div>
                <span className="text-slate-500">Причіпний інвентар: </span>
                {implements_.length ? implements_.join('; ') : <BlankLine width="12rem" />}
              </div>
              <div>
                <span className="text-slate-500">№ листа: </span>
                <BlankLine width="8rem" />
              </div>
            </div>
          ) : activeTemplate === '67b' ? (
            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <span className="text-slate-500">Тракторист-машиніст: </span>
                <b>{employee.full_name}</b>
                {employee.position ? `, ${employee.position}` : ''}
              </div>
              <div>
                <span className="text-slate-500">Марка, держ. номер трактора (машини): </span>
                <b>
                  {selectedEquipment
                    ? `${selectedEquipment.name}${selectedEquipment.plate_number ? ` (${selectedEquipment.plate_number})` : ''}`
                    : '—'}
                </b>
              </div>
              <div>
                <span className="text-slate-500">Табельний номер: </span>
                <BlankLine width="8rem" />
              </div>
              <div>
                <span className="text-slate-500">Розряд, клас: </span>
                <BlankLine width="8rem" />
              </div>
            </div>
          ) : (
            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <span className="text-slate-500">Водій: </span>
                <b>{employee.full_name}</b>
                {employee.position ? `, ${employee.position}` : ''}
              </div>
              <div>
                <span className="text-slate-500">Автомобіль: </span>
                {selectedEquipment
                  ? `${selectedEquipment.name}${selectedEquipment.plate_number ? ` (${selectedEquipment.plate_number})` : ''}`
                  : <BlankLine width="12rem" />}
              </div>
              <div>
                <span className="text-slate-500">Посвідчення №: </span>
                <BlankLine width="10rem" />
              </div>
              <div>
                <span className="text-slate-500">№ листа: </span>
                <BlankLine width="8rem" />
              </div>
            </div>
          )}

          {activeTemplate === '68' ? (
            <table className="table-base mb-4 w-full">
              <thead>
                <tr>
                  <th style={{ width: '10%' }}>Дата</th>
                  <th style={{ width: '18%' }}>Поле</th>
                  <th style={{ width: '14%' }}>Культура</th>
                  <th style={{ width: '43%' }}>Вид роботи</th>
                  <th className="text-right" style={{ width: '15%' }}>Обсяг</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">{dateLabel(item.work_date)}</td>
                    <td>{item.field_name ?? '—'}</td>
                    <td>{item.crop ? CROP_LABELS[item.crop] : '—'}</td>
                    <td>
                      {item.work_type_name}
                      {item.route_name ? ` · ${item.route_name}` : ''}
                      {item.helper_absent === 1
                        ? ` · хімік 50% (${num(item.helper_amount)} грн)`
                        : ''}
                    </td>
                    <td className="text-right tabular-nums whitespace-nowrap">
                      {num(item.quantity)} {UNIT_LABELS[item.unit]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : activeTemplate === '67b' ? (
            <table className="table-base mb-4 w-full">
              <thead>
                <tr>
                  <th style={{ width: '7%' }}>Дата</th>
                  <th style={{ width: '12%' }}>Місце роботи (поле)</th>
                  <th style={{ width: '19%' }}>Вид виконаної роботи</th>
                  <th style={{ width: '6%' }}>Од. виміру</th>
                  <th className="text-right" style={{ width: '6%' }}>Норма виробітку</th>
                  <th className="text-right" style={{ width: '8%' }}>Розцінка за од.</th>
                  <th className="text-right" style={{ width: '8%' }}>Обсяг виконаних робіт</th>
                  <th className="text-right" style={{ width: '7%' }}>Відпрацьовано, год</th>
                  <th className="text-right" style={{ width: '9%' }}>Сума, грн</th>
                  <th className="text-right" style={{ width: '9%' }}>Хімік 50%, грн</th>
                  <th className="text-right" style={{ width: '9%' }}>Разом, грн</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item) => {
                  const helperAmt = helperAmountOf(item);
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap">{dateLabel(item.work_date)}</td>
                      <td>{item.field_name ?? '—'}</td>
                      <td>
                        {item.crop ? `${item.work_type_name} · ${CROP_LABELS[item.crop]}` : item.work_type_name}
                      </td>
                      <td className="whitespace-nowrap">{UNIT_LABELS[item.unit]}</td>
                      <td className="text-right">&nbsp;</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {num(item.rate)}
                      </td>
                      <td className="text-right tabular-nums">{num(item.quantity)}</td>
                      <td className="text-right tabular-nums">{item.hours ? num(item.hours) : '—'}</td>
                      <td className="text-right tabular-nums">{money(item.total_amount - helperAmt)}</td>
                      <td className="text-right tabular-nums text-amber-700">
                        {helperAmt > 0 ? money(helperAmt) : '—'}
                      </td>
                      <td className="text-right font-medium tabular-nums">{money(item.total_amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={7} className="text-right">
                    Разом:
                  </td>
                  <td className="text-right tabular-nums">{num(totals67b.hours)}</td>
                  <td className="text-right tabular-nums">{money(totals67b.amount - totals67b.helper)}</td>
                  <td className="text-right tabular-nums text-amber-700">
                    {totals67b.helper > 0 ? money(totals67b.helper) : '—'}
                  </td>
                  <td className="text-right tabular-nums">{money(totals67b.amount)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <table className="table-base mb-4 w-full">
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>Дата</th>
                  <th style={{ width: '25%' }}>Маршрут / поле</th>
                  <th style={{ width: '40%' }}>Вантаж / вид роботи</th>
                  <th className="text-right" style={{ width: '15%' }}>Обсяг</th>
                  <th className="text-right" style={{ width: '8%' }}>Ходок</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">{dateLabel(item.work_date)}</td>
                    <td>{item.route_name ?? item.field_name ?? '—'}</td>
                    <td>
                      {item.work_type_name}
                      {item.helper_absent === 1
                        ? ` · хімік 50% (${num(item.helper_amount)} грн)`
                        : ''}
                    </td>
                    <td className="text-right tabular-nums whitespace-nowrap">
                      {num(item.quantity)} {UNIT_LABELS[item.unit]}
                    </td>
                    <td className="text-right tabular-nums">{item.trips ? num(item.trips) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTemplate === '68' ? (
            <div className="mb-6">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Пальне</div>
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th>Марка пального</th>
                    <th className="text-right">Залишок при виїзді</th>
                    <th className="text-right">Видано</th>
                    <th className="text-right">Залишок при поверненні</th>
                    <th className="text-right">Витрата за нормою</th>
                    <th className="text-right">Фактична витрата</th>
                    <th className="text-right">Економія / перевитрата</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: 7 }).map((_, i) => (
                      <td key={i}>&nbsp;</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : activeTemplate === '67b' ? (
            <div className="mb-6">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Пальне та мастильні матеріали
              </div>
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th>Найменування</th>
                    <th className="text-right">Норма витрати</th>
                    <th className="text-right">Фактично витрачено</th>
                    <th className="text-right">Економія / перевитрата</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <td key={i}>&nbsp;</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mb-6">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Пробіг і пальне</div>
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th>Одометр виїзд</th>
                    <th>Одометр повернення</th>
                    <th>Загальний пробіг</th>
                    <th>Пальне видано</th>
                    <th>Пальне залишок</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <td key={i}>&nbsp;</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-10 gap-y-6 pt-4 text-sm">
            {(activeTemplate === '68'
              ? ['Тракторист', 'Бригадир / агроном', 'Обліковець']
              : activeTemplate === '67b'
                ? ['Тракторист-машиніст', 'Бригадир (агроном)', 'Обліковець']
                : ['Диспетчер (виїзд дозволено)', 'Механік (технічний стан)', 'Водій', 'Лікар (передрейсовий огляд)']
            ).map((label) => (
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
