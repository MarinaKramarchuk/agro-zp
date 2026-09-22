import { useSearchParams } from 'react-router-dom';

function resolveDefault(def) {
  return typeof def === 'function' ? def() : def;
}

/**
 * Синхронізує набір локальних фільтрів сторінки (діапазон дат, вибраний
 * працівник/поле тощо) з query-параметрами URL — щоб перехід на іншу
 * сторінку й назад та оновлення (F5) не скидали фільтр.
 *
 * defaults: { key: value | () => value } — значення, яке показується,
 * поки в URL немає власного (функція читається лениво при кожному
 * рендері — потрібно для дефолтів, залежних від контексту, напр.
 * поточного періоду). Значення, що дорівнює дефолту, з URL прибирається,
 * щоб посилання не засмічувалось.
 *
 * Не для глобального періоду (рік/місяць) — той навмисно живе в
 * PeriodContext+localStorage, іншій семантиці стану.
 */
export function useUrlState(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = {};
  for (const key of Object.keys(defaults)) {
    const raw = searchParams.get(key);
    values[key] = raw !== null ? raw : resolveDefault(defaults[key]);
  }

  const setValues = (patch) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of Object.keys(patch)) {
          const value = patch[key];
          if (value === resolveDefault(defaults[key])) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        return next;
      },
      { replace: true },
    );
  };

  return [values, setValues];
}
