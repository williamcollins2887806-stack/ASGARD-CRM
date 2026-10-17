import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { SkeletonCard } from '@/components/shared/SkeletonKit';

/**
 * ToExecuteWidget — «К исполнению»: что РЕШЕНО, но ещё НЕ ВЫПОЛНЕНО.
 *
 * Заказчик 17.10.2026: директору нужна картина денег В РАБОТЕ:
 *   • счета — одобрены, но ещё не оплачены (бухгалтерия должна оплатить);
 *   • выплаты — согласованы, но факт перевода рабочим ещё не записан;
 *   • касса — одобрена, но деньги ещё не выданы.
 * Раньше эти суммы нигде не собирались вместе, и понять «сколько денег
 * осталось провести» было нельзя.
 *
 * Данные: GET /api/director-summary/queues → { toExecute: {...} }
 * Тап по строке ведёт на соответствующий раздел.
 */

const ROWS = [
  { key: 'invoices', icon: '🧾', label: 'Счета к оплате',   hint: 'ждут оплаты',   accent: 'var(--blue)',  to: '/approval-payment' },
  { key: 'payouts',  icon: '💸', label: 'Выплаты рабочим',  hint: 'к выплате',     accent: 'var(--gold)',  to: '/director-approvals?tab=payouts' },
  { key: 'cash',     icon: '🏦', label: 'Касса к выдаче',   hint: 'ждут выдачи',   accent: 'var(--green)', to: '/director-approvals?tab=cash' },
];

export default function ToExecuteWidget() {
  const user     = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic   = useHaptic();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  const role = user?.role || '';
  const isVisible = role === 'DIRECTOR_COMM' || role === 'DIRECTOR_GEN' || role === 'DIRECTOR_DEV' || role === 'ADMIN';

  const load = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const res = await api.get('/director-summary/queues');
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isVisible) return;
    const handler = () => { load(); };
    window.addEventListener('asgard:cash:changed', handler);
    window.addEventListener('asgard:payout:changed', handler);
    const t = setInterval(load, 60000);
    return () => {
      window.removeEventListener('asgard:cash:changed', handler);
      window.removeEventListener('asgard:payout:changed', handler);
      clearInterval(t);
    };
  }, [isVisible, load]);

  if (!isVisible) return null;

  const ex = data?.toExecute || {};
  const totalCount = ex.total_count || 0;
  const totalSum = ex.total_sum || 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
        border: totalCount > 0
          ? '0.5px solid color-mix(in srgb, var(--blue) 30%, var(--border-norse))'
          : '0.5px solid var(--border-norse)',
        boxShadow: 'var(--shadow-sm)',
        animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
      }}
    >
      {/* ── Шапка: сколько денег в работе ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-norse)',
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            display: 'grid', placeItems: 'center', fontSize: 19,
            background: 'color-mix(in srgb, var(--blue) 16%, transparent)',
          }}
        >
          ⏳
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            К исполнению
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2 }}>
            {totalCount > 0
              ? `${totalCount} операций на ${formatMoney(totalSum, { short: true })}`
              : 'Все операции проведены'}
          </div>
        </div>
      </div>

      {/* ── Три строки: что осталось провести ── */}
      {loading && !data ? (
        <div className="px-4 py-4"><SkeletonCard /></div>
      ) : (
        <div>
          {ROWS.map((r, i) => {
            const cell = ex[r.key] || { count: 0, sum: 0 };
            const has = cell.count > 0;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => { haptic.light(); navigate(r.to); }}
                className="spring-tap w-full text-left"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', minHeight: 56,
                  border: 'none',
                  borderTop: i > 0 ? '0.5px solid var(--border-norse)' : 'none',
                  background: 'transparent',
                  opacity: has ? 1 : 0.62,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{r.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: has ? 650 : 550,
                    color: has ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    lineHeight: 1.2,
                  }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {has ? `${cell.count} · ${r.hint}` : 'нет'}
                  </div>
                </div>
                <span style={{
                  fontSize: has ? 15 : 13,
                  fontWeight: has ? 800 : 600,
                  color: has ? r.accent : 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {has ? formatMoney(cell.sum, { short: true }) : '—'}
                </span>
                <span style={{ fontSize: 15, color: 'var(--text-tertiary)', flexShrink: 0 }}>›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
