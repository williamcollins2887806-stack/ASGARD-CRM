import { useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { TabBar } from '@/components/layout/TabBar';
import { useSSE } from '@/hooks/useSSE';
import { useChatStore } from '@/stores/chatStore';
import { features } from '@/config/features';
import { normalizeMobileNavUrl, savePinReturnTo } from '@/lib/navUrl';
import PresenceGateMobile from '@/components/PresenceGateMobile';
import PayoutStatementBanner from '@/components/PayoutStatementBanner';
import FieldLayout from '@/layouts/FieldLayout';
import DirectorHome from '@/components/layout/DirectorHome';

/* S2: телефония (jssip, ~220 КБ) — не нужна на каждом экране и не нужна полевым
   рабочим вообще. Грузим её отдельным чанком, вне критического пути.
   ВАЖНО: SoftphoneProvider — ИМЕНОВАННЫЙ экспорт, lazy ждёт { default },
   поэтому маппим .then(m => ({ default: m.SoftphoneProvider })). */
const SoftphoneProvider = lazy(() =>
  import('@/components/telephony/SoftphoneProvider').then((m) => ({ default: m.SoftphoneProvider })));

/* ─── S2: роут-сплиттинг ────────────────────────────────────────────────────
   Раньше здесь было ~126 статических import'ов страниц: Vite собирал их все в
   один чанк 2.36 МБ, который грузился при первом открытии → долгая загрузка на
   мобильной сети. Теперь каждая страница — отдельный чанк, подгружается по
   требованию. Каркас (FieldLayout), гейт роли (DirectorHome) и мелкие утилиты
   остаются статичными. Роль/секция по-прежнему проверяются ProtectedRoute. */
const lazyPage = (loader) => lazy(loader);

const FieldWelcome = lazyPage(() => import('@/pages/field/FieldWelcome'));
const FieldLogin = lazyPage(() => import('@/pages/field/FieldLogin'));
const FieldPinSetup = lazyPage(() => import('@/pages/field/FieldPinSetup'));
const FieldPinEntry = lazyPage(() => import('@/pages/field/FieldPinEntry'));
const FieldHome = lazyPage(() => import('@/pages/field/FieldHome'));
const FieldShift = lazyPage(() => import('@/pages/field/FieldShift'));
const FieldTimesheet = lazyPage(() => import('@/pages/field/FieldTimesheet'));
const FieldProfile = lazyPage(() => import('@/pages/field/FieldProfile'));
const FieldMyWorks = lazyPage(() => import('@/pages/field/FieldMyWorks'));
const FieldMoney = lazyPage(() => import('@/pages/field/FieldMoney'));
const FieldEarnings = lazyPage(() => import('@/pages/field/FieldEarnings'));
const FieldFunds = lazyPage(() => import('@/pages/field/FieldFunds'));
const FieldLogistics = lazyPage(() => import('@/pages/field/FieldLogistics'));
const FieldCrew = lazyPage(() => import('@/pages/field/FieldCrew'));
const FieldReport = lazyPage(() => import('@/pages/field/FieldReport'));
const FieldIncidents = lazyPage(() => import('@/pages/field/FieldIncidents'));
const FieldPhotos = lazyPage(() => import('@/pages/field/FieldPhotos'));
const FieldPacking = lazyPage(() => import('@/pages/field/FieldPacking'));
const FieldStages = lazyPage(() => import('@/pages/field/FieldStages'));
const FieldCrewStages = lazyPage(() => import('@/pages/field/FieldCrewStages'));
const FieldAchievements = lazyPage(() => import('@/pages/field/FieldAchievements'));
const FieldLeaderboard = lazyPage(() => import('@/pages/field/FieldLeaderboard'));
const FieldHall = lazyPage(() => import('@/pages/field/FieldHall'));
const WheelOfNorns = lazyPage(() => import('@/pages/field/WheelOfNorns'));
const FieldShop = lazyPage(() => import('@/pages/field/FieldShop'));
const FieldInventory = lazyPage(() => import('@/pages/field/FieldInventory'));
const FieldAssembly = lazyPage(() => import('@/pages/field/FieldAssembly'));
const FieldPalletBuilder = lazyPage(() => import('@/pages/field/FieldPalletBuilder'));
const FieldReceiving = lazyPage(() => import('@/pages/field/FieldReceiving'));
const FieldQuests = lazyPage(() => import('@/pages/field/FieldQuests'));
const FieldJourney = lazyPage(() => import('@/pages/field/FieldJourney'));
const FieldAcademy = lazyPage(() => import('@/pages/field/FieldAcademy'));
const FieldLesson = lazyPage(() => import('@/pages/field/FieldLesson'));
const FieldAcademyQuiz = lazyPage(() => import('@/pages/field/FieldAcademyQuiz'));
const FieldAcademyLibrary = lazyPage(() => import('@/pages/field/FieldAcademyLibrary'));
const FieldEarningsMonthly = lazyPage(() => import('@/pages/field/FieldEarningsMonthly'));
const FieldSeasonal = lazyPage(() => import('@/pages/field/FieldSeasonal'));
const FieldDiary = lazyPage(() => import('@/pages/field/FieldDiary'));
const FieldReadiness = lazyPage(() => import('@/pages/field/FieldReadiness'));
const PipelineGame = lazyPage(() => import('@/pages/field/PipelineGame'));
const ChemLabGame = lazyPage(() => import('@/pages/field/ChemLabGame'));
const PmDashboard = lazyPage(() => import('@/pages/pm/PmDashboard'));
const PmWorkers = lazyPage(() => import('@/pages/pm/PmWorkers'));
const PmWorkerProfile = lazyPage(() => import('@/pages/pm/PmWorkerProfile'));
const PmTimesheet = lazyPage(() => import('@/pages/pm/PmTimesheet'));
const PmPayments = lazyPage(() => import('@/pages/pm/PmPayments'));
const PmPayoutCart = lazyPage(() => import('@/pages/pm/PmPayoutCart'));
const PmAcademy = lazyPage(() => import('@/pages/pm/PmAcademy'));
const Welcome = lazyPage(() => import('@/pages/Welcome'));
const Login = lazyPage(() => import('@/pages/Login'));
const PinEntry = lazyPage(() => import('@/pages/PinEntry'));
const Home = lazyPage(() => import('@/pages/Home'));
const Tasks = lazyPage(() => import('@/pages/Tasks'));
const HelpTasks = lazyPage(() => import('@/pages/HelpTasks'));
const Chat = lazyPage(() => import('@/pages/Chat'));
const ChatView = lazyPage(() => import('@/pages/ChatView'));
const Mimir = lazyPage(() => import('@/pages/Mimir'));
const Works = lazyPage(() => import('@/pages/Works'));
const Contracts = lazyPage(() => import('@/pages/Contracts'));
const Customers = lazyPage(() => import('@/pages/Customers'));
const Tenders = lazyPage(() => import('@/pages/Tenders'));
const PlatformTenders = lazyPage(() => import('@/pages/tenders/PlatformTenders'));
const TenderGuruSettings = lazyPage(() => import('@/pages/tenders/TenderGuruSettings'));
const Personnel = lazyPage(() => import('@/pages/Personnel'));
const Profile = lazyPage(() => import('@/pages/Profile'));
const Finances = lazyPage(() => import('@/pages/Finances'));
const Approvals = lazyPage(() => import('@/pages/Approvals'));
const Settings = lazyPage(() => import('@/pages/Settings'));
const Correspondence = lazyPage(() => import('@/pages/Correspondence'));
const Alerts = lazyPage(() => import('@/pages/Alerts'));
const Meetings = lazyPage(() => import('@/pages/Meetings'));
const Cash = lazyPage(() => import('@/pages/Cash'));
const Acts = lazyPage(() => import('@/pages/Acts'));
const Invoices = lazyPage(() => import('@/pages/Invoices'));
const HrRequests = lazyPage(() => import('@/pages/HrRequests'));
const Travel = lazyPage(() => import('@/pages/Travel'));
const Procurement = lazyPage(() => import('@/pages/Procurement'));
const Permits = lazyPage(() => import('@/pages/Permits'));
const Proxies = lazyPage(() => import('@/pages/Proxies'));
const AllEstimates = lazyPage(() => import('@/pages/AllEstimates'));
const PmCalcs = lazyPage(() => import('@/pages/PmCalcs'));
const PmDuty = lazyPage(() => import('@/pages/pm/PmDuty'));
const ToCalcs = lazyPage(() => import('@/pages/ToCalcs'));
const HeadToApprovals = lazyPage(() => import('@/pages/HeadToApprovals'));
const Payroll = lazyPage(() => import('@/pages/Payroll'));
const OfficeExpenses = lazyPage(() => import('@/pages/OfficeExpenses'));
const CashAdmin = lazyPage(() => import('@/pages/CashAdmin'));
const TasksAdmin = lazyPage(() => import('@/pages/TasksAdmin'));
const Warehouse = lazyPage(() => import('@/pages/Warehouse'));
const Assembly = lazyPage(() => import('@/pages/Assembly'));
const Gantt = lazyPage(() => import('@/pages/Gantt'));
const WorkersSchedule = lazyPage(() => import('@/pages/WorkersSchedule'));
const WorkerProfile = lazyPage(() => import('@/pages/WorkerProfile'));
const ApprovalPayment = lazyPage(() => import('@/pages/ApprovalPayment'));
const MyEquipment = lazyPage(() => import('@/pages/MyEquipment'));
const MyMail = lazyPage(() => import('@/pages/MyMail'));
const Seals = lazyPage(() => import('@/pages/Seals'));
const Diag = lazyPage(() => import('@/pages/Diag'));
const Training = lazyPage(() => import('@/pages/Training'));
const OfficeAcademy = lazyPage(() => import('@/pages/OfficeAcademy'));
const OfficeLesson = lazyPage(() => import('@/pages/OfficeLesson'));
const OfficeAcademyQuiz = lazyPage(() => import('@/pages/OfficeAcademyQuiz'));
const OfficeAcademyAdmin = lazyPage(() => import('@/pages/OfficeAcademyAdmin'));
const Integrations = lazyPage(() => import('@/pages/Integrations'));
const More = lazyPage(() => import('@/pages/More'));
const GlobalTimesheet = lazyPage(() => import('@/pages/GlobalTimesheet'));
const TimesheetWarehouse = lazyPage(() => import('@/pages/TimesheetWarehouse'));
const TimesheetMedical = lazyPage(() => import('@/pages/TimesheetMedical'));
const TimesheetTravel = lazyPage(() => import('@/pages/TimesheetTravel'));
const PayrollDashboard = lazyPage(() => import('@/pages/PayrollDashboard'));
const OfficialEmployees = lazyPage(() => import('@/pages/OfficialEmployees'));
const TrainingBoard = lazyPage(() => import('@/pages/TrainingBoard'));
const StaffRequests = lazyPage(() => import('@/pages/StaffRequests'));
const PmBalance = lazyPage(() => import('@/pages/PmBalance'));
const CallAnalytics = lazyPage(() => import('@/pages/CallAnalytics'));
const TelephonyHome = lazyPage(() => import('@/pages/TelephonyHome'));
const TelephonyMissed = lazyPage(() => import('@/pages/TelephonyMissed'));
const TelephonyHistory = lazyPage(() => import('@/pages/TelephonyHistory'));
const TelephonyCallDetail = lazyPage(() => import('@/pages/TelephonyCallDetail'));
const EstimateReport = lazyPage(() => import('@/pages/EstimateReport'));
const MimirAutoEstimate = lazyPage(() => import('@/pages/MimirAutoEstimate'));
const HuginnEstimateChat = lazyPage(() => import('@/pages/HuginnEstimateChat'));
const ExpenseChat = lazyPage(() => import('@/pages/ExpenseChat'));
const DirectorApprovals = lazyPage(() => import('@/pages/director/Approvals'));
const DirectorTenderApprovals = lazyPage(() => import('@/pages/director/TenderApprovals'));
const MarketplaceMobile = lazyPage(() => import('@/pages/MarketplaceMobile'));
import { Toaster } from '@/components/ui/sonner';
import { usePushSubscription } from '@/hooks/usePushSubscription';

const PersonalKanban       = lazy(() => import('@/pages/PersonalKanban'));
const PersonalKanbanConfig = lazy(() => import('@/pages/PersonalKanbanConfig'));
const PersonalKanbanV3     = lazy(() => import('@/pages/PersonalKanbanV3'));
const DirectorsInbox       = lazy(() => import('@/pages/DirectorsInbox'));

// Роли, получающие office push (web-push на /api/push/subscribe).
// Полевые (с field_token) идут через FieldHome → /api/field/push/subscribe.
const OFFICE_PUSH_ROLES = new Set([
  'PM', 'HEAD_PM', 'ADMIN',
  'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'HEAD_TO', 'TO', 'BUH', 'HR', 'HR_MANAGER',
  'OFFICE_MANAGER', 'CHIEF_ENGINEER', 'PROC', 'WAREHOUSE',
]);

/**
 * OfficePushBootstrap — один раз на сессию монтирует usePushSubscription{kind:'office'}
 * для авторизованной office-роли и пытается подписать пользователя на web-push
 * (если permission уже granted и подписки ещё нет — идемпотентно).
 * §3.6 — Wave-2 шлёт `inbox_application_assigned` / `personal_kanban_transfer` через push.
 */
function OfficePushBootstrap() {
  const token = useAuthStore((s) => s.token);
  const role  = useAuthStore((s) => s.user?.role);
  const push  = usePushSubscription({ kind: 'office' });
  const triedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (!role || !OFFICE_PUSH_ROLES.has(role)) return;
    if (!push.supported) return;
    if (push.permission !== 'granted') return; // silent skip: не дёргаем requestPermission без user gesture
    if (push.subscribed) return;
    if (push.loading) return;
    if (triedRef.current) return;
    triedRef.current = true;
    // Идемпотентно: subscribe внутренне создаёт запись через ON CONFLICT (см. push routes Wave-2).
    push.subscribe().catch(() => { /* silent */ });
  }, [token, role, push.supported, push.permission, push.subscribed, push.loading, push.subscribe]);

  return null;
}

function PinRoute() {
  const pinStatus = useAuthStore((s) => s.pinStatus);
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/welcome" replace />;
  if (!pinStatus) return <Navigate to="/" replace />;
  return <PinEntry />;
}

/**
 * PageFallback — S2: лёгкий скелетон вместо пустого экрана, пока грузится
 * чанк страницы. Держим нарочно простым: он показывается на каждый навигационный
 * переход, поэтому не должен тянуть ни иконок, ни glass/blur.
 */
function PageFallback() {
  return (
    <div style={{ padding: '72px 16px 24px' }} aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 26, width: '58%', borderRadius: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '34%', marginTop: 10, borderRadius: 8 }} />
      <div style={{ marginTop: 22, display: 'grid', gap: 12 }}>
        <div className="skeleton" style={{ height: 92, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 92, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 92, borderRadius: 16 }} />
      </div>
    </div>
  );
}

function PinGuard({ children }) {  const pinStatus = useAuthStore((s) => s.pinStatus);
  const location = useLocation();
  if (pinStatus === 'need_pin' || pinStatus === 'need_setup') {
    const returnTo = `${location.pathname}${location.search || ''}`;
    savePinReturnTo(returnTo);
    return <Navigate to="/pin" replace />;
  }
  return children;
}

/** Push / SW → открытие нужного экрана после клика по уведомлению. */
function NotificationClickListener() {
  const navigate = useNavigate();
  const pinStatus = useAuthStore((s) => s.pinStatus);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.type !== 'NOTIFICATION_CLICK') return;
      const path = normalizeMobileNavUrl(data.url);
      if (!path) return;
      if (pinStatus === 'need_pin' || pinStatus === 'need_setup') {
        savePinReturnTo(path);
        navigate('/pin', { replace: true });
        return;
      }
      navigate(path);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, pinStatus]);

  return null;
}

function AppLayout() {
  const location = useLocation();
  const incrementChat = useChatStore((s) => s.incrementChat);
  const userId = useAuthStore((s) => s.user?.id);
  const userRole = useAuthStore((s) => s.user?.role);

  // Глобальный SSE: обновляет бейдж непрочитанных с любой страницы.
  // Chat.jsx и ChatView.jsx имеют свои useSSE для отображения сообщений —
  // здесь мы только считаем непрочитанные для TabBar-бейджа.
  useSSE(useCallback((event, data) => {
    if (event !== 'new_message') return;
    // Игнорируем собственные сообщения
    if (data.message?.user_id === userId) return;
    const chatId = data.chat_id;
    if (!chatId) return;
    // Chat.jsx сам пересчитывает total через initFromChats при загрузке
    if (location.pathname === '/chat') return;
    // Если пользователь сейчас в этом чате — он читает, не инкрементируем
    if (location.pathname === `/chat/${chatId}`) return;
    incrementChat(chatId);
  }, [incrementChat, userId, location.pathname]));

  const hideTabBar =
    ['/login', '/pin', '/welcome'].includes(location.pathname) ||
    location.pathname.startsWith('/chat/') ||
    location.pathname === '/mimir' ||
    location.pathname.startsWith('/estimate-report/') ||
    location.pathname.startsWith('/mimir-estimate/') ||
    location.pathname.startsWith('/huginn-chat/') ||
    location.pathname.startsWith('/field') ||
    location.pathname.startsWith('/pm');

  // Гейт присутствия — только для офисных ролей, и НЕ для директоров.
  // V391: у директора на мобильном остаётся ТОЛЬКО экран согласований
  // (заказчик 16.10.2026 — убрать отвлекающее). Гейт «отметься в дружину»
  // перекрывал fixed-оверлеем весь экран и не давал согласовывать. Серверную
  // логику не трогаем — на десктопе/в «Графике офиса» отметка остаётся.
  const isDirector = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'].includes(userRole);
  const showPresenceGate = !isDirector && !(
    ['/login', '/pin', '/welcome'].includes(location.pathname) ||
    location.pathname.startsWith('/field') ||
    location.pathname.startsWith('/pm')
  );

  return (
    <div className="h-full relative" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {showPresenceGate && <PresenceGateMobile />}
      {/* Баннер «выплата получена» — только рабочим/полевым, не директору */}
      {!isDirector && <PayoutStatementBanner />}
      <OfficePushBootstrap />
      <NotificationClickListener />
      {/* S2: ленивый SoftphoneProvider ОБЯЗАН быть внутри Suspense — иначе React
          выбрасывает на ближайший boundary выше (или валит дерево), и, в частности,
          не выполняется initTheme → светлая тема не включается. */}
      <Suspense fallback={null}>
      <SoftphoneProvider>
      <div
        key={location.pathname}
        style={{
          animation: 'pageTransitionIn 180ms var(--ease-smooth-out) both',
          height: '100%',
        }}
      >
      <Suspense fallback={<PageFallback />}>
        <Routes location={location}>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pin" element={<PinRoute />} />
          <Route path="/" element={<ProtectedRoute section="dashboard"><PinGuard><DirectorHome><Home /></DirectorHome></PinGuard></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute section="tasks"><PinGuard><Tasks /></PinGuard></ProtectedRoute>} />
          <Route path="/help" element={<ProtectedRoute section="tasks"><PinGuard><HelpTasks /></PinGuard></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute section="chat"><PinGuard><Chat /></PinGuard></ProtectedRoute>} />
          <Route path="/chat/:chatId" element={<ProtectedRoute section="chat"><PinGuard><ChatView /></PinGuard></ProtectedRoute>} />
          <Route path="/mimir" element={<ProtectedRoute section="chat"><PinGuard><Mimir /></PinGuard></ProtectedRoute>} />
          <Route path="/works" element={<ProtectedRoute section="works"><PinGuard><Works /></PinGuard></ProtectedRoute>} />
          <Route path="/contracts" element={<ProtectedRoute section="tenders"><PinGuard><Contracts /></PinGuard></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute section="tenders"><PinGuard><Customers /></PinGuard></ProtectedRoute>} />
          <Route path="/tenders" element={<ProtectedRoute section="tenders"><PinGuard><Tenders /></PinGuard></ProtectedRoute>} />
          <Route path="/tenders/platform" element={<ProtectedRoute section="tenders"><PinGuard><PlatformTenders /></PinGuard></ProtectedRoute>} />
          <Route path="/tenders/tenderguru-settings" element={<ProtectedRoute section="tenders"><PinGuard><TenderGuruSettings /></PinGuard></ProtectedRoute>} />
          <Route path="/personnel" element={<ProtectedRoute section="personnel"><PinGuard><Personnel /></PinGuard></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute section="profile"><PinGuard><Profile /></PinGuard></ProtectedRoute>} />
          <Route path="/finances" element={<ProtectedRoute section="finances"><PinGuard><Finances /></PinGuard></ProtectedRoute>} />
          <Route path="/approvals" element={<ProtectedRoute section="approvals"><PinGuard><Approvals /></PinGuard></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute section="settings"><PinGuard><Settings /></PinGuard></ProtectedRoute>} />
          <Route path="/correspondence" element={<ProtectedRoute section="works"><PinGuard><Correspondence /></PinGuard></ProtectedRoute>} />
          <Route path="/alerts" element={<ProtectedRoute section="dashboard"><PinGuard><Alerts /></PinGuard></ProtectedRoute>} />
          <Route path="/meetings" element={<ProtectedRoute section="dashboard"><PinGuard><Meetings /></PinGuard></ProtectedRoute>} />
          <Route path="/cash" element={<ProtectedRoute section="finances"><PinGuard><Cash /></PinGuard></ProtectedRoute>} />
          <Route path="/acts" element={<ProtectedRoute section="finances"><PinGuard><Acts /></PinGuard></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute section="finances"><PinGuard><Invoices /></PinGuard></ProtectedRoute>} />
          <Route path="/hr-requests" element={<ProtectedRoute section="personnel"><PinGuard><HrRequests /></PinGuard></ProtectedRoute>} />
          <Route path="/travel" element={<ProtectedRoute section="personnel"><PinGuard><Travel /></PinGuard></ProtectedRoute>} />
          <Route path="/procurement" element={<ProtectedRoute section="works"><PinGuard><Procurement /></PinGuard></ProtectedRoute>} />
          {/* Старые раздробленные маршруты закупок → редирект на единый модуль */}
          <Route path="/tmc-requests" element={<Navigate to="/procurement" replace />} />
          <Route path="/proc-requests" element={<Navigate to="/procurement" replace />} />
          <Route path="/permits" element={<ProtectedRoute section="personnel"><PinGuard><Permits /></PinGuard></ProtectedRoute>} />
          <Route path="/proxies" element={<ProtectedRoute section="works"><PinGuard><Proxies /></PinGuard></ProtectedRoute>} />
          <Route path="/funnel" element={<Navigate to="/tenders" replace />} />
          <Route path="/all-estimates" element={<ProtectedRoute section="tenders"><PinGuard><AllEstimates /></PinGuard></ProtectedRoute>} />
          <Route path="/pm-duty" element={<ProtectedRoute section="tenders"><PinGuard><PmDuty /></PinGuard></ProtectedRoute>} />
          <Route path="/pm-calcs" element={<ProtectedRoute section="tenders"><PinGuard><PmCalcs /></PinGuard></ProtectedRoute>} />
          <Route path="/to-calcs" element={<ProtectedRoute section="tenders"><PinGuard><ToCalcs /></PinGuard></ProtectedRoute>} />
          <Route path="/head-to-approvals" element={<ProtectedRoute section="tenders"><PinGuard><HeadToApprovals /></PinGuard></ProtectedRoute>} />
          <Route path="/payroll" element={<ProtectedRoute section="finances"><PinGuard><Payroll /></PinGuard></ProtectedRoute>} />
          <Route path="/office-expenses" element={<ProtectedRoute section="finances"><PinGuard><OfficeExpenses /></PinGuard></ProtectedRoute>} />
          <Route path="/cash-admin" element={<ProtectedRoute section="finances"><PinGuard><CashAdmin /></PinGuard></ProtectedRoute>} />
          <Route path="/tasks-admin" element={<ProtectedRoute section="settings"><PinGuard><TasksAdmin /></PinGuard></ProtectedRoute>} />
          <Route path="/warehouse" element={<ProtectedRoute section="dashboard"><PinGuard><Warehouse /></PinGuard></ProtectedRoute>} />
          <Route path="/assembly" element={<ProtectedRoute section="works"><PinGuard><Assembly /></PinGuard></ProtectedRoute>} />
          <Route path="/gantt" element={<ProtectedRoute section="works"><PinGuard><Gantt /></PinGuard></ProtectedRoute>} />
          <Route path="/workers-schedule" element={<ProtectedRoute section="personnel"><PinGuard><WorkersSchedule /></PinGuard></ProtectedRoute>} />
          {/* Старый /global-timesheet → редирект на новый /timesheet */}
          <Route path="/global-timesheet" element={<Navigate to="/timesheet" replace />} />
          {/* Новые v2-роуты табелей по ролям (агент E) */}
          <Route path="/timesheet" element={<ProtectedRoute section="personnel"><PinGuard><GlobalTimesheet /></PinGuard></ProtectedRoute>} />
          <Route path="/timesheet-warehouse" element={<ProtectedRoute section="personnel"><PinGuard><TimesheetWarehouse /></PinGuard></ProtectedRoute>} />
          <Route path="/timesheet-medical" element={<ProtectedRoute section="personnel"><PinGuard><TimesheetMedical /></PinGuard></ProtectedRoute>} />
          <Route path="/timesheet-travel" element={<ProtectedRoute section="personnel"><PinGuard><TimesheetTravel /></PinGuard></ProtectedRoute>} />
          <Route path="/my-timesheet" element={<ProtectedRoute section="works"><PinGuard><PmTimesheet /></PinGuard></ProtectedRoute>} />
          <Route path="/training-board" element={<ProtectedRoute section="personnel"><PinGuard><TrainingBoard /></PinGuard></ProtectedRoute>} />
          <Route path="/payroll-dashboard" element={<ProtectedRoute section="finances"><PinGuard><PayrollDashboard /></PinGuard></ProtectedRoute>} />
          <Route path="/official-employees" element={<ProtectedRoute section="finances"><PinGuard><OfficialEmployees /></PinGuard></ProtectedRoute>} />
          <Route path="/pm-balance" element={<ProtectedRoute section="finances"><PinGuard><PmBalance /></PinGuard></ProtectedRoute>} />
          <Route path="/staff-requests" element={<ProtectedRoute section="works"><PinGuard><StaffRequests /></PinGuard></ProtectedRoute>} />
          <Route path="/worker-profile/:id" element={<ProtectedRoute section="personnel"><PinGuard><WorkerProfile /></PinGuard></ProtectedRoute>} />
          <Route path="/approval-payment" element={<ProtectedRoute section="finances"><PinGuard><ApprovalPayment /></PinGuard></ProtectedRoute>} />
          <Route path="/my-equipment" element={<ProtectedRoute section="profile"><PinGuard><MyEquipment /></PinGuard></ProtectedRoute>} />
          <Route path="/my-mail" element={<ProtectedRoute section="profile"><PinGuard><MyMail /></PinGuard></ProtectedRoute>} />
          <Route path="/seals" element={<ProtectedRoute section="works"><PinGuard><Seals /></PinGuard></ProtectedRoute>} />
          <Route path="/diag" element={<ProtectedRoute section="settings"><PinGuard><Diag /></PinGuard></ProtectedRoute>} />
          <Route path="/training" element={<ProtectedRoute section="dashboard"><PinGuard><Training /></PinGuard></ProtectedRoute>} />
          <Route path="/office-academy" element={<ProtectedRoute section="dashboard"><PinGuard><OfficeAcademy /></PinGuard></ProtectedRoute>} />
          <Route path="/office-academy/admin" element={<ProtectedRoute section="settings"><PinGuard><OfficeAcademyAdmin /></PinGuard></ProtectedRoute>} />
          <Route path="/office-academy/:id/quiz" element={<ProtectedRoute section="dashboard"><PinGuard><OfficeAcademyQuiz /></PinGuard></ProtectedRoute>} />
          <Route path="/office-academy/:id" element={<ProtectedRoute section="dashboard"><PinGuard><OfficeLesson /></PinGuard></ProtectedRoute>} />
          <Route path="/integrations" element={<ProtectedRoute section="settings"><PinGuard><Integrations /></PinGuard></ProtectedRoute>} />
          <Route path="/call-analytics" element={<ProtectedRoute section="dashboard"><PinGuard><CallAnalytics /></PinGuard></ProtectedRoute>} />
          <Route path="/telephony" element={<ProtectedRoute section="dashboard"><PinGuard><TelephonyHome /></PinGuard></ProtectedRoute>} />
          <Route path="/telephony/missed" element={<ProtectedRoute section="dashboard"><PinGuard><TelephonyMissed /></PinGuard></ProtectedRoute>} />
          <Route path="/telephony/history" element={<ProtectedRoute section="dashboard"><PinGuard><TelephonyHistory /></PinGuard></ProtectedRoute>} />
          <Route path="/telephony/calls/:id" element={<ProtectedRoute section="dashboard"><PinGuard><TelephonyCallDetail /></PinGuard></ProtectedRoute>} />
          <Route path="/estimate-report/:id" element={<ProtectedRoute section="tenders"><PinGuard><EstimateReport /></PinGuard></ProtectedRoute>} />
          <Route path="/mimir-estimate/:workId" element={<ProtectedRoute section="works"><PinGuard><MimirAutoEstimate /></PinGuard></ProtectedRoute>} />
          <Route path="/huginn-chat/:chatId" element={<ProtectedRoute section="chat"><PinGuard><HuginnEstimateChat /></PinGuard></ProtectedRoute>} />
          <Route path="/expense-chat/:workId" element={<ProtectedRoute section="finances"><PinGuard><ExpenseChat /></PinGuard></ProtectedRoute>} />
          <Route path="/director-approvals" element={<ProtectedRoute section="finances"><PinGuard><DirectorApprovals /></PinGuard></ProtectedRoute>} />
          <Route path="/director-tender-approvals" element={<ProtectedRoute section="tenders"><PinGuard><DirectorTenderApprovals /></PinGuard></ProtectedRoute>} />
          <Route path="/marketplace" element={<ProtectedRoute section="marketplace"><PinGuard><MarketplaceMobile /></PinGuard></ProtectedRoute>} />
          <Route path="/more" element={<ProtectedRoute><PinGuard><More /></PinGuard></ProtectedRoute>} />

          {/* ═══ Личный канбан + Inbox (Волна 3) ═══ */}
          <Route
            path="/personal-kanban"
            element={
              <ProtectedRoute section="personal_kanban">
                <PinGuard>
                  <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-secondary)' }}>Загрузка…</div>}>
                    <PersonalKanban />
                  </Suspense>
                </PinGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/personal-kanban-config"
            element={
              <ProtectedRoute section="personal_kanban">
                <PinGuard>
                  <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-secondary)' }}>Загрузка…</div>}>
                    <PersonalKanbanConfig />
                  </Suspense>
                </PinGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/personal-kanban-v3"
            element={
              <ProtectedRoute section="personal_kanban">
                <PinGuard>
                  <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-secondary)' }}>Загрузка…</div>}>
                    <PersonalKanbanV3 />
                  </Suspense>
                </PinGuard>
              </ProtectedRoute>
            }
          />
          <Route
            path="/director-inbox"
            element={
              <ProtectedRoute section="inbox">
                <PinGuard>
                  <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-secondary)' }}>Загрузка…</div>}>
                    <DirectorsInbox />
                  </Suspense>
                </PinGuard>
              </ProtectedRoute>
            }
          />

          {/* ═══ PM Panel routes ═══ */}
          <Route path="/pm" element={<ProtectedRoute section="works"><PinGuard><PmDashboard /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/workers" element={<ProtectedRoute section="works"><PinGuard><PmWorkers /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/workers/:id" element={<ProtectedRoute section="works"><PinGuard><PmWorkerProfile /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/timesheet" element={<ProtectedRoute section="works"><PinGuard><PmTimesheet /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/payments" element={<ProtectedRoute section="works"><PinGuard><PmPayments /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/payout-cart" element={<ProtectedRoute section="works"><PinGuard><PmPayoutCart /></PinGuard></ProtectedRoute>} />
          <Route path="/pm/academy" element={<ProtectedRoute section="works"><PinGuard><PmAcademy /></PinGuard></ProtectedRoute>} />

          {/* ═══ Field Worker routes (feature-flagged) ═══ */}
          {features.FIELD_REACT_MIGRATION && (
            <>
              <Route path="/field/welcome" element={<FieldWelcome />} />
              <Route path="/field-login" element={<FieldLogin />} />
              <Route path="/field/pin-setup" element={<FieldPinSetup />} />
              <Route path="/field/pin-entry" element={<FieldPinEntry />} />
              <Route path="/field" element={<FieldLayout />}>
                <Route path="home" element={<FieldHome />} />
                <Route path="shift" element={<FieldShift />} />
                <Route path="money" element={<FieldMoney />} />
                <Route path="earnings" element={<FieldEarnings />} />
                <Route path="funds" element={<FieldFunds />} />
                <Route path="history" element={<FieldTimesheet />} />
                <Route path="timesheet" element={<FieldTimesheet />} />
                <Route path="my-works" element={<FieldMyWorks />} />
                <Route path="profile" element={<FieldProfile />} />
                <Route path="crew" element={<FieldCrew />} />
                <Route path="logistics" element={<FieldLogistics />} />
                <Route path="report" element={<FieldReport />} />
                <Route path="incidents" element={<FieldIncidents />} />
                <Route path="photos" element={<FieldPhotos />} />
                <Route path="packing" element={<FieldPacking />} />
                <Route path="assembly" element={<FieldAssembly />} />
                <Route path="assembly/:id" element={<FieldPalletBuilder />} />
                <Route path="receiving" element={<FieldReceiving />} />
                <Route path="stages" element={<FieldStages />} />
                <Route path="crew-stages" element={<FieldCrewStages />} />
                <Route path="achievements" element={<FieldAchievements />} />
                <Route path="leaderboard" element={<FieldLeaderboard />} />
                <Route path="hall/:id" element={<FieldHall />} />
                <Route path="wheel" element={<WheelOfNorns />} />
                <Route path="pipeline" element={<PipelineGame />} />
                <Route path="chemlab" element={<ChemLabGame />} />
                <Route path="chemlab-game" element={<ChemLabGame />} />
                <Route path="shop" element={<FieldShop />} />
                <Route path="inventory" element={<FieldInventory />} />
                <Route path="quests" element={<FieldQuests />} />
                <Route path="seasonal" element={<FieldSeasonal />} />
                <Route path="diary" element={<FieldDiary />} />
                <Route path="readiness" element={<FieldReadiness />} />
                <Route path="journey" element={<FieldJourney />} />
                <Route path="academy" element={<FieldAcademy />} />
                <Route path="academy/library" element={<FieldAcademyLibrary />} />
                <Route path="academy/lesson/:lessonId" element={<FieldLesson />} />
                <Route path="academy/quiz/:lessonId" element={<FieldAcademyQuiz />} />
                <Route path="earnings/monthly" element={<FieldEarningsMonthly />} />
                <Route index element={<Navigate to="home" replace />} />
              </Route>
            </>
          )}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </div>
      {!hideTabBar && <TabBar />}
      <Toaster position="top-center" richColors closeButton />
      </SoftphoneProvider>
      </Suspense>
    </div>
  );
}

export default function App() {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const token = useAuthStore((s) => s.token);
  const initTheme = useThemeStore((s) => s.initTheme);

  useEffect(() => {
    initTheme();
    if (token) {
      fetchUser();
    } else {
      useAuthStore.setState({ loading: false });
    }
  }, []);

  return (
    <BrowserRouter basename="/m">
      <AppLayout />
    </BrowserRouter>
  );
}
