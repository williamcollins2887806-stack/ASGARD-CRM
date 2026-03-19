import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';

/**
 * ApprovalsWidget — количество ожидающих согласований
 * API: GET /data/bonus_requests + GET /data/estimates
 */
export default function ApprovalsWidget() {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [bonusRes, estimatesRes] = await Promise.all([
          api.get('/data/bonus_requests'),
          api.get('/data/estimates?limit=50'),
        ]);

        const bonuses = api.extractRows(bonusRes);
        const estimates = api.extractRows(estimatesRes);

        const pendingBonuses = bonuses.filter(
          (b) => b.status === 'pending'
        );
        const pendingEstimates = estimates.filter(
          (e) => e.status === 'sent' || e.status === 'pending'
        );

        const all = [...pendingBonuses, ...pendingEstimates];
        setCount(all.slice(0, 3).length > 0 ? all.length : 0);
      } catch {
        setCount(0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Согласования" icon="✍️" loading={loading}>
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/approvals')}
      >
        <div className="flex items-baseline gap-2">
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
        </div>
        <p
          className="mt-1"
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            fontWeight: 600,
            letterSpacing: 0.2,
          }}
        >
          {count > 0 ? 'Ожидают решения' : 'Всё согласовано'}
        </p>
      </button>
    </WidgetShell>
  );
}
