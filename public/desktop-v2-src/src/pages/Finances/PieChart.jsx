/**
 * SVG-кольцевая диаграмма по категориям расходов.
 * Без библиотек, чтобы не тянуть лишние зависимости.
 */
import { EXPENSE_CATEGORIES, fmtMoney, moneyShort } from './api';

function polarToCartesian(cx, cy, r, angle) {
  const rad = (angle - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end   = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export default function PieChart({ title, categories, total: totalProp }) {
  const total = totalProp ?? Object.values(categories).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return (
      <div className="fin-chart">
        {title && <h3 className="fin-chart-title">{title}</h3>}
        <div className="c-t3 fs-13 p-10">
          Нет данных по категориям расходов.
        </div>
      </div>
    );
  }

  let currentAngle = 0;
  const segments = EXPENSE_CATEGORIES
    .filter((c) => (categories[c.key] || 0) > 0)
    .map((c) => {
      const value = categories[c.key];
      const pct   = value / total;
      const angle = pct * 360;
      const startAngle = currentAngle;
      currentAngle += angle;
      return { ...c, value, pct, startAngle, angle };
    });

  const svgPaths = segments.map((s, i) => {
    if (s.angle >= 359.9) {
      return (
        <circle
          key={i}
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={s.color}
          strokeWidth="32"
        />
      );
    }
    return (
      <path
        key={i}
        d={describeArc(100, 100, 80, s.startAngle, s.startAngle + s.angle)}
        fill="none"
        stroke={s.color}
        strokeWidth="32"
        strokeLinecap="butt"
      />
    );
  });

  return (
    <div className="fin-chart">
      {title && <h3 className="fin-chart-title">{title}</h3>}
      <div className="fin-pie-row">
        <div className="fin-pie">
          <svg viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)' }}>
            {svgPaths}
          </svg>
          <div className="fin-pie-center">
            <div className="fin-pie-total">{moneyShort(total)}</div>
            <div className="fin-pie-label">Всего</div>
          </div>
        </div>
        <div className="fin-legend">
          {segments.map((s) => (
            <div key={s.key} className="fin-legend-item">
              <span className="fin-legend-color" style={{ background: s.color }} />
              <span className="fin-legend-icon">{s.icon}</span>
              <span className="fin-legend-label">{s.label}</span>
              <span className="fin-legend-value">{fmtMoney(s.value)}</span>
              <span className="fin-legend-pct">{(s.pct * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
