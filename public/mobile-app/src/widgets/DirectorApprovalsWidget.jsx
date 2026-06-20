import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * DirectorApprovalsWidget — виджет на главной для DIRECTOR_COMM.
 *
 * Показывает количество cash_requests со status='requested' и быстрый CTA
 * на страницу `/director-approvals`.
 *
 * Видимость:
 *   • DIRECTOR_COMM (главный согласант)
 *   • DIRECTOR_GEN  (резервный)
 *   • DIRECTOR_DEV  (резервный)
 *   • ADMIN         (на всякий случай)
 *
 * Для остальных ролей возвращает null — виджет не отрисовывается.
 *
 * Подписывается на window event `asgard:cash:changed` — авто-refresh
 * (см. одноимённый dispatcher в Approvals.jsx и cash.js).
 */
export default function DirectorApprovalsWidget() {
  const user     = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic   = useHaptic();
  const [count,        setCount]        = useState(0);
  const [biggestAmount, setBiggestAmount] = useState(0);
  const [loading,      setLoading]      = useState(true);

  const role = user?.role || '';
  const isVisible =
    role === 'DIRECTOR_COMM' ||
    role === 'DIRECTOR_GEN'  ||
    role === 'DIRECTOR_DEV'  ||
    role === 'ADMIN';

  const fetchCount = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const res  = await api.get('/cash/all?status=requested');
      let rows   = api.extractRows(res) || [];
      rows       = rows.filter((r) => r.status === 'requested');
      setCount(rows.length);
      const max = rows.reduce((m, r) => Math.max(m, Number(r.amount) || 0), 0);
      setBiggestAmount(max);
    } catch {
      setCount(0);
      setBiggestAmount(0);
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  // Push-event subscription
  useEffect(() => {
    if (!isVisible) return;
    const handler = () => { fetchCount(); };
    window.addEventListener('asgard:cash:changed', handler);
    return () => window.removeEventListener('asgard:cash:changed', handler);
  }, [isVisible, fetchCount]);

  if (!isVisible) return null;

  const hasPending = count > 0;
  const accentColor = hasPending ? 'var(--gold)' : 'var(--green)';

  return (
    <WidgetShell name="Согласование кассы" icon="📋" loading={loading}>
      <button
        className="da-widget w-full text-left spring-tap"
        onClick={() => { haptic.light(); navigate('/director-approvals'); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        }}
      >
        {/* Icon */}
        <div
          className="da-widget-icon"
          style={{
            width: 44, height: 44, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: hasPending
              ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
              : 'color-mix(in srgb, var(--green) 18%, transparent)',
            fontSize: 22, flexShrink: 0,
            position: 'relative',
          }}
        >
          📋
          {hasPending && (
            <span
              className="da-widget-badge"
              style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 20, height: 20, padding: '0 6px',
                borderRadius: 10,
                background: 'var(--red)',
                color: 'white',
                fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="da-widget-content" style={{ flex: 1, minWidth: 0 }}>
          <div className="da-widget-title" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            {hasPending ? 'Касса: нужна виза' : 'Касса: всё согласовано'}
          </div>
          <div className="da-widget-count" style={{ fontSize: 12, color: accentColor, fontWeight: 600, marginTop: 2 }}>
            {hasPending
              ? `${count} ${plural(count, 'заявка', 'заявки', 'заявок')} ждёт${count === 1 ? '' : ''}`
              : 'Свежих запросов нет'}
            {hasPending && biggestAmount > 0 && (
              <span style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontWeight: 500 }}>
                · до {formatMoney(biggestAmount, { short: true })}
              </span>
            )}
          </div>
        </div>

        <ChevronRight size={16} style={{ color: accentColor, flexShrink: 0 }} />
      </button>
    </WidgetShell>
  );
}

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
