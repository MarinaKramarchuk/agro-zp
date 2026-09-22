// Порожній рядок і null - те саме "без техніки/поля" для порівняння дублів.
const normRef = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Шукає серед записів того самого дня запис-"дублікат" форми, що зараз
 * заповнюється: той самий працівник + вид роботи + техніка + поле (сам запис,
 * що редагується - form.id - виключається). Повертає знайдений запис або
 * undefined.
 */
export function findDuplicateWorklog(dayItems, form) {
  return dayItems.find(
    (item) =>
      item.id !== form.id &&
      Number(item.employee_id) === Number(form.employee_id) &&
      Number(item.work_type_id) === Number(form.work_type_id) &&
      normRef(item.equipment_id) === normRef(form.equipment_id) &&
      normRef(item.field_id) === normRef(form.field_id),
  );
}
