import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { formatMoney } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * MyCashBalanceWidget — мои подотчётные
 * API: GET /cash/my-balance
 */
export default function MyCashBalanceWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/cash/my-balance');
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onHand = Number(data?.balance ?? data?.on_hand) || 0;
  const spent = Number(data?.spent) || 0;
  const activeCount = Number(data?.active_requests ?? data?.active_count) || 0;

  const columns = [
    { label: 'На руках', value: formatMoney(onHand, { short: true }), color: 'var(--blue)' },
    { label: 'Потрачено', value: formatMoney(spent, { short: true }), color: 'var(--gold)' },
    { label: 'Активных', value: activeCount, color: 'var(--green)' },
  ];

  return (
    <WidgetShell name="Мои подотчётные" icon="💼" loading={loading}>
      <div
        className="grid grid-cols-3 gap-2 spring-tap cursor-pointer"
        onClick={() => {
          haptic.light();
          navigate('/cash');
        }}
      >
        {columns.map((col) => (
          <div key={col.label} className="text-center">
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: col.color,
                lineHeight: 1.2,
              }}
            >
              {col.value}
            </div>
            <div
              className="mt-1"
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                fontWeight: 500,
              }}
            >
              {col.label}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
