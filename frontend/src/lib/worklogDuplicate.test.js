import { describe, expect, it } from 'vitest';
import { findDuplicateWorklog } from './worklogDuplicate.js';

const baseItem = {
  id: 1,
  employee_id: 11,
  work_type_id: 19,
  equipment_id: null,
  field_id: null,
};

describe('findDuplicateWorklog', () => {
  it('знаходить запис з тими самими працівник + вид роботи + техніка + поле', () => {
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([baseItem], form)).toBe(baseItem);
  });

  it('не вважає дублем той самий запис, що редагується (form.id === item.id)', () => {
    const form = { id: 1, employee_id: '11', work_type_id: '19', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([baseItem], form)).toBeUndefined();
  });

  it('різна техніка - не дубль', () => {
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '5', field_id: '' };
    expect(findDuplicateWorklog([baseItem], form)).toBeUndefined();
  });

  it('різне поле - не дубль', () => {
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '', field_id: '7' };
    expect(findDuplicateWorklog([baseItem], form)).toBeUndefined();
  });

  it('різний вид роботи - не дубль', () => {
    const form = { id: null, employee_id: '11', work_type_id: '20', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([baseItem], form)).toBeUndefined();
  });

  it('різний працівник - не дубль', () => {
    const form = { id: null, employee_id: '12', work_type_id: '19', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([baseItem], form)).toBeUndefined();
  });

  it('порожній рядок і null для техніки/поля вважаються однаковими', () => {
    const itemWithNull = { ...baseItem, equipment_id: null, field_id: null };
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([itemWithNull], form)).toBe(itemWithNull);
  });

  it('однакова техніка/поле, вказані числом і рядком - все одно дубль', () => {
    const item = { ...baseItem, equipment_id: 5, field_id: 7 };
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '5', field_id: '7' };
    expect(findDuplicateWorklog([item], form)).toBe(item);
  });

  it('порожній список записів - дублів немає', () => {
    const form = { id: null, employee_id: '11', work_type_id: '19', equipment_id: '', field_id: '' };
    expect(findDuplicateWorklog([], form)).toBeUndefined();
  });
});
