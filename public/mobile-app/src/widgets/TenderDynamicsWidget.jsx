import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { MiniChart } from '@/components/shared/MiniChart';
import { WidgetShell } from '@/widgets/WidgetShell';

const MONTH_LABELS = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];

/**
 * TenderDynamicsWidget (WIDE) — динамика тендеров по месяцам
 * API: GET /data/tenders
 * Группирует по месяцу created_at текущего года, 12 баров
 */
export default function TenderDynamicsWidget() {
  const [chartData, setChartData] = useState(new Array(12).fill(0));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/data/tenders?limit=50');
        const rows = api.extractRows(res);
        const currentYear = new Date().getFullYear();
        const monthly = new Array(12).fill(0);

        rows.forEach((t) => {
          if (!t.created_at) return;
          const d = new Date(t.created_at);
          if (d.getFullYear() === currentYear) {
            monthly[d.getMonth()] += 1;
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
      <button
        className="w-full text-left spring-tap"
        onClick={() => navigate('/tenders')}
      >
        <MiniChart
          data={chartData}
          labels={MONTH_LABELS}
          height={80}
          color="var(--blue)"
        />
      </button>
    </WidgetShell>
  );
}
