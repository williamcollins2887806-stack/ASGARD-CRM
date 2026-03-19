import { useState, useCallback } from 'react';
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

export default function Home() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role || '';
  const [refreshKey, setRefreshKey] = useState(0);

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
