import { AnimatedCounter } from './AnimatedCounter';

/**
 * BigNumber — крупное число + label + emoji
 */
export function BigNumber({ value, label, icon, color = 'var(--text-primary)', format, suffix = '', className = '' }) {
  const isNum = typeof value === 'number';

  return (
    <div className={`flex items-start gap-2 ${className}`}>
      {icon && <span style={{ fontSize: 24, lineHeight: 1.2 }}>{icon}</span>}
      <div>
        <div className="flex items-baseline gap-1">
          <span style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1.1 }}>
            {isNum ? <AnimatedCounter to={value} format={format} /> : value}
          </span>
          {suffix && (
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>{suffix}</span>
          )}
        </div>
        {label && (
          <p className="mt-0.5" style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: 0.2 }}>
            {label}
          </p>
        )}
      </div>
    </div>
  );
}
