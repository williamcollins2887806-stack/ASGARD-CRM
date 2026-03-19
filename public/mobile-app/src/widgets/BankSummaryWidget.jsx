import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { BigNumber } from '@/components/shared/BigNumber';
import { formatMoney } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * BankSummaryWidget — баланс расчётного счёта
 * API: GET /integrations/bank/stats
 */
export default function BankSummaryWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/integrations/bank/stats');
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Банковская сводка" icon="🏦" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/integrations')}
      >
        {data ? (
          <>
            <BigNumber
              value={data.balance || 0}
              suffix="₽"
              label="Расчётный счёт"
              icon="🏦"
              format={(v) => v.toLocaleString('ru-RU')}
            />

            <div className="flex flex-wrap items-center gap-3 mt-3">
              {/* Income */}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
                ↑ {formatMoney(data.total_income || 0, { short: true })}
              </span>
              {/* Expense */}
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>
                ↓ {formatMoney(data.total_expense || 0, { short: true })}
              </span>
              {/* Unclassified */}
              {(data.unclassified_count || 0) > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'orange' }}>
                  {data.unclassified_count} не разнесено
                </span>
              )}
            </div>
          </>
        ) : (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-tertiary)',
              fontWeight: 500,
            }}
          >
            Нет данных
          </p>
        )}
      </button>
    </WidgetShell>
  );
}
