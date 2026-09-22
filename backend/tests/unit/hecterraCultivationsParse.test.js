// Знеособлений звіт Hecterra "Cultivations for unit Китаєць" (серпень 2026) - перший
// реальний формат Hecterra, який ми побачили (раніше єдиним джерелом полів
// був KMZ з межами - інша задача, інший парсер).
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import XLSX from 'xlsx';
import { parseCultivationsRows } from '../../src/services/hecterra/parseCultivationsExport.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/hecterra/Cultivations_for_unit_Китаєць.xlsx');

function loadRows() {
  const workbook = XLSX.readFile(FIXTURE);
  return XLSX.utils.sheet_to_json(workbook.Sheets['Sheet1'], { header: 1, blankrows: false, defval: '' });
}

describe('hecterra/parseCultivationsExport — знеособлений звіт "Cultivations for unit Китаєць"', () => {
  it('групує по (дата, поле), пропускає підсумковий рядок "Обробки N"', () => {
    const activities = parseCultivationsRows(loadRows());
    assert.equal(activities.length, 6, 'на 24.08 два різні поля - мають лишитись двома записами, не злитись');
    for (const a of activities) assert.equal(a.overseer_name, 'Китаєць');
  });

  it('ПРАВИЛО власниці: "Пропуски" додаються в оброблену площу (сенсор іноді хибно позначає оброблене як пропуск)', () => {
    const activities = parseCultivationsRows(loadRows());
    const field10 = activities.find((a) => a.activity_date === '2026-08-25');
    // з файлу: Оброблена площа 12.11 + Пропуски 0.02 = 12.13
    assert.equal(field10.area_ha, 12.13);
    assert.equal(field10.field_area_ha, 14.98);
  });

  it('кілька проходів того самого поля за день сумуються (оброблено+пропуски з обох проходів)', () => {
    const activities = parseCultivationsRows(loadRows());
    const field5V = activities.find((a) => a.field_name_raw === 'Поле № 5-В 37ГА');
    // прохід 1: 6.98+0.29=7.27, прохід 2: 3.33+0.32=3.65 -> 10.92
    assert.equal(field5V.area_ha, 10.92);
    assert.equal(field5V.field_area_ha, 37);

    const field9B = activities.find((a) => a.field_name_raw === 'Поле№ 9-Б  88 га');
    // прохід 1: 3.42+1.02=4.44, прохід 2: 70.46+3.68=74.14 -> 78.58
    assert.equal(field9B.area_ha, 78.58);
  });

  it('дата активності - дата ПОЧАТКУ проходу (не закінчення)', () => {
    const activities = parseCultivationsRows(loadRows());
    // "Ділянка Схід 66 га" почався 22.08 23:22, закінчився 23.08 03:10
    const overnight = activities.find((a) => a.field_name_raw === 'Ділянка Схід 66 га');
    assert.equal(overnight.activity_date, '2026-08-22');
  });

  it('культура з тексту мапиться на закритий список worklogs.crop; "—" -> null', () => {
    const activities = parseCultivationsRows(loadRows());
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле №1-Б 33га').crop, 'rapeseed');
    assert.equal(activities.find((a) => a.field_name_raw === 'Ділянка Схід 66 га').crop, 'sunflower');
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле № 10-Б 15 га').crop, null);
  });

  it('"Тривалість" сумується по кількох проходах і округлюється до цілих годин (без хвилин)', () => {
    const activities = parseCultivationsRows(loadRows());
    // один прохід: "16 хв." -> round(16/60) = 0
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле №1-Б 33га').hours, 0);
    // один прохід: "2 г. 49 хв." = 169 хв -> round(169/60) = 3
    assert.equal(activities.find((a) => a.field_name_raw === 'Ділянка Схід 66 га').hours, 3);
    // два проходи: "15 хв." + "12 хв." = 27 хв -> round(27/60) = 0
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле № 5-В 37ГА').hours, 0);
    // два проходи: "6 хв." + "2 г. 53 хв." = 179 хв -> round(179/60) = 3
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле№ 9-Б  88 га').hours, 3);
  });

  it('РЕГРЕСІЯ: "Озима пшениця"/"Ярий ячмінь" (Hecterra додає озима/яра) теж розпізнаються, не лише точний збіг', () => {
    const header = ['Поле', 'Площа, га', 'Культура', 'Операція', 'Початок', "Об'єкт", 'Водій', 'Оброблена площа, га', 'Пропуски, га'];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const row = (field, crop) => {
      const r = new Array(header.length).fill('');
      r[idx['Поле']] = field;
      r[idx['Площа, га']] = 10;
      r[idx['Культура']] = crop;
      r[idx['Операція']] = 'Обмолот зернових';
      r[idx['Початок']] = '01.08.2026 10:00';
      r[idx["Об'єкт"]] = 'Claas';
      r[idx['Оброблена площа, га']] = 5;
      r[idx['Пропуски, га']] = 0;
      return r;
    };
    const activities = parseCultivationsRows([header, row('Поле А', 'Озима пшениця'), row('Поле Б', 'Ярий ячмінь')]);
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле А').crop, 'wheat');
    assert.equal(activities.find((a) => a.field_name_raw === 'Поле Б').crop, 'barley');
  });

  it('РЕГРЕСІЯ: об\'єднані комірки Поле/Площа/Культура/Операція (реальний звіт "Cultivations for resource") - рядки-деталізація НЕ додаються до підсумку', () => {
    // Реальний "Cultivations for resource ..." (на відміну від "for unit") лишає
    // ці 4 колонки порожніми на рядках-деталізації підсумкового проходу -
    // перший рядок з непорожнім "Поле" вже несе ПІДСУМОК проходу (Оброблена
    // площа/Пропуски/Пробіг/Паливо/Тривалість), а рядки нижче - лише розбивка
    // цього ж підсумку по відрізках часу. Раніше їх сумували з підсумком
    // (форвард-філ + додавання) - площа в програму потрапляла подвоєною-потроєною
    // (був живий баг, знайдений на реальному звіті: сума "Оброблена площа" лише
    // підсумкових рядків день-в-день збігалась з офіційним підсумком аркуша
    // "Обробки N", а разом з деталізацією - ні).
    const header = [
      'Поле', 'Площа, га', 'Культура', 'Операція', 'Початок', "Об'єкт", 'Водій',
      'Оброблена площа, га', 'Пропуски, га', 'Пробіг, км', 'Витрачено палива, л',
    ];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const full = (overrides) => {
      const r = new Array(header.length).fill('');
      Object.assign(r, Object.fromEntries(Object.entries(overrides).map(([k, v]) => [idx[k], v])));
      return r;
    };
    const rows = [
      header,
      // підсумковий рядок проходу - вже містить повну площу/пробіг/паливо
      full({ Поле: 'Поле А', 'Площа, га': 50, Культура: 'Ріпак', Операція: 'Посів', Початок: '01.09.2026 04:00', "Об'єкт": 'JD', Водій: 'Іванов', 'Оброблена площа, га': 10, 'Пропуски, га': 1, 'Пробіг, км': 5, 'Витрачено палива, л': 2 }),
      // деталізація того самого проходу - Поле/Площа/Культура/Операція порожні (об'єднана комірка) - пропускається
      full({ Початок: '01.09.2026 04:00', "Об'єкт": 'JD', Водій: 'Іванов', 'Оброблена площа, га': 6, 'Пропуски, га': 0.5, 'Пробіг, км': 3, 'Витрачено палива, л': 1 }),
      full({ Початок: '01.09.2026 04:30', "Об'єкт": 'JD', Водій: 'Іванов', 'Оброблена площа, га': 4, 'Пропуски, га': 0.5, 'Пробіг, км': 2, 'Витрачено палива, л': 1 }),
    ];
    const activities = parseCultivationsRows(rows);
    assert.equal(activities.length, 1);
    const a = activities[0];
    assert.equal(a.field_name_raw, 'Поле А');
    assert.equal(a.field_area_ha, 50);
    assert.equal(a.crop, 'rapeseed');
    assert.equal(a.work_type_raw, 'Посів');
    assert.equal(a.area_ha, 11); // лише підсумковий рядок: 10 + 1, деталізацію нижче не додаємо
    assert.equal(a.distance_km, 5);
    assert.equal(a.fuel_consumed, 2);
  });

  it('РЕГРЕСІЯ: дві різні одиниці техніки на тому самому полі того самого дня лишаються ДВОМА окремими активностями', () => {
    // Ключ - "поле × дата × техніка" (документовано в importService.js).
    // Раніше ключ групування не включав Об'єкт (техніку) - другу техніку
    // (типово трактор, що підвозить добрива, поки сіялка сіє) тихо зливало
    // з першою в один запис, і вона зникала як окремий рядок.
    const header = ['Поле', 'Площа, га', 'Культура', 'Операція', 'Початок', "Об'єкт", 'Водій', 'Оброблена площа, га', 'Пропуски, га'];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const row = (object, operation, processed) => {
      const r = new Array(header.length).fill('');
      r[idx['Поле']] = 'Поле А';
      r[idx['Площа, га']] = 50;
      r[idx['Операція']] = operation;
      r[idx['Початок']] = '01.09.2026 04:00';
      r[idx["Об'єкт"]] = object;
      r[idx['Оброблена площа, га']] = processed;
      r[idx['Пропуски, га']] = 0;
      return r;
    };
    const activities = parseCultivationsRows([
      header,
      row('JD25384ВА Новий', 'Посів з добривами', 10),
      row('МТЗ 00000 КЕ Іванов', 'Доставка добрив', 1),
    ]);
    assert.equal(activities.length, 2);
    const sowing = activities.find((a) => a.overseer_name === 'JD25384ВА Новий');
    const delivery = activities.find((a) => a.overseer_name === 'МТЗ 00000 КЕ Іванов');
    assert.equal(sowing.area_ha, 10);
    assert.equal(sowing.work_type_raw, 'Посів з добривами');
    assert.equal(delivery.area_ha, 1);
    assert.equal(delivery.work_type_raw, 'Доставка добрив');
  });
});
