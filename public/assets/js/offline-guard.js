/**
 * ASGARD CRM — Offline Guard v1.0
 * Детекция потери сети / VPN-блокировки.
 * SVG-ворон Хугинн, руны, анимации.
 * Desktop + Mobile (ES5-совместимый).
 */
(function() {
  'use strict';

  var overlay = null;
  var isShowing = false;
  var failCount = 0;
  var MAX_FAILS = 3;
  var checkTimer = null;
  var isVPN = false;

  // ═══════════════════════════════════════════════════════════════════════════
  // SVG RAVEN
  // ═══════════════════════════════════════════════════════════════════════════

  var ravenSVG = '<svg viewBox="0 0 120 120" width="120" height="120" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="ogRaven" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#2a3b66"/><stop offset="100%" stop-color="#c0392b"/>' +
    '</linearGradient></defs>' +
    '<g fill="none" stroke="url(#ogRaven)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="og-raven-g">' +
      // Body
      '<ellipse cx="60" cy="68" rx="22" ry="28"/>' +
      // Head
      '<circle cx="60" cy="36" r="14"/>' +
      // Beak
      '<path d="M74 34 L84 30 L74 38Z" fill="url(#ogRaven)"/>' +
      // Eye
      '<circle cx="66" cy="33" r="2.5" fill="#f5d78e"/>' +
      // Left wing
      '<path d="M38 55 Q18 40 12 58 Q18 72 38 68" class="og-wing-l"/>' +
      // Right wing
      '<path d="M82 55 Q102 40 108 58 Q102 72 82 68" class="og-wing-r"/>' +
      // Tail
      '<path d="M48 94 L42 108 M52 96 L50 110 M60 96 L60 112 M68 96 L70 110 M72 94 L78 108"/>' +
      // Feet
      '<path d="M50 96 L46 104 M50 96 L54 104"/>' +
      '<path d="M70 96 L66 104 M70 96 L74 104"/>' +
    '</g>' +
  '</svg>';

  var shieldSVG = '<svg viewBox="0 0 100 120" width="100" height="120" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="ogShield" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#2a3b66"/><stop offset="100%" stop-color="#c0392b"/>' +
    '</linearGradient></defs>' +
    '<path d="M50 8 L90 28 L90 60 Q90 95 50 112 Q10 95 10 60 L10 28Z" fill="none" stroke="url(#ogShield)" stroke-width="3"/>' +
    '<text x="50" y="72" text-anchor="middle" font-size="36" font-family="serif" fill="#f5d78e">\u16D7</text>' +
  '</svg>';

  // ═══════════════════════════════════════════════════════════════════════════
  // CSS
  // ═══════════════════════════════════════════════════════════════════════════

  var cssText =
    '.og-overlay{position:fixed;inset:0;z-index:99999;' +
      'background:rgba(10,14,26,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'opacity:0;transition:opacity 0.5s ease;pointer-events:none;}' +
    '.og-overlay.visible{opacity:1;pointer-events:auto;}' +
    '.og-overlay.hiding{opacity:0;}' +

    '.og-content{text-align:center;max-width:400px;padding:20px;}' +

    '.og-raven-g{animation:ogWing 3s ease-in-out infinite;}' +
    '.og-wing-l{animation:ogWingL 3s ease-in-out infinite;transform-origin:38px 60px;}' +
    '.og-wing-r{animation:ogWingR 3s ease-in-out infinite;transform-origin:82px 60px;}' +

    '@keyframes ogWingL{0%,100%{transform:rotate(0)}50%{transform:rotate(-8deg)}}' +
    '@keyframes ogWingR{0%,100%{transform:rotate(0)}50%{transform:rotate(8deg)}}' +

    '.og-title{font-size:28px;font-weight:700;color:#f5d78e;margin:20px 0 8px;}' +
    '.og-subtitle{font-size:16px;color:rgba(255,255,255,0.6);animation:ogPulseText 2s ease-in-out infinite;}' +
    '@keyframes ogPulseText{0%,100%{opacity:0.6}50%{opacity:1}}' +

    '.og-spinner{width:40px;height:40px;margin:24px auto 0;' +
      'border:3px solid transparent;border-top-color:#2a3b66;border-right-color:#c0392b;' +
      'border-radius:50%;animation:ogSpin 1.5s linear infinite;}' +
    '@keyframes ogSpin{to{transform:rotate(360deg)}}' +

    '.og-rune{position:fixed;font-size:24px;font-family:serif;color:rgba(245,215,142,0.12);' +
      'animation:ogRunePulse 4s ease-in-out infinite;}' +
    '@keyframes ogRunePulse{0%,100%{opacity:0.08;text-shadow:0 0 0 transparent}50%{opacity:0.2;text-shadow:0 0 12px rgba(245,215,142,0.15)}}' +

    '.og-rune-tl{top:40px;left:40px;animation-delay:0s;}' +
    '.og-rune-tr{top:40px;right:40px;animation-delay:1s;}' +
    '.og-rune-bl{bottom:40px;left:40px;animation-delay:2s;}' +
    '.og-rune-br{bottom:40px;right:40px;animation-delay:3s;}' +

    '.og-flash{position:fixed;inset:0;z-index:100000;' +
      'display:flex;align-items:center;justify-content:center;' +
      'background:rgba(39,174,96,0.15);backdrop-filter:blur(8px);' +
      'font-size:22px;font-weight:700;color:#27ae60;' +
      'font-family:-apple-system,sans-serif;' +
      'opacity:0;transition:opacity 0.3s ease;pointer-events:none;}' +
    '.og-flash.visible{opacity:1;}' +

    '@media(max-width:768px){.og-title{font-size:22px}.og-subtitle{font-size:14px}' +
      '.og-rune{font-size:18px}.og-rune-tl,.og-rune-tr{top:24px}' +
      '.og-rune-bl,.og-rune-br{bottom:24px}.og-rune-tl,.og-rune-bl{left:20px}' +
      '.og-rune-tr,.og-rune-br{right:20px}}';

  function injectCSS() {
    if (document.getElementById('og-styles')) return;
    var style = document.createElement('style');
    style.id = 'og-styles';
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OVERLAY
  // ═══════════════════════════════════════════════════════════════════════════

  function createOverlay(vpnMode) {
    if (overlay) {
      overlay.parentNode && overlay.parentNode.removeChild(overlay);
    }

    overlay = document.createElement('div');
    overlay.className = 'og-overlay';
    overlay.innerHTML =
      '<div class="og-content">' +
        (vpnMode ? shieldSVG : ravenSVG) +
        '<div class="og-title">' + (vpnMode ? 'Мидгард заблокирован' : 'Связь потеряна') + '</div>' +
        '<div class="og-subtitle">' + (vpnMode ? 'Проверь VPN-подключение' : 'Ворон Хугинн ищет путь...') + '</div>' +
        '<div class="og-spinner"></div>' +
      '</div>' +
      '<span class="og-rune og-rune-tl">\u16B1</span>' +
      '<span class="og-rune og-rune-tr">\u16CF</span>' +
      '<span class="og-rune og-rune-bl">\u16BA</span>' +
      '<span class="og-rune og-rune-br">\u16BE</span>';

    document.body.appendChild(overlay);

    // Trigger animation
    requestAnimationFrame(function() {
      overlay.classList.add('visible');
    });
  }

  function showOverlay(vpnMode) {
    if (isShowing) return;
    isShowing = true;
    isVPN = !!vpnMode;
    injectCSS();
    createOverlay(vpnMode);
  }

  function hideOverlay() {
    if (!isShowing) return;
    isShowing = false;
    failCount = 0;

    // Flash green
    var flash = document.createElement('div');
    flash.className = 'og-flash';
    flash.textContent = '\u26A1 Связь восстановлена!';
    document.body.appendChild(flash);
    requestAnimationFrame(function() { flash.classList.add('visible'); });

    // Remove overlay
    if (overlay) {
      overlay.classList.add('hiding');
    }

    setTimeout(function() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
        overlay = null;
      }
      flash.classList.remove('visible');
      setTimeout(function() {
        if (flash.parentNode) flash.parentNode.removeChild(flash);
      }, 300);
    }, 1500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function onOffline() {
    showOverlay(false);
  }

  function onOnline() {
    // Verify with actual fetch before hiding
    checkConnection();
  }

  function checkConnection() {
    var url = '/api/health?_t=' + Date.now();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;

    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 500) {
        failCount = 0;
        if (isShowing) hideOverlay();
      } else {
        onFetchFail();
      }
    };
    xhr.onerror = function() { onFetchFail(); };
    xhr.ontimeout = function() { onFetchFail(); };
    xhr.send();
  }

  function onFetchFail() {
    failCount++;
    if (failCount >= MAX_FAILS) {
      // navigator.onLine = true but fetch fails → VPN issue
      if (navigator.onLine) {
        showOverlay(true);
      } else {
        showOverlay(false);
      }
    }
  }

  // Periodic check when overlay is shown
  function startCheckTimer() {
    if (checkTimer) return;
    checkTimer = setInterval(function() {
      if (isShowing) {
        checkConnection();
      }
    }, 5000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    startCheckTimer();

    // Initial check
    if (!navigator.onLine) {
      showOverlay(false);
    }
  }

  // Start on DOMContentLoaded or immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for external use
  window.OfflineGuard = {
    check: checkConnection,
    isShowing: function() { return isShowing; }
  };
})();
