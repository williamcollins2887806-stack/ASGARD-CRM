/**
 * ASGARD Field — App Init (auth guard, shell, theme)
 */
(() => {
'use strict';

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

  const content = Utils.el('div', {
    id: 'field-content',
    style: {
      flex:'1', overflowY:'auto', overflowX:'hidden',
      WebkitOverflowScrolling:'touch',
    },
  });

  shell.appendChild(content);
  app.appendChild(shell);

  // 3. Auth guard
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

  // Navigate to home or current hash
  const hash = window.location.hash.slice(1);
  if (!hash || hash === '/field/login' || hash === '/field') {
    Router.navigate('/field/home', { replace: true });
  } else {
    Router._render(hash);
  }
}

// Run when DOM ready
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
