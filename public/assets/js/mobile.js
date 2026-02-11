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
    // Используем существующую кнопку #btnMenu из app.js (не создаём дубль)
    // Создаём оверлей если его нет
    if (!$('#mobileOverlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'mobileOverlay';
      overlay.className = 'mobile-overlay';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
    }

    // Обработчики (btnMenu уже обработан в app.js через toggleNav)
    $('#mobileOverlay')?.addEventListener('click', closeMenu);

    // Закрытие при клике на пункт меню
    $$('.nav a, .sidenav a').forEach(link => {
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
    const sidebar = $('.sidenav') || $('nav');
    const overlay = $('#mobileOverlay');

    if (sidebar) {
      sidebar.classList.toggle('open', isMenuOpen);
    }
    if (overlay) {
      overlay.classList.toggle('active', isMenuOpen);
      overlay.style.pointerEvents = isMenuOpen ? 'auto' : 'none';
    }

    document.body.classList.toggle('nav-open', isMenuOpen);
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

    detectStandalone();
    checkIOSInstall();
  }
  
  // CSS для мобильной версии (только уникальные стили — остальное в app.css)
  const style = document.createElement('style');
  style.textContent = `
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
      pointer-events: none;
      transition: opacity 0.3s;
    }

    .mobile-overlay.active {
      display: block;
      opacity: 1;
      pointer-events: auto;
    }

    .offline-indicator {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--red);
      color: #fff;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 9999;
      transition: transform 0.3s;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    .offline-indicator.visible {
      transform: translateX(-50%) translateY(0);
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
      .sidenav {
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
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PWA INSTALL PROMPT
  // ═══════════════════════════════════════════════════════════════════════════

  let deferredPrompt = null;

  // Android: перехватываем стандартный промпт Chrome
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (sessionStorage.getItem('asg_install_dismissed')) return;
    showInstallBanner('android');
  });

  // iOS: проверяем при загрузке
  function checkIOSInstall() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    const dismissed = localStorage.getItem('asg_ios_install_dismissed');
    if (isIOS && !isStandalone && !dismissed) {
      setTimeout(() => showInstallBanner('ios'), 3000);
    }
  }

  function showInstallBanner(platform) {
    if (document.getElementById('pwaInstallBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.className = 'pwa-install-banner';

    if (platform === 'ios') {
      banner.innerHTML = `
        <div class="pwa-install-content">
          <img src="assets/img/icon-96.png" class="pwa-install-icon" alt="АСГАРД"/>
          <div class="pwa-install-text">
            <div class="pwa-install-title">Установить АСГАРД CRM</div>
            <div class="pwa-install-desc">Нажмите <strong>Поделиться</strong> <span style="font-size:16px">⎋</span> → <strong>На экран «Домой»</strong></div>
          </div>
          <button class="pwa-install-close" id="pwaInstallClose">✕</button>
        </div>`;
    } else {
      banner.innerHTML = `
        <div class="pwa-install-content">
          <img src="assets/img/icon-96.png" class="pwa-install-icon" alt="АСГАРД"/>
          <div class="pwa-install-text">
            <div class="pwa-install-title">Установить АСГАРД CRM</div>
            <div class="pwa-install-desc">Быстрый доступ с рабочего стола</div>
          </div>
          <button class="btn primary pwa-install-btn" id="pwaInstallBtn">Установить</button>
          <button class="pwa-install-close" id="pwaInstallClose">✕</button>
        </div>`;
    }

    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('visible'));
    });

    document.getElementById('pwaInstallClose')?.addEventListener('click', () => {
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 300);
      if (platform === 'ios') {
        localStorage.setItem('asg_ios_install_dismissed', '1');
      } else {
        sessionStorage.setItem('asg_install_dismissed', '1');
      }
    });

    document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted' && window.AsgardUI?.toast) {
        AsgardUI.toast('Готово', 'АСГАРД CRM установлен!', 'ok');
      }
      deferredPrompt = null;
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 300);
    });
  }

  // Standalone detection
  function detectStandalone() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true;
    document.body.classList.toggle('pwa-standalone', isStandalone);
    return isStandalone;
  }

  return {
    init,
    detectMobile,
    openMenu,
    closeMenu,
    toggleMenu,
    vibrate,
    isMobile: () => isMobile,
    detectStandalone
  };
})();
