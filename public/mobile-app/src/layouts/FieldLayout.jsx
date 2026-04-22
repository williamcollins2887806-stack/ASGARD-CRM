import { useState, useRef, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { Home, Wrench, Wallet, Truck, User } from 'lucide-react';

const TABS = [
  { path: '/field/home', icon: Home, label: 'Главная' },
  { path: '/field/shift', icon: Wrench, label: 'Смена' },
  { path: '/field/money', icon: Wallet, label: 'Деньги' },
  { path: '/field/stages', icon: Truck, label: 'Выезд' },
  { path: '/field/profile', icon: User, label: 'Профиль' },
];

export default function FieldLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const haptic = useHaptic();

  // Auth guard — redirect to welcome if no field token
  const fieldToken = localStorage.getItem('field_token');
  if (!fieldToken) {
    return <Navigate to="/field/welcome" replace />;
  }
  const navRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const activeIndex = TABS.findIndex(({ path }) =>
    location.pathname === path || location.pathname.startsWith(path + '/')
  );

  useEffect(() => {
    if (!navRef.current || activeIndex < 0) return;
    const buttons = navRef.current.querySelectorAll('[data-tab]');
    const btn = buttons[activeIndex];
    if (btn) {
      const navRect = navRef.current.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - navRect.left + (btnRect.width - 40) / 2,
        width: 40,
      });
    }
  }, [activeIndex]);

  const handleTap = (path) => {
    haptic.light();
    navigate(path);
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Page content */}
      <div className="flex-1 overflow-auto" style={{ paddingBottom: 'var(--tabbar-total, 72px)' }}>
        <Outlet />
      </div>

      {/* Bottom Tab Bar */}
      <nav
        ref={navRef}
        className="fixed bottom-0 left-0 right-0 glass-strong"
        style={{
          zIndex: 50,
          borderTop: '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
          height: 'var(--tabbar-total)',
          paddingBottom: 'var(--safe-bottom)',
        }}
      >
        {/* Sliding indicator */}
        <div
          className="absolute top-0"
          style={{
            left: indicator.left,
            width: indicator.width,
            height: 3,
            borderRadius: '0 0 3px 3px',
            background: 'var(--gold-gradient)',
            transition: 'left var(--motion-normal) var(--ease-spring)',
            boxShadow: '0 2px 8px rgba(200, 168, 78, 0.4)',
          }}
        />

        <div className="flex items-center justify-around h-full">
          {TABS.map(({ path, icon: Icon, label }, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={path}
                data-tab={i}
                onClick={() => handleTap(path)}
                className="flex flex-col items-center justify-center flex-1 spring-tap"
                style={{
                  color: active ? 'var(--gold)' : 'var(--text-tertiary)',
                  transition: 'color var(--motion-fast) var(--ease-smooth)',
                  minHeight: 'var(--tabbar-height)',
                }}
              >
                <div
                  style={{
                    transform: active ? 'scale(1.08)' : 'scale(1)',
                    transition: 'transform var(--motion-fast) var(--ease-spring)',
                    filter: active ? 'drop-shadow(0 0 4px rgba(200, 168, 78, 0.3))' : 'none',
                  }}
                >
                  <Icon size={22} strokeWidth={active ? 2.2 : 1.5} />
                </div>
                <span
                  className="mt-0.5 font-medium"
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.02em',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
