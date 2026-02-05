/**
 * АСГАРД CRM — Мобильная оптимизация
 * 
 * Функции:
 * - Адаптивное меню
 * - Touch-события
 * - Оффлайн поддержка
 * - PWA улучшения
 */
window.AsgardMobile = (function(){
  const { $, $$, toast } = AsgardUI;
  
  let isMobile = false;
  let isMenuOpen = false;
  let touchStartX = 0;
  let touchStartY = 0;
  
  // Определение мобильного устройства
  function detectMobile() {
    isMobile = window.innerWidth <= 768 || 
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    document.body.classList.toggle('is-mobile', isMobile);
    document.body.classList.toggle('is-desktop', !isMobile);
    
    return isMobile;
  }
  
  // Инициализация мобильного меню
  function initMobileMenu() {
    // Создаём кнопку бургера если её нет
    if (!$('#mobileMenuBtn')) {
      const btn = document.createElement('button');
      btn.id = 'mobileMenuBtn';
      btn.className = 'mobile-menu-btn';
      btn.innerHTML = '☰';
      btn.setAttribute('aria-label', 'Меню');
      
      const header = $('header') || $('.topbar');
      if (header) {
        header.insertBefore(btn, header.firstChild);
      }
    }
    
    // Создаём оверлей
    if (!$('#mobileOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'mobileOverlay';
      overlay.className = 'mobile-overlay';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
    } else {
      $('#mobileOverlay').style.pointerEvents = 'none';
    }
    
    // Обработчики
    $('#mobileMenuBtn')?.addEventListener('click', toggleMenu);
    $('#mobileOverlay')?.addEventListener('click', closeMenu);
    
    // Закрытие при клике на пункт меню
    $$('.nav a, .sidebar a').forEach(link => {
      link.addEventListener('click', () => {
        if (isMobile) closeMenu();
      });
    });
  }
  
  function toggleMenu() {
    isMenuOpen = !isMenuOpen;
    updateMenuState();
  }
  
  function openMenu() {
    isMenuOpen = true;
    updateMenuState();
  }
  
  function closeMenu() {
    isMenuOpen = false;
    updateMenuState();
  }
  
  function updateMenuState() {
    const sidebar = $('.sidebar') || $('nav');
    const overlay = $('#mobileOverlay');
    const btn = $('#mobileMenuBtn');
    
    if (sidebar) {
      sidebar.classList.toggle('open', isMenuOpen);
    }
    if (overlay) {
      overlay.classList.toggle('active', isMenuOpen);
      overlay.style.pointerEvents = isMenuOpen ? 'auto' : 'none';
    }
    if (btn) {
      btn.innerHTML = isMenuOpen ? '✕' : '☰';
    }
    
    document.body.classList.toggle('menu-open', isMenuOpen);
  }
  
  // Свайп для открытия/закрытия меню
  function initSwipeGestures() {
    document.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
      if (!isMobile) return;
      
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      
      // Горизонтальный свайп (минимум 50px, угол < 30°)
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
        if (deltaX > 0 && touchStartX < 30) {
          // Свайп вправо от левого края — открыть меню
          openMenu();
        } else if (deltaX < 0 && isMenuOpen) {
          // Свайп влево при открытом меню — закрыть
          closeMenu();
        }
      }
    }, { passive: true });
  }
  
  // Pull-to-refresh
  function initPullToRefresh() {
    let pullStartY = 0;
    let isPulling = false;
    
    const main = $('#main') || $('main');
    if (!main) return;
    
    main.addEventListener('touchstart', (e) => {
      if (main.scrollTop === 0) {
        pullStartY = e.touches[0].clientY;
        isPulling = true;
      }
    }, { passive: true });
    
    main.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      
      const pullDistance = e.touches[0].clientY - pullStartY;
      
      if (pullDistance > 0 && pullDistance < 150) {
        main.style.transform = `translateY(${pullDistance / 3}px)`;
      }
    }, { passive: true });
    
    main.addEventListener('touchend', () => {
      if (!isPulling) return;
      
      main.style.transform = '';
      isPulling = false;
      
      // Если потянули достаточно — обновляем
      // (логика обновления зависит от текущей страницы)
    });
  }
  
  // Оффлайн индикатор - отключен
  function initOfflineIndicator() {
    // Отключено по запросу
    return;
  }
  
  // Адаптивные таблицы
  function initResponsiveTables() {
    // Обёртка для горизонтального скролла
    $$('table.tbl').forEach(table => {
      if (table.parentElement?.classList.contains('tbl-wrap')) return;
      
      const wrapper = document.createElement('div');
      wrapper.className = 'tbl-wrap';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }
  
  // Улучшение touch-целей
  function initTouchTargets() {
    // Увеличиваем область клика для мелких кнопок
    $$('.btn.mini, .btn.ghost.mini').forEach(btn => {
      btn.style.minWidth = '44px';
      btn.style.minHeight = '44px';
    });
  }
  
  // Виброотклик (если поддерживается)
  function vibrate(pattern = 10) {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }
  
  // Инициализация
  function init() {
    detectMobile();
    
    if (isMobile) {
      initMobileMenu();
      initSwipeGestures();
      initPullToRefresh();
      initTouchTargets();
    }
    
    initOfflineIndicator();
    initResponsiveTables();
    
    // Слушаем изменение размера
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const wasMobile = isMobile;
        detectMobile();
        
        if (wasMobile !== isMobile) {
          if (isMobile) {
            initMobileMenu();
            initSwipeGestures();
          } else {
            closeMenu();
          }
        }
      }, 250);
    });
    
    // Фикс для iOS Safari (100vh)
    function setVH() {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    setVH();
    window.addEventListener('resize', setVH);
  }
  
  // CSS для мобильной версии
  const style = document.createElement('style');
  style.textContent = `
    /* Мобильное меню */
    .mobile-menu-btn {
      display: none;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 24px;
      padding: 8px 12px;
      cursor: pointer;
      z-index: 1001;
    }
    
    .mobile-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .mobile-overlay.active {
      opacity: 1;
    }
    
    .offline-indicator {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--red);
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      transition: transform 0.3s;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    
    .offline-indicator.visible {
      transform: translateX(-50%) translateY(0);
    }
    
    /* Mobile styles */
    @media (max-width: 768px) {
      .mobile-menu-btn {
        display: block;
      }
      
      .mobile-overlay {
        display: block;
      }
      
      .sidebar {
        position: fixed;
        left: -280px;
        top: 0;
        bottom: 0;
        width: 280px;
        z-index: 1000;
        transition: left 0.3s ease;
        overflow-y: auto;
      }
      
      .sidebar.open {
        left: 0;
      }
      
      .layout {
        margin-left: 0 !important;
      }
      
      .topbar {
        padding: 8px 12px;
      }
      
      .page-header {
        flex-direction: column;
        gap: 12px;
        align-items: stretch;
      }
      
      .page-header h1 {
        font-size: 20px;
      }
      
      .kpi {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 8px;
      }
      
      .kpi .k {
        padding: 12px;
      }
      
      .kpi .k .v {
        font-size: 18px;
      }
      
      .formrow {
        grid-template-columns: 1fr !important;
      }
      
      .filters {
        flex-direction: column;
      }
      
      .filters .inp,
      .filters select {
        width: 100%;
      }
      
      .tbl-wrap {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      
      .tbl {
        min-width: 600px;
      }
      
      .tbl th,
      .tbl td {
        padding: 8px 10px;
        font-size: 13px;
      }
      
      .btn {
        padding: 10px 16px;
      }
      
      .btn.mini {
        min-width: 44px;
        min-height: 44px;
        padding: 8px;
      }
      
      .modal {
        width: 95% !important;
        max-width: none !important;
        margin: 10px;
        max-height: calc(100vh - 20px);
      }
      
      .card {
        padding: 12px;
      }
      
      .tabs {
        overflow-x: auto;
        flex-wrap: nowrap;
        -webkit-overflow-scrolling: touch;
      }
      
      .tab {
        flex-shrink: 0;
        padding: 10px 16px;
      }
      
      /* Скрываем некритичные колонки */
      .tbl .hide-mobile {
        display: none;
      }
    }
    
    /* Tablet */
    @media (min-width: 769px) and (max-width: 1024px) {
      .sidebar {
        width: 60px;
      }
      
      .sidebar .nav-text {
        display: none;
      }
      
      .layout {
        margin-left: 60px;
      }
      
      .kpi {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    
    /* Touch-friendly */
    @media (hover: none) and (pointer: coarse) {
      .btn:active {
        transform: scale(0.98);
      }
      
      .search-result-item:active {
        background: var(--bg-hover);
      }
    }
    
    /* Safe areas (iPhone X+) */
    @supports (padding: env(safe-area-inset-bottom)) {
      .sidebar {
        padding-bottom: env(safe-area-inset-bottom);
      }
      
      .mobile-overlay {
        padding-bottom: env(safe-area-inset-bottom);
      }
    }
  `;
  document.head.appendChild(style);
  
  // Автоинициализация
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  return {
    init,
    detectMobile,
    openMenu,
    closeMenu,
    toggleMenu,
    vibrate,
    isMobile: () => isMobile
  };
})();
