/**
 * BottomSheet — iOS-стиль bottom sheet
 * Grab handle, glass-фон, spring-анимация, overlay blur
 * Optional sticky `footer` outside scroll area.
 */
import { useEffect, useRef, useCallback } from 'react';

export function BottomSheet({ open, onClose, children, title, footer, maxHeight = '85vh' }) {
  const sheetRef = useRef(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleTouchStart = useCallback((e) => {
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e) => {
    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    if (dy > 100) {
      onClose?.();
    }
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    startY.current = 0;
    currentY.current = 0;
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0" style={{ zIndex: 40 }}>
      <div
        className="absolute inset-0"
        onClick={onClose}
        style={{
          backgroundColor: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'fadeIn var(--motion-fast) var(--ease-enter) forwards',
        }}
      />

      <div
        ref={sheetRef}
        className={'absolute bottom-0 left-0 right-0 glass-strong rounded-t-3xl' + (footer ? ' flex flex-col' : '')}
        style={{
          maxHeight,
          ...(footer ? { height: maxHeight } : {}),
          animation: 'sheetSlideUp var(--motion-normal) var(--ease-spring) forwards',
          paddingBottom: footer ? 0 : 'calc(var(--safe-bottom) + 16px)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div
            className="w-9 h-1 rounded-full"
            style={{ backgroundColor: 'var(--text-tertiary)', opacity: 0.4 }}
          />
        </div>

        {title && (
          <div className="px-5 pb-3 shrink-0">
            <h3 className="text-lg font-bold c-primary">{title}</h3>
          </div>
        )}

        <div
          className={'px-5 overflow-y-auto scroll-container' + (footer ? ' flex-1 min-h-0' : '')}
          style={footer ? undefined : { maxHeight: 'calc(85vh - 80px)' }}
        >
          {children}
        </div>

        {footer ? (
          <div
            className="shrink-0 px-5 pt-3"
            style={{
              borderTop: '0.5px solid var(--border-norse)',
              paddingBottom: 'calc(var(--safe-bottom) + 12px)',
              background: 'var(--bg-surface)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
