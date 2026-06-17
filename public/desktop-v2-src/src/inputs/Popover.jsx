/**
 * Popover — переиспользуемый popover для dropdown'ов / DatePicker / MultiSelect.
 *
 * Рендерится через React.createPortal в document.body, поэтому НИКОГДА
 * не обрезается overflow родителей (модалок, карточек, scrollable-областей).
 * Позиционируется по координатам якорного элемента (getBoundingClientRect).
 * Автоматически:
 *   • flip вверх если внизу не помещается
 *   • align по ширине якоря (можно переопределить)
 *   • закрытие по клику снаружи и по ESC
 *   • repositioning при resize/scroll
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * @param {'start'|'end'} align — выравнивание popover'a относительно якоря по горизонтали.
 *   'start' (по умолчанию) — left popover по left якоря (для select'ов под полем).
 *   'end' — right popover по right якоря (для bell/avatar/иконок в правом углу шапки).
 */
export function Popover({ anchorRef, open, onClose, matchWidth = true, maxHeight = 320, align = 'start', children }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, placement: 'bottom' });

  // Рассчёт позиции с clamp по viewport
  const recalc = () => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const popH = popRef.current?.offsetHeight || maxHeight;
    const popW = popRef.current?.offsetWidth || (matchWidth ? r.width : 240);
    const margin = 8;

    // Flip по вертикали
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const placement = (spaceBelow < popH + 16 && spaceAbove > spaceBelow) ? 'top' : 'bottom';
    let top = placement === 'bottom' ? r.bottom + 6 : Math.max(margin, r.top - popH - 6);

    // Горизонтальное выравнивание:
    //   align='end' — right popover по right якоря (для bell/avatar справа в шапке).
    //   align='start' — left popover по left якоря.
    let left = align === 'end' ? (r.right - popW) : r.left;
    // Clamp — popover не должен вылезать за правый/левый край viewport.
    const maxLeft = window.innerWidth - popW - margin;
    if (left > maxLeft) left = Math.max(margin, maxLeft);
    if (left < margin) left = margin;

    // Clamp top на всякий случай
    if (top + popH > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - popH - margin);
    }

    setPos({
      top,
      left,
      width: matchWidth ? r.width : undefined,
      placement
    });
  };

  // Первый recalc — синхронно. Второй — на следующем кадре, когда popRef
  // уже померил настоящую ширину контента (иначе при align='end' popover
  // уезжает за правый край, потому что popW в первом проходе был = 240).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!open) return undefined;
    recalc();
    const raf = requestAnimationFrame(recalc);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => recalc();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popRef}
      className={'pop pop-' + pos.placement}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight,
        zIndex: 20000 // выше всех модалок
      }}
    >
      {children}
    </div>,
    document.body
  );
}
