import { PageShell } from '@/components/layout/PageShell';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useHaptic } from '@/hooks/useHaptic';
import { hasPermission } from '@/config/rbac';
import {
  FileText, DollarSign, Users, ShieldCheck, User, Settings, LogOut,
  Sun, Moon, ChevronRight, Info, Mail, Bell, Calendar, Wallet,
  Receipt, FileCheck, UserPlus, Plane, Package, ShoppingCart,
  Shield, Stamp,
} from 'lucide-react';

const MENU_ITEMS = [
  { path: '/tenders',        icon: FileText,     label: 'Тендеры',         section: 'tenders',   color: 'var(--gold)',   bg: 'var(--gold-glow)' },
  { path: '/contracts',      icon: FileText,     label: 'Договоры',        section: 'tenders',   color: 'var(--blue)',   bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/customers',      icon: Users,        label: 'Контрагенты',     section: 'tenders',   color: '#7B68EE',       bg: 'rgba(123, 104, 238, 0.1)' },
  { path: '/finances',       icon: DollarSign,   label: 'Финансы',         section: 'finances',  color: 'var(--green)',   bg: 'rgba(48, 209, 88, 0.1)' },
  { path: '/invoices',       icon: Receipt,      label: 'Счета',           section: 'finances',  color: 'var(--blue)',    bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/acts',           icon: FileCheck,    label: 'Акты',            section: 'finances',  color: 'var(--green)',   bg: 'rgba(48, 209, 88, 0.1)' },
  { path: '/cash',           icon: Wallet,       label: 'Касса',           section: 'finances',  color: 'var(--gold)',    bg: 'var(--gold-glow)' },
  { path: '/approvals',      icon: ShieldCheck,  label: 'Согласования',    section: 'approvals', color: 'var(--blue)',    bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/personnel',      icon: Users,        label: 'Сотрудники',      section: 'personnel', color: '#7B68EE',        bg: 'rgba(123, 104, 238, 0.1)' },
  { path: '/hr-requests',    icon: UserPlus,     label: 'Заявки HR',       section: 'personnel', color: '#7B68EE',        bg: 'rgba(123, 104, 238, 0.1)' },
  { path: '/travel',         icon: Plane,        label: 'Командировки',    section: 'personnel', color: 'var(--blue)',    bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/correspondence', icon: Mail,         label: 'Корреспонденция', section: 'works',     color: 'var(--gold)',    bg: 'var(--gold-glow)' },
  { path: '/meetings',       icon: Calendar,     label: 'Совещания',       section: 'dashboard', color: 'var(--blue)',    bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/tmc-requests',   icon: Package,      label: 'Заявки ТМЦ',      section: 'works',     color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/proc-requests',  icon: ShoppingCart, label: 'Закупки',         section: 'works',     color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/permits',        icon: Shield,       label: 'Допуски',         section: 'personnel', color: 'var(--green)',    bg: 'rgba(48, 209, 88, 0.1)' },
  { path: '/proxies',        icon: Stamp,        label: 'Доверенности',    section: 'works',     color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/funnel',          icon: FileText,     label: 'Воронка',         section: 'tenders',   color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/all-estimates',  icon: DollarSign,   label: 'Расчёты',         section: 'tenders',   color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/pm-calcs',       icon: DollarSign,   label: 'Мои расчёты',     section: 'tenders',   color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/payroll',        icon: DollarSign,   label: 'Ведомости ЗП',    section: 'finances',  color: 'var(--green)',    bg: 'rgba(48, 209, 88, 0.1)' },
  { path: '/office-expenses',icon: DollarSign,   label: 'Офис расходы',    section: 'finances',  color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/cash-admin',     icon: Wallet,       label: 'Касса (упр.)',    section: 'finances',  color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/approval-payment',icon: DollarSign,  label: 'Оплаты',          section: 'finances',  color: 'var(--green)',    bg: 'rgba(48, 209, 88, 0.1)' },
  { path: '/tasks-admin',    icon: ShieldCheck,  label: 'Все задачи',      section: 'settings',  color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/warehouse',      icon: Package,      label: 'Склад',           section: 'dashboard', color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/gantt',          icon: Calendar,     label: 'Диаграмма Ганта', section: 'works',     color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/workers-schedule',icon: Calendar,    label: 'График рабочих',  section: 'personnel', color: '#7B68EE',         bg: 'rgba(123, 104, 238, 0.1)' },
  { path: '/training',       icon: Users,        label: 'Обучение',        section: 'dashboard', color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/seals',          icon: Stamp,        label: 'Печати',          section: 'works',     color: 'var(--gold)',     bg: 'var(--gold-glow)' },
  { path: '/my-mail',        icon: Mail,         label: 'Почта',           section: 'profile',   color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/my-equipment',   icon: Package,      label: 'Моё оборудование',section: 'profile',   color: 'var(--gold)',    bg: 'var(--gold-glow)' },
  { path: '/integrations',   icon: Settings,     label: 'Интеграции',      section: 'settings',  color: 'var(--blue)',     bg: 'rgba(74, 144, 217, 0.1)' },
  { path: '/diag',           icon: Settings,     label: 'Диагностика',     section: 'settings',  color: 'var(--text-secondary)', bg: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' },
  { path: '/alerts',         icon: Bell,         label: 'Уведомления',     section: 'dashboard', color: 'var(--red-soft)', bg: 'rgba(255, 69, 58, 0.1)' },
];

const ACCOUNT_ITEMS = [
  { path: '/profile',   icon: User,     label: 'Профиль',    section: 'profile',  color: 'var(--text-secondary)', bg: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' },
  { path: '/settings',  icon: Settings, label: 'Настройки',  section: 'settings', color: 'var(--text-secondary)', bg: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)' },
];

export default function More() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useThemeStore();
  const haptic = useHaptic();
  const role = user?.role;

  const visibleMenu = MENU_ITEMS.filter((item) => hasPermission(role, item.section));
  const visibleAccount = ACCOUNT_ITEMS.filter((item) => hasPermission(role, item.section));

  const handleNav = (path) => {
    haptic.light();
    navigate(path);
  };

  const handleThemeToggle = () => {
    haptic.medium();
    toggleTheme();
  };

  const renderItem = ({ path, icon: Icon, label, color, bg }, i) => (
    <button
      key={path}
      onClick={() => handleNav(path)}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap ripple-container"
      style={{
        animation: `fadeInUp var(--motion-normal) var(--ease-smooth) ${i * 40}ms both`,
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: bg }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <span className="flex-1 text-left text-[15px] font-medium c-primary">
        {label}
      </span>
      <ChevronRight size={16} className="c-tertiary" />
    </button>
  );

  return (
    <PageShell title="Ещё">
      {/* User card with gradient ring */}
      <div
        className="rounded-2xl p-4 mb-4 flex items-center gap-3.5 bg-surface"
        style={{
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
        }}
      >
        {/* Gradient ring avatar */}
        <div className="relative shrink-0">
          <div className="gradient-ring">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
              style={{
                background: 'var(--hero-gradient)',
                color: '#fff',
              }}
            >
              {(user?.full_name || user?.login || 'A').charAt(0).toUpperCase()}
            </div>
          </div>
          {/* Online indicator */}
          <div className="online-dot" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[15px] font-semibold truncate c-primary"
          >
            {user?.full_name || user?.login || 'Пользователь'}
          </p>
          <p className="text-xs mt-0.5 c-tertiary">
            {user?.role || ''}
          </p>
        </div>
      </div>

      {/* Theme toggle with sunrise/sunset animation */}
      <div
        className="rounded-2xl overflow-hidden mb-3 bg-surface"
        style={{
          animation: 'fadeInUp var(--motion-normal) var(--ease-enter) 50ms both',
        }}
      >
        <button
          onClick={handleThemeToggle}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 spring-tap"
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden"
            style={{
              backgroundColor: theme === 'dark'
                ? 'rgba(255, 204, 0, 0.12)'
                : 'rgba(74, 144, 217, 0.12)',
              transition: 'background-color var(--motion-normal) var(--ease-smooth)',
            }}
          >
            <div
              style={{
                transition: 'transform var(--motion-slow) var(--ease-spring)',
                transform: theme === 'dark' ? 'rotate(0deg)' : 'rotate(360deg)',
              }}
            >
              {theme === 'dark'
                ? <Sun size={18} style={{ color: '#FFCC00' }} />
                : <Moon size={18} className="c-blue" />
              }
            </div>
          </div>
          <span className="flex-1 text-left text-[15px] font-medium c-primary">
            {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </span>
          <div
            className="w-[42px] h-[26px] rounded-full relative"
            style={{
              backgroundColor: theme === 'dark' ? 'var(--gold)' : 'var(--bg-elevated)',
              transition: 'background-color var(--motion-normal) var(--ease-smooth)',
            }}
          >
            <div
              className="absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all"
              style={{
                left: theme === 'dark' ? '19px' : '3px',
                transition: 'left var(--motion-normal) var(--ease-spring)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </div>
        </button>
      </div>

      {/* Business section label */}
      {visibleMenu.length > 0 && (
        <>
          <div className="section-label">Бизнес</div>
          <div
            className="rounded-2xl overflow-hidden mb-3 divide-y bg-surface"
            style={{ borderColor: 'var(--border-norse)' }}
          >
            {visibleMenu.map((item, i) => renderItem(item, i))}
          </div>
        </>
      )}

      {/* Account section label */}
      <div className="section-label">Аккаунт</div>
      <div
        className="rounded-2xl overflow-hidden mb-3 divide-y bg-surface"
        style={{ borderColor: 'var(--border-norse)' }}
      >
        {visibleAccount.map((item, i) => renderItem(item, i))}
      </div>

      {/* Logout */}
      <div className="rounded-2xl overflow-hidden mb-4 bg-surface">
        <button
          onClick={() => { haptic.medium(); logout(); navigate('/login'); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 spring-tap"
        >
          <LogOut size={18} className="c-red" />
          <span className="text-[15px] font-medium c-red">
            Выйти
          </span>
        </button>
      </div>

      {/* App version */}
      <div className="flex items-center justify-center gap-1.5 pb-2">
        <Info size={11} className="c-tertiary" style={{ opacity: 0.4 }} />
        <p
          className="text-[11px] font-medium c-tertiary"
          style={{ opacity: 0.4 }}
        >
          ASGARD Mobile v2.0.0
        </p>
      </div>
    </PageShell>
  );
}
