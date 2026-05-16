import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { WIDGET_REGISTRY, getLayout, roleMatch } from '@/widgets';

/**
 * Home — оркестратор дашборда «Зал Ярла»
 * Рендерит виджеты по роли с PullToRefresh и stagger-анимацией
 */

function getWidgetAnimation(i) {
  if (i === 0) return 'widgetScaleIn';
  return i % 2 !== 0 ? 'widgetSlideLeft' : 'widgetSlideRight';
}

const PM_ROLES = ['PM', 'HEAD_PM', 'ADMIN'];

export default function Home() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const role = user?.role || '';
  const [refreshKey, setRefreshKey] = useState(0);
  const isPm = PM_ROLES.includes(role);

  const layoutIds = getLayout(role);
  const widgets = layoutIds
    .map(id => ({ id, ...WIDGET_REGISTRY[id] }))
    .filter(w => w.component && roleMatch(role, w.roles));

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1);
    await new Promise(r => setTimeout(r, 600));
  }, []);

  return (
    <div className="flex flex-col h-full bg-primary">
      <PullToRefresh onRefresh={handleRefresh}>
        <div
          className="px-3 pb-4"
          style={{
            paddingTop: 'calc(var(--safe-top) + 8px)',
            paddingBottom: 'calc(var(--tabbar-total) + 16px)',
          }}
        >
          {/* Кнопка входа в Панель РП для PM/HEAD_PM/ADMIN */}
          {isPm && (
            <button
              onClick={() => navigate('/pm')}
              style={{
                width: '100%', marginBottom: 10,
                background: 'linear-gradient(135deg, #0d1a2e, #162030)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: 14, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 24 }}>🛡️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e8e8f0' }}>Панель РП</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>Рабочие · Табель · Выплаты · Мимир</div>
              </div>
              <span style={{ fontSize: 14, color: '#3b82f6' }}>→</span>
            </button>
          )}
          <div className="flex flex-col gap-2">
            {widgets.map((w, i) => {
              const Component = w.component;
              const anim = getWidgetAnimation(i);

              return (
                <div
                  key={`${w.id}-${refreshKey}`}
                  style={{
                    animation: `${anim} var(--motion-normal) var(--ease-spring) ${i * 80}ms both`,
                  }}
                >
                  <Component />
                </div>
              );
            })}
          </div>
        </div>
      </PullToRefresh>
    </div>
  );
}
