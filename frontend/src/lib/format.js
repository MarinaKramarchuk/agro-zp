const moneyFormatter = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

export const money = (value) => moneyFormatter.format(Number(value ?? 0));
export const num = (value) => numberFormatter.format(Number(value ?? 0));

export const today = () => new Date().toISOString().slice(0, 10);

export const pad = (n) => String(n).padStart(2, '0');

export const monthRange = (year, month) => ({
  date_from: `${year}-${pad(month)}-01`,
  date_to: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`,
});

export const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

const WEEKDAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export const weekdayOf = (year, month, day) => WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
export const isWeekend = (year, month, day) => [0, 6].includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay());

export const dateLabel = (iso) => {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
};

export const STAFF_GROUPS = {
  driver: 'Водій',
  tractor: 'Тракторист',
  other: 'Інше',
};

export const EQUIPMENT_CATEGORIES = {
  tractor: 'Трактор',
  truck: 'Вантажівка',
  combine: 'Комбайн',
  loader: 'Навантажувач',
  sprayer: 'Обприскувач',
  implement: 'Причіпне/знаряддя',
  other: 'Інше',
};

export const UNIT_LABELS = {
  ha: 'га',
  ton: 'тонни',
  km: 'км',
  tkm: 'т·км',
  hour: 'години',
  trip: 'ходка/рейс',
  bale: 'тюк',
  day: 'день',
};

export const CROP_LABELS = {
  wheat: 'Пшениця',
  rye: 'Жито',
  barley: 'Ячмінь',
  corn: 'Кукурудза',
  sunflower: 'Соняшник',
  rapeseed: 'Ріпак',
  soy: 'Соя',
  pea: 'Горох',
  future_harvest: 'Майбутній врожай',
};

export const CARGO_TYPE_LABELS = {
  chaff: 'Полова',
  grain_waste: 'Зерновідходи',
};

export const METRIC_LABELS = {
  hours: 'Годин',
  area_ha: 'Га',
  tons: 'Тонн',
  distance_km: 'Відстань, км',
  cargo_tons: 'Вантаж, т',
  trips: 'Ходок/рейсів',
  bales: 'Тюків',
  days: 'Днів',
};
