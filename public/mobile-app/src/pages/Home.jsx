import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { WIDGET_REGISTRY, getLayout, roleMatch } from '@/widgets';
import { Shield, ChevronRight, HardHat, CalendarClock } from 'lucide-react';
import { CrmUpdateBanner } from '@/components/shared/CrmUpdateBanner';
import { MobileAppBanner } from '@/components/shared/MobileAppBanner';
import { loadPmDutyCurrent } from '@/api/tendersRegistry';

/**
 * Home — оркестратор дашборда «Зал Ярла»
 * Рендерит виджеты по роли с PullToRefresh и stagger-анимацией
 */

function getWidgetAnimation(i) {
  if (i === 0) return 'widgetScaleIn';
  return i % 2 !== 0 ? 'widgetSlideLeft' : 'widgetSlideRight';
}

const PM_ROLES = ['PM', 'HEAD_PM', 'ADMIN'];
const DUTY_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'ADMIN'];

export default function Home() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const role = user?.role || '';
  const [refreshKey, setRefreshKey] = useState(0);
  const [duty, setDuty] = useState(null);
  const isPm = PM_ROLES.includes(role);
  const showDuty = DUTY_ROLES.includes(role);

  useEffect(() => {
    if (!showDuty) return;
    loadPmDutyCurrent().then((d) => setDuty(d.duty || d)).catch(() => setDuty(null));
  }, [showDuty, refreshKey]);

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
      <CrmUpdateBanner />
      <MobileAppBanner />
      <PullToRefresh onRefresh={handleRefresh}>
        <div
          className="px-3 pb-4"
          style={{
            paddingTop: 'calc(var(--safe-top) + 8px)',
            paddingBottom: 'calc(var(--tabbar-total) + 16px)',
          }}
        >
          {/* Панель РП + вход в Зал Рабочих для PM/HEAD_PM/ADMIN */}
          {isPm && (
            <div className="flex gap-2 mb-2">
              {/* Панель РП */}
              <button
                onClick={() => navigate('/pm')}
                className="text-left spring-tap"
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--blue) 12%, var(--bg-surface)), color-mix(in srgb, var(--blue) 4%, var(--bg-surface)))',
                  border: '0.5px solid color-mix(in srgb, var(--blue) 30%, var(--border-norse))',
                  borderRadius: 14,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'color-mix(in srgb, var(--blue) 20%, transparent)',
                  }}
                >
                  <Shield size={18} style={{ color: 'var(--blue)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Панель РП</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>Рабочие · Табель · Выплаты</div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--blue)', opacity: 0.7, flexShrink: 0 }} />
              </button>

              {/* Вход в Зал Рабочих */}
              <button
                onClick={() => navigate('/field-login')}
                className="spring-tap"
                style={{
                  flexShrink: 0,
                  background: 'color-mix(in srgb, var(--gold) 8%, var(--bg-surface))',
                  border: '0.5px solid color-mix(in srgb, var(--gold) 25%, var(--border-norse))',
                  borderRadius: 14,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  minWidth: 68,
                }}
              >
                <HardHat size={20} style={{ color: 'var(--gold)' }} />
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gold)', textAlign: 'center', lineHeight: 1.2 }}>
                  Зал<br />рабочих
                </div>
              </button>
            </div>
          )}
          {showDuty && duty?.pm_name && (
            <button
              type="button"
              onClick={() => navigate('/pm-duty')}
              className="w-full text-left spring-tap mb-2 rounded-xl px-3 py-2.5 flex items-center gap-3"
              style={{
                background: duty.pm_user_id === user?.id
                  ? 'color-mix(in srgb, var(--green) 12%, var(--bg-surface))'
                  : 'var(--bg-elevated)',
                border: '0.5px solid var(--border-norse)',
              }}
            >
              <CalendarClock size={18} style={{ color: 'var(--blue)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold c-primary">
                  {duty.pm_user_id === user?.id ? 'Вы дежурный РП' : `Дежурный: ${duty.pm_name}`}
                </div>
                <div className="text-[11px] c-tertiary">
                  {String(duty.period_start).slice(0, 10)} — {String(duty.period_end).slice(0, 10)}
                </div>
              </div>
              <ChevronRight size={16} className="c-tertiary" />
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
