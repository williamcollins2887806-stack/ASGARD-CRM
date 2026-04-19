import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { formatMoney } from '@/lib/utils';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * PayrollPendingWidget — ведомости, ожидающие согласования
 * API: GET /payroll/sheets + GET /data/users (parallel)
 */
export default function PayrollPendingWidget() {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [sheetsRes] = await Promise.all([
          api.get('/payroll/sheets'),
          api.get('/data/users?limit=200'),
        ]);

        const sheets = api.extractRows(sheetsRes);
        const pending = sheets.filter((s) => s.status === 'pending');

        setCount(pending.length);
        setTotal(
          pending.reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
        );
      } catch {
        setCount(0);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Ведомости (ожидание)" icon="📋" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/payroll')}
      >
        <span
          style={{
            fontSize: 36,
            fontWeight: 900,
            lineHeight: 1.1,
            color: count > 0 ? 'orange' : 'var(--green)',
          }}
        >
          {count}
        </span>

        <p
          className="mt-1"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: 0.2,
          }}
        >
          {count > 0 ? 'На согласовании' : 'Нет ожидающих'}
        </p>

        {count > 0 && (
          <p
            className="mt-0.5"
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            {formatMoney(total)}
          </p>
        )}
      </button>
    </WidgetShell>
  );
}
