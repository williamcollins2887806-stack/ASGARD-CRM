/**
 * ASGARD CRM — Mobile Module v2.0 (Premium)
 * ═══════════════════════════════════════════════════════════
 * Мобильная логика: детекция, жесты, PWA, табы, дровер,
 * inline-grid reset, pull-to-refresh, page transitions,
 * auto-hide header, scroll-to-top, KPI scroll hints,
 * MutationObserver для динамического контента.
 *
 * Разметка (m-app, m-header, m-tabbar) рендерится в app.js.
 * Здесь только поведение и вспомогательные функции.
 * ═══════════════════════════════════════════════════════════
 */
window.AsgardMobile = (function () {
  'use strict';

  const { $, $$, toast } = AsgardUI;

  // ─── Состояние ────────────────────────────────────────────
  let isMobile = false;
  let menuOpen = false;
  let overlay  = null;
  let deferredPWAPrompt = null;

  // ─── Точки касания для свайпов ────────────────────────────
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  // ─── Pull-to-refresh состояние ────────────────────────────
  let ptrActive = false;
  let ptrStartY = 0;
  let ptrDist = 0;
  const PTR_THRESHOLD = 70;  // px для активации
  const PTR_MAX = 120;       // максимум вытягивания

  // ─── Auto-hide header ─────────────────────────────────────
  let lastScrollY = 0;
  let headerHidden = false;
  let scrollTicking = false;

  // ─── MutationObserver ─────────────────────────────────────
  let layoutObserver = null;

  // ─── Конфигурация — элементы которые НЕ сбрасываем ────────
  const GRID_EXEMPT_SELECTORS = [
    '.sg-keypad', '.m-tabbar', '.pk-keypad', '[class*="keypad"]',
    '.btn-group-grid', '.m-skeleton-kpi-row', '.more-menu-grid',
    '.nav-tabs', '.tab-nav', '.m-header', '.m-header-actions',
    '.fab-menu', '.welcome-form-actions', '.sg-dots', '.sg-center'
  ];

  // ==========================================================
  //  1. Детекция мобильного устройства
  // ==========================================================

  function detectMobile() {
    var uaCheck = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    isMobile = window.innerWidth <= 768 || uaCheck;
    return isMobile;
  }

  // ==========================================================
  //  2. Класс на body: is-mobile / is-desktop
  // ==========================================================

  function toggleBodyClass() {
    document.body.classList.toggle('is-mobile', isMobile);
    document.body.classList.toggle('is-desktop', !isMobile);
  }

  // ==========================================================
  //  3. Свайп-жесты (edge swipe для дровера)
  // ==========================================================

  function initSwipeGestures() {
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  function onTouchStart(e) {
    var touch = e.touches[0];
    touchStartX    = touch.clientX;
    touchStartY    = touch.clientY;
    touchStartTime = Date.now();
  }

  function onTouchEnd(e) {
    var touch  = e.changedTouches[0];
    var deltaX = touch.clientX - touchStartX;
    var deltaY = touch.clientY - touchStartY;
    var elapsed = Date.now() - touchStartTime;

    if (elapsed > 400 || Math.abs(deltaY) > Math.abs(deltaX)) return;

    if (!menuOpen && touchStartX < 30 && deltaX > 50) {
      openMenu();
    } else if (menuOpen && deltaX < -50) {
      closeMenu();
    }
  }

  // ==========================================================
  //  4. iOS-фикс высоты вьюпорта (--vh)
  // ==========================================================

  function setViewportHeight() {
    var vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', vh + 'px');
  }

  function initViewportFix() {
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
  }

  // ==========================================================
  //  5. Адаптивные таблицы (расширенная версия)
  // ==========================================================

  /**
   * Оборачиваем .tbl / .asg в .tbl-wrap и расставляем data-label.
   * Вызывается после каждого рендера страницы и при мутациях DOM.
   */
  function initResponsiveTables(root) {
    var container = root || document.getElementById('layout') || document;
    var tables = container.querySelectorAll('table.tbl, table.asg');
    if (!tables.length) return;

    tables.forEach(function (table) {
      // Уже обработана
      if (table.dataset.mobileProcessed === '1') return;

      // Оборачиваем в скроллируемый контейнер
      if (!table.parentElement.classList.contains('tbl-wrap')) {
        var wrap = document.createElement('div');
        wrap.className = 'tbl-wrap';
        wrap.dataset.scrollable = 'true';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      }

      // Пробрасываем заголовки в data-label для карточного режима
      var headers = table.querySelectorAll('thead th');
      if (!headers.length) return;

      var labels = Array.from(headers).map(function (th) {
        return th.textContent.trim();
      });

      table.querySelectorAll('tbody tr').forEach(function (row) {
        row.querySelectorAll('td').forEach(function (td, idx) {
          if (labels[idx] && !td.hasAttribute('data-label')) {
            td.setAttribute('data-label', labels[idx]);
          }
        });
      });

      table.dataset.mobileProcessed = '1';
    });
  }

  // ==========================================================
  //  6. Reset Inline Grids (ключевая функция)
  // ==========================================================

  /**
   * Сбрасывает inline grid-template-columns на 1fr для всех элементов
   * внутри #layout, кроме исключений (keypads, tab bars, etc.)
   *
   * Проблема: многие JS-модули ставят grid-template-columns через
   * element.style, что перебивает CSS. Эта функция вызывается после
   * каждого рендера страницы и через MutationObserver.
   */
  function resetInlineGrids(root) {
    if (!isMobile) return;

    var container = root || document.getElementById('layout');
    if (!container) return;

    // Все элементы с inline grid-template-columns
    var els = container.querySelectorAll('[style*="grid-template-columns"]');
    var exemptSelector = GRID_EXEMPT_SELECTORS.join(',');

    els.forEach(function (el) {
      // Пропускаем исключения
      if (el.closest(exemptSelector)) return;

      // Сохраняем оригинальное значение для возможности восстановления
      if (!el.dataset.origGrid) {
        el.dataset.origGrid = el.style.gridTemplateColumns;
      }

      el.style.gridTemplateColumns = '1fr';
    });

    // Также ищем elements с inline display:grid + grid-template-columns в style
    var gridEls = container.querySelectorAll('[style*="grid-template"]');
    gridEls.forEach(function (el) {
      if (el.closest(exemptSelector)) return;
      if (el.style.gridTemplateColumns && el.style.gridTemplateColumns !== '1fr') {
        if (!el.dataset.origGrid) {
          el.dataset.origGrid = el.style.gridTemplateColumns;
        }
        el.style.gridTemplateColumns = '1fr';
      }
    });
  }

  /**
   * Восстанавливает оригинальные grid значения (при переключении на десктоп)
   */
  function restoreInlineGrids() {
    var els = document.querySelectorAll('[data-orig-grid]');
    els.forEach(function (el) {
      el.style.gridTemplateColumns = el.dataset.origGrid;
      delete el.dataset.origGrid;
    });
  }

  // ==========================================================
  //  7. MutationObserver для динамического контента
  // ==========================================================

  /**
   * Наблюдает за #layout и обрабатывает новые элементы:
   * - Сбрасывает inline grids
   * - Проставляет data-label на таблицах
   * - Добавляет scroll hints на KPI-карусели
   */
  function initLayoutObserver() {
    if (layoutObserver) layoutObserver.disconnect();

    var layout = document.getElementById('layout');
    if (!layout) return;

    // Debounce для пакетной обработки мутаций
    var debounceTimer = null;

    layoutObserver = new MutationObserver(function (mutations) {
      // Проверяем, есть ли реальные добавления узлов
      var hasAdditions = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          hasAdditions = true;
          break;
        }
      }
      if (!hasAdditions) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        resetInlineGrids();
        initResponsiveTables();
        initKPIScrollHints();
      }, 50);
    });

    layoutObserver.observe(layout, {
      childList: true,
      subtree: true
    });
  }

  // ==========================================================
  //  8. Page Transitions — Анимация при навигации
  // ==========================================================

  var _previousHash = '';
  var _navDirection = 'enter';  // Wave 3: push/pop/enter

  /**
   * Добавляет анимацию fade+slide при переходе между страницами.
   * Вызывается на hashchange.
   */
  function animatePageTransition() {
    var layout = document.getElementById('layout');
    if (!layout) return;

    // Wave 3: remove all transition classes
    layout.classList.remove('m-page-enter', 'm-page-push', 'm-page-pop');

    // Trigger reflow
    void layout.offsetWidth;

    // Apply direction-based animation
    var cls = 'm-page-enter';
    if (_navDirection === 'push') cls = 'm-page-push';
    else if (_navDirection === 'pop') cls = 'm-page-pop';
    layout.classList.add(cls);

    // Reset direction for next navigation
    _navDirection = 'enter';

    // Scroll to top
    var content = document.querySelector('.m-content');
    if (content) content.scrollTop = 0;
  }

  // ==========================================================
  //  9. Pull-to-Refresh
  // ==========================================================

  /**
   * Инициализация pull-to-refresh на .m-content
   * Работает только когда контент прокручен до самого верха.
   */
  function initPullToRefresh() {
    var content = document.querySelector('.m-content');
    if (!content) return;

    // Создаём индикатор если его нет
    var indicator = document.getElementById('ptrIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ptrIndicator';
      indicator.className = 'm-ptr-indicator';
      indicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/></svg>';
      content.style.position = 'relative';
      content.insertBefore(indicator, content.firstChild);
    }

    content.addEventListener('touchstart', function (e) {
      if (content.scrollTop <= 0) {
        ptrActive = true;
        ptrStartY = e.touches[0].clientY;
        ptrDist = 0;
      }
    }, { passive: true });

    content.addEventListener('touchmove', function (e) {
      if (!ptrActive) return;

      var currentY = e.touches[0].clientY;
      ptrDist = currentY - ptrStartY;

      // Только вниз
      if (ptrDist < 0) {
        ptrDist = 0;
        return;
      }

      // Ограничиваем
      if (ptrDist > PTR_MAX) ptrDist = PTR_MAX;

      // Обновляем индикатор
      var progress = Math.min(ptrDist / PTR_THRESHOLD, 1);
      indicator.style.top = (ptrDist - 50) + 'px';
      indicator.style.opacity = progress;
      indicator.style.transform = 'translateX(-50%) rotate(' + (progress * 180) + 'deg)';

      if (ptrDist > PTR_THRESHOLD) {
        indicator.classList.add('visible');
      }
    }, { passive: true });

    content.addEventListener('touchend', function () {
      if (!ptrActive) return;
      ptrActive = false;

      if (ptrDist >= PTR_THRESHOLD) {
        // Активируем рефреш
        indicator.classList.add('loading');
        indicator.style.top = '12px';

        // Перезагружаем текущую страницу
        setTimeout(function () {
          var hash = window.location.hash;
          // Принудительно перезагружаем маршрут
          history.replaceState(null, '', '#/__ptr_reload__');
          setTimeout(function () {
            history.replaceState(null, '', hash);
            window.dispatchEvent(new HashChangeEvent('hashchange'));
            // Убираем индикатор после загрузки
            setTimeout(function () {
              indicator.classList.remove('visible', 'loading');
              indicator.style.top = '-50px';
              indicator.style.opacity = '0';
              indicator.style.transform = 'translateX(-50%)';
            }, 500);
          }, 50);
        }, 300);
      } else {
        // Не достигли порога — сбрасываем
        indicator.classList.remove('visible');
        indicator.style.top = '-50px';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateX(-50%)';
      }

      ptrDist = 0;
    }, { passive: true });
  }

  // ==========================================================
  // 10. Auto-Hide Header на скролле
  // ==========================================================

  /**
   * Прячем m-header при скролле вниз, показываем при скролле вверх.
   * Как в Сбере, ВТБ и прочих премиум-приложениях.
   */
  function initAutoHideHeader() {
    var content = document.querySelector('.m-content');
    if (!content) return;

    content.addEventListener('scroll', function () {
      if (scrollTicking) return;

      scrollTicking = true;
      requestAnimationFrame(function () {
        var currentY = content.scrollTop;
        var header = document.querySelector('.m-header');
        if (!header) { scrollTicking = false; return; }

        var delta = currentY - lastScrollY;

        if (delta > 8 && currentY > 60 && !headerHidden) {
          // Скролл вниз — прячем
          header.style.transform = 'translateY(-100%)';
          header.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
          headerHidden = true;
          // Освобождаем место
          content.style.paddingTop = '0';
        } else if (delta < -5 && headerHidden) {
          // Скролл вверх — показываем
          header.style.transform = 'translateY(0)';
          headerHidden = false;
          content.style.paddingTop = '';
        }

        lastScrollY = currentY;
        scrollTicking = false;
      });
    }, { passive: true });
  }

  // ==========================================================
  // 11. KPI Scroll Hints (градиентные подсказки)
  // ==========================================================

  /**
   * Добавляет визуальные подсказки о горизонтальной прокрутке
   * на KPI-каруселях (тень справа, когда есть непрокрученный контент).
   */
  function initKPIScrollHints() {
    var kpiContainers = document.querySelectorAll(
      '.kpi, .kpi-row, .stats-grid, .kpi-grid, .dash-kpi, [class*="stats-row"], [class*="kpi-row"]'
    );

    kpiContainers.forEach(function (container) {
      if (container.dataset.scrollHintInit === '1') return;
      container.dataset.scrollHintInit = '1';

      // Проверяем есть ли что скроллить
      function updateHint() {
        var hasOverflow = container.scrollWidth > container.clientWidth + 4;
        var atEnd = (container.scrollLeft + container.clientWidth) >= (container.scrollWidth - 4);

        container.classList.toggle('m-scroll-hint', hasOverflow && !atEnd);
      }

      container.addEventListener('scroll', updateHint, { passive: true });
      // Начальная проверка после рендера
      setTimeout(updateHint, 100);
    });
  }

  // ==========================================================
  // 12. Scroll-to-Top при навигации
  // ==========================================================

  function scrollToTop() {
    var content = document.querySelector('.m-content');
    if (content) content.scrollTop = 0;

    // Также сбрасываем header
    var header = document.querySelector('.m-header');
    if (header) {
      header.style.transform = 'translateY(0)';
      headerHidden = false;
    }
    lastScrollY = 0;
  }

  // ==========================================================
  // 13. Touch Feedback — рипл-эффект при нажатии
  // ==========================================================

  /**
   * Добавляет Material-style ripple effect на кликабельные элементы.
   * Быстрый и лёгкий, не тормозит UI.
   */
  function initTouchFeedback() {
    document.addEventListener('touchstart', function (e) {
      var target = e.target.closest('.btn, .m-tab, .navitem, .fab-menu-item, .more-menu-item, .card[onclick], [data-click], a.card');
      if (!target || target.classList.contains('no-ripple')) return;

      var rect = target.getBoundingClientRect();
      var touch = e.touches[0];
      var x = touch.clientX - rect.left;
      var y = touch.clientY - rect.top;

      var ripple = document.createElement('span');
      ripple.className = 'm-ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';

      target.style.position = target.style.position || 'relative';
      target.style.overflow = 'hidden';
      target.appendChild(ripple);

      setTimeout(function () {
        ripple.remove();
      }, 600);
    }, { passive: true });
  }

  // ==========================================================
  // 14. Инъекция дополнительных мобильных CSS
  // ==========================================================

  function injectCSS() {
    var style = document.createElement('style');
    style.id = 'asgard-mobile-css';
    style.textContent = [
      /* --- Оверлей дровера --- */
      '.mobile-overlay {',
      '  position: fixed; top: 0; left: 0; width: 100%; height: 100%;',
      '  background: rgba(0,0,0,0.6);',
      '  z-index: 1099;',
      '  opacity: 0;',
      '  pointer-events: none;',
      '  display: block;',
      '  transition: opacity .25s ease;',
      '  -webkit-backdrop-filter: blur(2px);',
      '  backdrop-filter: blur(2px);',
      '}',
      '.mobile-overlay.active {',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',

      /* --- Safe-area поддержка --- */
      '@supports (padding: env(safe-area-inset-bottom)) {',
      '  .m-tabbar { padding-bottom: env(safe-area-inset-bottom); }',
      '  .m-app    { padding-bottom: env(safe-area-inset-bottom); }',
      '}',

      /* --- Тач-кнопки: минимальный размер 44px --- */
      '@media (hover: none) and (pointer: coarse) {',
      '  .btn.mini, .btn.ghost.mini {',
      '    min-width: 44px;',
      '    min-height: 44px;',
      '  }',
      '  .btn:active {',
      '    transform: scale(0.98);',
      '  }',
      '}',

      /* --- Page enter animation --- */
      '.m-page-enter {',
      '  animation: m-page-enter 0.25s ease-out both;',
      '}',
      '@keyframes m-page-enter {',
      '  from { opacity: 0; transform: translateY(10px); }',
      '  to { opacity: 1; transform: translateY(0); }',
      '}',

      /* --- Ripple effect --- */
      '.m-ripple {',
      '  position: absolute;',
      '  width: 60px; height: 60px;',
      '  margin: -30px 0 0 -30px;',
      '  border-radius: 50%;',
      '  background: rgba(255,255,255,0.15);',
      '  pointer-events: none;',
      '  animation: m-ripple-anim 0.5s ease-out forwards;',
      '  z-index: 1;',
      '}',
      '@keyframes m-ripple-anim {',
      '  from { transform: scale(0); opacity: 1; }',
      '  to { transform: scale(4); opacity: 0; }',
      '}',

      /* --- Auto-hide header smooth --- */
      '.m-header {',
      '  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);',
      '  will-change: transform;',
      '}',

      /* --- Reduced motion --- */
      '@media (prefers-reduced-motion: reduce) {',
      '  .m-page-enter, .m-ripple { animation: none !important; }',
      '  .m-header { transition: none !important; }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  // ==========================================================
  // 15. PWA Install Prompt
  // ==========================================================

  function initPWAInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPWAPrompt = e;
      showInstallBanner();
    });

    if (isIOS() && !isStandalone()) {
      setTimeout(showIOSInstallHint, 3000);
    }
  }

  function showInstallBanner() {
    if ($('#pwaInstallBanner') || localStorage.getItem('pwa_dismissed')) return;

    var banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.className = 'pwa-banner';
    banner.innerHTML =
      '<span>Установите ASGARD на главный экран</span>' +
      '<button class="btn mini accent" id="pwaInstallBtn">Установить</button>' +
      '<button class="btn mini ghost" id="pwaCloseBtn">&times;</button>';
    document.body.appendChild(banner);

    $('#pwaInstallBtn').addEventListener('click', function () {
      if (deferredPWAPrompt) {
        deferredPWAPrompt.prompt();
        deferredPWAPrompt.userChoice.then(function (choice) {
          if (choice.outcome === 'accepted') {
            toast('Приложение установлено!', 'success');
          }
          deferredPWAPrompt = null;
          banner.remove();
        });
      }
    });

    $('#pwaCloseBtn').addEventListener('click', function () {
      localStorage.setItem('pwa_dismissed', '1');
      banner.remove();
    });
  }

  function showIOSInstallHint() {
    if (localStorage.getItem('pwa_ios_hint')) return;
    toast('Нажмите «Поделиться» → «На экран домой» для установки', 'info', 6000);
    localStorage.setItem('pwa_ios_hint', '1');
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  // ==========================================================
  // 16. Standalone-детекция
  // ==========================================================

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true
    );
  }

  function detectStandalone() {
    document.body.classList.toggle('pwa-standalone', isStandalone());
    return isStandalone();
  }

  // ==========================================================
  // 17. Вибрация
  // ==========================================================

  function vibrate(pattern) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern || 15);
    }
  }

  // ==========================================================
  // 18. Активный таб в нижней панели
  // ==========================================================

  function updateActiveTab() {
    if (typeof getMobileTabGroup !== 'function') return;

    var group = getMobileTabGroup();
    var tabs  = $$('.m-tab');

    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.tab === group);
    });
  }

  function initTabTracking() {
    window.addEventListener('hashchange', function () {
      updateActiveTab();
    });
    updateActiveTab();
  }

  // ==========================================================
  // 19. Мобильный дровер (сайдбар + оверлей)
  // ==========================================================

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', closeMenu);
    return overlay;
  }

  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    var nav = $('.sidenav');
    ensureOverlay();

    if (nav) nav.classList.add('open');
    document.body.classList.add('nav-open');
    overlay.classList.add('active');
    vibrate(10);
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    var nav = $('.sidenav');

    if (nav) nav.classList.remove('open');
    document.body.classList.remove('nav-open');
    if (overlay) overlay.classList.remove('active');
  }

  function toggleMenu() {
    menuOpen ? closeMenu() : openMenu();
  }

  // ==========================================================
  // 20. Post-render Hook — вызывается после каждого рендера
  // ==========================================================

  /**
   * Главная точка входа после каждого рендера страницы.
   * Вызывается из hashchange и через MutationObserver.
   * Собирает все мобильные пост-процессоры в одном месте.
   */
  function onPageRendered() {
    if (!isMobile) return;

    // Даём странице время отрендериться (многие модули async)
    setTimeout(function () {
      resetInlineGrids();
      initResponsiveTables();
      initKPIScrollHints();
      scrollToTop();
      animatePageTransition();
    }, 80);

    // Повторный проход для late-rendered контента (async fetch)
    setTimeout(function () {
      resetInlineGrids();
      initResponsiveTables();
      initKPIScrollHints();
    }, 500);

    // Третий проход для очень поздних рендеров
    setTimeout(function () {
      resetInlineGrids();
      initResponsiveTables();
    }, 1500);
  }

  // ==========================================================
  // 21. hashchange master handler
  // ==========================================================

  function onHashChange() {
    var newHash = window.location.hash;
    if (newHash === _previousHash) return;
    _previousHash = newHash;

    closeMenu();
    updateActiveTab();
    onPageRendered();

    // Переинициализируем observer на новом layout
    setTimeout(initLayoutObserver, 100);
    // Переинициализируем pull-to-refresh (новый .m-content может быть)
    setTimeout(initPullToRefresh, 200);
    setTimeout(initAutoHideHeader, 200);
  }

  // ==========================================================
  //  Инициализация
  // ==========================================================

  function init() {
    // ═══ iPhone/iPad safe area detection ═══
    var ua = navigator.userAgent || '';
    if (/iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      document.documentElement.classList.add('is-iphone');
    }
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      document.documentElement.classList.add('is-pwa');
    }
    // Dynamic viewport height (fixes iOS Safari bottom bar)
    function setVH() {
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    }
    setVH();
    window.addEventListener('resize', setVH);
    detectMobile();
    toggleBodyClass();
    injectCSS();
    initViewportFix();
    detectStandalone();

    if (isMobile) {
      initSwipeGestures();
      initTabTracking();
    // Wave 3: Track navigation direction (push/pop/enter)
    document.addEventListener('click', function(e) {
      var card = e.target.closest('.m-card[data-id], .m-card[data-href], .m-stat-card[data-href], .m-quick-action[data-href]');
      if (card) { _navDirection = 'push'; return; }
      var back = e.target.closest('.m-back-btn, .m-hdr-btn[onclick*="back"], [data-action="back"]');
      if (back) { _navDirection = 'pop'; }
    }, true);

    window.addEventListener('popstate', function() {
      _navDirection = 'pop';
    });
      initPWAInstall();
      initTouchFeedback();

      // Первичная обработка текущей страницы
      onPageRendered();

      // Master hashchange handler
      window.addEventListener('hashchange', onHashChange);

      // Инициализируем observer и pull-to-refresh после рендера layout
      setTimeout(function () {
        initLayoutObserver();
        initPullToRefresh();
        initAutoHideHeader();
      }, 300);
    }

    // При ресайзе пересчитываем детекцию
    window.addEventListener('resize', function () {
      var was = isMobile;
      detectMobile();
      if (was !== isMobile) {
        toggleBodyClass();
        if (isMobile) {
          // Стали мобильными — инициализируем всё
          initSwipeGestures();
          initTabTracking();
          initTouchFeedback();
          onPageRendered();
          setTimeout(function () {
            initLayoutObserver();
            initPullToRefresh();
            initAutoHideHeader();
          }, 300);
        } else {
          // Стали десктопными — восстанавливаем грид
          restoreInlineGrids();
          if (layoutObserver) layoutObserver.disconnect();
          // Восстанавливаем header
          var header = document.querySelector('.m-header');
          if (header) header.style.transform = '';
          headerHidden = false;
        }
      }
    });

    // Закрываем меню при переходе на другой роут
    window.addEventListener('hashchange', closeMenu);
  }

  // Автозапуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();

  // v8.2 — Chart.js mobile defaults
  if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = true;
    Chart.defaults.plugins.legend.position = 'bottom';
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.padding = 12;
    Chart.defaults.plugins.legend.labels.font = { size: 11 };
    Chart.defaults.plugins.tooltip.titleFont = { size: 13 };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.elements.point.radius = 3;
    Chart.defaults.elements.line.borderWidth = 2;
  }


  }

  // ─── Публичный API ────────────────────────────────────────

  // v8.1.1 — Scroll input into view when keyboard opens
  document.addEventListener('focusin', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true')) {
      setTimeout(function() {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });

  // v8.1.1 — iOS keyboard handling via visualViewport API
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      var vh = window.visualViewport.height;
      document.documentElement.style.setProperty('--vh', vh + 'px');
      // Adjust bottom-fixed elements when keyboard is open
      var tabbar = document.querySelector('.m-tabbar');
      var chatInput = document.querySelector('.m-chat-input-bar');
      if (tabbar) {
        tabbar.style.transform = vh < window.innerHeight * 0.7 ? 'translateY(100%)' : '';
      }
      if (chatInput) {
        chatInput.style.bottom = vh < window.innerHeight * 0.7 ? (window.innerHeight - vh) + 'px' : '';
      }
    });
  }

    return {
    init:                init,
    detectMobile:        detectMobile,
    openMenu:            openMenu,
    closeMenu:           closeMenu,
    toggleMenu:          toggleMenu,
    vibrate:             vibrate,
    isMobile:            function () { return isMobile; },
    detectStandalone:    detectStandalone,
    updateActiveTab:     updateActiveTab,
    // v2.0 API
    resetInlineGrids:    resetInlineGrids,
    restoreInlineGrids:  restoreInlineGrids,
    initResponsiveTables: initResponsiveTables,
    onPageRendered:      onPageRendered,
    scrollToTop:         scrollToTop,
    animatePageTransition: animatePageTransition
  };

}

);


  // v8.4.0 — Global universal card detail handler
  // Auto-opens detail sheet for any card that doesn't have a custom handler
  document.addEventListener('click', function(e) {
    var card = e.target.closest('.m-card[data-id]');
    if (!card) return;
    // Skip if this area has custom detail handling
    if (card.closest('[data-custom-detail]')) return;
    // Skip if a button or link was clicked inside the card
    if (e.target.closest('button, a, .m-card-action')) return;

    var id = card.dataset.id;
    if (!id) return;

    // Extract fields from card DOM
    var fields = [];
    card.querySelectorAll('.m-card-field').forEach(function(f) {
      var lbl = f.querySelector('.m-card-field-label');
      var val = f.querySelector('.m-card-field-value');
      if (lbl && val && val.textContent.trim()) {
        fields.push({ label: lbl.textContent.trim(), value: val.textContent.trim() });
      }
    });

    var titleEl = card.querySelector('.m-card-title');
    var subtEl = card.querySelector('.m-card-subtitle');
    var badgeEl = card.querySelector('.m-badge');
    var title = titleEl ? titleEl.textContent.trim() : 'Запись #' + id;

    // Build detail HTML
    var M = window.AsgardMobileUI || {};
    if (!M.showSheet) return;

    var html = '';
    if (subtEl && subtEl.textContent.trim()) {
      html += '<div style="color:var(--t2,#999);font-size:14px;margin-bottom:12px">' + subtEl.textContent.trim() + '</div>';
    }
    if (badgeEl) {
      html += '<div style="margin-bottom:16px">' + badgeEl.outerHTML + '</div>';
    }
    if (fields.length) {
      html += '<div class="m-detail-fields">';
      fields.forEach(function(f) {
        html += '<div class="m-detail-field">';
        html += '<span class="m-detail-label">' + f.label + '</span>';
        html += '<span class="m-detail-value">' + f.value + '</span>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="color:var(--t3);padding:20px 0;text-align:center">Нет дополнительных данных</div>';
    }

    M.showSheet(title, html);
  }, true); // useCapture to run before module handlers
  window._universalCardClick = true;



/* ═══ v8.7.0 — UX Premium Pack ═══ */

/* 1. Haptic Feedback */
(function() {
  function haptic(type) {
    if (!navigator.vibrate) return;
    switch(type) {
      case 'light': navigator.vibrate(5); break;
      case 'medium': navigator.vibrate(10); break;
      case 'heavy': navigator.vibrate(20); break;
      case 'success': navigator.vibrate([10, 30, 10]); break;
      case 'error': navigator.vibrate([15, 50, 15, 50, 15]); break;
      default: navigator.vibrate(8);
    }
  }
  window.AsgardHaptic = haptic;

  // Auto-haptic on tab clicks
  document.addEventListener('click', function(e) {
    var tab = e.target.closest('.m-tab');
    if (tab) haptic('light');
    var btn = e.target.closest('.m-btn, .m-card[data-clickable], .m-p-action, .m-sec-item, .m-logout-btn');
    if (btn) haptic('light');
    var toggle = e.target.closest('.m-toggle, input[type="checkbox"]');
    if (toggle) haptic('medium');
  }, { passive: true });
})();

/* 2. Parallax Scroll on Home */
(function() {
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      var card = document.querySelector('.m-greeting-card');
      var content = document.querySelector('.m-content') || document.querySelector('#layout');
      if (!card || !content) { ticking = false; return; }

      var scrollY = content.scrollTop || 0;
      var maxScroll = 150;
      var progress = Math.min(scrollY / maxScroll, 1);

      card.style.transform = 'translateY(' + (-scrollY * 0.3) + 'px) scale(' + (1 - progress * 0.08) + ')';
      card.style.opacity = String(1 - progress * 0.6);

      // Stats row becomes slightly sticky
      var stats = document.querySelector('.m-stats-row');
      if (stats && scrollY > 80) {
        stats.style.position = 'sticky';
        stats.style.top = '0';
        stats.style.zIndex = '5';
      } else if (stats) {
        stats.style.position = '';
        stats.style.top = '';
      }

      ticking = false;
    });
  }

  // Bind on route change
  window.addEventListener('hashchange', function() {
    setTimeout(function() {
      var content = document.querySelector('.m-content') || document.querySelector('#layout');
      if (content && location.hash.includes('/home')) {
        content.addEventListener('scroll', onScroll, { passive: true });
      }
    }, 300);
  });

  // Initial bind
  setTimeout(function() {
    var content = document.querySelector('.m-content') || document.querySelector('#layout');
    if (content && location.hash.includes('/home')) {
      content.addEventListener('scroll', onScroll, { passive: true });
    }
  }, 500);
})();

/* 5. Gesture Navigation — Swipe Back */
(function() {
  var touchStartX = 0;
  var touchStartY = 0;
  var swiping = false;
  var overlay = null;

  document.addEventListener('touchstart', function(e) {
    var touch = e.touches[0];
    // Only trigger from left edge (first 20px)
    if (touch.clientX > 20) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    swiping = true;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!swiping) return;
    var touch = e.touches[0];
    var deltaX = touch.clientX - touchStartX;
    var deltaY = Math.abs(touch.clientY - touchStartY);

    // Must be horizontal swipe
    if (deltaY > deltaX || deltaX < 10) return;

    // Show swipe indicator
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'm-swipe-back-indicator';
      document.body.appendChild(overlay);
    }

    var progress = Math.min(deltaX / 150, 1);
    overlay.style.opacity = String(progress * 0.6);
    overlay.style.width = Math.min(deltaX * 0.6, 60) + 'px';

    // Haptic at threshold
    if (progress >= 1 && !overlay.dataset.vibrated) {
      overlay.dataset.vibrated = '1';
      if (window.AsgardHaptic) AsgardHaptic('medium');
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (!swiping) return;
    swiping = false;

    if (overlay) {
      var completed = parseFloat(overlay.style.opacity) >= 0.5;
      overlay.remove();
      overlay = null;

      if (completed) {
        // Navigate back
        if (window.AsgardHaptic) AsgardHaptic('light');
        history.back();
      }
    }
  }, { passive: true });
})();

/* 6. Pull to Refresh */
(function() {
  var startY = 0;
  var pulling = false;
  var ptrEl = null;
  var threshold = 80;

  function createPTR() {
    if (ptrEl) return;
    ptrEl = document.createElement('div');
    ptrEl.className = 'm-ptr';
    ptrEl.innerHTML = '<div class="m-ptr-icon">\u16A6</div>';
    ptrEl.style.cssText = 'position:fixed;top:-50px;left:50%;transform:translateX(-50%);z-index:999;transition:top 0.3s cubic-bezier(0.175,0.885,0.32,1.275);';
    document.body.appendChild(ptrEl);
  }

  document.addEventListener('touchstart', function(e) {
    var content = document.querySelector('.m-content') || document.querySelector('#layout');
    if (!content || content.scrollTop > 5) return;
    startY = e.touches[0].clientY;
    pulling = true;
    createPTR();
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling || !ptrEl) return;
    var deltaY = e.touches[0].clientY - startY;
    if (deltaY < 0) return;

    var progress = Math.min(deltaY / threshold, 1);
    ptrEl.style.top = Math.min(deltaY * 0.4, 50) + 'px';
    ptrEl.querySelector('.m-ptr-icon').style.transform = 'rotate(' + (progress * 360) + 'deg)';

    if (progress >= 1 && !ptrEl.dataset.ready) {
      ptrEl.dataset.ready = '1';
      if (window.AsgardHaptic) AsgardHaptic('medium');
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!pulling || !ptrEl) return;
    pulling = false;

    if (ptrEl.dataset.ready) {
      // Trigger refresh
      ptrEl.style.top = '10px';
      ptrEl.querySelector('.m-ptr-icon').style.animation = 'm-ptr-spin 0.8s linear infinite';
      if (window.AsgardHaptic) AsgardHaptic('success');

      setTimeout(function() {
        location.reload();
      }, 500);
    } else {
      ptrEl.style.top = '-50px';
      setTimeout(function() {
        if (ptrEl) { ptrEl.remove(); ptrEl = null; }
      }, 300);
    }
  }, { passive: true });
})();


/* ═══ v8.8.0 — Mobile Global Search ═══ */
(function() {
  var searchOpen = false;
  var searchOverlay = null;
  var searchDebounce = null;

  function mobileSearchOpen() {
    if (searchOpen) return;
    searchOpen = true;

    searchOverlay = document.createElement('div');
    searchOverlay.className = 'm-search-overlay';
    searchOverlay.innerHTML = '<div class="m-search-container">' +
      '<div class="m-search-bar">' +
        '<button class="m-search-back" id="mSearchBack">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<input type="text" class="m-search-input" id="mGlobalSearchInput" placeholder="Search across CRM..." autocomplete="off" />' +
        '<button class="m-search-clear" id="mSearchClear" style="display:none">' +
          '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="rgba(255,255,255,.1)"/><path d="M6 6l6 6M12 6l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="m-search-filters" id="mSearchFilters">' +
        '<button class="m-search-filter active" data-type="all">All</button>' +
        '<button class="m-search-filter" data-type="task">Tasks</button>' +
        '<button class="m-search-filter" data-type="tender">Tenders</button>' +
        '<button class="m-search-filter" data-type="customer">Clients</button>' +
        '<button class="m-search-filter" data-type="employee">Staff</button>' +
        '<button class="m-search-filter" data-type="contract">Contracts</button>' +
        '<button class="m-search-filter" data-type="invoice">Invoices</button>' +
      '</div>' +
      '<div class="m-search-results" id="mSearchResults">' +
        mobileSearchQuickAccess() +
      '</div>' +
    '</div>';

    document.body.appendChild(searchOverlay);
    searchOverlay.offsetHeight; // force reflow
    searchOverlay.classList.add('open');

    var input = document.getElementById('mGlobalSearchInput');
    var results = document.getElementById('mSearchResults');
    var clearBtn = document.getElementById('mSearchClear');
    var activeType = 'all';

    setTimeout(function() { input.focus(); }, 100);

    // Back button
    document.getElementById('mSearchBack').addEventListener('click', mobileSearchClose);

    // Clear button
    clearBtn.addEventListener('click', function() {
      input.value = '';
      clearBtn.style.display = 'none';
      results.innerHTML = mobileSearchQuickAccess();
    });

    // Filter chips
    document.getElementById('mSearchFilters').addEventListener('click', function(e) {
      var chip = e.target.closest('.m-search-filter');
      if (!chip) return;
      document.querySelectorAll('.m-search-filter').forEach(function(c) { c.classList.remove('active'); });
      chip.classList.add('active');
      activeType = chip.dataset.type;
      if (input.value.trim().length >= 2) doSearch();
      if (window.AsgardHaptic) AsgardHaptic('light');
    });

    // Input handler with debounce
    input.addEventListener('input', function() {
      clearBtn.style.display = input.value.length > 0 ? '' : 'none';
      clearTimeout(searchDebounce);
      if (input.value.trim().length < 2) {
        results.innerHTML = mobileSearchQuickAccess();
        return;
      }
      searchDebounce = setTimeout(doSearch, 250);
    });

    async function doSearch() {
      var q = input.value.trim();
      if (q.length < 2) return;
      results.innerHTML = '<div class="m-search-loading"><div class="m-spinner" style="width:24px;height:24px"></div></div>';

      try {
        var searchResults = [];
        if (window.AsgardSearch && AsgardSearch.search) {
          searchResults = await AsgardSearch.search(q, activeType);
        }

        if (searchResults.length === 0) {
          results.innerHTML = mobileSearchEmpty(q);
          return;
        }

        // Save to history
        if (window.AsgardSearch && AsgardSearch.saveToHistory) {
          AsgardSearch.saveToHistory(q);
        }

        results.innerHTML = mobileSearchRender(searchResults, q);
      } catch(e) {
        results.innerHTML = '<div class="m-search-empty">Search error</div>';
      }
    }

    // Result click handler (event delegation)
    results.addEventListener('click', function(e) {
      var item = e.target.closest('.m-search-result');
      if (!item) return;
      var route = item.dataset.route;
      if (route) {
        if (window.AsgardHaptic) AsgardHaptic('light');
        mobileSearchClose();
        location.hash = route;
      }
    });

    // Close on Escape
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') mobileSearchClose();
    });
  }

  function mobileSearchClose() {
    if (!searchOpen || !searchOverlay) return;
    searchOpen = false;
    searchOverlay.classList.remove('open');
    setTimeout(function() {
      if (searchOverlay && searchOverlay.parentNode) {
        searchOverlay.parentNode.removeChild(searchOverlay);
      }
      searchOverlay = null;
    }, 300);
  }

  // Quick access screen (when no query)
  function mobileSearchQuickAccess() {
    var history = [];
    try {
      var h = localStorage.getItem('asgard_search_history');
      if (h) history = JSON.parse(h).slice(0, 5);
    } catch(e) {}

    var html = '';
    if (history.length > 0) {
      html += '<div class="m-search-section">' +
        '<div class="m-search-section-title">Recent</div>';
      for (var i = 0; i < history.length; i++) {
        html += '<div class="m-search-result" data-history="1" data-search-history="1">' +
          '<div class="m-search-result-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" opacity=".4"/><path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>' +
          '<div class="m-search-result-text">' + escapeHtml(history[i]) + '</div>' +
        '</div>';
      }
      html += '</div>';
    }

    html += '<div class="m-search-section">' +
      '<div class="m-search-section-title">Quick Navigation</div>' +
      '<div class="m-search-quick-grid">' +
        mobileSearchQuickItem('#/tasks', 'Задачи', 'M8 2l1.5 3H13l-2.5 2 1 3L8 8l-3.5 2 1-3L3 5h3.5z') +
        mobileSearchQuickItem('#/tenders', 'Тендеры', 'M2 3h12v10H2zM5 6h6M5 8h4') +
        mobileSearchQuickItem('#/customers', 'Клиенты', 'M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5') +
        mobileSearchQuickItem('#/finances', 'Финансы', 'M8 1v14M4 5h8M4 9h8M6 13h4') +
        mobileSearchQuickItem('#/pm-works', 'Объекты', 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z') +
        mobileSearchQuickItem('#/contracts', 'Договоры', 'M4 2h8v12H4zM7 5h3M7 7h3M7 9h2') +
      '</div>' +
    '</div>';

    return html;
  }

  function mobileSearchQuickItem(route, label, pathD) {
    return '<div class="m-search-quick-item m-search-result" data-route="' + route + '">' +
      '<div class="m-search-quick-icon"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="' + pathD + '" stroke="var(--gold, #D4A843)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<div class="m-search-quick-label">' + label + '</div>' +
    '</div>';
  }

  // Render search results
  function mobileSearchRender(results, query) {
    var grouped = {};
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r);
    }

    var typeLabels = {
      task: 'Задачи', tender: 'Тендеры', customer: 'Клиенты',
      employee: 'Сотрудники', invoice: 'Счета', contract: 'Договоры',
      work: 'Объекты', act: 'Акты', correspondence: 'Почта',
      estimate: 'Сметы', equipment: 'Оборудование'
    };
    var typeRoutes = {
      tender: '#/tenders?id=', work: '#/pm-works?id=',
      customer: '#/customer?inn=', employee: '#/employee?id=',
      invoice: '#/invoices?id=', act: '#/acts?id=',
      task: '#/tasks?id=', contract: '#/contracts?id=',
      correspondence: '#/correspondence?id=', estimate: '#/all-estimates?id=',
      equipment: '#/warehouse?id='
    };

    var html = '';
    var types = Object.keys(grouped);
    for (var t = 0; t < types.length; t++) {
      var type = types[t];
      var items = grouped[type];
      html += '<div class="m-search-section">' +
        '<div class="m-search-section-title">' + (typeLabels[type] || type) + ' (' + items.length + ')</div>';

      var max = Math.min(items.length, 8);
      for (var j = 0; j < max; j++) {
        var item = items[j];
        var route = (typeRoutes[type] || '#/') + (item.id || '');
        html += '<div class="m-search-result" data-route="' + route + '">' +
          '<div class="m-search-result-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--gold,#D4A843)" stroke-width="1" opacity=".5"/><text x="8" y="11" text-anchor="middle" font-size="8" fill="var(--gold,#D4A843)">' + (type.charAt(0).toUpperCase()) + '</text></svg></div>' +
          '<div class="m-search-result-body">' +
            '<div class="m-search-result-title">' + highlightQuery(item.title || '', query) + '</div>' +
            (item.subtitle ? '<div class="m-search-result-sub">' + highlightQuery(item.subtitle, query) + '</div>' : '') +
          '</div>' +
          '<svg class="m-search-result-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".3"/></svg>' +
        '</div>';
      }
      if (items.length > 8) {
        html += '<div class="m-search-more">+' + (items.length - 8) + ' more</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function mobileSearchEmpty(q) {
    return '<div class="m-search-empty">' +
      '<svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="22" cy="22" r="14" stroke="var(--gold,#D4A843)" stroke-width="2" opacity=".3"/><path d="M32 32l10 10" stroke="var(--gold,#D4A843)" stroke-width="2.5" stroke-linecap="round" opacity=".3"/><path d="M18 20h8M22 16v8" stroke="var(--gold,#D4A843)" stroke-width="1.5" stroke-linecap="round" opacity=".2"/></svg>' +
      '<div class="m-search-empty-text">Nothing found for "' + escapeHtml(q) + '"</div>' +
      '<div class="m-search-empty-hint">Try different keywords</div>' +
    '</div>';
  }

  function highlightQuery(text, query) {
    if (!text || !query) return escapeHtml(text || '');
    var safe = escapeHtml(text);
    try {
      var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return safe.replace(re, '<mark>$1</mark>');
    } catch(e) { return safe; }
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Handle search history clicks (event delegation)
  document.addEventListener('click', function(e) {
    var histItem = e.target.closest('[data-search-history]');
    if (histItem) {
      var input = document.getElementById('mGlobalSearchInput');
      if (input) {
        input.value = histItem.textContent.trim();
        input.dispatchEvent(new Event('input'));
      }
    }
  });

  // Expose globally
  window.AsgardMobileSearch = { open: mobileSearchOpen, close: mobileSearchClose };

  // Auto-bind search icon in header
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.m-header-search, #mHeaderSearch, .m-search-trigger');
    if (btn) {
      e.preventDefault();
      mobileSearchOpen();
    }
  });
})();

/* ═══ v8.8.0 — Infinite Scroll (IntersectionObserver) ═══ */
(function() {
  var observer = null;

  function setupInfiniteScroll() {
    if (observer) observer.disconnect();
    if (!('IntersectionObserver' in window)) return;

    observer = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var sentinel = entries[i].target;
        var btn = sentinel.previousElementSibling;
        if (btn && btn.querySelector('.m-load-more-btn')) {
          btn.querySelector('.m-load-more-btn').click();
          // Re-observe if still visible (more items to load)
          setTimeout(function() {
            if (btn.style.display !== 'none') {
              observer.observe(sentinel);
            }
          }, 300);
        }
      }
    }, { rootMargin: '200px' });

    // Find all Load More buttons and add sentinels
    var loadMoreEls = document.querySelectorAll('.m-load-more');
    for (var j = 0; j < loadMoreEls.length; j++) {
      var el = loadMoreEls[j];
      if (el.nextElementSibling && el.nextElementSibling.classList.contains('m-scroll-sentinel')) continue;
      var sentinel = document.createElement('div');
      sentinel.className = 'm-scroll-sentinel';
      sentinel.style.height = '1px';
      el.parentNode.insertBefore(sentinel, el.nextSibling);
      observer.observe(sentinel);
    }
  }

  // Re-setup on route change
  window.addEventListener('hashchange', function() {
    setTimeout(setupInfiniteScroll, 500);
  });
  // Initial
  setTimeout(setupInfiniteScroll, 1000);
  // Also on DOM changes (for dynamically loaded content)
  var mutObserver = new MutationObserver(function() {
    var hasNew = document.querySelector('.m-load-more:not([data-scroll-init])');
    if (hasNew) {
      hasNew.setAttribute('data-scroll-init', '1');
      setTimeout(setupInfiniteScroll, 200);
    }
  });
  if (document.body) {
    mutObserver.observe(document.body, { childList: true, subtree: true });
  }
})();

/* ═══ v8.8.0 — Offline Indicator + Service Worker Cache ═══ */
(function() {
  var offlineBanner = null;

  function showOffline() {
    if (offlineBanner) return;
    offlineBanner = document.createElement('div');
    offlineBanner.className = 'm-offline-banner';
    offlineBanner.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 1l14 14M3 5.5A7.5 7.5 0 0114 5.5M5.5 8A5 5 0 0111.5 8M8 10.5a2.5 2.5 0 012.5 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '<span>Offline mode</span>';
    document.body.appendChild(offlineBanner);
    offlineBanner.offsetHeight;
    offlineBanner.classList.add('show');
  }

  function hideOffline() {
    if (!offlineBanner) return;
    offlineBanner.classList.remove('show');
    setTimeout(function() {
      if (offlineBanner && offlineBanner.parentNode) {
        offlineBanner.parentNode.removeChild(offlineBanner);
      }
      offlineBanner = null;
    }, 300);
  }

  window.addEventListener('online', hideOffline);
  window.addEventListener('offline', showOffline);
  if (!navigator.onLine) showOffline();
})();
