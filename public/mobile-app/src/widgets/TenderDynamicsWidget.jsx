import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadRegistry } from '@/api/tendersRegistry';
import { MiniChart } from '@/components/shared/MiniChart';
import { WidgetShell } from '@/widgets/WidgetShell';

const MONTH_LABELS = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];

/**
 * TenderDynamicsWidget — динамика по полю period (YYYY-MM), не created_at
 */
export default function TenderDynamicsWidget() {
  const [chartData, setChartData] = useState(new Array(12).fill(0));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await loadRegistry({ subtab: 'registry', period: '', limit: 2000 });
        const rows = res.items || [];
        const currentYear = new Date().getFullYear();
        const monthly = new Array(12).fill(0);

        rows.forEach((t) => {
          const p = t.period;
          if (!p || !/^\d{4}-\d{2}$/.test(String(p))) return;
          const [y, m] = String(p).split('-').map(Number);
          if (y === currentYear && m >= 1 && m <= 12) {
            monthly[m - 1] += 1;
          }
        });

        setChartData(monthly);
      } catch {
        setChartData(new Array(12).fill(0));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <WidgetShell name="Динамика тендеров" icon="📈" loading={loading}>
      <button className="w-full text-left spring-tap" onClick={() => navigate('/tenders')}>
        <MiniChart data={chartData} labels={MONTH_LABELS} height={80} color="var(--blue)" />
      </button>
    </WidgetShell>
  );
}
