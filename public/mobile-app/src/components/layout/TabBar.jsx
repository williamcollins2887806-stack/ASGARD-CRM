import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';

/**
 * SVG иконки для TabBar — filled (active) vs outlined (inactive)
 */
const TabIcon = ({ name, active, size = 22 }) => {
  const color = 'currentColor';
  const sw = active ? 2.2 : 1.5;
  const fill = active ? color : 'none';

  const icons = {
    home: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    tasks: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
        <path d="M9 11l2 2 4-4" />
      </svg>
    ),
    chat: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
      </svg>
    ),
    works: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    more: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="1" fill={color} />
        <circle cx="19" cy="12" r="1" fill={color} />
        <circle cx="5" cy="12" r="1" fill={color} />
      </svg>
    ),
    // V391: вкладки директора — только согласования и профиль
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    user: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
      </svg>
    ),
  };

  return icons[name] || null;
};

const TABS = [
  { path: '/',      icon: 'home',  label: 'Главная' },
  { path: '/tasks', icon: 'tasks', label: 'Задачи' },
  { path: '/works', icon: 'works', label: 'Работы' },
  { path: '/more',  icon: 'more',  label: 'Ещё' },
];

/** 17.10.2026 (заказчик): директору вернули часть разделов — «погорячился,
 *  когда сказал что закрываем все вкладки». Главная и согласования остаются
 *  первыми, но доступны и рабочие разделы: работы, финансы, «Ещё».
 *  Десктоп не затрагивается. */
const DIRECTOR_ROLES = ['DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
const DIRECTOR_TABS = [
  { path: '/',                   icon: 'home',  label: 'Главная' },
  { path: '/director-approvals', icon: 'check', label: 'Согласования' },
  { path: '/finances',           icon: 'works', label: 'Финансы' },
  { path: '/more',               icon: 'more',  label: 'Ещё' },
];
export function tabsForRole(role) {
  return DIRECTOR_ROLES.includes(role) ? DIRECTOR_TABS : TABS;
}

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const haptic = useHaptic();
  const navRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  // V391: состав вкладок зависит от роли (у директора — только согласования).
  const role = useAuthStore((s) => s.user?.role) || '';
  const tabs = tabsForRole(role);

  const activeIndex = tabs.findIndex(({ path }) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  });

  // Update sliding indicator position
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
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 glass-strong"
      style={{
        zIndex: 50,
        borderTop: '0.5px solid color-mix(in srgb, var(--gold) 15%, var(--border-norse))',
        /**
         * D-341 (переделано 23.10.2026): бар прижат к ФИЗИЧЕСКОМУ низу экрана.
         *
         * На iOS коробка вьюпорта короче экрана (iPhone 11: 845 против 896).
         * `bottom: 0` ставил бар к низу КОРОБКИ, и снизу оставалась полоса 51px.
         *
         * `--tabbar-lift` = `100dvh − 100lvh` (845 − 896 = −51px) опускает бар
         * ровно на разницу, то есть на физический низ. Формула самокомпенсируется:
         * при короткой коробке бар уезжает на её дефицит, при полной — `bottom`
         * становится 0. Позиция на экране одна и та же, поэтому бар не «прыгает»
         * при самопочинке вьюпорта (в отличие от прежней маскировки цветом).
         *
         * `--safe-bottom` не нужен: физический низ под баром и есть место под
         * home-индикатор, а высота бара уже включает эту полосу.
         */
        bottom: 'var(--tabbar-lift, 0px)',
        height: 'var(--tabbar-total)',
      }}
    >
      {/* Sliding gold indicator pill */}
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
        {tabs.map(({ path, icon, label }, i) => {
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
              <div className="relative"
                style={{
                  transform: active ? 'scale(1.08)' : 'scale(1)',
                  transition: 'transform var(--motion-fast) var(--ease-spring), filter var(--motion-fast) ease',
                  filter: active ? 'drop-shadow(0 0 4px rgba(200, 168, 78, 0.3))' : 'none',
                }}
              >
                <TabIcon name={icon} active={active} />
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
  );
}
