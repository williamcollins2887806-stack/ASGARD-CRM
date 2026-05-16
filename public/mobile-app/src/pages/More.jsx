import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useHaptic } from '@/hooks/useHaptic';
import { hasPermission } from '@/config/rbac';
import { PageShell } from '@/components/layout/PageShell';
import {
  // Продажи
  Trophy, FilePen, Building2, Filter, Calculator,
  // Финансы
  BarChart2, Receipt, FileCheck2, Banknote, Users2,
  Building, Landmark, CreditCard,
  // Персонал
  Users, UserPlus, Plane, ShieldCheck, Stamp, CalendarDays,
  // Документы
  Inbox, Calendar, HardHat, Warehouse, Package,
  ShoppingCart, Disc3, GanttChartSquare,
  // Настройки
  Bell, GraduationCap, Mail, Cpu, Plug, Stethoscope, ListChecks,
  // Прочее
  Sun, Moon, LogOut, ChevronRight,
} from 'lucide-react';

const ROLE_NAMES = {
  ADMIN:          'Администратор',
  PM:             'Руководитель проекта',
  TO:             'Тендерный отдел',
  HEAD_PM:        'Главный РП',
  HEAD_TO:        'Начальник ТО',
  HR:             'HR специалист',
  HR_MANAGER:     'HR менеджер',
  BUH:            'Бухгалтер',
  DIRECTOR_GEN:   'Генеральный директор',
  DIRECTOR_COMM:  'Коммерческий директор',
  DIRECTOR_DEV:   'Директор по развитию',
  OFFICE_MANAGER: 'Офис-менеджер',
  CHIEF_ENGINEER: 'Главный инженер',
  WAREHOUSE:      'Склад',
  PROC:           'Закупки',
};

// ─── Группы меню ───────────────────────────────────────────────────────────
// color  — акцент группы (иконки)
// items  — section: ключ hasPermission, path: маршрут

const GROUPS = [
  {
    key: 'sales',
    label: 'Продажи и тендеры',
    color: 'var(--gold)',
    items: [
      { path: '/tenders',     icon: Trophy,          label: 'Тендеры',      section: 'tenders' },
      { path: '/contracts',   icon: FilePen,          label: 'Договоры',     section: 'tenders' },
      { path: '/customers',   icon: Building2,        label: 'Контрагенты',  section: 'tenders' },
      { path: '/funnel',      icon: Filter,           label: 'Воронка',      section: 'tenders' },
      { path: '/all-estimates',icon: Calculator,      label: 'Расчёты',      section: 'tenders' },
      { path: '/pm-calcs',    icon: Calculator,       label: 'Мои расчёты',  section: 'tenders' },
    ],
  },
  {
    key: 'finance',
    label: 'Финансы',
    color: 'var(--green)',
    items: [
      { path: '/finances',         icon: BarChart2,  label: 'Финансы',       section: 'finances' },
      { path: '/invoices',         icon: Receipt,    label: 'Счета',         section: 'finances' },
      { path: '/acts',             icon: FileCheck2, label: 'Акты',          section: 'finances' },
      { path: '/cash',             icon: Banknote,   label: 'Касса',         section: 'finances' },
      { path: '/payroll',          icon: Users2,     label: 'Ведомости ЗП',  section: 'finances' },
      { path: '/office-expenses',  icon: Building,   label: 'Офис расходы',  section: 'finances' },
      { path: '/cash-admin',       icon: Landmark,   label: 'Касса (упр.)',  section: 'finances' },
      { path: '/approval-payment', icon: CreditCard, label: 'Оплаты',        section: 'finances' },
    ],
  },
  {
    key: 'people',
    label: 'Персонал',
    color: '#7B68EE',
    items: [
      { path: '/personnel',        icon: Users,       label: 'Сотрудники',       section: 'personnel' },
      { path: '/hr-requests',      icon: UserPlus,    label: 'Заявки HR',        section: 'personnel' },
      { path: '/travel',           icon: Plane,       label: 'Командировки',     section: 'personnel' },
      { path: '/permits',          icon: ShieldCheck, label: 'Допуски',          section: 'personnel' },
      { path: '/proxies',          icon: Stamp,       label: 'Доверенности',     section: 'works' },
      { path: '/workers-schedule', icon: CalendarDays,label: 'График рабочих',   section: 'personnel' },
    ],
  },
  {
    key: 'docs',
    label: 'Документы и объекты',
    color: 'var(--blue)',
    items: [
      { path: '/correspondence', icon: Inbox,            label: 'Корреспонденция', section: 'works' },
      { path: '/meetings',       icon: Calendar,         label: 'Совещания',       section: 'dashboard' },
      { path: '/works',          icon: HardHat,          label: 'Работы',          section: 'works' },
      { path: '/warehouse',      icon: Warehouse,        label: 'Склад',           section: 'dashboard' },
      { path: '/tmc-requests',   icon: Package,          label: 'Заявки ТМЦ',     section: 'works' },
      { path: '/proc-requests',  icon: ShoppingCart,     label: 'Закупки',         section: 'works' },
      { path: '/seals',          icon: Disc3,            label: 'Печати',          section: 'works' },
      { path: '/gantt',          icon: GanttChartSquare, label: 'Диаграмма Ганта', section: 'works' },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    color: 'var(--text-secondary)',
    items: [
      { path: '/alerts',       icon: Bell,         label: 'Уведомления',    section: 'dashboard' },
      { path: '/training',     icon: GraduationCap,label: 'Обучение',       section: 'dashboard' },
      { path: '/my-mail',      icon: Mail,         label: 'Почта',          section: 'profile' },
      { path: '/my-equipment', icon: Cpu,          label: 'Оборудование',   section: 'profile' },
      { path: '/integrations', icon: Plug,         label: 'Интеграции',     section: 'settings' },
      { path: '/diag',         icon: Stethoscope,  label: 'Диагностика',    section: 'settings' },
      { path: '/tasks-admin',  icon: ListChecks,   label: 'Все задачи',     section: 'settings' },
    ],
  },
];

// ─── Аккаунт (всегда видны) ────────────────────────────────────────────────
const ACCOUNT_ITEMS = [
  { path: '/profile',  label: 'Профиль',    section: 'profile' },
  { path: '/settings', label: 'Настройки',  section: 'settings' },
];

export default function More() {
  const navigate  = useNavigate();
  const user      = useAuthStore((s) => s.user);
  const logout    = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useThemeStore();
  const haptic    = useHaptic();
  const role      = user?.role;

  const nav = (path) => { haptic.light(); navigate(path); };

  const roleName = ROLE_NAMES[role] || role || 'Пользователь';
  const initials = (user?.full_name || user?.login || 'A')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <PageShell title="Ещё">

      {/* ── Карточка пользователя ─────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 mb-1 flex items-center gap-4"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
          border: '0.5px solid var(--border-norse)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 0ms both',
        }}
      >
        {/* Аватар с градиентной рамкой */}
        <div className="relative shrink-0">
          <div
            style={{
              padding: 2.5,
              background: 'linear-gradient(135deg, var(--brand-red), var(--brand-blue), var(--brand-gold))',
              borderRadius: '50%',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--hero-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {initials}
            </div>
          </div>
          {/* Онлайн-индикатор */}
          <div
            style={{
              position: 'absolute',
              bottom: 1,
              right: 1,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--green)',
              border: '2px solid var(--bg-surface)',
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold truncate c-primary">
            {user?.full_name || user?.login || 'Пользователь'}
          </p>
          <p className="text-[13px] c-secondary mt-0.5 truncate">{roleName}</p>
        </div>

        {/* Аккаунт-ссылки */}
        <div className="flex flex-col gap-1 shrink-0">
          {ACCOUNT_ITEMS.filter((i) => hasPermission(role, i.section)).map((item) => (
            <button
              key={item.path}
              onClick={() => nav(item.path)}
              className="spring-tap text-[12px] font-medium px-3 py-1 rounded-lg"
              style={{
                color: 'var(--gold)',
                background: 'var(--gold-glow)',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Переключатель темы ─────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden mb-4"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
          border: '0.5px solid var(--border-norse)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 50ms both',
        }}
      >
        <button
          onClick={() => { haptic.medium(); toggleTheme(); }}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: theme === 'dark'
                ? 'rgba(255, 204, 0, 0.12)'
                : 'rgba(74, 144, 217, 0.12)',
            }}
          >
            {theme === 'dark'
              ? <Sun size={18} style={{ color: '#FFCC00' }} />
              : <Moon size={18} className="c-blue" />
            }
          </div>
          <span className="flex-1 text-left text-[15px] font-medium c-primary">
            {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </span>
          {/* iOS switch */}
          <div
            style={{
              width: 44,
              height: 26,
              borderRadius: 13,
              background: theme === 'dark' ? 'var(--gold)' : 'var(--bg-elevated)',
              position: 'relative',
              transition: 'background var(--motion-normal) var(--ease-smooth)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 3,
                left: theme === 'dark' ? 21 : 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                transition: 'left var(--motion-normal) var(--ease-spring)',
              }}
            />
          </div>
        </button>
      </div>

      {/* ── Группы меню ───────────────────────────────────────────────── */}
      {GROUPS.map((group, gi) => {
        const visible = group.items.filter((item) => hasPermission(role, item.section));
        if (visible.length === 0) return null;

        return (
          <div
            key={group.key}
            style={{
              animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${100 + gi * 60}ms both`,
              marginBottom: 8,
            }}
          >
            {/* Заголовок секции */}
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                paddingLeft: 4,
                paddingBottom: 8,
                paddingTop: 8,
              }}
            >
              {group.label}
            </p>

            {/* Карточка со списком */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              {visible.map((item, ii) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => nav(item.path)}
                    className="w-full flex items-center gap-3.5 px-4 spring-tap ripple-container"
                    style={{
                      paddingTop: 13,
                      paddingBottom: 13,
                      borderBottom: ii < visible.length - 1
                        ? '0.5px solid var(--border-norse)'
                        : 'none',
                    }}
                  >
                    {/* Иконка с цветом группы */}
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        background: `color-mix(in srgb, ${group.color} 13%, transparent)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={17} style={{ color: group.color }} strokeWidth={1.8} />
                    </div>

                    <span
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        fontSize: 15,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {item.label}
                    </span>

                    <ChevronRight
                      size={16}
                      style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Выход ─────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden mb-2 mt-2"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
          border: '0.5px solid var(--border-norse)',
          animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${100 + GROUPS.length * 60}ms both`,
        }}
      >
        <button
          onClick={() => { haptic.medium(); logout(); navigate('/login'); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-4 spring-tap"
        >
          <LogOut size={18} style={{ color: 'var(--red-soft)' }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--red-soft)' }}>
            Выйти из системы
          </span>
        </button>
      </div>

      {/* Версия */}
      <p
        className="text-center pb-3"
        style={{ fontSize: 11, color: 'var(--text-tertiary)', opacity: 0.4 }}
      >
        ASGARD Mobile v2.0
      </p>
    </PageShell>
  );
}
