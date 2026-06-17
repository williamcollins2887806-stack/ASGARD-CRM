/**
 * АСГАРД CRM 2.0 — Модальная система.
 *
 * Архитектура:
 *   • Глобальный стек модалок (LIFO) — поддержка N уровней вложенности
 *     (в проекте есть тройные модалки: Работа → Закупки → Заявки → Новая).
 *   • Imperative API через хук `useModal()`:
 *       const { open, close, closeAll } = useModal();
 *       open(<ConfirmModal {...} />, { id?, onClose? })
 *   • Каждая модалка получает свой `id` (uuid), z-index считается от позиции в стеке.
 *   • ESC закрывает только верхний слой.
 *   • Клик по overlay закрывает только верхний (если onDismiss=true).
 *   • Focus trap — фокус блокируется внутри последней модалки.
 *   • Префиксы анимаций: "enter" (mount), "leave" (close).
 *
 * Compat-layer (`compat.js`) экспортирует функции под именами оригинального
 * `AsgardUI.showModal/confirm/prompt` — чтобы в будущем заменить vanilla одним свитчем.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import OopsBubble from './OopsBubble';

const ModalCtx = createContext(null);

let _bubbleUid = 0;
const nextBubbleId = () => `b_${++_bubbleUid}_${Date.now().toString(36)}`;

// Контекст «развёрнуть на весь экран» — каждая модалка получает свой
// { maximized, toggle } через provider, который ModalLayer оборачивает
// вокруг content. MHead читает контекст и рендерит кнопку ⛶ автоматически.
export const MaximizeCtx = createContext(null);
export const useMaximize = () => useContext(MaximizeCtx);

let _uid = 0;
const nextId = () => `m_${++_uid}_${Date.now().toString(36)}`;

/* Селектор «фокусируемых» элементов внутри модалки — для focus-trap и initial focus. */
const FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getFocusable(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SEL))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function ModalProvider({ children }) {
  const [stack, setStack] = useState([]); // [{ id, content, opts, leaving? }]
  const stackRef = useRef(stack);
  stackRef.current = stack;

  // S-001: «Упс»-баблы при клике вне модалки (паритет с vanilla ui.js:179-181).
  // Несколько баблов одновременно — допустимо (быстрые клики подряд).
  const [bubbles, setBubbles] = useState([]); // [{ id, x, y }]
  const showBubble = useCallback((x, y) => {
    const id = nextBubbleId();
    setBubbles((b) => [...b, { id, x, y }]);
  }, []);
  const removeBubble = useCallback((id) => {
    setBubbles((b) => b.filter((x) => x.id !== id));
  }, []);

  const close = useCallback((id) => {
    setStack((s) => {
      const target = id || s[s.length - 1]?.id;
      if (!target) return s;
      // запускаем leave-анимацию, потом удаляем
      const next = s.map((m) => (m.id === target ? { ...m, leaving: true } : m));
      setTimeout(() => {
        setStack((s2) => {
          const item = s2.find((x) => x.id === target);
          if (item?.opts?.onClose) item.opts.onClose();
          return s2.filter((x) => x.id !== target);
        });
      }, 200);
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setStack((s) => {
      s.forEach((item) => { if (item.opts?.onClose) try { item.opts.onClose(); } catch { /* noop */ } });
      return [];
    });
  }, []);

  const open = useCallback((content, opts = {}) => {
    const id = opts.id || nextId();
    setStack((s) => {
      // если id уже есть — заменяем, иначе пуш
      const exists = s.findIndex((x) => x.id === id);
      const next = { id, content, opts };
      if (exists >= 0) {
        const copy = s.slice();
        copy[exists] = next;
        return copy;
      }
      return [...s, next];
    });
    return id;
  }, []);

  /** Заменить содержимое верхней модалки без push/pop — для multi-step replaceModal-паттерна. */
  const replace = useCallback((content, opts = {}) => {
    setStack((s) => {
      if (!s.length) {
        const id = opts.id || nextId();
        return [{ id, content, opts }];
      }
      const last = s[s.length - 1];
      const next = { id: last.id, content, opts: { ...last.opts, ...opts } };
      return [...s.slice(0, -1), next];
    });
  }, []);

  // ESC закрывает верхнюю
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && stackRef.current.length) {
        const top = stackRef.current[stackRef.current.length - 1];
        if (top?.opts?.dismissOnEsc !== false) close(top.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Блокируем body scroll с сохранением позиции (iOS-trick) + компенсация scrollbar.
  // Это гарантирует что модалка ВСЕГДА видна и страница не "прыгает" вправо.
  // Защита от race condition: запоминаем scroll только если ещё не зафиксировали body.
  useEffect(() => {
    const isLocked = document.body.style.position === 'fixed';
    if (stack.length > 0 && !isLocked) {
      // первая модалка — запоминаем scroll, фиксируем body
      const scrollY = window.scrollY;
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.dataset.savedScroll = String(scrollY);
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = scrollBarWidth + 'px';
      }
    } else if (stack.length === 0 && isLocked) {
      // все модалки закрыты — восстанавливаем
      const saved = Number(document.body.dataset.savedScroll || 0);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      document.body.style.paddingRight = '';
      delete document.body.dataset.savedScroll;
      window.scrollTo(0, saved);
    }
    return () => {
      // safety cleanup при unmount Provider
      if (stack.length > 0 && document.body.style.position === 'fixed') {
        const saved = Number(document.body.dataset.savedScroll || 0);
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        document.body.style.paddingRight = '';
        delete document.body.dataset.savedScroll;
        window.scrollTo(0, saved);
      }
    };
  }, [stack.length]);

  const api = useMemo(() => ({ open, close, closeAll, replace, stack }), [open, close, closeAll, replace, stack]);

  return (
    <ModalCtx.Provider value={api}>
      {children}
      {stack.length > 0 && createPortal(
        <div className="modal-stack-root">
          {stack.map((m, i) => (
            <ModalLayer
              key={m.id}
              item={m}
              index={i}
              total={stack.length}
              onClose={() => close(m.id)}
              onOverlayClick={showBubble}
            />
          ))}
        </div>,
        document.body
      )}
      {/* S-001: «упс-баблы» — отдельный portal вне modal-stack-root,
          чтобы поверх любых модалок и без наследования pointer-events. */}
      {bubbles.map((b) => (
        <OopsBubble key={b.id} x={b.x} y={b.y} onDone={() => removeBubble(b.id)} />
      ))}
    </ModalCtx.Provider>
  );
}

function ModalLayer({ item, index, total, onClose, onOverlayClick }) {
  const { content, opts, leaving } = item;
  const isTop = index === total - 1;
  const z = 10000 + index * 30;
  // под модалкой каждой выше — затемняемся ещё чуть-чуть
  const dim = isTop ? 1 : 0.6;
  const shape = opts.shape || (opts.size === 'wide' ? 'wide' : opts.size === 'full' ? 'full' : 'center');
  const frameRef = useRef(null);
  const [maximized, setMaximized] = useState(false);
  const maxApi = useMemo(() => ({
    maximized,
    toggle: () => setMaximized((m) => !m),
    set: setMaximized,
  }), [maximized]);
  // Сохраняем триггер (active element) только для ВЕРХНЕЙ модалки на момент монтирования,
  // чтобы при закрытии вернуть туда фокус (WCAG 2.4.3 + focus management best-practice).
  const triggerRef = useRef(null);

  // На mount: запомнить триггер, поставить initial-focus в первое поле модалки.
  useEffect(() => {
    if (!isTop) return;
    triggerRef.current = document.activeElement;
    // ждём один тик чтобы DOM модалки точно был отрисован, потом ищем фокусабельный
    const id = setTimeout(() => {
      const root = frameRef.current;
      if (!root) return;
      // приоритет: явный [data-autofocus] → первый input/select/textarea → первый button
      const explicit = root.querySelector('[data-autofocus]');
      const first = explicit
        || root.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
        || root.querySelector(FOCUSABLE_SEL);
      if (first && typeof first.focus === 'function') {
        try { first.focus({ preventScroll: true }); } catch { first.focus(); }
      } else if (root) {
        // если нечего фокусировать — фокусируем сам frame чтобы Esc/Tab продолжали работать.
        try { root.focus({ preventScroll: true }); } catch { /* noop */ }
      }
    }, 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // На unmount верхней модалки: вернуть фокус на триггер.
  useEffect(() => {
    return () => {
      const t = triggerRef.current;
      if (!t || typeof t.focus !== 'function') return;
      // не возвращаем фокус если триггер пропал из DOM
      if (!document.body.contains(t)) return;
      try { t.focus({ preventScroll: true }); } catch { try { t.focus(); } catch { /* noop */ } }
    };
  }, []);

  // Focus-trap — обрабатываем Tab только на верхней модалке.
  useEffect(() => {
    if (!isTop) return;
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const root = frameRef.current;
      if (!root) return;
      const list = getFocusable(root);
      if (list.length === 0) {
        e.preventDefault();
        try { root.focus({ preventScroll: true }); } catch { /* noop */ }
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop]);

  return (
    <div
      className={'modal-layer shape-' + shape + ' ' + (leaving ? 'leaving ' : '') + (isTop ? 'top ' : 'under ') + (opts.size || '')}
      style={{ zIndex: z, '--dim': dim }}
      data-modal-id={item.id}
      aria-hidden={!isTop ? 'true' : undefined}
    >
      <div
        className={'modal-overlay ' + (opts.overlay === 'transparent' ? 'transparent' : '')}
        onClick={(e) => {
          // S-001 паритет с vanilla: клик-вне НЕ закрывает модалку,
          // вместо этого показывает «упс-бабл» в точке курсора (ui.js:179-181).
          if (e.target !== e.currentTarget) return;
          onOverlayClick?.(e.clientX, e.clientY);
        }}
        aria-hidden="true"
      />
      <div
        ref={frameRef}
        className={'modal-frame frame-' + shape + (maximized ? ' is-maximized' : '')}
        role={opts.role || 'dialog'}
        aria-modal={isTop ? 'true' : undefined}
        aria-label={opts.ariaLabel || opts.title || 'Диалог'}
        tabIndex={-1}
      >
        <MaximizeCtx.Provider value={maxApi}>
          {content}
        </MaximizeCtx.Provider>
      </div>
    </div>
  );
}

export const useModal = () => {
  const ctx = useContext(ModalCtx);
  if (!ctx) throw new Error('useModal must be used inside <ModalProvider>');
  return ctx;
};

/* Глобальный «именной» алиас — для compat-layer (window.AsgardUI замена). */
let _globalApi = null;
export function ModalGlobalBridge() {
  const api = useModal();
  useEffect(() => {
    _globalApi = api;
    return () => { if (_globalApi === api) _globalApi = null; };
  }, [api]);
  return null;
}
export const getGlobalModalApi = () => _globalApi;
