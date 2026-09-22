/** Прямі INSERT-и в тестову БД (в обхід HTTP-шару) — для швидкого сідінгу фікстур. */

export function seedEmployee(db, overrides = {}) {
  const data = {
    full_name: 'Тестовий Працівник',
    position: 'Тракторист',
    staff_group: 'tractor',
    monthly_rate: null,
    uses_minimum_wage: 0,
    bas_code: null,
    overseer_name: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO employees (full_name, position, staff_group, monthly_rate, uses_minimum_wage, bas_code, overseer_name, note)
       VALUES (@full_name, @position, @staff_group, @monthly_rate, @uses_minimum_wage, @bas_code, @overseer_name, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
}

export function seedWorkType(db, overrides = {}) {
  const data = {
    name: 'Оранка',
    staff_group: 'tractor',
    requires_field: 0,
    is_repair: 0,
    is_area_checked: 0,
    is_helper_role: 0,
    is_transport_rate: 0,
    bas_code: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO work_types (name, staff_group, requires_field, is_repair, is_area_checked, is_helper_role, is_transport_rate, bas_code, note)
       VALUES (@name, @staff_group, @requires_field, @is_repair, @is_area_checked, @is_helper_role, @is_transport_rate, @bas_code, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM work_types WHERE id = ?').get(info.lastInsertRowid);
}

export function seedEquipmentModel(db, overrides = {}) {
  const data = {
    key: `model_${Math.random().toString(36).slice(2, 8)}`,
    label: 'МТЗ',
    category: 'tractor',
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(`INSERT INTO equipment_models (key, label, category, note) VALUES (@key, @label, @category, @note)`)
    .run(data);
  return db.prepare('SELECT * FROM equipment_models WHERE id = ?').get(info.lastInsertRowid);
}

export function seedEquipment(db, overrides = {}) {
  const data = {
    name: 'Трактор №1',
    model_id: null,
    plate_number: 'AA0000BB',
    category: 'tractor',
    overseer_name: null,
    bas_code: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO equipment (name, model_id, plate_number, category, overseer_name, bas_code, note)
       VALUES (@name, @model_id, @plate_number, @category, @overseer_name, @bas_code, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM equipment WHERE id = ?').get(info.lastInsertRowid);
}

export function seedField(db, overrides = {}) {
  const data = {
    name: 'Поле №1',
    area_ha: 50,
    crop: null,
    gektera_field_id: null,
    overseer_name: null,
    bas_code: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO fields (name, area_ha, crop, gektera_field_id, overseer_name, bas_code, note)
       VALUES (@name, @area_ha, @crop, @gektera_field_id, @overseer_name, @bas_code, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM fields WHERE id = ?').get(info.lastInsertRowid);
}

export function seedTariff(db, overrides = {}) {
  const data = {
    work_type_id: null,
    equipment_label: null,
    implement_label: null,
    unit: 'ha',
    rate: 100,
    secondary_unit: null,
    secondary_rate: 0,
    is_manual: 0,
    is_default_rate: 0,
    raw_text: null,
    source: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO tariff_rates
         (work_type_id, equipment_label, implement_label, unit, rate,
          secondary_unit, secondary_rate, is_manual, is_default_rate, raw_text, source, note)
       VALUES
         (@work_type_id, @equipment_label, @implement_label, @unit, @rate,
          @secondary_unit, @secondary_rate, @is_manual, @is_default_rate, @raw_text, @source, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM tariff_rates WHERE id = ?').get(info.lastInsertRowid);
}

export function seedWorkPlan(db, overrides = {}) {
  const data = {
    plan_date: '2026-08-01',
    employee_id: null,
    equipment_id: null,
    field_id: null,
    work_type_id: null,
    crop: null,
    note: null,
    created_by: null,
    updated_by: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO work_plans (plan_date, employee_id, equipment_id, field_id, work_type_id, crop, note, created_by, updated_by)
       VALUES (@plan_date, @employee_id, @equipment_id, @field_id, @work_type_id, @crop, @note, @created_by, @updated_by)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM work_plans WHERE id = ?').get(info.lastInsertRowid);
}

export function linkTariffModel(db, rateId, modelId) {
  db.prepare('INSERT INTO tariff_rate_models (rate_id, model_id) VALUES (?, ?)').run(rateId, modelId);
}

export function seedRoute(db, overrides = {}) {
  const data = {
    name: `Маршрут ${Math.random().toString(36).slice(2, 8)}`,
    distance_km: 100,
    rate: 500,
    source: null,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO routes (name, distance_km, rate, source, note)
       VALUES (@name, @distance_km, @rate, @source, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM routes WHERE id = ?').get(info.lastInsertRowid);
}

export function seedKmRate(db, overrides = {}) {
  const data = {
    from_km: 0,
    to_km: null,
    rate: 10,
    note: null,
    ...overrides,
  };
  const info = db
    .prepare(
      `INSERT INTO route_km_rates (from_km, to_km, rate, note)
       VALUES (@from_km, @to_km, @rate, @note)`,
    )
    .run(data);
  return db.prepare('SELECT * FROM route_km_rates WHERE id = ?').get(info.lastInsertRowid);
}
