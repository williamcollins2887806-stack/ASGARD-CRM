import { useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

/**
 * PageShell — обёртка страницы.
 * Glass-blur header при скролле, iOS large→compact title.
 * Props:
 *   showBack  — показать кнопку «Назад»
 *   onBack    — кастомный обработчик; по умолчанию navigate(-1)
 */
export function PageShell({
  title,
  children,
  noPadding = false,
  scrollable = true,
  headerRight,
  largeTitle = true,
  showBack = false,
  onBack,
}) {
  const mainRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);
  const navigate = useNavigate();

  const handleScroll = useCallback((e) => {
    setScrollY(e.target.scrollTop);
  }, []);

  const handleBack = onBack || (() => navigate(-1));

  const headerBlur = Math.min(scrollY / 60, 1);
  const isCompact  = scrollY > 40;

  return (
    <div className="flex flex-col h-full bg-primary">
      {title && (
        <header
          className="shrink-0 relative"
          style={{ paddingTop: 'calc(var(--safe-top) + 8px)', zIndex: 10 }}
        >
          {/* Glass на скролле */}
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

          <div className="relative flex items-center justify-between pb-2">
            {/* Левая сторона: кнопка назад или пустое место */}
            {showBack ? (
              <button
                onClick={handleBack}
                className="spring-tap flex items-center justify-center shrink-0"
                style={{
                  width: 44,
                  height: 44,
                  marginLeft: 4,
                  color: 'var(--gold)',
                }}
                aria-label="Назад"
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
              </button>
            ) : (
              <div style={{ width: 20, marginLeft: 20 }} />
            )}

            {/* Заголовок */}
            <h1
              className="font-bold tracking-tight c-primary flex-1"
              style={{
                fontSize: isCompact && largeTitle ? '17px' : '22px',
                transition: 'all var(--motion-normal) var(--ease-smooth-out)',
                paddingTop:    isCompact && largeTitle ? '4px'  : '8px',
                paddingBottom: isCompact && largeTitle ? '4px'  : '4px',
                paddingLeft:   showBack ? 4 : 0,
              }}
            >
              {title}
            </h1>

            {/* Правая сторона */}
            <div className="flex items-center gap-1 pr-2">
              {headerRight}
            </div>
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
