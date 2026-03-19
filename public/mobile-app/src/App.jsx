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
import Works from '@/pages/Works';
import More from '@/pages/More';

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
  const hideTabBar = ['/login', '/pin', '/welcome'].includes(location.pathname);

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
          <Route path="/works" element={<ProtectedRoute section="works"><PinGuard><Works /></PinGuard></ProtectedRoute>} />
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
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
