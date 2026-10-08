import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, PhoneMissed, PhoneCall, Building2, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { Sparkline } from '@/components/shared/Sparkline';
import { CallList } from '@/components/telephony/CallRow';
import { glass } from '@/components/telephony/telUi';
import { TEL_ROLES, useSoftphone } from '@/components/telephony/SoftphoneProvider';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';

function TelWrap({ children }) {
  return <div className="mx-auto w-full" style={{ maxWidth: 430 }}>{children}</div>;
}

export default function TelephonyHome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = useAuthStore((s) => s.user?.role);
  const sip = useSoftphone();
  const haptic = useHaptic();
  const [summary, setSummary] = useState(null);
  const [op, setOp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const sipTried = useRef(false);

  const allowed = TEL_ROLES.includes(role);

  const load = useCallback(async () => {
    if (!allowed) return;
    setErr('');
    try {
      const [sum, status] = await Promise.all([
        api.get('/telephony/me/summary'),
        api.get('/telephony/pbx/operator/status'),
      ]);
      setSummary(sum);
      setOp(status);
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!op?.on_line || sip?.sipState !== 'idle' || sipTried.current) return;
    sipTried.current = true;
    sip.goOnline?.().catch(() => { sipTried.current = false; });
  }, [op?.on_line, sip]);

  useEffect(() => {
    if (params.get('tab') === 'missed') navigate('/telephony/missed', { replace: true });
    if (params.get('tab') === 'office') navigate('/telephony/missed?scope=office', { replace: true });
  }, [params, navigate]);

  const onLine = !!op?.on_line;
  const toggleLine = async () => {
    setBusy(true);
    haptic.medium();
    try {
      if (onLine) {
        await sip?.goOffline?.();
        await api.post('/telephony/pbx/operator/status', { on_line: false });
      } else {
        await sip?.goOnline?.();
      }
      await load();
      haptic.success();
    } catch (e) {
      setErr(e.message || 'Не удалось переключить линию');
      haptic.error();
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (receive_mode) => {
    setBusy(true);
    haptic.light();
    try {
      await api.post('/telephony/pbx/operator/status', { receive_mode, on_line: onLine });
      await load();
    } catch (e) {
      setErr(e.message || 'Режим не сохранился');
    } finally {
      setBusy(false);
    }
  };

  const listed = useMemo(() => {
    const rows = summary?.recent || [];
    if (filter === 'missed') return rows.filter((r) => r.call_type === 'missed');
    return rows;
  }, [summary, filter]);

  if (!allowed) {
    return (
      <PageShell title="Телефон" showBack>
        <EmptyState title="Нет доступа" description="Телефония доступна сотрудникам офиса с линией." />
      </PageShell>
    );
  }

  return (
    <PageShell title="Телефон" showBack>
      <PullToRefresh onRefresh={load}>
        <TelWrap>
        {loading ? (
          <SkeletonList count={4} />
        ) : (
          <>
            {err && (
              <p className="mb-3 text-sm" style={{ color: 'var(--red)' }}>{err}</p>
            )}
            <button
              type="button"
              className="spring-tap w-full mb-3 font-bold"
              disabled={busy}
              onClick={toggleLine}
              style={{
                minHeight: 56,
                borderRadius: 20,
                letterSpacing: '-0.02em',
                fontSize: 17,
                color: onLine
                  ? 'color-mix(in srgb, var(--green-dim) 70%, var(--text-primary))'
                  : 'var(--text-primary)',
                boxShadow: onLine
                  ? '0 0 22px color-mix(in srgb, var(--green-dim) 18%, transparent)'
                  : 'none',
                background: onLine
                  ? 'linear-gradient(135deg, color-mix(in srgb, var(--green-dim) 14%, var(--bg-surface)), color-mix(in srgb, var(--bg-surface) 86%, transparent))'
                  : glass.background,
                border: onLine
                  ? '0.5px solid color-mix(in srgb, var(--green-dim) 28%, var(--border-norse))'
                  : glass.border,
                backdropFilter: glass.backdropFilter,
                WebkitBackdropFilter: glass.WebkitBackdropFilter,
              }}
            >
              {onLine ? 'На линии' : 'Не на линии'}
            </button>
            <p className="mb-3 text-center" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {onLine ? 'Звонок придёт в приложение и на ПК' : 'Нажмите, чтобы принимать звонки'}
            </p>

            <div className="flex gap-2 mb-4">
              {[
                { id: 'both', label: 'Приложение + ПК' },
                { id: 'mobile', label: 'Только сотовый' },
              ].map((m) => {
                const active = (op?.receive_mode || 'both') === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="spring-tap flex-1"
                    disabled={busy}
                    onClick={() => setMode(m.id)}
                    style={{
                      minHeight: 44,
                      borderRadius: 14,
                      fontSize: 13,
                      fontWeight: 600,
                      color: active ? 'var(--gold)' : 'var(--text-secondary)',
                      ...glass,
                      background: active
                        ? 'color-mix(in srgb, var(--gold) 18%, var(--bg-surface))'
                        : glass.background,
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
              <button
                type="button"
                className="spring-tap flex flex-col items-stretch text-left rounded-2xl p-3"
                onClick={() => { setFilter('missed'); haptic.light(); }}
                style={{
                  minHeight: 124,
                  ...glass,
                  border: filter === 'missed'
                    ? '0.5px solid color-mix(in srgb, var(--gold) 55%, var(--border-norse))'
                    : glass.border,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <PhoneMissed size={18} style={{ color: 'var(--red)' }} />
                  <span className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    фильтр
                    <ChevronRight size={14} color="var(--gold)" />
                  </span>
                </div>
                <div className="mt-2" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--red)' }}>
                  {summary?.missed_unack ?? 0}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Пропущенные</div>
                {Array.isArray(summary?.week_spark) && summary.week_spark.length > 1 && (
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <Sparkline data={summary.week_spark} width={88} height={22} color="var(--red)" />
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>7 дней</span>
                  </div>
                )}
              </button>
              <button
                type="button"
                className="spring-tap flex flex-col items-stretch text-left rounded-2xl p-3"
                onClick={() => { setFilter('all'); navigate('/telephony/history'); }}
                style={{
                  minHeight: 124,
                  ...glass,
                  border: filter === 'all'
                    ? '0.5px solid color-mix(in srgb, var(--gold) 55%, var(--border-norse))'
                    : glass.border,
                }}
              >
                <div className="flex items-center justify-between">
                  <PhoneCall size={18} style={{ color: 'var(--gold)' }} />
                  <ChevronRight size={14} color="var(--gold)" />
                </div>
                <div className="mt-2" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--gold)' }}>
                  {summary?.today_total ?? 0}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Сегодня</div>
              </button>
            </div>

            {summary?.can_see_office && (
              <button
                type="button"
                className="spring-tap w-full mb-4 flex items-center gap-3 px-3"
                style={{ minHeight: 48, borderRadius: 16, color: 'var(--text-primary)', ...glass }}
                onClick={() => navigate('/telephony/missed?scope=office')}
              >
                <Building2 size={18} color="var(--gold)" />
                <span className="font-semibold text-sm flex-1 text-left">Общие без оператора: {summary.office_unack || 0}</span>
                <ChevronRight size={16} color="var(--gold)" />
              </button>
            )}

            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {filter === 'missed' ? 'Пропущенные сейчас' : 'Последние'}
              </span>
              <button type="button" style={{ color: 'var(--gold)', minHeight: 44, fontSize: 14, fontWeight: 600 }} onClick={() => navigate('/telephony/history')}>
                Журнал
              </button>
            </div>
            {listed.length === 0 ? (
              <EmptyState icon={Phone} title="Пока тихо" description="Свои звонки появятся здесь." />
            ) : (
              <CallList items={listed} />
            )}
          </>
        )}
        </TelWrap>
      </PullToRefresh>
    </PageShell>
  );
}
