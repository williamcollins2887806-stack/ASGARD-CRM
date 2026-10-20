/**
 * PullToRefresh — кастомный PTR
 * Золотой Valknut-спиннер, threshold 60px, spring-back.
 *
 * Важно (20.10.2026): компонент НЕ создаёт собственный скролл-контейнер.
 * Раньше это был `overflow-y-auto` внутри `PageShell.main`, который тоже
 * скроллится — двойной вложенный скролл ломал инерцию iOS и «дёргал» контент
 * у нижнего тап-бара. Теперь жесты навешиваются на УЖЕ существующий скроллер
 * (родительский), а этот компонент отвечает только за индикатор и смещение.
 *
 * Если родительского скролл-контейнера нет — компонент создаёт свой
 * (обратная совместимость для экранов без PageShell).
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const THRESHOLD = 60;

export function PullToRefresh({ onRefresh, children, /** опционально: свой скроллер */ scrollRef }) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef(null);
  /** Скроллер, к которому реально привязаны жесты. */
  const scrollerRef = useRef(null);

  const [ownScroller, setOwnScroller] = useState(false);

  // Определяем скроллер: переданный, ближайший родительский (только реальные
  // скролл-контейнеры проекта с классом scroll-container) или собственный.
  // Ищем именно `.scroll-container`, чтобы не привязаться к случайному
  // overflow-родителю с нулевым нижним отступом.
  useEffect(() => {
    const own = containerRef.current;
    if (!own) return;
    if (scrollRef?.current) { scrollerRef.current = scrollRef.current; setOwnScroller(false); return; }
    const parentScroller = own.closest('.scroll-container');
    if (parentScroller && parentScroller !== own) {
      scrollerRef.current = parentScroller;
      setOwnScroller(false);
      return;
    }
    scrollerRef.current = own; // своего скроллера нет — работаем как раньше
    setOwnScroller(true);
  }, [scrollRef]);

  const handleTouchStart = useCallback((e) => {
    const sc = scrollerRef.current;
    if ((sc ? sc.scrollTop : 0) <= 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  /**
   * Тяга обрабатывается через requestAnimationFrame: раньше setPullDistance
   * вызывался на КАЖДЫЙ touchmove, и React перерисовывал всё дерево страницы
   * десятки раз в секунду — на списках это давало заметные «дёргания».
   * Теперь состояние обновляется не чаще одного раза на кадр.
   */
  const rafRef = useRef(0);
  const pendingDy = useRef(0);

  const handleTouchMove = useCallback((e) => {
    if (!pulling || refreshing) return;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    pendingDy.current = dy;
    if (rafRef.current) return; // кадр уже запланирован — не плодим обновления
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setPullDistance(Math.min(pendingDy.current * 0.5, 100));
    });
  }, [pulling, refreshing]);

  /** Снимаем запланированный кадр при размонтировании. */
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

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
      className={ownScroller ? 'relative overflow-y-auto scroll-container h-full' : 'relative'}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ WebkitOverflowScrolling: 'touch' }}
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
