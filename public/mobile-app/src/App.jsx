import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { TabBar } from '@/components/layout/TabBar';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import PinEntry from '@/pages/PinEntry';
import Home from '@/pages/Home';
import Tasks from '@/pages/Tasks';
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
import TmcRequests from '@/pages/TmcRequests';
import ProcRequests from '@/pages/ProcRequests';
import Permits from '@/pages/Permits';
import Proxies from '@/pages/Proxies';
import Funnel from '@/pages/Funnel';
import AllEstimates from '@/pages/AllEstimates';
import PmCalcs from '@/pages/PmCalcs';
import Payroll from '@/pages/Payroll';
import OfficeExpenses from '@/pages/OfficeExpenses';
import CashAdmin from '@/pages/CashAdmin';
import TasksAdmin from '@/pages/TasksAdmin';
import Warehouse from '@/pages/Warehouse';
import Gantt from '@/pages/Gantt';
import WorkersSchedule from '@/pages/WorkersSchedule';
import WorkerProfile from '@/pages/WorkerProfile';
import ApprovalPayment from '@/pages/ApprovalPayment';
import MyEquipment from '@/pages/MyEquipment';
import MyMail from '@/pages/MyMail';
import Seals from '@/pages/Seals';
import Diag from '@/pages/Diag';
import Training from '@/pages/Training';
import Integrations from '@/pages/Integrations';
import More from '@/pages/More';
import CallAnalytics from '@/pages/CallAnalytics';
import EstimateReport from '@/pages/EstimateReport';

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
  const hideTabBar =
    ['/login', '/pin', '/welcome'].includes(location.pathname) ||
    location.pathname.startsWith('/chat/') ||
    location.pathname === '/mimir' ||
    location.pathname.startsWith('/estimate-report/');

  return (
    <div className="h-full relative" style={{ backgroundColor: 'var(--bg-primary)' }}>
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
          <Route path="/tmc-requests" element={<ProtectedRoute section="works"><PinGuard><TmcRequests /></PinGuard></ProtectedRoute>} />
          <Route path="/proc-requests" element={<ProtectedRoute section="works"><PinGuard><ProcRequests /></PinGuard></ProtectedRoute>} />
          <Route path="/permits" element={<ProtectedRoute section="personnel"><PinGuard><Permits /></PinGuard></ProtectedRoute>} />
          <Route path="/proxies" element={<ProtectedRoute section="works"><PinGuard><Proxies /></PinGuard></ProtectedRoute>} />
          <Route path="/funnel" element={<ProtectedRoute section="tenders"><PinGuard><Funnel /></PinGuard></ProtectedRoute>} />
          <Route path="/all-estimates" element={<ProtectedRoute section="tenders"><PinGuard><AllEstimates /></PinGuard></ProtectedRoute>} />
          <Route path="/pm-calcs" element={<ProtectedRoute section="tenders"><PinGuard><PmCalcs /></PinGuard></ProtectedRoute>} />
          <Route path="/payroll" element={<ProtectedRoute section="finances"><PinGuard><Payroll /></PinGuard></ProtectedRoute>} />
          <Route path="/office-expenses" element={<ProtectedRoute section="finances"><PinGuard><OfficeExpenses /></PinGuard></ProtectedRoute>} />
          <Route path="/cash-admin" element={<ProtectedRoute section="finances"><PinGuard><CashAdmin /></PinGuard></ProtectedRoute>} />
          <Route path="/tasks-admin" element={<ProtectedRoute section="settings"><PinGuard><TasksAdmin /></PinGuard></ProtectedRoute>} />
          <Route path="/warehouse" element={<ProtectedRoute section="dashboard"><PinGuard><Warehouse /></PinGuard></ProtectedRoute>} />
          <Route path="/gantt" element={<ProtectedRoute section="works"><PinGuard><Gantt /></PinGuard></ProtectedRoute>} />
          <Route path="/workers-schedule" element={<ProtectedRoute section="personnel"><PinGuard><WorkersSchedule /></PinGuard></ProtectedRoute>} />
          <Route path="/worker-profile/:id" element={<ProtectedRoute section="personnel"><PinGuard><WorkerProfile /></PinGuard></ProtectedRoute>} />
          <Route path="/approval-payment" element={<ProtectedRoute section="finances"><PinGuard><ApprovalPayment /></PinGuard></ProtectedRoute>} />
          <Route path="/my-equipment" element={<ProtectedRoute section="profile"><PinGuard><MyEquipment /></PinGuard></ProtectedRoute>} />
          <Route path="/my-mail" element={<ProtectedRoute section="profile"><PinGuard><MyMail /></PinGuard></ProtectedRoute>} />
          <Route path="/seals" element={<ProtectedRoute section="works"><PinGuard><Seals /></PinGuard></ProtectedRoute>} />
          <Route path="/diag" element={<ProtectedRoute section="settings"><PinGuard><Diag /></PinGuard></ProtectedRoute>} />
          <Route path="/training" element={<ProtectedRoute section="dashboard"><PinGuard><Training /></PinGuard></ProtectedRoute>} />
          <Route path="/integrations" element={<ProtectedRoute section="settings"><PinGuard><Integrations /></PinGuard></ProtectedRoute>} />
          <Route path="/call-analytics" element={<ProtectedRoute section="dashboard"><PinGuard><CallAnalytics /></PinGuard></ProtectedRoute>} />
          <Route path="/estimate-report/:id" element={<ProtectedRoute section="tenders"><PinGuard><EstimateReport /></PinGuard></ProtectedRoute>} />
          <Route path="/more" element={<ProtectedRoute><PinGuard><More /></PinGuard></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!hideTabBar && <TabBar />}
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
