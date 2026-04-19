import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';
import { Sparkline } from '@/components/shared/Sparkline';

/**
 * KpiSummaryWidget (WIDE) — KPI сводка
 * API: GET /data/tenders + GET /works + GET /data/estimates (параллельно)
 */
export default function KpiSummaryWidget() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const currentYear = new Date().getFullYear();
        const [tendersRes, worksRes, estimatesRes] = await Promise.all([
          api.get('/data/tenders?limit=50'),
          api.get('/works?limit=200'),
          api.get('/data/estimates?limit=50'),
        ]);

        const tenders = api.extractRows(tendersRes);
        const works = api.extractRows(worksRes);
        const estimates = api.extractRows(estimatesRes);

        // Filter current year
        const isCurrentYear = (row) => {
          const d = row.created_at ? new Date(row.created_at) : null;
          return d && d.getFullYear() === currentYear;
        };

        const yearTenders = tenders.filter(isCurrentYear);
        const yearWorks = works.filter(isCurrentYear);
        const yearEstimates = estimates.filter(isCurrentYear);

        // In-work statuses
        const activeStatuses = ['В работе', 'Активна', 'В процессе', 'Назначена'];
        const inWork = yearWorks.filter((w) => activeStatuses.includes(w.status));

        // Average margin
        const margins = yearEstimates
          .map((e) => Number(e.margin_percent))
          .filter((m) => !isNaN(m) && m > 0);
        const avgMargin =
          margins.length > 0
            ? Math.round(margins.reduce((s, v) => s + v, 0) / margins.length)
            : 0;

        // Monthly sparkline grouping
        function monthlyData(rows) {
          const counts = Array(12).fill(0);
          rows.forEach((r) => {
            const d = r.created_at ? new Date(r.created_at) : null;
            if (d && d.getFullYear() === currentYear) {
              counts[d.getMonth()]++;
            }
          });
          const currentMonth = new Date().getMonth();
          return counts.slice(0, currentMonth + 1);
        }

        setStats({
          tendersCount: yearTenders.length,
          tendersSpark: monthlyData(yearTenders),
          inWorkCount: inWork.length,
          inWorkSpark: monthlyData(inWork),
          avgMargin,
          estimatesCount: yearEstimates.length,
          estimatesSpark: monthlyData(yearEstimates),
        });
      } catch {
        setStats(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const cards = stats
    ? [
        {
          label: 'Тендеров',
          value: stats.tendersCount,
          color: 'var(--blue)',
          spark: stats.tendersSpark,
        },
        {
          label: 'В работе',
          value: stats.inWorkCount,
          color: 'var(--green)',
          spark: stats.inWorkSpark,
        },
        {
          label: 'Ср. маржа %',
          value: stats.avgMargin,
          color: 'var(--gold)',
          spark: null,
        },
        {
          label: 'Просчётов',
          value: stats.estimatesCount,
          color: '#D4A843',
          spark: stats.estimatesSpark,
        },
      ]
    : [];

  return (
    <WidgetShell name="KPI сводка" icon="🎯" loading={loading}>
      <div
        className="flex gap-3 overflow-x-auto pb-1"
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex-shrink-0 flex flex-col justify-between p-3"
            style={{
              width: 140,
              backgroundColor: 'var(--bg-surface-alt)',
              borderRadius: 14,
              border: '1px solid var(--border-norse)',
              scrollSnapAlign: 'start',
            }}
          >
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: card.color,
                lineHeight: 1.1,
              }}
            >
              {card.value}
            </span>

            {card.spark && (
              <div className="mt-1.5">
                <Sparkline
                  data={card.spark}
                  width={48}
                  height={20}
                  color={card.color}
                />
              </div>
            )}

            <span
              className="mt-2"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              {card.label}
            </span>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
