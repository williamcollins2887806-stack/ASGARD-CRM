import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * PageShell — обёртка страницы
 * Glass-blur header при скролле, large→compact title (iOS-стиль)
 */
export function PageShell({
  title,
  children,
  noPadding = false,
  scrollable = true,
  headerRight,
  largeTitle = true,
}) {
  const mainRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);

  const handleScroll = useCallback((e) => {
    setScrollY(e.target.scrollTop);
  }, []);

  // Header opacity & compact state
  const headerBlur = Math.min(scrollY / 60, 1);
  const isCompact = scrollY > 40;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {title && (
        <header
          className="shrink-0 relative"
          style={{
            paddingTop: 'calc(var(--safe-top) + 8px)',
            zIndex: 10,
          }}
        >
          {/* Glass background on scroll */}
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${headerBlur * 20}px) saturate(${100 + headerBlur * 80}%)`,
              WebkitBackdropFilter: `blur(${headerBlur * 20}px) saturate(${100 + headerBlur * 80}%)`,
              backgroundColor: `color-mix(in srgb, var(--bg-primary) ${Math.round(headerBlur * 80)}%, transparent)`,
              borderBottom: headerBlur > 0.5
                ? '0.5px solid color-mix(in srgb, var(--gold) 12%, var(--border-norse))'
                : 'none',
              transition: 'border-bottom var(--motion-fast) var(--ease-smooth-out)',
            }}
          />

          <div className="relative flex items-center justify-between px-5 pb-2">
            <h1
              className="font-bold tracking-tight"
              style={{
                color: 'var(--text-primary)',
                fontSize: isCompact && largeTitle ? '17px' : '22px',
                transition: 'all var(--motion-normal) var(--ease-smooth-out)',
                paddingTop: isCompact && largeTitle ? '4px' : '8px',
                paddingBottom: isCompact && largeTitle ? '4px' : '4px',
              }}
            >
              {title}
            </h1>
            {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
          </div>
        </header>
      )}

      <main
        ref={mainRef}
        onScroll={scrollable ? handleScroll : undefined}
        className={`flex-1 ${scrollable ? 'overflow-y-auto scroll-container' : 'overflow-hidden'} ${noPadding ? '' : 'px-4'}`}
        style={{ paddingBottom: 'calc(var(--tabbar-total) + 16px)' }}
      >
        <div className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
