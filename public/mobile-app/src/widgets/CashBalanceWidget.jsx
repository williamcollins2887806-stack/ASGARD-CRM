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
          // Array of cash items — filter active, sum amounts
          const active = res.filter(
            (r) => r.status !== 'closed' && r.status !== 'returned'
          );
          const total = active.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
          setSum(total);
          setCount(active.length);
        } else if (res && typeof res === 'object') {
          // Object with balance/total/count
          setSum(res.balance ?? res.total ?? 0);
          setCount(res.count ?? 0);
        }
      } catch {
        setSum(0);
        setCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const countLabel = `${count} ${plural(count, 'заявка', 'заявки', 'заявок')} в обработке`;

  return (
    <WidgetShell name="Баланс КАССА" icon="💵" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/cash-admin')}
      >
        <BigNumber
          value={sum}
          suffix="₽"
          label="Выдано из кассы"
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
