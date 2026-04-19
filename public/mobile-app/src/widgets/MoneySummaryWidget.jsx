import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { AnimatedCounter } from '@/components/shared/AnimatedCounter';
import { Sparkline } from '@/components/shared/Sparkline';
import { formatMoney } from '@/lib/utils';
import { useHaptic } from '@/hooks/useHaptic';
import { SkeletonCard } from '@/components/shared/SkeletonKit';

/**
 * MoneySummaryWidget (HERO — NO WidgetShell)
 * API: GET /works + GET /data/tenders
 * Safety timeout: 5 сек → показать с нулями если API не ответил
 */
export default function MoneySummaryWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const haptic = useHaptic();

  // Safety timeout: если API не отвечает > 5 сек, показать с нулями
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 30000);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    (async () => {
      try {
        const currentYear = new Date().getFullYear();
        const [worksRes, tendersRes] = await Promise.all([
          api.get('/works?limit=200'),
          api.get('/data/tenders?limit=50'),
        ]);

        const works = api.extractRows(worksRes);
        const tenders = api.extractRows(tendersRes);
        const all = [...works, ...tenders];

        // Filter current year
        const yearRows = all.filter((r) => {
          const d = r.created_at ? new Date(r.created_at) : null;
          return d && d.getFullYear() === currentYear;
        });

        let revenue = 0;
        let expenses = 0;
        const monthlyRevenue = Array(12).fill(0);

        yearRows.forEach((r) => {
          const sum = Number(r.contract_value) || 0;
          const cost = Number(r.total_cost || r.expenses) || 0;
          revenue += sum;
          expenses += cost;

          if (sum > 0) {
            const d = new Date(r.created_at);
            monthlyRevenue[d.getMonth()] += sum;
          }
        });

        const currentMonth = new Date().getMonth();
        const sparkData = monthlyRevenue.slice(0, currentMonth + 1);

        setData({
          revenue,
          expenses,
          profit: revenue - expenses,
          sparkData,
        });
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="rounded-3xl p-5" style={{ background: 'var(--hero-gradient)' }}>
        <SkeletonCard />
      </div>
    );
  }

  const revenue = data?.revenue || 0;
  const expenses = data?.expenses || 0;
  const profit = data?.profit || 0;
  const sparkData = data?.sparkData || [];

  return (
    <div
      className="rounded-3xl relative overflow-hidden spring-tap cursor-pointer"
      style={{
        background: 'var(--hero-gradient)',
        padding: 20,
        boxShadow: '0 8px 32px rgba(26, 74, 138, 0.2)',
        animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
      }}
      onClick={() => {
        haptic.light();
        navigate('/finances');
      }}
    >
      {/* Rune watermark */}
      <span
        className="absolute pointer-events-none select-none"
        style={{
          fontSize: 32,
          color: 'rgba(255, 255, 255, 0.08)',
          right: 48,
          top: 40,
        }}
      >
        ᚨ
      </span>

      {/* Label */}
      <span
        style={{
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.55)',
          letterSpacing: 1.5,
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        ФИНАНСЫ 2026
      </span>

      {/* Revenue */}
      <div className="mt-2">
        <AnimatedCounter
          to={revenue}
          format={(v) => formatMoney(v, { short: true })}
          style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}
        />
      </div>

      {/* Sparkline */}
      {sparkData.length > 0 && (
        <div className="mt-3">
          <Sparkline
            data={sparkData}
            width={200}
            height={28}
            color="rgba(255, 255, 255, 0.7)"
          />
        </div>
      )}

      {/* Details row */}
      <div className="flex items-center gap-4 mt-3">
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red-soft)' }}>
          Расходы: {formatMoney(expenses, { short: true })}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>
          Прибыль: {formatMoney(profit, { short: true })}
        </span>
      </div>
    </div>
  );
}
