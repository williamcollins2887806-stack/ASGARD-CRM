import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/api/useAuth';
import { ModalProvider, ModalGlobalBridge } from '@/modals';
import { ToastContainer } from '@/modals/Notifications';
import AppShell from '@/layout/AppShell';
import { ChunkReloadBoundary, ChunkReloadGlobalListener } from '@/blocks/ChunkReloadBoundary';
import { useGlobalSSE } from '@/hooks/useGlobalSSE';
// Wave 12 — попап входящего звонка через createPortal(document.body).
// Монтируется ВНУТРИ Protected, чтобы SSE-каналы (call:incoming/connected/ended)
// уже были подняты (useGlobalSSE), а user.role был проверен. Источник vanilla:
// public/assets/js/telephony_popup.js (1353 LOC). См. pages/Telephony/IncomingCallPopup.jsx.
import IncomingCallPopup from '@/pages/Telephony/IncomingCallPopup';

// ────────────────────────────────────────────────────────────────────────────
// Волна D-5: глобальный code-split. Главный чанк до этого был 1651 kB —
// большинство страниц рендерятся РАЗ за сессию, тащить их в initial-бандл
// смысла нет. Eager оставлены только: shell/auth-страницы (Welcome/Login/
// Register), Home (стартовая) и MimirFab (виджет на всех страницах).
// Все остальные ~95 страниц — React.lazy → отдельные чанки по 5-80 kB.
// ────────────────────────────────────────────────────────────────────────────

// Eager (стартовая навигация, нужны мгновенно):
import Home from '@/pages/Home';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import MimirFab from '@/widgets/Mimir/MimirFab';

// Lazy (всё остальное):
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Modals = lazy(() => import('@/pages/Modals'));
const Tenders = lazy(() => import('@/pages/Tenders'));
const PmWorks = lazy(() => import('@/pages/PmWorks'));
const PmCalcs = lazy(() => import('@/pages/PmCalcs'));
const AllWorks = lazy(() => import('@/pages/AllWorks'));
const AllEstimates = lazy(() => import('@/pages/AllEstimates'));
const Funnel = lazy(() => import('@/pages/Funnel'));
const Customers = lazy(() => import('@/pages/Customers'));
const Gantt = lazy(() => import('@/pages/Gantt'));
const Approvals = lazy(() => import('@/pages/Approvals'));
const ApprovalPayment = lazy(() => import('@/pages/ApprovalPayment'));
const Tkp = lazy(() => import('@/pages/Tkp'));
const TkpFollowup = lazy(() => import('@/pages/TkpFollowup'));
const EstimateReport = lazy(() => import('@/pages/EstimateReport'));
const PreTenders = lazy(() => import('@/pages/PreTenders'));
const Telephony = lazy(() => import('@/pages/Telephony'));
const MyMail = lazy(() => import('@/pages/MyMail'));
const Chat = lazy(() => import('@/pages/Chat'));
const OfficeAcademy = lazy(() => import('@/pages/OfficeAcademy'));
const TrainingBoard = lazy(() => import('@/pages/TrainingBoard'));
const Birthdays = lazy(() => import('@/pages/Birthdays'));
const Calendar = lazy(() => import('@/pages/Calendar'));
const Tasks = lazy(() => import('@/pages/Tasks'));
const Help = lazy(() => import('@/pages/Help'));
const Alerts = lazy(() => import('@/pages/Alerts'));
const OfficeSchedule = lazy(() => import('@/pages/OfficeSchedule'));
const Travel = lazy(() => import('@/pages/Travel'));
const OfficialEmployees = lazy(() => import('@/pages/OfficialEmployees'));
const GlobalTimesheet = lazy(() => import('@/pages/GlobalTimesheet'));
const Personnel = lazy(() => import('@/pages/Personnel'));
const HrRequests = lazy(() => import('@/pages/HrRequests'));
const HrRating = lazy(() => import('@/pages/HrRating'));
const BonusApproval = lazy(() => import('@/pages/BonusApproval'));
const OneTimePay = lazy(() => import('@/pages/OneTimePay'));
const SelfEmployed = lazy(() => import('@/pages/SelfEmployed'));
const PmBalance = lazy(() => import('@/pages/PmBalance'));
// Readiness экспортирует Pm/Board именованно — lazy через .then(...)
const ReadinessPm    = lazy(() => import('@/pages/Readiness').then(m => ({ default: m.Pm })));
const ReadinessBoard = lazy(() => import('@/pages/Readiness').then(m => ({ default: m.Board })));
const Kanban = lazy(() => import('@/pages/Kanban'));
const BigScreen = lazy(() => import('@/pages/BigScreen'));
const EngineerDashboard = lazy(() => import('@/pages/EngineerDashboard'));
const PmAnalytics = lazy(() => import('@/pages/PmAnalytics'));
const ToAnalytics = lazy(() => import('@/pages/ToAnalytics'));
const ObjectMap = lazy(() => import('@/pages/ObjectMap'));
const Finances = lazy(() => import('@/pages/Finances'));
const BuhRegistry = lazy(() => import('@/pages/BuhRegistry'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const Acts = lazy(() => import('@/pages/Acts'));
const OfficeExpenses = lazy(() => import('@/pages/OfficeExpenses'));
const PayrollDashboard = lazy(() => import('@/pages/PayrollDashboard'));
const Payroll = lazy(() => import('@/pages/Payroll'));
const MyEquipment = lazy(() => import('@/pages/MyEquipment'));
const Contracts = lazy(() => import('@/pages/Contracts'));
const Seals = lazy(() => import('@/pages/Seals'));
const Proxies = lazy(() => import('@/pages/Proxies'));
const PassRequests = lazy(() => import('@/pages/PassRequests'));
const Settings = lazy(() => import('@/pages/Settings'));
const Diag = lazy(() => import('@/pages/Diag'));
const Backup = lazy(() => import('@/pages/Backup'));
const Sync = lazy(() => import('@/pages/Sync'));
const MailSettings = lazy(() => import('@/pages/MailSettings'));
const Mailbox = lazy(() => import('@/pages/Mailbox'));
const Correspondence = lazy(() => import('@/pages/Correspondence'));
const Procurement = lazy(() => import('@/pages/Procurement'));
const SuppliersCatalog = lazy(() => import('@/pages/SuppliersCatalog'));
const Assembly = lazy(() => import('@/pages/Assembly'));
const TmcRequests = lazy(() => import('@/pages/TmcRequests'));
const InboxApplications = lazy(() => import('@/pages/InboxApplications'));
const Calculator = lazy(() => import('@/pages/Calculator'));
const Cash = lazy(() => import('@/pages/Cash'));
const CashAdmin = lazy(() => import('@/pages/CashAdmin'));
const Permits = lazy(() => import('@/pages/Permits'));
const PermitApplications = lazy(() => import('@/pages/PermitApplications'));
const PermitApplicationForm = lazy(() => import('@/pages/PermitApplications/FormPage'));
const TasksAdmin = lazy(() => import('@/pages/TasksAdmin'));
const Warehouse = lazy(() => import('@/pages/Warehouse'));
const GamificationLeaderboard = lazy(() => import('@/pages/GamificationLeaderboard'));
const GamificationAdmin = lazy(() => import('@/pages/GamificationAdmin'));
const PmPrizes = lazy(() => import('@/pages/PmPrizes'));
const AwaitingCustomer = lazy(() => import('@/pages/AwaitingCustomer'));
const ConductorEstimate = lazy(() => import('@/pages/ConductorEstimate'));
const More = lazy(() => import('@/pages/More'));
const UserRequests = lazy(() => import('@/pages/UserRequests'));
const Integrations = lazy(() => import('@/pages/Integrations'));
const CommandMap = lazy(() => import('@/pages/CommandMap'));
const Collections = lazy(() => import('@/pages/Collections'));
const Training = lazy(() => import('@/pages/Training'));
const MyDashboard = lazy(() => import('@/pages/MyDashboard'));
const PreTendersBoard = lazy(() => import('@/pages/PreTenders/Board'));
const WorkersSchedule = lazy(() => import('@/pages/WorkersSchedule'));
const CallReports = lazy(() => import('@/pages/CallReports'));
const KpiWorks = lazy(() => import('@/pages/KpiWorks'));
const KpiMoney = lazy(() => import('@/pages/KpiMoney'));
const Meetings = lazy(() => import('@/pages/Meetings'));
const Reminders = lazy(() => import('@/pages/Reminders'));
const PmConsents = lazy(() => import('@/pages/PmConsents'));
const GamificationDashboard = lazy(() => import('@/pages/GamificationDashboard'));
const ToCalcs = lazy(() => import('@/pages/ToCalcs'));
const HeadToApprovals = lazy(() => import('@/pages/HeadToApprovals'));
const Telegram = lazy(() => import('@/pages/Telegram'));
const BankImport = lazy(() => import('@/pages/BankImport'));
const WorkReport = lazy(() => import('@/pages/WorkReport'));
const AutoReports = lazy(() => import('@/pages/AutoReports'));
const PaymentsReport = lazy(() => import('@/pages/PaymentsReport'));
const SystemPanel = lazy(() => import('@/pages/SystemPanel'));
const FieldTariffs = lazy(() => import('@/pages/FieldTariffs'));
// Волна 4б: личный канбан РП + корзина заявок директора
const PersonalKanban = lazy(() => import('@/pages/PersonalKanban'));
const DirectorsInbox = lazy(() => import('@/pages/DirectorsInbox'));

function Protected({ title, children, roles }) {
  const { user, ready } = useAuth();
  // SSE: открываем глобальное соединение только когда юзер залогинен.
  // Singleton внутри хука — повторные вызовы не открывают второе соединение.
  useGlobalSSE(!!user);
  if (!ready) return (
    <div className="p-24 c-t3" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true">⏳ </span>Проверяем сессию…
    </div>
  );
  if (!user) {
    // CRIT-фикс: было `href='/#/welcome'` — Protected без юзера выкидывал в vanilla.
    window.location.hash = '#/welcome';
    return null;
  }
  if (roles && roles.length && !roles.includes(user.role)) {
    return (
      <AppShell title={title}>
        <div className="card access-denied">
          <h2>🚫 Нет доступа</h2>
          <p>Эта страница доступна для ролей: <strong>{roles.join(', ')}</strong></p>
          <p>Ваша роль: <strong>{user.role}</strong></p>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title={title}>
      {children}
      <IncomingCallPopup />
    </AppShell>
  );
}

/* Full-screen pages bypass the AppShell (sidebar/header) — used for /big-screen. */
function ProtectedBare({ children }) {
  const { user, ready } = useAuth();
  useGlobalSSE(!!user);
  if (!ready) return (
    <div className="p-24 c-t3" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true">⏳ </span>Проверяем сессию…
    </div>
  );
  if (!user) {
    // CRIT-фикс: было `href='/#/welcome'` — ProtectedBare без юзера выкидывал в vanilla.
    window.location.hash = '#/welcome';
    return null;
  }
  return <>{children}<IncomingCallPopup /></>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ModalProvider>
          <ModalGlobalBridge />
          <ToastContainer />
          <ChunkReloadGlobalListener />
          <ChunkReloadBoundary>
          <HashRouter>
            <MimirFab />
            <Suspense fallback={
              <div className="p-24 c-t3" role="status" aria-live="polite" aria-busy="true">
                <span aria-hidden="true">⏳ </span>Загрузка страницы…
              </div>
            }>
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<Protected title="Главная"><Home /></Protected>} />
              <Route path="/dashboard" element={<Protected title="Дашборд руководителя"><Dashboard /></Protected>} />
              <Route path="/modals" element={<Protected title="Каталог модалок" roles={['ADMIN']}><Modals /></Protected>} />
              <Route path="/tenders" element={<Protected title="Сага Тендеров"><Tenders /></Protected>} />
              <Route path="/pm-works" element={<Protected title="Походы"><PmWorks /></Protected>} />
              <Route path="/pm-calcs" element={<Protected title="Просчёты (inbox)"><PmCalcs /></Protected>} />
              <Route path="/all-works" element={<Protected title="Свод Контрактов"><AllWorks /></Protected>} />
              <Route path="/all-estimates" element={<Protected title="Свод Расчётов"><AllEstimates /></Protected>} />
              <Route path="/funnel" element={<Protected title="Воронка продаж"><Funnel /></Protected>} />
              <Route path="/customers" element={<Protected title="Заказчики"><Customers /></Protected>} />
              <Route path="/gantt-calcs"   element={<Protected title="Гантт • Просчёты"><Gantt /></Protected>} />
              <Route path="/gantt-works"   element={<Protected title="Гантт • Работы"><Gantt /></Protected>} />
              <Route path="/gantt-objects" element={<Protected title="Гантт • Объекты"><Gantt /></Protected>} />
              <Route path="/approvals"     element={<Protected title="Согласования"><Approvals /></Protected>} />
              <Route path="/approval-payment" element={<Protected title="Очередь оплаты"><ApprovalPayment /></Protected>} />
              <Route path="/tkp" element={<Protected title="ТКП"><Tkp /></Protected>} />
              <Route path="/tkp-followup" element={<Protected title="Контроль ТКП"><TkpFollowup /></Protected>} />
              <Route path="/office-academy" element={<Protected title="Залы Асгарда"><OfficeAcademy /></Protected>} />
              <Route path="/training-board" element={<Protected title="Обучение и допуски"><TrainingBoard /></Protected>} />
              <Route path="/birthdays" element={<Protected title="Дни рождения"><Birthdays /></Protected>} />
              <Route path="/calendar" element={<Protected title="Календарь встреч"><Calendar /></Protected>} />
              <Route path="/tasks" element={<Protected title="Задачи"><Tasks /></Protected>} />
              <Route path="/help"  element={<Protected title="Помощь коллеги"><Help /></Protected>} />
              <Route path="/alerts" element={<Protected title="Уведомления"><Alerts /></Protected>} />
              <Route path="/office-schedule" element={<Protected title="График офиса"><OfficeSchedule /></Protected>} />
              <Route path="/travel" element={<Protected title="Логистика дружины"><Travel /></Protected>} />
              <Route path="/official-employees" element={<Protected title="Официально устроенные"><OfficialEmployees /></Protected>} />
              <Route path="/global-timesheet" element={<Protected title="Общий табель"><GlobalTimesheet /></Protected>} />
              <Route path="/personnel" element={<Protected title="Дружина"><Personnel /></Protected>} />
              <Route path="/employee" element={<Protected title="Дружина"><Personnel /></Protected>} />
              <Route path="/hr-requests" element={<Protected title="Заявки персонала"><HrRequests /></Protected>} />
              <Route path="/hr-rating" element={<Protected title="Рейтинг дружины"><HrRating /></Protected>} />
              <Route path="/bonus-approval" element={<Protected title="Согласование премий"><BonusApproval /></Protected>} />
              <Route path="/one-time-pay" element={<Protected title="Разовые оплаты"><OneTimePay /></Protected>} />
              <Route path="/self-employed" element={<Protected title="Самозанятые"><SelfEmployed /></Protected>} />
              <Route path="/pm-balance" element={<Protected title="Баланс РП"><PmBalance /></Protected>} />
              <Route path="/pm-balance/:pm_id" element={<Protected title="Баланс РП"><PmBalance /></Protected>} />
              <Route path="/estimate-report" element={<Protected title="Отчёт по смете"><EstimateReport /></Protected>} />
              <Route path="/pre-tenders" element={<Protected title="Заявки (входящие)"><PreTenders /></Protected>} />
              <Route path="/telephony" element={<Protected title="Телефония"><Telephony /></Protected>} />
              <Route path="/my-mail" element={<Protected title="Моя почта"><MyMail /></Protected>} />
              <Route path="/chat" element={<Protected title="Хугинн (Чаты)"><Chat /></Protected>} />
              <Route path="/messenger" element={<Protected title="Хугинн (Чаты)"><Chat /></Protected>} />
              <Route path="/readiness" element={<Protected title="Готовность проектов"><ReadinessPm /></Protected>} />
              <Route path="/readiness-board" element={<Protected title="Сводка готовности по РП"><ReadinessBoard /></Protected>} />
              <Route path="/kanban" element={<Protected title="Канбан-доска задач"><Kanban /></Protected>} />
              {/* ─── Волна 4б: Личный канбан + Корзина заявок директора ─── */}
              <Route path="/personal-kanban" element={<Protected title="Мой канбан" roles={['PM','HEAD_PM','ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']}><PersonalKanban /></Protected>} />
              <Route path="/director-inbox" element={<Protected title="Корзина заявок" roles={['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','HEAD_PM']}><DirectorsInbox /></Protected>} />
              <Route path="/big-screen" element={<ProtectedBare><BigScreen /></ProtectedBare>} />
              <Route path="/engineer-dashboard" element={<Protected title="Кузница Инженера"><EngineerDashboard /></Protected>} />
              <Route path="/pm-analytics" element={<Protected title="Хроники РП"><PmAnalytics /></Protected>} />
              <Route path="/to-analytics" element={<Protected title="Хроники ТО"><ToAnalytics /></Protected>} />
              <Route path="/object-map" element={<Protected title="Карта объектов"><ObjectMap /></Protected>} />
              <Route path="/finances" element={<Protected title="Деньги • Аналитика"><Finances /></Protected>} />
              <Route path="/buh-registry" element={<Protected title="Реестр расходов"><BuhRegistry /></Protected>} />
              <Route path="/invoices" element={<Protected title="Счета и оплаты"><Invoices /></Protected>} />
              <Route path="/acts" element={<Protected title="Акты выполненных работ"><Acts /></Protected>} />
              <Route path="/office-expenses" element={<Protected title="Офисные расходы"><OfficeExpenses /></Protected>} />
              <Route path="/payroll-dashboard" element={<Protected title="Финансы персонала"><PayrollDashboard /></Protected>} />
              <Route path="/payroll"       element={<Protected title="Расчёты с рабочими"><Payroll /></Protected>} />
              <Route path="/payroll-sheet" element={<Protected title="Ведомость"><Payroll mode="sheet" /></Protected>} />
              <Route path="/payroll-grid"  element={<Protected title="Ведомость-сетка"><Payroll mode="grid" /></Protected>} />
              <Route path="/reports/payroll" element={<Protected title="Отчёт по выплатам"><Payroll mode="report" /></Protected>} />
              <Route path="/my-equipment" element={<Protected title="Моё оборудование"><MyEquipment /></Protected>} />
              <Route path="/contracts" element={<Protected title="Реестр договоров"><Contracts /></Protected>} />
              <Route path="/seals" element={<Protected title="Реестр печатей"><Seals /></Protected>} />
              <Route path="/proxies" element={<Protected title="Реестр доверенностей"><Proxies /></Protected>} />
              <Route path="/pass-requests" element={<Protected title="Заявки на пропуск"><PassRequests /></Protected>} />
              <Route path="/settings" element={<Protected title="Кузница Настроек"><Settings /></Protected>} />
              <Route path="/diag" element={<Protected title="Диагностика"><Diag /></Protected>} />
              <Route path="/backup" element={<Protected title="Резерв"><Backup /></Protected>} />
              <Route path="/sync" element={<Protected title="Синхронизация"><Sync /></Protected>} />
              <Route path="/mail-settings" element={<Protected title="Настройки почты"><MailSettings /></Protected>} />
              <Route path="/mailbox" element={<Protected title="Почтовый ящик"><Mailbox /></Protected>} />
              <Route path="/correspondence" element={<Protected title="Корреспонденция"><Correspondence /></Protected>} />
              <Route path="/procurement"    element={<Protected title="Закупки"><Procurement mode="all" /></Protected>} />
              <Route path="/my-procurement" element={<Protected title="Мои заявки на закупку"><Procurement mode="my" /></Protected>} />
              <Route path="/suppliers-catalog" element={<Protected title="Поставщики и цены"><SuppliersCatalog /></Protected>} />
              <Route path="/assembly" element={<Protected title="Ведомости сборки"><Assembly /></Protected>} />
              <Route path="/tmc-requests" element={<Protected title="Заявки на ТМЦ"><TmcRequests /></Protected>} />
              <Route path="/inbox-applications" element={<Protected title="Входящие заявки (AI)"><InboxApplications /></Protected>} />
              <Route path="/calculator" element={<Protected title="Калькулятор работ"><Calculator /></Protected>} />
              <Route path="/cash" element={<Protected title="Казна Дружины"><Cash /></Protected>} />
              <Route path="/cash-admin" element={<Protected title="Казна. Управление"><CashAdmin /></Protected>} />
              <Route path="/permits" element={<Protected title="Разрешения и допуски"><Permits /></Protected>} />
              <Route path="/permit-applications" element={<Protected title="Заявки на оформление разрешений"><PermitApplications /></Protected>} />
              <Route path="/permit-application-form" element={<Protected title="Заявка на оформление"><PermitApplicationForm /></Protected>} />
              <Route path="/tasks-admin" element={<Protected title="Управление задачами"><TasksAdmin /></Protected>} />
              <Route path="/warehouse" element={<Navigate to="/warehouse-v2" replace />} />
              <Route path="/warehouse-v2" element={<Protected title="Склад 2.0"><Warehouse /></Protected>} />
              <Route path="/gamification-leaderboard" element={<Protected title="Зал Одина"><GamificationLeaderboard /></Protected>} />
              <Route path="/gamification-admin" element={<Protected title="Кузница геймификации"><GamificationAdmin /></Protected>} />
              <Route path="/pm-prizes" element={<Protected title="Призы воинов"><PmPrizes /></Protected>} />
              <Route path="/awaiting-customer" element={<Protected title="Ожидание заказчика"><AwaitingCustomer /></Protected>} />
              <Route path="/conductor-estimate" element={<Protected title="War Room Conductor"><ConductorEstimate /></Protected>} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/more" element={<Protected title="Ещё"><More /></Protected>} />
              <Route path="/user-requests" element={<Protected title="Заявки пользователей"><UserRequests /></Protected>} />
              <Route path="/integrations" element={<Protected title="Интеграции"><Integrations /></Protected>} />
              <Route path="/command-map" element={<Protected title="Карта команд"><CommandMap /></Protected>} />
              {/* ─── Заполненные пробелы: real React-страницы ─── */}
              <Route path="/collections"            element={<Protected title="Подборки Дружины"><Collections /></Protected>} />
              <Route path="/training"               element={<Protected title="Заявки на обучение"><Training /></Protected>} />
              <Route path="/my-dashboard"           element={<Protected title="Дашборд РП"><MyDashboard /></Protected>} />
              <Route path="/pre-tenders/board"      element={<Protected title="Канбан заявок"><PreTendersBoard /></Protected>} />
              <Route path="/workers-schedule"       element={<Protected title="График Дружины"><WorkersSchedule /></Protected>} />
              <Route path="/call-reports"           element={<Protected title="Отчёты по звонкам"><CallReports /></Protected>} />
              <Route path="/kpi-works"              element={<Protected title="Ярл • Аналитика Работ"><KpiWorks /></Protected>} />
              <Route path="/kpi-money"              element={<Protected title="Ярл • Аналитика Денег"><KpiMoney /></Protected>} />
              <Route path="/meetings"               element={<Protected title="Совещания"><Meetings /></Protected>} />
              <Route path="/reminders"              element={<Protected title="Напоминания"><Reminders /></Protected>} />
              <Route path="/pm-consents"            element={<Protected title="Согласия РП"><PmConsents /></Protected>} />
              <Route path="/gamification-dashboard" element={<Protected title="Дашборд геймификации"><GamificationDashboard /></Protected>} />
              {/* ─── Редиректы и алиасы ─── */}
              <Route path="/analytics"              element={<Navigate to="/kpi-works" replace />} />
              <Route path="/command-map-flat"       element={<Navigate to="/command-map" replace />} />
              <Route path="/gantt"                  element={<Navigate to="/gantt-objects" replace />} />
              <Route path="/todo"                   element={<Navigate to="/tasks" replace />} />
              <Route path="/system-panel"           element={<Protected title="Панель сервера" roles={['ADMIN']}><SystemPanel /></Protected>} />
              <Route path="/field-tariffs"          element={<Protected title="Тарифы поля" roles={['ADMIN']}><FieldTariffs /></Protected>} />
              <Route path="/equipment"              element={<Navigate to="/warehouse-v2" replace />} />
              <Route path="/customer"               element={<Navigate to="/customers" replace />} />
              <Route path="/mango"                  element={<Navigate to="/telephony" replace />} />
              <Route path="/quests"                 element={<Navigate to="/gamification-admin" replace />} />
              <Route path="/to-calcs"               element={<Protected title="Просчёты ТО"><ToCalcs /></Protected>} />
              <Route path="/head-to-approvals"      element={<Protected title="Согласование ТО"><HeadToApprovals /></Protected>} />
              <Route path="/telegram"               element={<Protected title="Telegram-бот" roles={['ADMIN']}><Telegram /></Protected>} />
              <Route path="/bank-import"            element={<Protected title="Импорт банковских выписок" roles={['ADMIN','BUH','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV']}><BankImport /></Protected>} />
              {/* ─── Отчёты (волна 14.06.2026 — миграция vanilla на v2) ─── */}
              <Route path="/work-report"            element={<Protected title="Финансовый отчёт работы"><WorkReport /></Protected>} />
              <Route path="/auto-reports"           element={<Protected title="Автоотчёты" roles={['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH','HEAD_PM','HEAD_TO']}><AutoReports /></Protected>} />
              <Route path="/payments-report"        element={<Protected title="Отчёт по выплатам" roles={['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV','BUH','HEAD_PM']}><PaymentsReport /></Protected>} />
              {/* Старый алиас vanilla #/reports/payroll → отчёт по выплатам */}
              <Route path="/reports/payments"       element={<Navigate to="/payments-report" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          </HashRouter>
          </ChunkReloadBoundary>
        </ModalProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
