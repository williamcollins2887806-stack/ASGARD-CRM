/**
 * StatCard — карточка метрики (Сбер-стиль)
 * Иконка + анимированное число + label + дельта
 */
import { useState, useEffect, useRef } from 'react';

export function StatCard({
  icon: Icon,
  iconColor = 'var(--blue)',
  iconBg = 'rgba(74, 144, 217, 0.1)',
  value = '—',
  label,
  delta,
  delay = 0,
  onClick,
}) {
  const isNumber = typeof value === 'number';

  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden haptic-press ripple-container"
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{
        backgroundColor: 'var(--bg-surface)',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ backgroundColor: iconBg }}
      >
        {Icon && <Icon size={20} style={{ color: iconColor }} />}
      </div>

      {/* Animated value */}
      <div className="flex items-end gap-1.5">
        <span
          className="text-2xl font-bold tabular-nums counter-animate"
          style={{ color: 'var(--text-primary)' }}
        >
          {isNumber ? <AnimatedCounter to={value} /> : value}
        </span>

        {/* Delta badge */}
        {delta != null && (
          <span
            className="text-xs font-semibold mb-0.5 px-1.5 py-0.5 rounded-md"
            style={{
              color: delta >= 0 ? 'var(--green)' : 'var(--red-soft)',
              backgroundColor: delta >= 0
                ? 'rgba(48, 209, 88, 0.1)'
                : 'rgba(198, 40, 40, 0.1)',
            }}
          >
            {delta >= 0 ? '↑' : '↓'}{Math.abs(delta)}%
          </span>
        )}
      </div>

      {/* Label */}
      <p
        className="text-xs mt-1 font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </p>

      {/* Subtle gradient glow */}
      <div
        className="absolute -top-6 -right-6 w-20 h-20 rounded-full"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, ${iconColor} 8%, transparent), transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** Count-up эффект */
function AnimatedCounter({ to, duration = 600 }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (typeof to !== 'number') return;
    const start = performance.now();
    const from = 0;

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);

  return <>{display}</>;
}
