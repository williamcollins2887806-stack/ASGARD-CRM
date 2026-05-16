/**
 * StatCard — единый компонент метрики. Максимум 3 в ряд, читаемый текст.
 * Поддерживает старый (iconColor/iconBg/delta) и новый (color/trend) API.
 */
import { useState, useEffect, useRef } from 'react';

export function StatCard({
  icon: Icon,
  label,
  value = '—',
  // новый API
  color,
  trend,        // число: +8.3 или -2.1 (%)
  // старый API (обратная совместимость)
  iconColor,
  iconBg,
  delta,
  delay = 0,
  onClick,
}) {
  const resolvedColor = color || iconColor || 'var(--blue)';
  const resolvedBg   = iconBg || `color-mix(in srgb, ${resolvedColor} 14%, transparent)`;
  const resolvedTrend = trend ?? delta;
  const trendPositive = resolvedTrend > 0;
  const hasTrend = resolvedTrend !== undefined && resolvedTrend !== null;

  const isNumber = typeof value === 'number';

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex flex-col items-center text-center rounded-2xl spring-tap"
      style={{
        padding: '14px 10px 12px',
        background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
        border: '0.5px solid var(--border-norse)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`,
        cursor: onClick ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Фоновое свечение иконки */}
      <div
        style={{
          position: 'absolute',
          top: -16,
          right: -16,
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: `radial-gradient(circle, color-mix(in srgb, ${resolvedColor} 10%, transparent), transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Иконка */}
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: resolvedBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        {Icon && <Icon size={18} style={{ color: resolvedColor }} strokeWidth={2} />}
      </div>

      {/* Значение */}
      <p
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: resolvedColor,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          marginBottom: 4,
          tabularNums: true,
        }}
      >
        {isNumber ? <AnimatedCounter to={value} /> : value}
      </p>

      {/* Метка — минимум 12px, читаемо */}
      <p
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          lineHeight: 1.3,
        }}
      >
        {label}
      </p>

      {/* Тренд */}
      {hasTrend && (
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: trendPositive ? 'var(--green)' : 'var(--red-soft)',
            marginTop: 3,
          }}
        >
          {trendPositive ? '▲' : '▼'} {Math.abs(resolvedTrend).toFixed(1)}%
        </p>
      )}
    </button>
  );
}

/**
 * StatRow — сетка для StatCard. Cols: 2 или 3 (не 4).
 */
export function StatRow({ children, cols = 3, className = '' }) {
  return (
    <div
      className={`grid gap-2.5 pb-4 ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

function AnimatedCounter({ to, duration = 600 }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof to !== 'number') return;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - p) * (1 - p);
      setDisplay(Math.round(to * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);

  return <>{display}</>;
}

export default StatCard;
