/**
 * SkeletonKit — Norse-тематичные skeleton-компоненты
 * Золотой тint shimmer в тёмной теме
 */

function SkeletonBase({ className = '', style = {}, children }) {
  return (
    <div
      className={`skeleton-norse ${className}`}
      style={{ ...style }}
    >
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBase
          key={i}
          style={{
            height: 12,
            borderRadius: 6,
            width: i === lines - 1 ? '60%' : '100%',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function SkeletonTitle({ width = '70%', className = '' }) {
  return (
    <SkeletonBase
      className={className}
      style={{ height: 18, borderRadius: 8, width }}
    />
  );
}

export function SkeletonAvatar({ size = 44, className = '' }) {
  return (
    <SkeletonBase
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div
      className={`rounded-2xl p-4 ${className}`}
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-center gap-3 mb-3">
        <SkeletonAvatar size={40} />
        <div className="flex-1 space-y-2">
          <SkeletonTitle width="50%" />
          <SkeletonBase style={{ height: 10, borderRadius: 5, width: '30%' }} />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/** Превью-список из N skeleton-карточек */
export function SkeletonList({ count = 3, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            animation: `fadeInUp var(--motion-normal) var(--ease-enter) ${i * 80}ms both`,
            opacity: 1 - i * 0.15,
          }}
        >
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}
