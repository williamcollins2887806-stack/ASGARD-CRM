import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { BigNumber } from '@/components/shared/BigNumber';
import { plural } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * CashBalanceWidget — баланс кассы
 * API: GET /cash/balance
 */
export default function CashBalanceWidget() {
  const [sum, setSum] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/cash/balance');

        if (Array.isArray(res)) {
          // Массив заявок — суммируем остаток по незакрытым
          const active = res.filter(
            (r) => r.status !== 'closed' && r.status !== 'returned'
          );
          const total = active.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
          setSum(total);
          setCount(active.length);
        } else if (res && typeof res === 'object') {
          // 19.10.2026: /cash/balance отдаёт { balance, operations }.
          // balance — ОСТАТОК в кассе, а не «выдано». Раньше виджет подписывал
          // его «Выдано из кассы» и показывал 1 327 800 ₽ вместо 89 200 ₽.
          setSum(res.balance ?? res.total ?? 0);
          const ops = Array.isArray(res.operations) ? res.operations : [];
          setCount(ops.length);
        }
      } catch {
        setSum(0);
        setCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const countLabel = count > 0
    ? `${count} ${plural(count, 'операция', 'операции', 'операций')} в кассе`
    : '';

  return (
    <WidgetShell name="Баланс КАССА" icon="💵" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/cash-admin')}
      >
        <BigNumber
          value={sum}
          suffix="₽"
          label="В кассе сейчас"
          icon="💵"
          format={(v) => v.toLocaleString('ru-RU')}
        />

        {count > 0 && (
          <p
            className="mt-2"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            {countLabel}
          </p>
        )}
      </button>
    </WidgetShell>
  );
}
