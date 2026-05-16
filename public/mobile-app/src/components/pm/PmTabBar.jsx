import { useNavigate, useLocation } from 'react-router-dom';

const TABS = [
  { path: '/pm',          icon: '🏠', label: 'Главная' },
  { path: '/pm/workers',  icon: '👷', label: 'Рабочие' },
  { path: '/pm/timesheet',icon: '📋', label: 'Табель'  },
  { path: '/pm/payments', icon: '💰', label: 'Выплаты' },
  { path: '/pm/academy',  icon: '🏛️', label: 'Мимир'  },
];

export default function PmTabBar() {
  const navigate  = useNavigate();
  const location  = useLocation();

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      background: '#16161f',
      borderTop: '1px solid #ffffff12',
      display: 'flex',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {TABS.map(t => {
        const active = location.pathname === t.path ||
          (t.path !== '/pm' && location.pathname.startsWith(t.path));
        return (
          <button key={t.path} onClick={() => navigate(t.path)}
            style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 0 8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
            <span style={{
              fontSize: 9, fontWeight: active ? 700 : 400,
              color: active ? '#3b82f6' : '#6b7280',
              letterSpacing: 0.3,
            }}>{t.label}</span>
            {active && (
              <div style={{ width: 20, height: 2, background: '#3b82f6', borderRadius: 1 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
