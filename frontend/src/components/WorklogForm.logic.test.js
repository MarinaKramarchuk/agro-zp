import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_WORKLOG_FORM, toPayload, worklogFormFromRecord } from './WorklogForm.jsx';

const USER_KEY = 'agro-zp:user-name';

describe('worklogFormFromRecord', () => {
  it('заповнює форму зі збереженого запису, відсутні поля -> порожній рядок', () => {
    const item = { id: 5, work_date: '2026-09-11', employee_id: 8, tons: 12 };
    const form = worklogFormFromRecord(item);

    expect(form.id).toBe(5);
    expect(form.work_date).toBe('2026-09-11');
    expect(form.employee_id).toBe(8);
    expect(form.tons).toBe(12);
    expect(form.hours).toBe('');
    expect(form.note).toBe('');
  });

  it('null-значення в записі теж перетворюються на порожній рядок', () => {
    const item = { id: 1, work_date: '2026-09-01', field_id: null };
    expect(worklogFormFromRecord(item).field_id).toBe('');
  });

  it('ручна розцінка: тариф і маршрут відсутні -> підтягує rate у manual_rate', () => {
    const item = {
      id: 2,
      work_date: '2026-09-01',
      pay_mode: 'tariff',
      tariff_rate_id: null,
      route_id: null,
      rate: 20,
      work_type_name: 'Перевезення зерна',
    };
    const form = worklogFormFromRecord(item);
    expect(form.manual_rate).toBe(20);
  });

  it('є tariff_rate_id -> це не ручна розцінка, manual_rate лишається порожнім', () => {
    const item = {
      id: 3,
      work_date: '2026-09-01',
      pay_mode: 'tariff',
      tariff_rate_id: 42,
      route_id: null,
      rate: 20,
    };
    const form = worklogFormFromRecord(item);
    expect(form.manual_rate).toBe('');
  });

  it('погодинний запис (pay_mode hourly) -> теж не ручна розцінка', () => {
    const item = { id: 4, work_date: '2026-09-01', pay_mode: 'hourly', tariff_rate_id: null, route_id: null, rate: 15 };
    expect(worklogFormFromRecord(item).manual_rate).toBe('');
  });

  it('ручна розцінка + вид роботи "рейс/маршрут" -> route_id стає сентинелом ручного маршруту', () => {
    const item = {
      id: 6,
      work_date: '2026-09-01',
      pay_mode: 'tariff',
      tariff_rate_id: null,
      route_id: null,
      work_type_name: 'Міжміський рейс',
    };
    expect(worklogFormFromRecord(item).route_id).toBe('__manual__');
  });

  it('ручна розцінка, але вид роботи не рейс -> route_id лишається порожнім', () => {
    const item = {
      id: 7,
      work_date: '2026-09-01',
      pay_mode: 'tariff',
      tariff_rate_id: null,
      route_id: null,
      work_type_name: 'Ремонтні роботи водіїв',
    };
    expect(worklogFormFromRecord(item).route_id).toBe('');
  });

  it('helper_absent=1 -> підтягує helper_work_type_id; helper_absent=0 -> ігнорує його', () => {
    const withHelper = worklogFormFromRecord({ id: 8, work_date: '2026-09-01', helper_absent: 1, helper_work_type_id: 12 });
    expect(withHelper.helper_work_type_id).toBe(12);

    const withoutHelper = worklogFormFromRecord({
      id: 9,
      work_date: '2026-09-01',
      helper_absent: 0,
      helper_work_type_id: 12,
    });
    expect(withoutHelper.helper_work_type_id).toBe('');
  });
});

describe('toPayload', () => {
  beforeEach(() => {
    localStorage.setItem(USER_KEY, 'Обліковець');
  });

  afterEach(() => {
    localStorage.clear();
  });

  const base = { ...EMPTY_WORKLOG_FORM, work_date: '2026-09-11' };

  it('порожні числові поля -> null, заповнені -> число (не рядок)', () => {
    const payload = toPayload({ ...base, employee_id: '8', tons: '12', hours: '' });
    expect(payload.employee_id).toBe(8);
    expect(payload.tons).toBe(12);
    expect(payload.hours).toBeNull();
  });

  it('work_date_to: порожній рядок -> null', () => {
    expect(toPayload({ ...base, work_date_to: '' }).work_date_to).toBeNull();
    expect(toPayload({ ...base, work_date_to: '2026-09-12' }).work_date_to).toBe('2026-09-12');
  });

  it('pay_mode: тільки "hourly" зберігається як є, усе інше -> "tariff"', () => {
    expect(toPayload({ ...base, pay_mode: 'hourly' }).pay_mode).toBe('hourly');
    expect(toPayload({ ...base, pay_mode: 'tariff' }).pay_mode).toBe('tariff');
    expect(toPayload({ ...base, pay_mode: '' }).pay_mode).toBe('tariff');
  });

  it('route_id: сентинел ручного маршруту -> null, реальний id -> число', () => {
    expect(toPayload({ ...base, route_id: '__manual__' }).route_id).toBeNull();
    expect(toPayload({ ...base, route_id: '' }).route_id).toBeNull();
    expect(toPayload({ ...base, route_id: '3' }).route_id).toBe(3);
  });

  it('helper_absent / transport_pay -> завжди 0 або 1', () => {
    expect(toPayload({ ...base, helper_absent: 1, transport_pay: 0 })).toMatchObject({
      helper_absent: 1,
      transport_pay: 0,
    });
    expect(toPayload({ ...base, helper_absent: 0, transport_pay: 1 })).toMatchObject({
      helper_absent: 0,
      transport_pay: 1,
    });
  });

  it('crop/note/cargo_type: порожній рядок -> null', () => {
    const payload = toPayload({ ...base, crop: '', note: '', cargo_type: '' });
    expect(payload.crop).toBeNull();
    expect(payload.note).toBeNull();
    expect(payload.cargo_type).toBeNull();
  });

  it('cargo_type: значення передається як є', () => {
    expect(toPayload({ ...base, cargo_type: 'chaff' }).cargo_type).toBe('chaff');
  });

  it('created_by шлеться лише при створенні (form.id порожній), не при редагуванні', () => {
    expect(toPayload({ ...base, id: null }).created_by).toBe('Обліковець');
    expect(toPayload({ ...base, id: 55 }).created_by).toBeUndefined();
  });

  it('updated_by шлеться завжди, з імені поточного користувача', () => {
    expect(toPayload({ ...base, id: 55 }).updated_by).toBe('Обліковець');
  });

  it('імʼя користувача не задано -> created_by/updated_by undefined, а не порожній рядок', () => {
    localStorage.clear();
    const payload = toPayload({ ...base, id: null });
    expect(payload.created_by).toBeUndefined();
    expect(payload.updated_by).toBeUndefined();
  });
});
