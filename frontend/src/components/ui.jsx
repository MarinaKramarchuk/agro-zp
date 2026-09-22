import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* --- Повідомлення (toast) -------------------------------------------------- */
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-50 flex w-[min(26rem,90vw)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg px-4 py-3 text-sm shadow-lg ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : toast.type === 'info'
                  ? 'bg-slate-800 text-white'
                  : 'bg-green-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* --- Поля форми ------------------------------------------------------------ */
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={`field-input ${className}`} {...props} />;
}

export function Select({ options, placeholder, className = '', ...props }) {
  return (
    <select className={`field-input ${className}`} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Як Select, але з пошуком: вводиш текст - список звужується до варіантів,
 * що містять цей текст у назві (а не лише починаються з нього). Потрібне для
 * довгих довідників (техніка, працівники, поля), де гортати весь список незручно. */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '',
  className = '',
  disabled = false,
  required = false,
  name,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) ?? null,
    [options, value],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const commit = (option) => {
    onChange({ target: { name, value: option ? String(option.value) : '' } });
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        setOpen(true);
        setHighlight(0);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <input
        type="text"
        className="field-input"
        placeholder={placeholder}
        disabled={disabled}
        required={required && !value}
        autoComplete="off"
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      {selected && !open && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          onClick={() => commit(null)}
          aria-label="Очистити вибір"
        >
          ×
        </button>
      )}
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Нічого не знайдено</li>}
          {filtered.map((option, index) => (
            <li
              key={option.value}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                index === highlight
                  ? 'bg-green-50 text-green-800'
                  : String(option.value) === String(value)
                    ? 'font-medium text-slate-800'
                    : 'text-slate-700'
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Textarea({ className = '', ...props }) {
  return <textarea rows={3} className={`field-input ${className}`} {...props} />;
}

/* --- Службові блоки -------------------------------------------------------- */
export function Spinner({ label = 'Завантаження…' }) {
  return (
    <div className="flex items-center gap-3 p-6 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-green-600" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <div className="font-medium">{error.message}</div>
      {Array.isArray(error.details) && (
        <ul className="mt-2 list-disc pl-5">
          {error.details.map((d, i) => (
            <li key={i}>
              {d.path}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
          Спробувати ще
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="p-8 text-center text-slate-500">
      <div className="text-base font-medium text-slate-600">{title}</div>
      {hint && <div className="mt-1 text-sm">{hint}</div>}
    </div>
  );
}

/* --- Сортування таблиць ------------------------------------------------------ */
/** Перемикає стан сортування по кліку на заголовок: та сама колонка -> міняє
 * напрямок, інша колонка -> починає з firstDir (напр. суми зручніше спершу
 * за спаданням - "хто отримав найбільше", текстові поля - за зростанням). */
export function toggleSort(current, key, firstDir = 'asc') {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir };
}

/** Клікабельний заголовок таблиці зі стрілкою напрямку для активної колонки. */
export function SortTh({ label, sortKey, sort, onSort, align = 'left', className = '' }) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 ${align === 'right' ? 'text-right' : ''} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="ml-1 inline-block w-3 text-slate-400">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
    </th>
  );
}

/* --- Модальне вікно -------------------------------------------------------- */
const MODAL_WIDTHS = { md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-7xl' };

export function Modal({ open, title, onClose, children, footer, wide = false, size }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const width = MODAL_WIDTHS[size ?? (wide ? 'lg' : 'md')];

  return (
    <div className="no-print fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className={`card w-full ${width} my-8`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Закрити"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/* --- Підтвердження видалення ---------------------------------------------- */
export function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback(
    // options: { confirmLabel, danger } - за замовчуванням поведінка як була
    // (видалення: червона кнопка "Видалити"), для інших дій - переозначити.
    (message, { confirmLabel = 'Видалити', danger = true } = {}) =>
      new Promise((resolve) => setState({ message, confirmLabel, danger, resolve })),
    [],
  );

  const element = state ? (
    <Modal
      open
      title="Підтвердження"
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
          >
            Скасувати
          </button>
          <button
            type="button"
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
          >
            {state.confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-slate-700">{state.message}</p>
    </Modal>
  ) : null;

  return useMemo(() => ({ confirm, confirmElement: element }), [confirm, element]);
}
