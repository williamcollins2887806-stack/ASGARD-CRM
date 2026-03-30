/**
 * ASGARD Field — App Init (auth guard, shell, theme, PWA install, offline)
 */
(() => {
'use strict';

let _deferredInstallPrompt = null;
let _offlineBanner = null;
let _installBanner = null;

async function init() {
  // 1. Inject DS
  DS.injectStyles();
  DS.setTheme('dark');

  // 2. Build shell
  const app = document.getElementById('field-app');
  if (!app) return;

  app.innerHTML = '';
  const shell = Utils.el('div', {
    className: 'field-shell',
    style: {
      display:'flex', flexDirection:'column',
      height:'100dvh', width:'100%',
      background:'var(--f-bg0)', color:'var(--f-text)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      overflow:'hidden', position:'relative',
    },
  });

  // Offline banner (hidden by default)
  _offlineBanner = Utils.el('div', {
    id: 'field-offline-banner',
    style: {
      display: 'none', padding: '8px 16px',
      background: 'linear-gradient(90deg, #92400e, #78350f)',
      color: '#fbbf24', fontSize: '0.8125rem', fontWeight: '600',
      textAlign: 'center', gap: '8px', alignItems: 'center', justifyContent: 'center',
      zIndex: '100',
    },
  }, '\uD83D\uDFE1 Офлайн — данные сохранены локально');
  shell.appendChild(_offlineBanner);

  const content = Utils.el('div', {
    id: 'field-content',
    style: {
      flex:'1', overflowY:'auto', overflowX:'hidden',
      WebkitOverflowScrolling:'touch',
    },
  });

  // Pull-to-refresh
  setupPullToRefresh(content);

  shell.appendChild(content);
  app.appendChild(shell);

  // 3. Setup offline/online listeners
  setupOnlineListeners();

  // 4. Auth guard
  const token = API.getToken();
  if (!token) {
    Router.navigate('/field/login', { replace: true });
    return;
  }

  // Verify token
  const me = await API.fetch('/auth/me');
  if (!me || me._status === 401) {
    API.clearToken();
    Router.navigate('/field/login', { replace: true });
    return;
  }

  // Store user data
  Store.set('me', me);

  // Cache project data for offline
  try {
    const project = await API.fetch('/me/active-project');
    if (project && project._ok !== false) {
      OfflineDB.cacheProject(project);
    }
  } catch (_) {}

  // Navigate to home or current hash
  const hash = window.location.hash.slice(1);
  if (!hash || hash === '/field/login' || hash === '/field') {
    Router.navigate('/field/home', { replace: true });
  } else {
    Router._render(hash);
  }

  // 5. Show PWA install banner (after 2nd visit)
  setupInstallPrompt(shell);

  // 6. Listen for sync-complete messages from SW
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'sync-complete') {
        const store = event.data.store || '';
        if (window.F && F.Toast) {
          F.Toast('\u2705 Данные синхронизированы' + (store ? ` (${store})` : ''));
        }
        // Refresh current page
        const path = Router.getCurrentRoute();
        if (path) Router._render(path);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// ONLINE/OFFLINE
// ═══════════════════════════════════════════════════════════════
function setupOnlineListeners() {
  function updateBanner() {
    if (!_offlineBanner) return;
    if (navigator.onLine) {
      _offlineBanner.style.display = 'none';
    } else {
      _offlineBanner.style.display = 'flex';
    }
  }
  window.addEventListener('online', () => {
    updateBanner();
    // Try to sync pending items
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        if (reg.sync) {
          reg.sync.register('field-checkin-sync');
          reg.sync.register('field-photo-sync');
          reg.sync.register('field-report-sync');
        }
      });
    }
  });
  window.addEventListener('offline', updateBanner);
  updateBanner();
}

// ═══════════════════════════════════════════════════════════════
// PULL TO REFRESH
// ═══════════════════════════════════════════════════════════════
function setupPullToRefresh(container) {
  let startY = 0;
  let pulling = false;
  let indicator = null;

  container.addEventListener('touchstart', (e) => {
    if (container.scrollTop <= 0) {
      startY = e.touches[0].pageY;
      pulling = true;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].pageY - startY;
    if (dy > 10 && container.scrollTop <= 0) {
      if (!indicator) {
        indicator = Utils.el('div', {
          style: {
            textAlign: 'center', padding: '12px', fontSize: '0.8125rem',
            color: 'var(--f-gold, #D4A843)', fontWeight: '600',
            transition: 'opacity 0.2s',
          },
        }, '\u2935\uFE0F Потяните для обновления');
        container.prepend(indicator);
      }
      const progress = Math.min(dy / 120, 1);
      indicator.style.opacity = String(progress);
      if (dy > 120) {
        indicator.textContent = '\uD83D\uDD04 Отпустите для обновления';
      }
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    if (indicator) {
      const wasReady = indicator.textContent.includes('Отпустите');
      indicator.remove();
      indicator = null;
      if (wasReady) {
        // Refresh current page
        const path = Router.getCurrentRoute();
        if (path) Router._render(path);
        Utils.vibrate(30);
      }
    }
    pulling = false;
    startY = 0;
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════
// PWA INSTALL PROMPT
// ═══════════════════════════════════════════════════════════════
function setupInstallPrompt(shell) {
  // Track visits
  const visits = parseInt(localStorage.getItem('field_visits') || '0') + 1;
  localStorage.setItem('field_visits', String(visits));

  // Dismissed already?
  const dismissed = localStorage.getItem('field_install_dismissed');
  if (dismissed) return;

  // Already installed (standalone mode)?
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone === true) return;

  // Show after 2nd visit
  if (visits < 2 && !_deferredInstallPrompt) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    showInstallBanner(shell);
  });

  // If prompt was already captured
  if (_deferredInstallPrompt) {
    showInstallBanner(shell);
  }
}

function showInstallBanner(shell) {
  if (_installBanner) return;
  if (localStorage.getItem('field_install_dismissed')) return;

  _installBanner = Utils.el('div', {
    style: {
      position: 'fixed', bottom: '0', left: '0', right: '0',
      padding: '16px 20px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
      background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
      borderTop: '2px solid #D4A843',
      display: 'flex', alignItems: 'center', gap: '12px',
      zIndex: '200',
      animation: 'fieldSlideUp 0.4s ease',
    },
  });

  const icon = Utils.el('img', {
    src: '/assets/img/asgard_emblem.png',
    style: { width: '40px', height: '40px', borderRadius: '10px', flexShrink: '0' },
  });

  const text = Utils.el('div', { style: { flex: '1' } });
  text.appendChild(Utils.el('div', {
    style: { fontWeight: '700', fontSize: '0.875rem', color: '#f4f4f5' },
  }, '\u2694\uFE0F Установить ASGARD Field'));
  text.appendChild(Utils.el('div', {
    style: { fontSize: '0.75rem', color: '#9ca3af', marginTop: '2px' },
  }, 'Быстрый доступ с рабочего стола'));

  const installBtn = Utils.el('button', {
    style: {
      padding: '8px 20px', borderRadius: '10px', border: 'none',
      background: 'linear-gradient(135deg, #D4A843, #B8922E)',
      color: '#000', fontWeight: '700', fontSize: '0.8125rem',
      cursor: 'pointer', whiteSpace: 'nowrap',
    },
    onClick: async () => {
      if (_deferredInstallPrompt) {
        _deferredInstallPrompt.prompt();
        const { outcome } = await _deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          localStorage.setItem('field_install_dismissed', '1');
        }
        _deferredInstallPrompt = null;
      }
      _installBanner.remove();
      _installBanner = null;
    },
  }, 'Установить');

  const closeBtn = Utils.el('button', {
    style: {
      background: 'none', border: 'none', color: '#6b7280',
      fontSize: '20px', cursor: 'pointer', padding: '4px 8px',
    },
    onClick: () => {
      localStorage.setItem('field_install_dismissed', '1');
      _installBanner.remove();
      _installBanner = null;
    },
  }, '\u2715');

  _installBanner.appendChild(icon);
  _installBanner.appendChild(text);
  _installBanner.appendChild(installBtn);
  _installBanner.appendChild(closeBtn);

  shell.appendChild(_installBanner);
}

// Capture beforeinstallprompt early (before init)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
});

// ═══════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Service Worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/field/sw.js').catch(err => {
      console.log('[SW] Registration failed:', err);
    });
  });
}
})();
