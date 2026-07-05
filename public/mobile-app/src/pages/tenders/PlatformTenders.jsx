import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import {
  loadRegistry,
  acceptPlatformCandidate,
  dismissPlatformCandidate,
  loadTenderGuruSettings,
} from '@/api/tendersRegistry';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Settings, ChevronRight } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

export default function PlatformTenders() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [tg, setTg] = useState({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const canSettings = ['ADMIN', 'TO', 'HEAD_TO'].includes(user?.role);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [reg, settings] = await Promise.all([
        loadRegistry({ subtab: 'platform' }),
        loadTenderGuruSettings().catch(() => ({ settings: {} })),
      ]);
      setItems(reg.items || []);
      setTg({ ...(reg.tenderguru || {}), ...(settings.settings || {}) });
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const accept = async (id) => {
    setActing(id);
    haptic.light();
    try {
      await acceptPlatformCandidate(id);
      haptic.success();
      refresh();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка');
    } finally {
      setActing(null);
    }
  };

  const dismiss = async (id, duplicate = false) => {
    setActing(id);
    haptic.light();
    try {
      await dismissPlatformCandidate(id, duplicate);
      refresh();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка');
    } finally {
      setActing(null);
    }
  };

  const apiOff = tg.enabled === false;
  const noKey = !tg.api_key_set;

  return (
    <PageShell
      title="С площадок"
      headerRight={canSettings ? (
        <button
          type="button"
          onClick={() => navigate('/tenders/tenderguru-settings')}
          className="flex items-center justify-center spring-tap"
          style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}
        >
          <Settings size={20} />
        </button>
      ) : null}
    >
      <PullToRefresh onRefresh={refresh}>
        <p className="text-[12px] c-secondary mb-3 px-0.5">
          Кандидаты TenderGuru — дополнение к ручному реестру. Обогащение тендеров моложе {tg.enrich_max_age_months || 3} мес.
        </p>

        {apiOff && (
          <div className="mb-3 rounded-xl px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--gold)' }}>
            TenderGuru API выключен администратором.
          </div>
        )}
        {noKey && (
          <div className="mb-3 rounded-xl px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--gold) 12%, transparent)', color: 'var(--gold)' }}>
            Не задан TENDERGURU_API_KEY на сервере.
          </div>
        )}
        {tg.last_sync_at && (
          <p className="text-[11px] c-tertiary mb-2">
            Последняя синхронизация: {formatDate(tg.last_sync_at)}
          </p>
        )}

        {loading ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Settings}
            iconColor="var(--blue)"
            iconBg="color-mix(in srgb, var(--blue) 10%, transparent)"
            title="Нет новых кандидатов"
            description="Запустите синхронизацию в настройках TenderGuru"
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="rounded-2xl px-4 py-3.5"
                style={{
                  background: 'var(--bg-surface)',
                  border: '0.5px solid var(--border-norse)',
                  animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                }}
              >
                <p className="text-[15px] font-semibold c-primary leading-tight">{item.customer_name || item.title || '—'}</p>
                {item.title && item.customer_name && (
                  <p className="text-[12px] c-secondary mt-0.5 line-clamp-2">{item.title}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-[11px] c-tertiary">
                  {item.price && <span>{formatMoney(item.price, { short: true })}</span>}
                  {item.deadline && <span>{formatDate(item.deadline)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <ActionBtn label="Принять" color="var(--green)" disabled={acting === item.id} onClick={() => accept(item.id)} />
                  <ActionBtn label="Отклонить" color="var(--red-soft)" disabled={acting === item.id} onClick={() => dismiss(item.id, false)} />
                  <ActionBtn label="Дубликат" color="var(--text-tertiary)" disabled={acting === item.id} onClick={() => dismiss(item.id, true)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {canSettings && (
          <button
            type="button"
            onClick={() => navigate('/tenders/tenderguru-settings')}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 spring-tap mb-4"
            style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-norse)' }}
          >
            <span className="text-[14px] font-semibold c-primary">⚙ Настройки TenderGuru</span>
            <ChevronRight size={16} className="c-tertiary" />
          </button>
        )}
      </PullToRefresh>
    </PageShell>
  );
}

function ActionBtn({ label, color, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl text-[11px] font-semibold py-2 spring-tap"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        border: `0.5px solid color-mix(in srgb, ${color} 30%, transparent)`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
