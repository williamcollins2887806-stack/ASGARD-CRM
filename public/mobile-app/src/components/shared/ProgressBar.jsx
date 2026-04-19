/**
 * ProgressBar — прогресс-бар с анимацией
 */
export function ProgressBar({ value = 0, max = 100, color = 'var(--blue)', label, className = '' }) {
  const pct = Math.min(Math.max((value / (max || 1)) * 100, 0), 100);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 6, backgroundColor: 'var(--bg-elevated)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: color,
            transition: 'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
      </div>
      {label && (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, minWidth: 32, textAlign: 'right' }}>
          {label}
        </span>
      )}
    </div>
  );
}
