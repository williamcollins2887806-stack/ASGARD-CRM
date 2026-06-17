/**
 * Ring — SVG-кольцо готовности с подписью %.
 * Цвета: ≥80% — ok, ≥50% — amber, <50% — err.
 * Никаких хардкод-цветов — только CSS-переменные.
 */
import { readyColor } from './api';

export default function Ring({ value = 0, size = 56, strokeWidth }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const stroke = strokeWidth ?? Math.max(5, size * 0.11);
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const dash = c * (v / 100);
  const tone = readyColor(v);
  return (
    <svg
      width={size}
      height={size}
      style={{ flex: '0 0 auto' }}
      role="img"
      aria-label={`Готовность ${v}%`}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brd-1)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      </g>
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.round(size * 0.28)}
        fontWeight="800"
        fill={tone}
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      >
        {v}%
      </text>
    </svg>
  );
}
