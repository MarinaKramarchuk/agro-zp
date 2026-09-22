import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../hooks/useQuery.js';

const POLL_MS = 60_000;

export const ALERTS_EMPTY_TEXT = '✓ Усе розпізнано — нічого не висить непідтвердженим.';

/** Список тривог — спільний для дзвіночка (компактні рядки в дропдауні) і
 * дашборду (більш помітні "чіпи" в горизонтальний ряд). Обидва місця
 * показують той самий /alerts, тож і текст, і розмітку варто тримати в
 * одному місці, а не дублювати. */
export function AlertItems({ items, variant = 'chips', onNavigate }) {
  if (items.length === 0) {
    return (
      <p className={variant === 'chips' ? 'text-sm text-green-700' : 'px-2 py-2 text-sm text-green-700'}>
        {ALERTS_EMPTY_TEXT}
      </p>
    );
  }

  if (variant === 'chips') {
    return (
      <div className="flex flex-wrap gap-3">
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.link}
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100"
          >
            <span className="font-semibold">{item.count}</span> {item.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.link}
          onClick={onNavigate}
          className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-amber-50"
        >
          <span>{item.label}</span>
          <span className="font-semibold text-amber-700">{item.count}</span>
        </Link>
      ))}
    </div>
  );
}

/** Дзвіночок сповіщень у шапці — видимий на будь-якій сторінці, не лише на
 * "Огляді". Агрегує вже наявну detection-логіку (немаплені OVERSEER/Hecterra
 * сутності, перевищення площі поля) через GET /alerts. */
export function AlertsBell() {
  const { data, reload } = useQuery('/alerts');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm text-slate-600 hover:bg-slate-100"
        aria-label="Сповіщення"
      >
        <span aria-hidden>🔔</span>
        <span>Сповіщення</span>
        {total > 0 && (
          <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <AlertItems items={items} variant="rows" onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
