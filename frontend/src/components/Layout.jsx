import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { AlertsBell } from './AlertsBell.jsx';
import { PeriodSwitcher } from './PeriodSwitcher.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { getCurrentUserName, setCurrentUserName } from '../lib/currentUser.js';

const MAIN_LINKS = [
  { to: '/', label: 'Огляд', icon: '🏠' },
  { to: '/machine-data', label: 'Дані з техніки', icon: '🛰' },
  { to: '/work-plans', label: 'Плани робіт', icon: '📋' },
  { to: '/worklogs', label: 'Реєстрація роботи', icon: '📝' },
  { to: '/worklogs/journal', label: 'Журнал робіт', icon: '📚' },
  { to: '/worklogs/print', label: 'Друк бланків', icon: '🖨' },
  { to: '/timesheet', label: 'Табель', icon: '📅' },
  { to: '/repair-hours', label: 'Ремонт (години)', icon: '🔧' },
  { to: '/payroll', label: 'Відомість ЗП', icon: '💰' },
  { to: '/field-control', label: 'Контроль гектарів', icon: '🌾' },
];

const REFERENCE_LINKS = [
  { to: '/employees', label: 'Працівники' },
  { to: '/equipment', label: 'Техніка' },
  { to: '/fields', label: 'Поля' },
  { to: '/work-types', label: 'Види робіт' },
  { to: '/tariffs', label: 'Тарифи (Б + К)' },
  { to: '/routes', label: 'Міжміські рейси' },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${
    isActive ? 'bg-green-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
  }`;

const subLinkClass = ({ isActive }) =>
  `block rounded-lg px-3 py-2 text-sm transition ${
    isActive ? 'bg-green-50 font-medium text-green-800' : 'text-slate-600 hover:bg-slate-100'
  }`;

/** Легкий облік "хто вніс запис" - без пароля, ім'я запам'ятовується в цьому
 * браузері й додається до записів, які людина зберігає. */
function UserNameField() {
  const [name, setName] = useState(() => getCurrentUserName());
  const [editing, setEditing] = useState(false);

  const save = (value) => {
    const trimmed = value.trim();
    setName(trimmed);
    setCurrentUserName(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full rounded-lg px-1 py-1 text-left text-xs text-slate-500 hover:bg-slate-100"
        title="Ваше ім'я додається до записів, які ви зберігаєте"
      >
        {name ? (
          <>
            👤 <span className="font-medium text-slate-600">{name}</span>
          </>
        ) : (
          '👤 Вписати своє ім’я…'
        )}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      defaultValue={name}
      placeholder="Ваше ім'я"
      className="field-input px-2 py-1 text-xs"
      onBlur={(e) => save(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

/** Вміст бокової панелі — спільний для десктопної aside й мобільної
 * висувної панелі. onNavigate викликається при кліку на пункт меню (закрити
 * мобільну панель); на десктопі не передається. */
function SidebarContent({ stats, onNavigate }) {
  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-2 px-1">
        <div>
          <div className="text-lg font-bold text-green-700">Агро-Зарплата</div>
          <div className="text-xs text-slate-500">облік шляхових листів</div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-secondary shrink-0 py-1 text-xs"
          title="Оновити сторінку (як F5)"
        >
          ⟳ Оновити
        </button>
      </div>

      <div className="mb-3">
        <PeriodSwitcher />
      </div>

      <div className="mb-3">
        <AlertsBell />
      </div>

      <div className="mb-6">
        <UserNameField />
      </div>

      <nav className="flex flex-col gap-2">
        {MAIN_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/' || link.to === '/worklogs'}
            className={linkClass}
            onClick={onNavigate}
          >
            <span aria-hidden>{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Довідники
        </div>
        <nav className="flex flex-col gap-1">
          {REFERENCE_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={subLinkClass} onClick={onNavigate}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {stats && (
        <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <div>Працівників: {stats.employees}</div>
          <div>Техніки: {stats.equipment}</div>
          <div>Полів: {stats.fields}</div>
          <div>Тарифів: {stats.tariff_rates}</div>
          <div>Шляхових листів: {stats.worklogs}</div>
        </div>
      )}

      <button
        type="button"
        onClick={() => window.open('/help', '_blank', 'noopener,noreferrer')}
        className="mt-6 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-base text-slate-700 hover:bg-slate-100"
        title="Відкрити інструкцію в новому вікні"
      >
        <span aria-hidden>❓</span>
        Довідка
      </button>
    </>
  );
}

export function Layout() {
  const { data: stats } = useQuery('/stats');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Мобільна верхня панель з кнопкою меню — на широких екранах прихована */}
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white p-3 lg:hidden">
        <div className="text-lg font-bold text-green-700">Агро-Зарплата</div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg px-3 py-2 text-2xl leading-none text-slate-600 hover:bg-slate-100"
          aria-label="Відкрити меню"
        >
          ☰
        </button>
      </div>

      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-[85vw] max-w-80 flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Закрити меню"
            >
              ×
            </button>
            <SidebarContent stats={stats} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex w-full flex-col lg:flex-row">
        <aside className="no-print hidden bg-white p-4 lg:block lg:min-h-screen lg:w-72 lg:border-r lg:border-slate-200">
          <SidebarContent stats={stats} />
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
