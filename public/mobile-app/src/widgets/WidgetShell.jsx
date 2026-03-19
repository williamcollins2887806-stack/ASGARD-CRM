import { useState, useEffect } from 'react';
import { SkeletonCard } from '@/components/shared/SkeletonKit';

/**
 * WidgetShell — обёртка виджета
 * Glassmorphism + gold glow при касании
 * Защитный таймаут: если loading > 30 сек — показывает контент / fallback
 */
export function WidgetShell({ name, icon, loading, delay = 0, children }) {
  const [forceShow, setForceShow] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!loading) { setForceShow(false); return; }
    const t = setTimeout(() => setForceShow(true), 30000);
    return () => clearTimeout(t);
  }, [loading]);

  const showSkeleton = loading && !forceShow;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onTouchCancel={() => setPressed(false)}
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
        backdropFilter: 'blur(8px) saturate(140%)',
        WebkitBackdropFilter: 'blur(8px) saturate(140%)',
        border: pressed
          ? '0.5px solid rgba(200, 168, 78, 0.25)'
          : '0.5px solid var(--border-norse)',
        boxShadow: pressed
          ? 'var(--shadow-sm), var(--shadow-gold)'
          : 'var(--shadow-sm)',
        transition: 'border 200ms ease, box-shadow 200ms ease',
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${delay}ms both`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5">
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <span
          className="c-secondary"
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.2,
          }}
        >
          {name}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        {showSkeleton ? (
          <SkeletonCard />
        ) : forceShow && loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="c-tertiary" style={{ fontSize: 13 }}>
              Нет данных
            </span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
