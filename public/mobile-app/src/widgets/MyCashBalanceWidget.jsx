import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { formatMoney } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';

/**
 * MyCashBalanceWidget — мои подотчётные
 * API: GET /cash/my-balance
 *
 * С июня 2026 формула включает Stage W:
 *   handovers_received (нал от СЗ), cash_payouts_workers (выдано рабочим), se_cash_legacy.
 * Если бек отдаёт новое поле handovers_received → показываем 4 колонки,
 * иначе fallback на старые 3 (На руках / Потрачено / Активных).
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
  const handoversReceived = Number(data?.handovers_received) || 0;
  const cashPayoutsWorkers = Number(data?.cash_payouts_workers) || 0;

  // 4-колоночная разбивка появляется когда сервер вернул новое поле
  // handovers_received (даже =0 → пользователь видит «От СЗ: 0 ₽», что норма).
  const hasStageW = data && Object.prototype.hasOwnProperty.call(data, 'handovers_received');

  const columns = hasStageW ? [
    { label: 'На руках',  value: formatMoney(onHand, { short: true }),              color: 'var(--blue)' },
    { label: 'От СЗ',     value: formatMoney(handoversReceived, { short: true }),   color: 'var(--green)' },
    { label: 'Выдано',    value: formatMoney(cashPayoutsWorkers, { short: true }),  color: 'var(--gold)' },
    { label: 'Активных',  value: activeCount,                                       color: 'var(--text-primary)' },
  ] : [
    { label: 'На руках',  value: formatMoney(onHand, { short: true }), color: 'var(--blue)' },
    { label: 'Потрачено', value: formatMoney(spent,  { short: true }), color: 'var(--gold)' },
    { label: 'Активных',  value: activeCount,                          color: 'var(--green)' },
  ];

  return (
    <WidgetShell name="Мои подотчётные" icon="💼" loading={loading}>
      <div
        className={`grid ${hasStageW ? 'grid-cols-4' : 'grid-cols-3'} gap-2 spring-tap cursor-pointer`}
        onClick={() => {
          haptic.light();
          navigate('/cash');
        }}
      >
        {columns.map((col) => (
          <div key={col.label} className="text-center">
            <div
              style={{
                fontSize: hasStageW ? 15 : 18,
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
                fontSize: 10,
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
