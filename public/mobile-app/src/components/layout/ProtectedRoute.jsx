import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { hasPermission, ROUTE_SECTIONS } from '@/config/rbac';

export function ProtectedRoute({ children, section }) {
  const { user, token, loading } = useAuthStore();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 rounded-full animate-spin"
            style={{
              border: '3px solid var(--bg-elevated)',
              borderTopColor: 'var(--gold)',
            }}
          />
          <span
            className="text-xs font-medium tracking-wide uppercase"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Загрузка
          </span>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/welcome" state={{ from: location }} replace />;
  }

  const requiredSection = section || ROUTE_SECTIONS[location.pathname] || null;
  if (requiredSection && !hasPermission(user.role, requiredSection)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
