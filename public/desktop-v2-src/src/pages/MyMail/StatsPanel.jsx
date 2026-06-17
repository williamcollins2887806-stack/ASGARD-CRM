/**
 * StatsPanel — статистика по почте (vanilla my_mail.js:320 loadStats).
 *
 * Реализует:
 *  - всего писем, непрочитанных
 *  - средняя длина (вычисляется из выборки)
 *  - мини-spark-chart активности по дням (последние 7 дней)
 */
export function StatsPanel({ stats, activity }) {
  const total = Number(stats?.total) || 0;
  const unread = Number(stats?.unread) || 0;
  const avgLen = Number(stats?.avg_len) || 0;

  return (
    <div className="mm-stats">
      <div className="mm-sidebar__title">📊 Статистика</div>
      <div className="mm-stats__grid">
        <div className="mm-stats__cell">
          <div className="mm-stats__num">{total}</div>
          <div className="mm-stats__lbl">всего</div>
        </div>
        <div className="mm-stats__cell">
          <div className="mm-stats__num">{unread}</div>
          <div className="mm-stats__lbl">непрочитанных</div>
        </div>
        {avgLen > 0 && (
          <div className="mm-stats__cell">
            <div className="mm-stats__num">{avgLen}</div>
            <div className="mm-stats__lbl">ср. длина</div>
          </div>
        )}
      </div>
      <Sparkline data={activity || []} />
    </div>
  );
}

function Sparkline({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(1, ...data);
  const W = 160;
  const H = 36;
  const step = W / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = H - (v / max) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `0,${H} ${pts} ${W},${H}`;
  return (
    <div className="mm-stats__chart" title="Активность за последние 7 дней">
      <div className="mm-stats__chart-lbl">7 дней</div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none">
        <polygon points={area} fill="var(--gold-bg)" />
        <polyline points={pts} fill="none" stroke="var(--gold)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
