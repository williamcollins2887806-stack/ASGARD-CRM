import WelcomeWidget from './WelcomeWidget';
import QuickActionsWidget from './QuickActionsWidget';
import TodoWidget from './TodoWidget';
import ApprovalsWidget from './ApprovalsWidget';
import BankSummaryWidget from './BankSummaryWidget';
import BirthdaysWidget from './BirthdaysWidget';
import CalendarWidget from './CalendarWidget';
import CashBalanceWidget from './CashBalanceWidget';
import EquipmentAlertsWidget from './EquipmentAlertsWidget';
import EquipmentValueWidget from './EquipmentValueWidget';
import GanttMiniWidget from './GanttMiniWidget';
import KpiSummaryWidget from './KpiSummaryWidget';
import MoneySummaryWidget from './MoneySummaryWidget';
import MyCashBalanceWidget from './MyCashBalanceWidget';
import MyMailWidget from './MyMailWidget';
import MyWorksWidget from './MyWorksWidget';
import NotificationsWidget from './NotificationsWidget';
import OverdueWorksWidget from './OverdueWorksWidget';
import PayrollPendingWidget from './PayrollPendingWidget';
import PermitsExpiryWidget from './PermitsExpiryWidget';
import PlatformAlertsWidget from './PlatformAlertsWidget';
import PreTendersWidget from './PreTendersWidget';
import ReceiptScannerWidget from './ReceiptScannerWidget';
import TeamWorkloadWidget from './TeamWorkloadWidget';
import TelephonyWidget from './TelephonyWidget';
import TenderDynamicsWidget from './TenderDynamicsWidget';
import TendersFunnelWidget from './TendersFunnelWidget';

/** Реестр: id → { component, name, icon, size, roles, hero? } */
export const WIDGET_REGISTRY = {
  welcome:          { component: WelcomeWidget,          name: 'Приветствие',          icon: '👋', size: 'normal', roles: ['*'] },
  quick_actions:    { component: QuickActionsWidget,     name: 'Быстрые действия',     icon: '⚡', size: 'normal', roles: ['*'] },
  todo:             { component: TodoWidget,             name: 'Мои задачи',           icon: '✅', size: 'normal', roles: ['*'] },
  approvals:        { component: ApprovalsWidget,        name: 'Согласования',          icon: '✍️', size: 'normal', roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
  bank_summary:     { component: BankSummaryWidget,      name: 'Банковская сводка',     icon: '🏦', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'] },
  birthdays:        { component: BirthdaysWidget,        name: 'Дни рождения',          icon: '🎂', size: 'normal', roles: ['*'] },
  calendar:         { component: CalendarWidget,         name: 'Календарь',             icon: '📅', size: 'normal', roles: ['*'] },
  cash_balance:     { component: CashBalanceWidget,      name: 'Баланс КАССА',          icon: '💵', size: 'normal', roles: ['ADMIN','BUH','DIRECTOR_*'] },
  equipment_alerts: { component: EquipmentAlertsWidget,  name: 'Оборудование • Алерты', icon: '🛠', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','WAREHOUSE','DIRECTOR_*'] },
  equipment_value:  { component: EquipmentValueWidget,   name: 'Стоимость ТМЦ',        icon: '📦', size: 'normal', roles: ['ADMIN','CHIEF_ENGINEER','DIRECTOR_*'] },
  gantt_mini:       { component: GanttMiniWidget,        name: 'Ближайшие дедлайны',    icon: '⏰', size: 'normal', roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
  kpi_summary:      { component: KpiSummaryWidget,       name: 'KPI сводка',            icon: '🎯', size: 'wide',   roles: ['ADMIN','DIRECTOR_*'] },
  money_summary:    { component: MoneySummaryWidget,     name: 'Финансы',               icon: '💰', size: 'normal', roles: ['ADMIN','DIRECTOR_*'], hero: true },
  my_cash_balance:  { component: MyCashBalanceWidget,    name: 'Мои подотчётные',       icon: '💼', size: 'normal', roles: ['*'] },
  my_mail:          { component: MyMailWidget,           name: 'Моя почта',             icon: '📧', size: 'normal', roles: ['*'] },
  my_works:         { component: MyWorksWidget,          name: 'Мои работы',            icon: '🔧', size: 'normal', roles: ['PM','HEAD_PM'] },
  notifications:    { component: NotificationsWidget,    name: 'Уведомления',           icon: '🔔', size: 'normal', roles: ['*'] },
  overdue_works:    { component: OverdueWorksWidget,     name: 'Просроченные работы',   icon: '⚠️', size: 'wide',   roles: ['ADMIN','PM','HEAD_PM','DIRECTOR_*'] },
  payroll_pending:  { component: PayrollPendingWidget,   name: 'Ведомости (ожидание)',   icon: '📋', size: 'normal', roles: ['ADMIN','BUH','PM','HEAD_PM','DIRECTOR_*'] },
  permits_expiry:   { component: PermitsExpiryWidget,    name: 'Истекающие допуски',    icon: '🛡', size: 'wide',   roles: ['ADMIN','HR','HR_MANAGER','HEAD_TO','CHIEF_ENGINEER','DIRECTOR_*'] },
  platform_alerts:  { component: PlatformAlertsWidget,   name: 'Тендерные площадки',    icon: '🏗', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
  pre_tenders:      { component: PreTendersWidget,       name: 'Заявки',                icon: '🤖', size: 'normal', roles: ['ADMIN','HEAD_TO','DIRECTOR_*'] },
  receipt_scanner:  { component: ReceiptScannerWidget,   name: 'Сканер чеков',          icon: '📷', size: 'normal', roles: ['PM','HEAD_PM'] },
  team_workload:    { component: TeamWorkloadWidget,     name: 'Загрузка РП',           icon: '📊', size: 'wide',   roles: ['ADMIN','HEAD_PM','DIRECTOR_*'] },
  telephony_status: { component: TelephonyWidget,        name: 'Телефония',             icon: '📞', size: 'normal', roles: ['ADMIN','DIRECTOR_*','PM','HEAD_PM','TO','HEAD_TO','BUH'] },
  tender_dynamics:  { component: TenderDynamicsWidget,   name: 'Динамика тендеров',     icon: '📈', size: 'wide',   roles: ['ADMIN','TO','HEAD_TO','DIRECTOR_*'] },
  tenders_funnel:   { component: TendersFunnelWidget,    name: 'Воронка',               icon: '📊', size: 'normal', roles: ['ADMIN','TO','HEAD_TO','PM','DIRECTOR_*'] },
};

/** Дефолтный набор виджетов по роли */
export const DEFAULT_LAYOUTS = {
  ADMIN:          ['welcome','kpi_summary','pre_tenders','quick_actions','overdue_works','tenders_funnel','my_mail','notifications'],
  PM:             ['welcome','quick_actions','my_works','my_cash_balance','gantt_mini','todo','my_mail','notifications','birthdays'],
  TO:             ['welcome','quick_actions','tenders_funnel','tender_dynamics','my_mail','notifications'],
  HEAD_TO:        ['welcome','pre_tenders','platform_alerts','tender_dynamics','tenders_funnel','my_mail','notifications'],
  HEAD_PM:        ['welcome','team_workload','overdue_works','gantt_mini','my_mail','notifications'],
  CHIEF_ENGINEER: ['welcome','equipment_value','equipment_alerts','my_mail','notifications'],
  HR:             ['welcome','permits_expiry','birthdays','my_mail','notifications','calendar'],
  BUH:            ['welcome','cash_balance','bank_summary','money_summary','my_mail','notifications'],
  DEFAULT:        ['welcome','my_mail','notifications','todo','calendar','birthdays'],
};

/** Проверка роли виджета */
export function roleMatch(userRole, widgetRoles) {
  if (widgetRoles.includes('*')) return true;
  const r = userRole || '';
  return widgetRoles.some(wr => {
    if (wr.endsWith('*') && r.startsWith(wr.slice(0, -1))) return true;
    if (wr === r) return true;
    if (r === 'HEAD_TO' && wr === 'TO') return true;
    if (r === 'HEAD_PM' && wr === 'PM') return true;
    if (r === 'HR_MANAGER' && wr === 'HR') return true;
    return false;
  });
}

/** Получить лейаут для роли */
export function getLayout(role) {
  if (role?.startsWith('DIRECTOR')) return DEFAULT_LAYOUTS.ADMIN;
  return DEFAULT_LAYOUTS[role] || DEFAULT_LAYOUTS.DEFAULT;
}
