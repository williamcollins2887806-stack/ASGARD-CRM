import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { SkeletonCard } from '@/components/shared/SkeletonKit';

/**
 * DirectorQueuesWidget — ЕДИНЫЙ виджет согласований для директора (мобильный).
 *
 * Заказчик 17.10.2026: раньше на мобильном был виджет только про кассу
 * («Согласование кассы»), хотя директор согласует ещё счета и выплаты.
 * Теперь один виджет показывает ВСЕ три очереди с количеством и суммой,
 * а тап по строке ведёт СРАЗУ на нужную вкладку экрана согласований.
 *
 * Данные: GET /api/director-summary/queues → { approvals: { invoices, payouts, cash } }
 *
 * Размеры под палец: вся строка — тап-зона высотой ≥48px, иконка 36px,
 * суммы табличным шрифтом, чтобы не «прыгали» при обновлении.
 */

const ROWS = [
  { key: 'invoices', icon: '📄', label: 'Счета',   accent: 'var(--blue)' },
  { key: 'payouts',  icon: '💰', label: 'Выплаты', accent: 'var(--gold)' },
  { key: 'cash',     icon: '💵', label: 'Касса',   accent: 'var(--green)' },
];

export default function DirectorQueuesWidget() {
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

  // Авто-обновление при изменениях (касса/выплаты/счета) + мягкий опрос
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

  const approvals = data?.approvals || {};
  const total = approvals.total_count || 0;

  const goTab = useCallback((tab) => {
    haptic.light();
    navigate(`/director-approvals?tab=${tab}`);
  }, [haptic, navigate]);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)',
        border: total > 0
          ? '0.5px solid color-mix(in srgb, var(--gold) 32%, var(--border-norse))'
          : '0.5px solid var(--border-norse)',
        boxShadow: total > 0 ? 'var(--shadow-sm), var(--shadow-gold)' : 'var(--shadow-sm)',
        animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
      }}
    >
      {/* ── Шапка: сколько всего ждёт решения ── */}
      <button
        type="button"
        onClick={() => { haptic.light(); navigate('/director-approvals'); }}
        className="w-full text-left spring-tap"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px 12px', minHeight: 56,
          borderBottom: '0.5px solid var(--border-norse)',
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            display: 'grid', placeItems: 'center', position: 'relative',
            background: total > 0
              ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
              : 'color-mix(in srgb, var(--green) 16%, transparent)',
            fontSize: 19,
          }}
        >
          ✍️
          {total > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -5,
              minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
              background: 'var(--danger)', color: 'var(--on-danger)',
              fontSize: 11, fontWeight: 800,
              display: 'grid', placeItems: 'center',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}>
              {total > 99 ? '99+' : total}
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {total > 0 ? 'Нужно ваше решение' : 'Всё согласовано'}
          </div>
          <div style={{ fontSize: 12, color: total > 0 ? 'var(--gold)' : 'var(--green)', fontWeight: 600, marginTop: 2 }}>
            {total > 0
              ? `${total} в очереди · ${formatMoney(approvals.total_sum || 0, { short: true })}`
              : 'Новых заявок нет'}
          </div>
        </div>
        <span style={{ fontSize: 16, color: 'var(--text-tertiary)', flexShrink: 0 }}>›</span>
      </button>

      {/* ── Три очереди: тап ведёт на свою вкладку ── */}
      {loading && !data ? (
        <div className="px-4 py-4"><SkeletonCard /></div>
      ) : (
        <div style={{ display: 'flex' }}>
          {ROWS.map((r, i) => {
            const cell = approvals[r.key] || { count: 0, sum: 0 };
            const has = cell.count > 0;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => goTab(r.key)}
                className="spring-tap"
                style={{
                  flex: 1, minWidth: 0, minHeight: 76,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 3,
                  padding: '12px 6px',
                  background: 'transparent',
                  border: 'none',
                  borderLeft: i > 0 ? '0.5px solid var(--border-norse)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 15 }}>{r.icon}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: has ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  }}>
                    {r.label}
                  </span>
                  {has && (
                    <span style={{
                      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                      background: r.accent, color: '#0b0b0b',
                      fontSize: 11, fontWeight: 800,
                      display: 'grid', placeItems: 'center',
                    }}>
                      {cell.count > 99 ? '99+' : cell.count}
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: has ? 14 : 12,
                  fontWeight: has ? 700 : 500,
                  color: has ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}>
                  {has ? formatMoney(cell.sum, { short: true }) : '—'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
