import { useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { TabBar } from '@/components/layout/TabBar';
import { useSSE } from '@/hooks/useSSE';
import { useChatStore } from '@/stores/chatStore';
import { features } from '@/config/features';
import PresenceGateMobile from '@/components/PresenceGateMobile';
import FieldLayout from '@/layouts/FieldLayout';
import FieldWelcome from '@/pages/field/FieldWelcome';
import FieldLogin from '@/pages/field/FieldLogin';
import FieldPinSetup from '@/pages/field/FieldPinSetup';
import FieldPinEntry from '@/pages/field/FieldPinEntry';
import FieldHome from '@/pages/field/FieldHome';
import FieldShift from '@/pages/field/FieldShift';
import FieldHistory from '@/pages/field/FieldHistory';
import FieldProfile from '@/pages/field/FieldProfile';
import FieldMyWorks from '@/pages/field/FieldMyWorks';
import FieldMoney from '@/pages/field/FieldMoney';
import FieldEarnings from '@/pages/field/FieldEarnings';
import FieldFunds from '@/pages/field/FieldFunds';
import FieldLogistics from '@/pages/field/FieldLogistics';
import FieldCrew from '@/pages/field/FieldCrew';
import FieldReport from '@/pages/field/FieldReport';
import FieldIncidents from '@/pages/field/FieldIncidents';
import FieldPhotos from '@/pages/field/FieldPhotos';
import FieldPacking from '@/pages/field/FieldPacking';
import FieldStages from '@/pages/field/FieldStages';
import FieldCrewStages from '@/pages/field/FieldCrewStages';
import FieldAchievements from '@/pages/field/FieldAchievements';
import FieldLeaderboard from '@/pages/field/FieldLeaderboard';
import WheelOfNorns from '@/pages/field/WheelOfNorns';
import FieldShop from '@/pages/field/FieldShop';
import FieldInventory from '@/pages/field/FieldInventory';
import FieldAssembly from '@/pages/field/FieldAssembly';
import FieldPalletBuilder from '@/pages/field/FieldPalletBuilder';
import FieldReceiving from '@/pages/field/FieldReceiving';
import FieldQuests from '@/pages/field/FieldQuests';
import FieldJourney from '@/pages/field/FieldJourney';
import FieldAcademy from '@/pages/field/FieldAcademy';
import FieldLesson from '@/pages/field/FieldLesson';
import FieldAcademyQuiz from '@/pages/field/FieldAcademyQuiz';
import FieldAcademyLibrary from '@/pages/field/FieldAcademyLibrary';
import FieldEarningsMonthly from '@/pages/field/FieldEarningsMonthly';
import FieldSeasonal from '@/pages/field/FieldSeasonal';
import FieldDiary from '@/pages/field/FieldDiary';
import FieldReadiness from '@/pages/field/FieldReadiness';
import PmDashboard from '@/pages/pm/PmDashboard';
import PmWorkers from '@/pages/pm/PmWorkers';
import PmWorkerProfile from '@/pages/pm/PmWorkerProfile';
import PmTimesheet from '@/pages/pm/PmTimesheet';
import PmPayments from '@/pages/pm/PmPayments';
import PmAcademy from '@/pages/pm/PmAcademy';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import PinEntry from '@/pages/PinEntry';
import Home from '@/pages/Home';
import Tasks from '@/pages/Tasks';
import HelpTasks from '@/pages/HelpTasks';
import Chat from '@/pages/Chat';
import ChatView from '@/pages/ChatView';
import Mimir from '@/pages/Mimir';
import Works from '@/pages/Works';
import Contracts from '@/pages/Contracts';
import Customers from '@/pages/Customers';
import Tenders from '@/pages/Tenders';
import Personnel from '@/pages/Personnel';
import Profile from '@/pages/Profile';
import Finances from '@/pages/Finances';
import Approvals from '@/pages/Approvals';
import Settings from '@/pages/Settings';
import Correspondence from '@/pages/Correspondence';
import Alerts from '@/pages/Alerts';
import Meetings from '@/pages/Meetings';
import Cash from '@/pages/Cash';
import Acts from '@/pages/Acts';
import Invoices from '@/pages/Invoices';
import HrRequests from '@/pages/HrRequests';
import Travel from '@/pages/Travel';
import Procurement from '@/pages/Procurement';
import Permits from '@/pages/Permits';
import Proxies from '@/pages/Proxies';
import Funnel from '@/pages/Funnel';
import AllEstimates from '@/pages/AllEstimates';
import PmCalcs from '@/pages/PmCalcs';
import ToCalcs from '@/pages/ToCalcs';
import HeadToApprovals from '@/pages/HeadToApprovals';
import Payroll from '@/pages/Payroll';
import OfficeExpenses from '@/pages/OfficeExpenses';
import CashAdmin from '@/pages/CashAdmin';
import TasksAdmin from '@/pages/TasksAdmin';
import Warehouse from '@/pages/Warehouse';
import Assembly from '@/pages/Assembly';
import Gantt from '@/pages/Gantt';
import WorkersSchedule from '@/pages/WorkersSchedule';
import WorkerProfile from '@/pages/WorkerProfile';
import ApprovalPayment from '@/pages/ApprovalPayment';
import MyEquipment from '@/pages/MyEquipment';
import MyMail from '@/pages/MyMail';
import Seals from '@/pages/Seals';
import Diag from '@/pages/Diag';
import Training from '@/pages/Training';
import OfficeAcademy from '@/pages/OfficeAcademy';
import OfficeLesson from '@/pages/OfficeLesson';
import OfficeAcademyQuiz from '@/pages/OfficeAcademyQuiz';
import OfficeAcademyAdmin from '@/pages/OfficeAcademyAdmin';
import Integrations from '@/pages/Integrations';
import More from '@/pages/More';
import GlobalTimesheet from '@/pages/GlobalTimesheet';
import TimesheetWarehouse from '@/pages/TimesheetWarehouse';
import TimesheetMedical from '@/pages/TimesheetMedical';
import TimesheetTravel from '@/pages/TimesheetTravel';
import PayrollDashboard from '@/pages/PayrollDashboard';
import OfficialEmployees from '@/pages/OfficialEmployees';
import TrainingBoard from '@/pages/TrainingBoard';
import StaffRequests from '@/pages/StaffRequests';
import PmBalance from '@/pages/PmBalance';
import CallAnalytics from '@/pages/CallAnalytics';
import EstimateReport from '@/pages/EstimateReport';
import MimirAutoEstimate from '@/pages/MimirAutoEstimate';
import HuginnEstimateChat from '@/pages/HuginnEstimateChat';
import ExpenseChat from '@/pages/ExpenseChat';
import DirectorApprovals from '@/pages/director/Approvals';
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

function PinGuard({ children }) {
  const pinStatus = useAuthStore((s) => s.pinStatus);
  if (pinStatus === 'need_pin' || pinStatus === 'need_setup') {
    return <Navigate to="/pin" replace />;
  }
  return children;
}

function AppLayout() {
  const location = useLocation();
  const incrementChat = useChatStore((s) => s.incrementChat);
  const userId = useAuthStore((s) => s.user?.id);

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

  // Гейт присутствия — только в офисном разделе (не на field/pm/логине). Сам себя гейтит по роли.
  const showPresenceGate = !(
    ['/login', '/pin', '/welcome'].includes(location.pathname) ||
    location.pathname.startsWith('/field') ||
    location.pathname.startsWith('/pm')
  );

  return (
    <div className="h-full relative" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {showPresenceGate && <PresenceGateMobile />}
      <OfficePushBootstrap />
      <div
        key={location.pathname}
        style={{
          animation: 'pageTransitionIn 180ms var(--ease-smooth-out) both',
          height: '100%',
        }}
      >
        <Routes location={location}>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pin" element={<PinRoute />} />
          <Route path="/" element={<ProtectedRoute section="dashboard"><PinGuard><Home /></PinGuard></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute section="tasks"><PinGuard><Tasks /></PinGuard></ProtectedRoute>} />
          <Route path="/help" element={<ProtectedRoute section="tasks"><PinGuard><HelpTasks /></PinGuard></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute section="chat"><PinGuard><Chat /></PinGuard></ProtectedRoute>} />
          <Route path="/chat/:chatId" element={<ProtectedRoute section="chat"><PinGuard><ChatView /></PinGuard></ProtectedRoute>} />
          <Route path="/mimir" element={<ProtectedRoute section="chat"><PinGuard><Mimir /></PinGuard></ProtectedRoute>} />
          <Route path="/works" element={<ProtectedRoute section="works"><PinGuard><Works /></PinGuard></ProtectedRoute>} />
          <Route path="/contracts" element={<ProtectedRoute section="tenders"><PinGuard><Contracts /></PinGuard></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute section="tenders"><PinGuard><Customers /></PinGuard></ProtectedRoute>} />
          <Route path="/tenders" element={<ProtectedRoute section="tenders"><PinGuard><Tenders /></PinGuard></ProtectedRoute>} />
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
          <Route path="/funnel" element={<ProtectedRoute section="tenders"><PinGuard><Funnel /></PinGuard></ProtectedRoute>} />
          <Route path="/all-estimates" element={<ProtectedRoute section="tenders"><PinGuard><AllEstimates /></PinGuard></ProtectedRoute>} />
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
          <Route path="/estimate-report/:id" element={<ProtectedRoute section="tenders"><PinGuard><EstimateReport /></PinGuard></ProtectedRoute>} />
          <Route path="/mimir-estimate/:workId" element={<ProtectedRoute section="works"><PinGuard><MimirAutoEstimate /></PinGuard></ProtectedRoute>} />
          <Route path="/huginn-chat/:chatId" element={<ProtectedRoute section="chat"><PinGuard><HuginnEstimateChat /></PinGuard></ProtectedRoute>} />
          <Route path="/expense-chat/:workId" element={<ProtectedRoute section="finances"><PinGuard><ExpenseChat /></PinGuard></ProtectedRoute>} />
          <Route path="/director-approvals" element={<ProtectedRoute section="finances"><PinGuard><DirectorApprovals /></PinGuard></ProtectedRoute>} />
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
                <Route path="history" element={<FieldHistory />} />
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
                <Route path="wheel" element={<WheelOfNorns />} />
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
      </div>
      {!hideTabBar && <TabBar />}
      <Toaster position="top-center" richColors closeButton />
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
