import { useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ChevronLeft, Home as HomeIcon } from 'lucide-react';
import { tabsForRole } from '@/components/layout/TabBar';
import { useAuthStore } from '@/stores/authStore';

/**
 * PageShell — обёртка страницы.
 * Glass-blur header при скролле, iOS large→compact title.
 *
 * Навигация (20.10.2026): в шапке ВСЕГДА есть выход — либо «назад», либо
 * «на главную». Раньше showBack по умолчанию был false, и на листовых экранах
 * пользователь оставался без кнопки (жалоба заказчика).
 *
 * Props:
 *   showBack  — принудительно показать «назад» (по умолчанию — авто)
 *   isRoot    — экран является корневым (нижний тап-бар); вместо «назад» даём «домой»
 *   onBack    — кастомный обработчик; по умолчанию navigate(-1)
 */
export function PageShell({
  title,
  children,
  noPadding = false,
  scrollable = true,
  headerRight,
  largeTitle = true,
  showBack,
  onBack,
  isRoot = false,
}) {
  const mainRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);

  const handleScroll = useCallback((e) => {
    setScrollY(e.target.scrollTop);
  }, []);

  // Корневой ли экран: совпадает с вкладкой нижнего тап-бара (или задано явно).
  const rootPaths = tabsForRole(role).map((t) => t.path);
  const isTabRoot = isRoot || rootPaths.includes(location.pathname);

  // Пришли ли на экран «внутрь» истории. Если истории нет (deep-link, push,
  // закладка) — navigate(-1) выбросил бы из приложения, поэтому ведём на главную.
  const canGoBack = (typeof window !== 'undefined' && window.history.length > 1);

  const handleBack = onBack || (() => (canGoBack ? navigate(-1) : navigate('/')));

  // Логика левой кнопки в шапке:
  //   • showBack === false  → кнопки нет (явный запрет, напр. корневой экран)
  //   • корневой экран      → «на главную» (на главной самой кнопки не нужно)
  //   • вложенный экран     → «назад» (явный showBack или автоматически)
  const backVisible = showBack !== false && !isTabRoot;
  const homeVisible = showBack !== false && isTabRoot && location.pathname !== '/';

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
            {/* Левая сторона: «назад» на вложенных экранах, «домой» на корневых */}
            {backVisible ? (
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
            ) : homeVisible ? (
              <Link
                to="/"
                className="spring-tap flex items-center justify-center shrink-0"
                style={{ width: 44, height: 44, marginLeft: 4, color: 'var(--gold)' }}
                aria-label="На главную"
              >
                <HomeIcon size={20} strokeWidth={2.2} />
              </Link>
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
                paddingLeft:   (backVisible || homeVisible) ? 4 : 0,
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
        style={{
          /**
           * D-341: контент резервирует только ту часть бара, что реально
           * заходит в коробку вьюпорта.
           *
           * Бар прижат к физическому низу и на iPhone лежит в основном В ЗАЗОРЕ
           * (`--app-gap` = 51px), который находится вне документа. Прежняя
           * формула (`--tabbar-total + 16px`) резервировала все 52px, поэтому
           * внизу оставалось ~51px пустоты — контент «отставал» от бара.
           *
           * Правильная формула — через `--tabbar-lift` (он ЗНАКОВЫЙ, в отличие
           * от `--app-gap`, обрезанного в ноль). Перекрытие = lift + total:
           *   iPhone 11: lift −51, total 52 → max(0, 1)  + 16 = 17px
           *   коробка = экран: 0 + 86 → 86              + 16 = 102px
           *   Safari с панелями: −116 + 52 = −64 →  0   + 16 = 16px
           *   коробка ВЫШЕ экрана (зум): +20 + 52 = 72  + 16 = 88px
           * Последний случай `--app-gap` не покрывал: он давал 68px при
           * перекрытии 72px, и контент на 4px заезжал под бар (нашла матрица
           * устройств: tools/verify-tabbar-matrix.js).
           */
          paddingBottom: 'calc(max(0px, var(--tabbar-total) + var(--tabbar-lift, 0px)) + 16px)',
        }}
      >
        <div className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
