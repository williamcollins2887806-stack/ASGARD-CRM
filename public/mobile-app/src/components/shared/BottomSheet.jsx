/**
 * BottomSheet — iOS-стиль bottom sheet
 * Grab handle, glass-фон, spring-анимация, overlay blur
 */
import { useEffect, useRef, useCallback } from 'react';

export function BottomSheet({ open, onClose, children, title }) {
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
      {/* Overlay */}
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

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 glass-strong rounded-t-3xl"
        style={{
          maxHeight: '85vh',
          animation: 'sheetSlideUp var(--motion-normal) var(--ease-spring) forwards',
          paddingBottom: 'calc(var(--safe-bottom) + 16px)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="w-9 h-1 rounded-full"
            style={{ backgroundColor: 'var(--text-tertiary)', opacity: 0.4 }}
          />
        </div>

        {/* Title */}
        {title && (
          <div className="px-5 pb-3">
            <h3
              className="text-lg font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h3>
          </div>
        )}

        {/* Content */}
        <div className="px-5 overflow-y-auto scroll-container" style={{ maxHeight: 'calc(85vh - 80px)' }}>
          {children}
        </div>
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
