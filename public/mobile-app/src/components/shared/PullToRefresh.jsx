/**
 * PullToRefresh — кастомный PTR
 * Золотой Valknut-спиннер, threshold 60px, spring-back
 */
import { useState, useRef, useCallback } from 'react';

const THRESHOLD = 60;

export function PullToRefresh({ onRefresh, children }) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    if (containerRef.current?.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling || refreshing) return;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    // Dampened pull (logarithmic feel)
    setPullDistance(Math.min(dy * 0.5, 100));
  }, [pulling, refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;
    if (pullDistance >= THRESHOLD && onRefresh) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPulling(false);
    setPullDistance(0);
  }, [pulling, pullDistance, onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto scroll-container h-full"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: pullDistance || (refreshing ? 48 : 0),
          transition: pulling ? 'none' : 'height var(--motion-normal) var(--ease-spring)',
        }}
      >
        <div
          style={{
            opacity: progress,
            transform: `rotate(${progress * 360}deg) scale(${0.5 + progress * 0.5})`,
            transition: pulling ? 'none' : 'all var(--motion-normal) var(--ease-spring)',
            filter: progress > 0.3
              ? `drop-shadow(0 0 ${8 + progress * 12}px rgba(200, 168, 78, ${0.15 + progress * 0.25}))`
              : 'none',
          }}
        >
          {/* Valknut spinner (3 interlocked triangles) */}
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <path
              d="M20 4 L32 28 L8 28 Z"
              stroke="var(--gold)"
              strokeWidth="2"
              fill="none"
              opacity={refreshing ? 1 : progress}
            >
              {refreshing && (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 20 20"
                  to="360 20 20"
                  dur="1.2s"
                  repeatCount="indefinite"
                />
              )}
            </path>
            <path
              d="M14 8 L26 28 L2 22 Z"
              stroke="var(--gold)"
              strokeWidth="1.5"
              fill="none"
              opacity={0.6}
            />
            <path
              d="M26 8 L38 22 L14 28 Z"
              stroke="var(--gold)"
              strokeWidth="1.5"
              fill="none"
              opacity={0.6}
            />
          </svg>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance * 0.15}px)` : 'none',
          transition: pulling ? 'none' : 'transform var(--motion-normal) var(--ease-spring)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
