/**
 * BottomSheet — iOS-стиль bottom sheet
 * Grab handle, плотный фон, spring-анимация.
 * Optional sticky `footer` outside scroll area.
 *
 * D-267 — правки мобильного UX:
 *  1) рендер через портал в `#modal-root`: иначе `position: fixed` ломается
 *     из-за transform на предках (App.jsx `pageTransitionIn`, PageShell `.page-enter`);
 *  2) ВСЕГДА есть кнопка закрытия «×» в шапке (44×44), плюс свайп вниз за грабер,
 *     тап по подложке и `Escape`. До правки футер с кнопками был только у 2 из 103 шторок;
 *  3) свайп-вниз срабатывает ТОЛЬКО за «полоску»-грабер (не за содержимое) —
 *     раньше обычный скролл формы закрывал шторку и терял введённые данные;
 *  4) фокус-трап и возврат фокуса, `aria-modal`.
 *
 * ВАЖНО (регресс-защита): начальная установка фокуса выполняется РОВНО ОДИН РАЗ
 * на открытие и НЕ должна зависеть от идентичности `onClose` — иначе при вводе
 * в поле контролируемого инпута родитель ре-рендерится, эффект перезапускается
 * и фокус «убегает» из поля на «×» (ровно жалоба «вводим — выкидывает»).
 * Поэтому `onClose` держим в ref и не включаем в зависимости эффекта фокуса.
 */
import { useEffect, useRef, useCallback, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getModalRoot } from '@/lib/modalRoot';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Стек шторок (21.10.2026). Раньше все шторки имели один и тот же zIndex 10060,
 * поэтому вложенная шторка (например «Причина возврата» поверх деталки счёта)
 * ложилась «по порядку DOM»: при неверном порядке она оказывалась ПОД нижней, и
 * тапы уходили в подложку — выглядело как зависшая модалка, кнопки не нажимаются.
 * Теперь каждая открытая шторка получает zIndex выше предыдущей.
 */
const BASE_Z = 10060;
let zStack = 0;

export function BottomSheet({ open, onClose, children, title, footer, maxHeight = '85vh' }) {
  const sheetRef = useRef(null);
  const grabberRef = useRef(null);
  /** Зона свайп-закрытия: вся шапка шторки (грабер + заголовок). */
  const dragZoneRef = useRef(null);
  const uid = useId();
  const titleId = `bs-title-${uid}`;
  const lastFocusedRef = useRef(null);
  const initialFocusDoneRef = useRef(false);

  /**
   * Высота клавиатуры (22.10.2026). Без этого на iOS клавиатура НАКРЫВАЛА шторку:
   * футер с кнопками «Отмена» / «Вернуть с причиной» уходил под неё, и завершить
   * действие было нельзя (жалоба директора: «клавиатура перекрывает модалку»).
   *
   * Клавиатура уменьшает `visualViewport.height`, не меняя layout viewport.
   * Считаем разницу и поднимаем шторку на неё — футер остаётся доступным.
   */
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!open) { setKbHeight(0); return undefined; }
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const measure = () => {
      // Высота, которую перекрывает клавиатура (снизу вверх).
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      // Игнорируем мелочь (0..60 px): это не клавиатура, а округления/панели.
      setKbHeight(overlap > 60 ? Math.round(overlap) : 0);
    };

    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, [open]);

  /**
   * Свой уровень в стеке шторок. Выделяется при открытии и освобождается при
   * закрытии/размонтировании — так вложенная шторка гарантированно выше нижней,
   * независимо от порядка монтирования в DOM.
   */
  const [zIndex, setZIndex] = useState(BASE_Z);
  useEffect(() => {
    if (!open) return undefined;
    zStack += 1;
    setZIndex(BASE_Z + zStack);
    return () => { zStack = Math.max(0, zStack - 1); };
  }, [open]);

  // onClose в ref: эффекты не должны перезапускаться от смены идентичности колбэка.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = useCallback(() => onCloseRef.current?.(), []);

  // Свайп тянем только за грабер.
  const sheetStartY = useRef(0);
  const sheetCurrentY = useRef(0);
  const sheetDragging = useRef(false);

  // Блокировка фона. У приложения `body { overflow: hidden }` в index.css, прокрутка
  // живёт во внутренних контейнерах, поэтому НЕ переводим body в position: fixed —
  // это ломало бы сохранение/восстановление скролла и конфликтовало с контролами
  // (AsgardSelect/EmployeePicker), которые сами чистят body.style.overflow.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  // Escape + фокус-трап. Зависимость ТОЛЬКО от `open`.
  useEffect(() => {
    if (!open) return undefined;

    lastFocusedRef.current = document.activeElement;
    initialFocusDoneRef.current = false;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = sheetRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    // Первичный фокус — один раз на открытие.
    const t = setTimeout(() => {
      if (initialFocusDoneRef.current) return;
      initialFocusDoneRef.current = true;
      const node = sheetRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      (items[0] || node).focus?.({ preventScroll: true });
    }, 50);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown, true);
      // Возврат фокуса на инициатора.
      const prevEl = lastFocusedRef.current;
      if (prevEl && typeof prevEl.focus === 'function' && prevEl.isConnected) {
        prevEl.focus({ preventScroll: true });
      }
    };
  }, [open, close]);

  /* Свайп-закрытие: нативные слушатели с { passive: false }, иначе preventDefault
     в пассивном обработчике не работает (и браузер ругается в консоль).

     20.10.2026: зона свайпа расширена с узкого грабера на ВСЮ шапку (грабер +
     заголовок + кнопка закрытия). Раньше жест ловился только за полоску 36px,
     и на телефоне закрыть шторку свайпом было почти невозможно.
     Контент по-прежнему не перехватываем — там вертикальный скролл.
     Начало жеста на кнопке «Закрыть» игнорируем, чтобы не мешать тапу. */
  useEffect(() => {
    if (!open) return undefined;
    const zone = dragZoneRef.current;
    if (!zone) return undefined;

    const onStart = (e) => {
      if (e.target.closest('button')) return; // не мешаем кнопкам в шапке
      sheetStartY.current = e.touches[0].clientY;
      sheetCurrentY.current = e.touches[0].clientY;
      sheetDragging.current = true;
    };
    const onMove = (e) => {
      if (!sheetDragging.current) return;
      const touch = e.touches[0];
      const dy = touch.clientY - sheetStartY.current;
      if (dy > 0) {
        e.preventDefault();          // работает: слушатель не пассивный
        sheetCurrentY.current = touch.clientY;
        // Тянем шторку за пальцем. transform здесь — на самой шторке, а не на её
        // предке, поэтому position: fixed у содержимого не страдает.
        if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
      }
    };
    const onEnd = () => {
      if (!sheetDragging.current) return;
      sheetDragging.current = false;
      const dy = sheetCurrentY.current - sheetStartY.current;
      if (sheetRef.current) sheetRef.current.style.transform = '';
      if (dy > 100) close();
      sheetStartY.current = 0;
      sheetCurrentY.current = 0;
    };

    zone.addEventListener('touchstart', onStart, { passive: true });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
    return () => {
      zone.removeEventListener('touchstart', onStart);
      zone.removeEventListener('touchmove', onMove);
      zone.removeEventListener('touchend', onEnd);
      zone.removeEventListener('touchcancel', onEnd);
    };
  }, [open, close]);

  if (!open) return null;

  const root = getModalRoot();
  if (!root) return null;

  const content = (
    <div className="fixed inset-0 flex flex-col justify-end" style={{ zIndex }}>
      <div
        className="absolute inset-0"
        onClick={close}
        style={{
          backgroundColor: 'rgba(0,0,0,0.5)',
          animation: 'fadeIn var(--motion-fast) var(--ease-enter) forwards',
        }}
      />

      {/* Шторка — flex-колонка фиксированной max-высоты: футер/содержимое не могут
          вытолкнуть кнопки за пределы экрана (иначе «Отмена» уезжала на длинных формах).
          marginBottom = высота клавиатуры: футер с кнопками остаётся видимым над ней. */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={'relative sheet-surface flex flex-col' + (footer ? '' : '')}
        style={{
          maxHeight,
          height: 'auto',
          marginBottom: kbHeight ? `${kbHeight}px` : undefined,
          animation: 'sheetSlideUp var(--motion-normal) var(--ease-spring) forwards',
          paddingBottom: 'calc(var(--safe-bottom) + 8px)',
        }}
      >
        {/* Зона свайп-закрытия: грабер + шапка с заголовком.
            Жест по шапке закрывает шторку; тап по кнопкам не перехватывается. */}
        <div ref={dragZoneRef} style={{ touchAction: 'pan-y' }}>
          <div
            ref={grabberRef}
            className="flex justify-center pt-3 pb-1 shrink-0"
            style={{ cursor: 'grab' }}
          >
            <div
              className="w-9 h-1 rounded-full"
              style={{ backgroundColor: 'var(--text-tertiary)', opacity: 0.4 }}
            />
          </div>

        {/* Шапка: заголовок + ГАРАНТИРОВАННАЯ кнопка закрытия (всегда видна:
            шапка прижата к верху шторки, клавиатура приходит снизу). */}
        <div className="px-5 pb-3 shrink-0 flex items-start gap-2">
          {title ? (
            <h3 id={titleId} className="text-lg font-bold c-primary flex-1">{title}</h3>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="sheet-close shrink-0"
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>
        </div>

        <div className="px-5 overflow-y-auto scroll-container flex-1 min-h-0">
          {children}
        </div>

        {footer ? (
          <div
            className="shrink-0 px-5 pt-3"
            style={{
              borderTop: '0.5px solid var(--border-norse)',
              background: 'var(--bg-surface)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, root);
}
