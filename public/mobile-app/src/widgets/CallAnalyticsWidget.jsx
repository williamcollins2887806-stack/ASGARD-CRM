import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { WidgetShell } from '@/widgets/WidgetShell';
import { Sparkline } from '@/components/shared/Sparkline';

/**
 * CallAnalyticsWidget — виджет аналитики звонков для дашборда
 * API: GET /call-reports/dashboard → {stats, chartData}
 */
export default function CallAnalyticsWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/call-reports/dashboard');
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = data?.stats || {};
  const chartData = data?.chartData || [];
  const sparkline = chartData.map(d => d.total || 0);

  return (
    <WidgetShell name="Аналитика звонков" icon="📊" loading={loading}>
      <button
        className="w-full spring-tap"
        onClick={() => navigate('/call-analytics')}
      >
        {/* KPI Row */}
        <div className="flex items-center gap-4 mb-3">
          {[
            { v: stats.totalCalls || 0, l: 'Всего', c: 'var(--blue)' },
            { v: stats.targetCalls || 0, l: 'Целевых', c: 'var(--green)' },
            { v: stats.missedCalls || 0, l: 'Пропущ.', c: 'var(--red)' },
          ].map((m, i) => (
            <div key={i} className="flex flex-col items-center">
              <span
                className="text-lg font-bold tabular-nums"
                style={{ color: m.c }}
              >
                {m.v}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                {m.l}
              </span>
            </div>
          ))}

          {/* Sparkline */}
          {sparkline.length > 1 && (
            <div className="flex-1 flex justify-end">
              <Sparkline data={sparkline} width={80} height={24} color="var(--gold)" />
            </div>
          )}
        </div>

        {/* AI Summary */}
        {stats.latestSummary ? (
          <div className="flex items-start gap-2">
            <span style={{ fontSize: 14 }}>🧙</span>
            <p
              className="text-xs leading-relaxed text-left"
              style={{ color: 'var(--text-secondary)' }}
            >
              {stats.latestSummary.slice(0, 120)}
              {stats.latestSummary.length > 120 ? '…' : ''}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 14 }}>📊</span>
            <span
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              AI-отчёты по расписанию
            </span>
          </div>
        )}
      </button>
    </WidgetShell>
  );
}
