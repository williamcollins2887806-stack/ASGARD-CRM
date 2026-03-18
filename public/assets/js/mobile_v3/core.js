/**
 * ASGARD CRM — Mobile Core v3.0
 * Архитектурное ядро мобильного фронтенда
 * Router, Layout, State, API, Gestures, Utils
 */

/* ── Lifecycle: стек открытых модалок (shared с components.js BottomSheet) ── */
var _asgardOpenModals = [];

/* ============================================================
   1. ROUTER — Hash-based SPA навигация
   ============================================================ */
const Router = (() => {
  const routes = {};
  const guards = [];
  const history = [];
  let historyIndex = -1;
  let currentRoute = null;
  let transitioning = false;
  let _historyNav = false;
  var _pageCleanups = [];

  /** Зарегистрировать cleanup-функцию текущей страницы (вызывается при навигации) */
  function onLeave(fn) {
    if (typeof fn === 'function') _pageCleanups.push(fn);
  }

  /** Выполнить все cleanup при смене страницы */
  function _runCleanups() {
    _pageCleanups.forEach(function(fn) { try { fn(); } catch(e) {} });
    _pageCleanups = [];
    // Закрыть все открытые модалки
    _asgardOpenModals.forEach(function(el) { try { el.remove(); } catch(e) {} });
    _asgardOpenModals = [];
    if (typeof Utils !== 'undefined' && typeof Utils.unlockScroll === 'function') Utils.unlockScroll();
    // Закрыть клавиатуру
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function register(path, loader) {
    // loader can be: a function (lazy import), or an object with render()
    if (typeof loader === 'function') {
      routes[path] = { loader, module: null };
    } else if (loader && typeof loader.render === 'function') {
      // Direct module object — store as already-loaded module
      routes[path] = { loader: null, module: loader };
    } else {
      routes[path] = { loader, module: null };
    }
  }

  function addGuard(fn) {
    guards.push(fn);
  }

  function parseHash(hash) {
    const clean = (hash || '#/').replace(/^#\/?/, '/');
    const qIdx = clean.indexOf('?');
    const path = qIdx >= 0 ? clean.substring(0, qIdx) : clean;
    const params = {};
    if (qIdx >= 0) {
      const qs = clean.substring(qIdx + 1);
      qs.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { path, params };
  }

  function findRoute(path) {
    if (routes[path]) return { route: routes[path], params: {} };
    // Pattern matching: /employee/:id
    for (const [pattern, route] of Object.entries(routes)) {
      const patternParts = pattern.split('/');
      const pathParts = path.split('/');
      if (patternParts.length !== pathParts.length) continue;
      const params = {};
      let match = true;
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
          params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }
      if (match) return { route, params };
    }
    return null;
  }

  async function navigate(path, opts = {}) {
    if (transitioning) return;
    const { replace = false, direction = 'auto', query = {} } = opts;

    // Build hash
    const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const hash = '#' + path + (qs ? '?' + qs : '');

    // Guards
    for (const guard of guards) {
      const allowed = await guard(path, currentRoute);
      if (!allowed) return;
    }

    if (replace) {
      window.location.replace(hash);
    } else {
      window.location.hash = hash;
    }
  }

  function back() {
    if (historyIndex > 0) {
      _historyNav = true;
      historyIndex--;
      const prev = history[historyIndex];
      navigate(prev.path, { replace: true, direction: 'back', query: prev.params });
    } else {
      navigate('/home', { replace: true, direction: 'back' });
    }
  }

  function forward() {
    if (historyIndex < history.length - 1) {
      _historyNav = true;
      historyIndex++;
      const next = history[historyIndex];
      navigate(next.path, { replace: true, direction: 'forward', query: next.params });
    }
  }

  async function handleRoute() {
    if (transitioning) return;
    transitioning = true;

    // Lifecycle: cleanup предыдущей страницы
    _runCleanups();

    const { path, params } = parseHash(window.location.hash);
    const found = findRoute(path);

    if (!found) {
      transitioning = false;
      navigate('/home', { replace: true });
      return;
    }

    const allParams = { ...params, ...found.params };

    // ── RBAC: проверка доступа по роли ──
    if (window.RoleAccess) {
      var _rbacUser = typeof Store !== 'undefined' ? Store.get('user') : null;
      var _rbacRole = _rbacUser && _rbacUser.role;
      if (_rbacRole && !RoleAccess.hasAccess(_rbacRole, path)) {
        currentRoute = path;
        Store.set('activeRoute', path);
        var _rbacContent = Layout.getContentZone();
        if (_rbacContent && typeof M !== 'undefined' && M.AccessDenied) {
          Array.from(_rbacContent.querySelectorAll('.asgard-page')).forEach(function(o) {
            o.classList.add('asgard-page-exit');
            setTimeout(function() { if (o.parentNode) o.remove(); }, 350);
          });
          Array.from(_rbacContent.children).forEach(function(c) {
            if (!c.classList.contains('asgard-page')) c.remove();
          });
          var _dp = document.createElement('div');
          _dp.className = 'asgard-page asgard-fade';
          _dp.appendChild(M.AccessDenied());
          _rbacContent.appendChild(_dp);
          _rbacContent.scrollTop = 0;
          window.scrollTo(0, 0);
        }
        transitioning = false;
        Layout.updateActiveTab();
        window.dispatchEvent(new CustomEvent('asgard:route', { detail: { path: path, params: allParams, denied: true } }));
        return;
      }
    }

    // Determine animation direction
    const prevIndex = historyIndex;
    const prevPath = currentRoute;

    // Update history (skip when navigating via back()/forward())
    if (_historyNav) {
      _historyNav = false;
    } else {
      if (historyIndex < history.length - 1) {
        history.splice(historyIndex + 1);
      }
      history.push({ path, params: allParams });
      historyIndex = history.length - 1;
    }

    // Load module lazily
    if (!found.route.module && typeof found.route.loader === 'function') {
      try {
        found.route.module = await found.route.loader();
      } catch (e) {
        console.error('[Router] Failed to load module:', path, e);
        transitioning = false;
        return;
      }
    }

    const direction = historyIndex <= prevIndex ? 'back' : 'forward';
    const isTabSwitch = isTabRoute(path) && isTabRoute(prevPath);
    const animClass = isTabSwitch ? 'asgard-fade' : (direction === 'back' ? 'asgard-slide-right' : 'asgard-slide-left');

    currentRoute = path;
    Store.set('activeRoute', path);

    // Render
    const content = Layout.getContentZone();
    if (content) {
      const newPage = document.createElement('div');
      newPage.className = 'asgard-page ' + animClass;

      // Chat pages manage their own scroll — disable page-level scroll
      const _chatRoutes = ['/messenger/', '/mimir'];
      if (_chatRoutes.some(function(r) { return path.indexOf(r) === 0 || path === r; })) {
        newPage.classList.add('asgard-page--chat');
      }

      try {
        const mod = found.route.module || found.route;
        if (mod && typeof mod.render === 'function') {
          const rendered = await mod.render(allParams);
          if (rendered instanceof HTMLElement) {
            newPage.appendChild(rendered);
          } else if (typeof rendered === 'string') {
            newPage.innerHTML = rendered;
          }
        }
      } catch (e) {
        console.error('[Router] Render error:', path, e);
        if (typeof M !== 'undefined' && M.ErrorBanner) {
          newPage.appendChild(M.ErrorBanner({ onRetry: function() { Router.navigate(path, { replace: true }); } }));
        } else {
          newPage.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-sec);font-size:13px">Не удалось загрузить</div>`;
        }
      }

      // Transition old page out, new page in
      // Remove ALL accumulated .asgard-page elements (not just first) + non-page children
      Array.from(content.querySelectorAll('.asgard-page')).forEach(old => {
        old.classList.add('asgard-page-exit');
        setTimeout(() => { if (old.parentNode) old.remove(); }, 350);
      });
      Array.from(content.children).forEach(child => {
        if (!child.classList.contains('asgard-page')) {
          child.remove();
        }
      });
      content.appendChild(newPage);

      // Scroll to top
      content.scrollTop = 0;
      window.scrollTo(0, 0);

      // Fire event
      window.dispatchEvent(new CustomEvent('asgard:route', { detail: { path, params: allParams } }));
    }

    transitioning = false;
  }

  const TAB_ROUTES = ['/home', '/tasks', '/messenger', '/more', '/mimir', '/pm-works'];
  function isTabRoute(path) {
    return TAB_ROUTES.includes(path);
  }

  function init() {
    window.addEventListener('hashchange', handleRoute);
    if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
      const user = Store.get('user');
      window.location.hash = (user && user.token) ? '#/home' : '#/welcome';
    }
    handleRoute();
  }

  function current() {
    return parseHash(window.location.hash);
  }

  function has(path) {
    return !!findRoute(path);
  }

  function forceRerender() { transitioning = false; handleRoute(); }

  return { register, addGuard, navigate, back, forward, init, current, parseHash, has, onLeave, forceRerender };
})();


/* ============================================================
   2. LAYOUT — Структура экрана
   ============================================================ */
const Layout = (() => {
  let shell = null;
  let headerZone = null;
  let contentZone = null;
  let tabBar = null;
  let overlayZone = null;
  let _routeHandler = null;

  function create() {
    shell = document.createElement('div');
    shell.id = 'asgard-shell';
    shell.className = 'asgard-shell';

    // Content zone (scrollable)
    contentZone = document.createElement('main');
    contentZone.id = 'asgard-content';
    contentZone.className = 'asgard-content';

    // Overlay zone
    overlayZone = document.createElement('div');
    overlayZone.id = 'asgard-overlay';
    overlayZone.className = 'asgard-overlay';

    // Tab bar
    tabBar = document.createElement('nav');
    tabBar.id = 'asgard-tabbar';
    tabBar.className = 'asgard-tabbar';

    shell.appendChild(contentZone);
    shell.appendChild(tabBar);
    shell.appendChild(overlayZone);

    // Replace body contents for mobile
    document.body.innerHTML = '';
    document.body.appendChild(shell);

    // Mark HTML element for CSS isolation from desktop styles
    document.documentElement.classList.add('asgard-mobile');

    // Disable desktop responsive.css — it has !important rules on button/input
    // that override our inline styles. Mobile v3 doesn't need it.
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (link.href && link.href.includes('responsive.css')) {
        link.disabled = true;
      }
    });

    // Portrait lock — rotate hint
    const rotateHint = document.createElement('div');
    rotateHint.className = 'asgard-rotate-hint';
    rotateHint.innerHTML = '<div style="font-size:48px;animation:asgardSpin 2s ease infinite">📱</div>'
      + '<div style="font-size:16px;font-weight:600">Поверните телефон</div>'
      + '<div style="font-size:13px;opacity:0.5">ASGARD CRM работает в портретном режиме</div>';
    document.body.appendChild(rotateHint);

    // Setup pull-to-refresh
    Gestures.setupPullToRefresh(contentZone);
    // Setup swipe-back
    Gestures.setupSwipeBack(contentZone);

    return shell;
  }

  function renderTabBar(config) {
    if (!tabBar) return;
    tabBar.innerHTML = '';
    tabBar.setAttribute('role', 'navigation');
    tabBar.setAttribute('aria-label', 'Навигация');

    config.forEach((tab, i) => {
      if (tab.type === 'fab') {
        // Mimir FAB button
        const fab = document.createElement('button');
        fab.className = 'asgard-tabbar__fab';
        fab.innerHTML = tab.icon;
        fab.setAttribute('aria-label', tab.label);
        fab.addEventListener('click', () => {
          if (tab.onClick) tab.onClick();
          else if (tab.href) Router.navigate(tab.href);
        });
        tabBar.appendChild(fab);
      } else {
        const btn = document.createElement('a');
        btn.className = 'asgard-tabbar__item';
        if (tab.label === 'Мимир') btn.classList.add('asgard-tabbar__item--mimir');
        btn.href = '#' + tab.href;
        btn.setAttribute('data-route', tab.href);
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');
        btn.innerHTML = `
          <span class="asgard-tabbar__icon">${tab.icon}</span>
          <span class="asgard-tabbar__label">${tab.label}</span>
          ${tab.badge ? `<span class="asgard-tabbar__badge">${tab.badge}</span>` : ''}
          <span class="asgard-tabbar__indicator"></span>
        `;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (tab.onClick) { tab.onClick(); return; }
          Router.navigate(tab.href);
        });
        tabBar.appendChild(btn);
      }
    });

    updateActiveTab();
    if (_routeHandler) window.removeEventListener('asgard:route', _routeHandler);
    _routeHandler = updateActiveTab;
    window.addEventListener('asgard:route', _routeHandler);
  }

  function updateActiveTab() {
    if (!tabBar) return;
    const current = Router.current().path;
    tabBar.querySelectorAll('.asgard-tabbar__item').forEach(item => {
      const route = item.getAttribute('data-route');
      const isActive = current === route;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-selected', String(isActive));
    });
  }

  // Мимир теперь на отдельной странице /mimir (pages/mimir.js)
  function openMimirChat() {
    Router.navigate('/mimir');
  }
  window.openMimirChat = openMimirChat;

  function getDefaultTabs() {
    return [
      { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', label: 'Главная', href: '/home' },
      { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>', label: 'Задачи', href: '/tasks' },
      { type: 'fab', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>', label: 'Хугин', href: '/messenger' },
      { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20 14.5 14.5 0 000-20"/><path d="M2 12h20"/></svg>', label: 'Мимир', href: '/mimir' },
      { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>', label: 'Ещё', href: '/more' },
    ];
  }

  function getPMTabs() {
    return getDefaultTabs();
  }

  function setBadge(route, count) {
    if (!tabBar) return;
    const item = tabBar.querySelector(`[data-route="${route}"]`);
    if (!item) return;
    let badge = item.querySelector('.asgard-tabbar__badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'asgard-tabbar__badge';
      item.appendChild(badge);
    }
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function getContentZone() { return contentZone; }
  function getOverlayZone() { return overlayZone; }
  function getTabBar() { return tabBar; }

  // Tab-bar hide/show for fullscreen pages (messenger chat, mimir)
  var _tabBarHidden = false;
  function hideTabBar() {
    _tabBarHidden = true;
    if (tabBar) tabBar.style.display = 'none';
    var content = getContentZone();
    if (content) content.style.paddingBottom = '0';
  }
  function showTabBar() {
    _tabBarHidden = false;
    if (tabBar) tabBar.style.display = '';
    var content = getContentZone();
    if (content) content.style.paddingBottom = '';
  }
  function isTabBarHidden() { return _tabBarHidden; }

  return { create, renderTabBar, getDefaultTabs, getPMTabs, setBadge, getContentZone, getOverlayZone, getTabBar, updateActiveTab, hideTabBar, showTabBar, isTabBarHidden };
})();


/* ============================================================
   3. STATE MANAGEMENT — Глобальный стор
   ============================================================ */
const Store = (() => {
  const state = {
    user: null,
    theme: 'dark',
    notifications: [],
    activeRoute: '/home',
    unreadMail: 0,
    unreadChat: 0,
  };

  const STORAGE_KEY = 'asgard_mobile_state';

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(state, parsed);
      }
    } catch (e) {
      console.warn('[Store] Failed to load state from localStorage:', e);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        user: state.user,
        theme: state.theme,
      }));
    } catch (e) { /* ignore */ }
  }

  function get(key) {
    return state[key];
  }

  function set(key, value) {
    const old = state[key];
    state[key] = value;
    if (old !== value) {
      window.dispatchEvent(new CustomEvent('asgard:state', { detail: { key, value, old } }));
      if (key === 'user' || key === 'theme') saveToStorage();
    }
  }

  function getAll() {
    return { ...state };
  }

  function on(key, callback) {
    const handler = (e) => {
      if (e.detail.key === key) callback(e.detail.value, e.detail.old);
    };
    window.addEventListener('asgard:state', handler);
    return () => window.removeEventListener('asgard:state', handler);
  }

  loadFromStorage();

  return { get, set, getAll, on };
})();


/* ============================================================
   4. IndexedDB — Хранение крупных данных
   ============================================================ */
const IDB = (() => {
  const DB_NAME = 'asgard_mobile';
  const DB_VERSION = 1;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains('cache')) {
          _db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!_db.objectStoreNames.contains('offline')) {
          _db.createObjectStore('offline', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function setItem(store, key, value) {
    const _db = await open();
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(store, 'readwrite');
      tx.objectStore(store).put({ key, value, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getItem(store, key) {
    const _db = await open();
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function removeItem(store, key) {
    const _db = await open();
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  return { open, setItem, getItem, removeItem };
})();


/* ============================================================
   5. API LAYER — Запросы к бэкенду
   ============================================================ */
const API = (() => {
  const BASE = window.ASGARD_API_BASE || '/api';
  const cache = new Map();
  const STALE_TIME = 30000; // 30s

  function getToken() {
    return localStorage.getItem('auth_token') || localStorage.getItem('asgard_token') || (Store.get('user') && Store.get('user').token) || '';
  }

  async function fetchAPI(endpoint, opts = {}) {
    const { method = 'GET', body, headers = {}, retry = 2, noCache = false, timeout = 15000 } = opts;

    const url = endpoint.startsWith('http') ? endpoint : BASE + endpoint;

    // Stale-while-revalidate for GET
    if (method === 'GET' && !noCache) {
      const cached = cache.get(url);
      if (cached && (Date.now() - cached.ts) < STALE_TIME) {
        // Revalidate in background
        if ((Date.now() - cached.ts) > STALE_TIME / 2) {
          fetchFresh(url, method, body, headers, timeout).then(data => {
            if (data) cache.set(url, { data, ts: Date.now() });
          }).catch(() => {});
        }
        return cached.data;
      }
    }

    return fetchWithRetry(url, method, body, headers, retry, timeout);
  }

  async function fetchWithRetry(url, method, body, headers, retries, timeout) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await fetchFresh(url, method, body, headers, timeout);
        if (method === 'GET') {
          cache.set(url, { data, ts: Date.now() });
        }
        return data;
      } catch (err) {
        if (err.status === 401) {
          // Try token refresh
          const refreshed = await refreshToken();
          if (refreshed && attempt < retries) continue;
          // Redirect to login
          Router.navigate('/welcome', { replace: true });
          throw err;
        }
        if (err.status === 403) {
          // Access denied — don't retry
          throw err;
        }
        if (attempt === retries) throw err;
        // Exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  }

  async function fetchFresh(url, method, body, headers, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getToken(),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const err = new Error(`HTTP ${resp.status}`);
        err.status = resp.status;
        try { err.body = await resp.json(); } catch (_) {}
        throw err;
      }

      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return await resp.json();
      }
      return await resp.text();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  async function refreshToken() {
    try {
      const resp = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getToken(),
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.token) {
          localStorage.setItem('auth_token', data.token);
          const user = Store.get('user');
          if (user) Store.set('user', { ...user, token: data.token });
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function clearCache(pattern) {
    if (!pattern) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.includes(pattern)) cache.delete(key);
    }
  }

  // SSE subscriptions
  function subscribe(endpoint, onMessage) {
    const url = (endpoint.startsWith('http') ? endpoint : BASE + endpoint) + '?token=' + getToken();
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch (_) {
        onMessage(e.data);
      }
    };

    es.onerror = () => {
      // Reconnect after 3s
      setTimeout(() => {
        es.close();
        subscribe(endpoint, onMessage);
      }, 3000);
    };

    return () => es.close();
  }

  /**
   * Extract rows array from any API response.
   * Backend uses dynamic keys: { tenders: [...] }, { works: [...] }, { notifications: [...] }, etc.
   * This function finds the first array in the response object.
   */
  function extractRows(d) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    // Try common keys first
    var commonKeys = ['items', 'data', 'rows', 'notifications', 'works', 'tenders', 'users',
      'estimates', 'permits', 'emails', 'tasks', 'sheets', 'employees', 'events', 'chats',
      'messages', 'comments', 'files', 'documents', 'connections', 'requests'];
    for (var i = 0; i < commonKeys.length; i++) {
      if (d[commonKeys[i]] && Array.isArray(d[commonKeys[i]])) return d[commonKeys[i]];
    }
    // Fallback: find first array value in response
    var keys = Object.keys(d);
    for (var j = 0; j < keys.length; j++) {
      if (Array.isArray(d[keys[j]])) return d[keys[j]];
    }
    return [];
  }

  function fetchCached(table, apiPath, opts) {
    var raw = opts && opts.raw;
    return fetchAPI(apiPath).then(function (d) {
      var rows = raw ? d : extractRows(d);
      if (!raw && typeof AsgardDB !== 'undefined' && AsgardDB.putAll && Array.isArray(rows) && rows.length) {
        AsgardDB.putAll(table, rows).catch(function () {});
      }
      return rows;
    }).catch(function (e) {
      console.error('[fetchCached] ' + table + ' failed:', e && e.message || e);
      if (typeof AsgardDB !== 'undefined' && AsgardDB.getAll) {
        return AsgardDB.getAll(table).then(function (d) { return d || (raw ? {} : []); }).catch(function () { return raw ? {} : []; });
      }
      return raw ? {} : [];
    });
  }

  return { fetch: fetchAPI, fetchCached: fetchCached, clearCache, subscribe, getToken, extractRows, BASE };
})();


/* ============================================================
   5b. SSE MANAGER — Singleton SSE connection
   ============================================================ */
var SSEManager = (function() {
  var _es = null;
  var _listeners = new Map(); // event → Set of callbacks
  var _retryDelay = 1000;
  var _retryTimer = null;
  var _connected = false;
  var _connCallbacks = [];

  function connect() {
    if (_es && _es.readyState !== 2) return; // already connected or connecting
    var token = API.getToken();
    if (!token) return;
    try {
      _es = new EventSource('/api/sse/stream?token=' + token);
      _es.onopen = function() {
        _connected = true;
        _retryDelay = 1000;
        _connCallbacks.forEach(function(cb) { try { cb(true); } catch(e) {} });
      };
      _es.onerror = function() {
        _connected = false;
        if (_es) { try { _es.close(); } catch(e) {} _es = null; }
        _connCallbacks.forEach(function(cb) { try { cb(false); } catch(e) {} });
        clearTimeout(_retryTimer);
        _retryTimer = setTimeout(function() {
          if (navigator.onLine !== false) connect();
        }, _retryDelay + Math.random() * 1000);
        _retryDelay = Math.min(_retryDelay * 2, 30000);
      };
      // Wire all registered listeners to new EventSource
      _listeners.forEach(function(cbs, evt) {
        _es.addEventListener(evt, function(e) {
          var data;
          try { data = JSON.parse(e.data); } catch(_) { data = e.data; }
          cbs.forEach(function(cb) { try { cb(data); } catch(err) {} });
        });
      });
    } catch(e) { _connected = false; }
  }

  function on(event, callback) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(callback);
    // If ES already active, add listener directly
    if (_es && _es.readyState !== 2) {
      _es.addEventListener(event, function handler(e) {
        var data;
        try { data = JSON.parse(e.data); } catch(_) { data = e.data; }
        callback(data);
      });
    }
    // Return unsubscribe function
    return function off() {
      var set = _listeners.get(event);
      if (set) set.delete(callback);
    };
  }

  function onConnection(cb) {
    _connCallbacks.push(cb);
    return function() { _connCallbacks = _connCallbacks.filter(function(c) { return c !== cb; }); };
  }

  function isConnected() { return _connected; }

  function disconnect() {
    clearTimeout(_retryTimer);
    if (_es) { try { _es.close(); } catch(e) {} _es = null; }
    _connected = false;
  }

  // Auto-connect when online, auto-reconnect
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function() { if (!_connected) connect(); });
    window.addEventListener('offline', function() { _connected = false; _connCallbacks.forEach(function(cb) { try { cb(false); } catch(e) {} }); });
  }

  return { connect: connect, on: on, onConnection: onConnection, isConnected: isConnected, disconnect: disconnect };
})();


/* ============================================================
   6. GESTURES — Touch-жесты
   ============================================================ */
const Gestures = (() => {
  function setupPullToRefresh(container) {
    let startY = 0;
    let pulling = false;
    let indicator = null;

    container.addEventListener('touchstart', (e) => {
      if (container.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && dy < 150 && container.scrollTop === 0) {
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'asgard-ptr';
          indicator.innerHTML = '<div class="asgard-ptr__spinner"></div>';
          container.prepend(indicator);
        }
        const progress = Math.min(dy / 80, 1);
        indicator.style.height = dy + 'px';
        indicator.style.opacity = progress;
        indicator.querySelector('.asgard-ptr__spinner').style.transform = `rotate(${dy * 3}deg)`;
      }
    }, { passive: true });

    container.addEventListener('touchend', () => {
      if (indicator) {
        const h = parseInt(indicator.style.height) || 0;
        if (h > 80) {
          // Trigger refresh
          indicator.classList.add('asgard-ptr--refreshing');
          window.dispatchEvent(new CustomEvent('asgard:refresh'));
          setTimeout(() => {
            if (indicator) {
              indicator.remove();
              indicator = null;
            }
          }, 1500);
        } else {
          indicator.remove();
          indicator = null;
        }
      }
      pulling = false;
    }, { passive: true });
  }

  function setupSwipeBack(container) {
    let startX = 0;
    let startY = 0;
    let swiping = false;

    container.addEventListener('touchstart', (e) => {
      const x = e.touches[0].clientX;
      if (x < 35) { // Edge swipe zone
        startX = x;
        startY = e.touches[0].clientY;
        swiping = true;
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > 50) { swiping = false; return; }
      if (dx > 20) {
        const page = container.querySelector('.asgard-page');
        if (page) {
          page.style.transform = `translateX(${dx}px)`;
          page.style.opacity = 1 - (dx / 400);
        }
      }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (!swiping) return;
      swiping = false;
      const page = container.querySelector('.asgard-page');
      if (page) {
        const transform = page.style.transform;
        const match = transform.match(/translateX\((\d+(?:\.\d+)?)px\)/);
        const dx = match ? parseInt(match[1]) : 0;
        if (dx > 70) {
          page.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
          page.style.transform = 'translateX(100%)';
          page.style.opacity = '0';
          setTimeout(() => Router.back(), 300);
        } else {
          page.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
          page.style.transform = 'translateX(0)';
          page.style.opacity = '1';
          setTimeout(() => { page.style.transition = ''; }, 300);
        }
      }
    }, { passive: true });
  }

  function setupSwipeActions(element, actions) {
    let startX = 0;
    let dx = 0;
    let actionsPanel = null;
    const maxSwipe = actions.length * 72;

    element.style.position = 'relative';
    element.style.overflow = 'hidden';

    const inner = document.createElement('div');
    inner.className = 'asgard-swipe-inner';
    inner.style.borderRadius = 'inherit';
    while (element.firstChild) inner.appendChild(element.firstChild);
    element.appendChild(inner);

    // Actions panel
    actionsPanel = document.createElement('div');
    actionsPanel.className = 'asgard-swipe-actions';
    actionsPanel.style.borderRadius = '0 inherit inherit 0';
    actionsPanel.style.overflow = 'hidden';
    actionsPanel.style.visibility = 'hidden';
    actions.forEach((action, idx) => {
      const btn = document.createElement('button');
      btn.className = 'asgard-swipe-action';
      btn.style.background = action.color || 'var(--red)';
      // Round the last button to match card corner
      if (idx === actions.length - 1) {
        btn.style.borderRadius = '0 16px 16px 0';
      }
      btn.textContent = action.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        resetSwipe();
      });
      actionsPanel.appendChild(btn);
    });
    element.appendChild(actionsPanel);

    inner.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      dx = 0;
      inner.style.transition = '';
    }, { passive: true });

    inner.addEventListener('touchmove', (e) => {
      dx = startX - e.touches[0].clientX;
      if (dx > 5) {
        actionsPanel.style.visibility = 'visible';
      }
      if (dx > 0 && dx <= maxSwipe) {
        inner.style.transform = `translateX(${-dx}px)`;
      }
    }, { passive: true });

    inner.addEventListener('touchend', () => {
      if (dx > maxSwipe / 2) {
        inner.style.transition = 'transform 0.3s ease';
        inner.style.transform = `translateX(${-maxSwipe}px)`;
      } else {
        resetSwipe();
      }
      dx = 0;
    }, { passive: true });

    function resetSwipe() {
      inner.style.transition = 'transform 0.3s ease';
      inner.style.transform = 'translateX(0)';
      setTimeout(() => { actionsPanel.style.visibility = 'hidden'; }, 300);
    }
  }

  function onLongPress(element, callback, duration = 500) {
    let timer = null;
    let moved = false;

    element.addEventListener('touchstart', (e) => {
      moved = false;
      timer = setTimeout(() => {
        if (!moved) {
          if (navigator.vibrate) navigator.vibrate(30);
          callback(e);
        }
      }, duration);
    }, { passive: true });

    element.addEventListener('touchmove', () => { moved = true; clearTimeout(timer); }, { passive: true });
    element.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
    element.addEventListener('touchcancel', () => clearTimeout(timer), { passive: true });
  }

  return { setupPullToRefresh, setupSwipeBack, setupSwipeActions, onLongPress };
})();


/* ============================================================
   7. UTILITIES — Форматирование, debounce, scroll
   ============================================================ */
const Utils = (() => {
  // Date formatting
  function formatDate(date, format = 'short') {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');

    const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    switch (format) {
      case 'full': return `${day}.${month}.${year} ${hours}:${mins}`;
      case 'date': return `${day}.${month}.${year}`;
      case 'short': return `${day} ${MONTHS[d.getMonth()]}`;
      case 'shortYear': return `${day} ${MONTHS[d.getMonth()]} ${year}`;
      case 'time': return `${hours}:${mins}`;
      case 'relative': return relativeTime(d);
      default: return `${day}.${month}.${year}`;
    }
  }

  function relativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (secs < 60) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    if (hours < 24) return `${hours} ч назад`;
    if (days === 1) return 'вчера';
    if (days < 7) return `${days} дн назад`;
    return formatDate(date, 'short');
  }

  // Currency formatting
  function formatMoney(value, opts = {}) {
    const { short = false, sign = false, currency = '₽' } = opts;
    const num = Number(value) || 0;
    const prefix = sign && num > 0 ? '+' : '';

    if (short) {
      if (Math.abs(num) >= 1e9) return prefix + (num / 1e9).toFixed(1).replace(/\.0$/, '') + ' млрд ' + currency;
      if (Math.abs(num) >= 1e6) return prefix + (num / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн ' + currency;
      if (Math.abs(num) >= 1e3) return prefix + (num / 1e3).toFixed(0) + ' тыс ' + currency;
      return prefix + num.toFixed(0) + ' ' + currency;
    }

    return prefix + new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ' + currency;
  }

  // Number formatting
  function formatNumber(value, opts = {}) {
    const { short = false, decimals = 0 } = opts;
    const num = Number(value) || 0;

    if (short) {
      if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(1) + ' млрд';
      if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(1) + ' млн';
      if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(1) + ' тыс';
    }

    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: decimals }).format(num);
  }

  // Debounce
  function debounce(fn, ms = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // Throttle
  function throttle(fn, ms = 100) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        return fn.apply(this, args);
      }
    };
  }

  // Infinite scroll
  function infiniteScroll(container, callback, opts = {}) {
    const { threshold = 200 } = opts;
    let loading = false;

    const handler = throttle(() => {
      if (loading) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        loading = true;
        Promise.resolve(callback()).finally(() => { loading = false; });
      }
    }, 200);

    container.addEventListener('scroll', handler, { passive: true });
    return () => container.removeEventListener('scroll', handler);
  }

  // Keyboard-aware scroll + hide tab bar
  function keyboardAwareScroll() {
    if (!window.visualViewport) return;

    window.visualViewport.addEventListener('resize', () => {
      const focused = document.activeElement;
      const keyboardOpen = window.innerHeight - window.visualViewport.height > 150;
      document.body.classList.toggle('keyboard-open', keyboardOpen);

      // Hide tab-bar when keyboard opens (globally), restore only if page didn't hide it
      var tb = Layout.getTabBar();
      if (tb) {
        if (keyboardOpen) {
          tb.style.display = 'none';
        } else if (!Layout.isTabBarHidden()) {
          tb.style.display = '';
        }
      }

      // Scroll chat messages to bottom when keyboard opens
      if (keyboardOpen) {
        setTimeout(function() {
          var msgArea = document.querySelector('.asgard-mimir-messages, .huginn-messages');
          if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
        }, 300);
      }

      // Scroll form inputs into view (not for chat — chat uses flex)
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) {
        if (!focused.closest('.huginn-composer, .asgard-mimir-composer')) {
          setTimeout(() => {
            focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }
    });
  }

  // Generate unique ID
  function uid(prefix = 'a') {
    return prefix + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Plural forms for Russian
  function plural(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    const n1 = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (n1 > 1 && n1 < 5) return few;
    if (n1 === 1) return one;
    return many;
  }

  // Deep clone
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Safe querySelector
  function $(selector, parent = document) {
    return parent.querySelector(selector);
  }

  function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
  }

  // Create element helper
  function el(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') element.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
      else if (key === 'innerHTML') element.innerHTML = value;
      else if (key === 'textContent') element.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      }
      else element.setAttribute(key, value);
    }
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (children instanceof HTMLElement) {
      element.appendChild(children);
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (child instanceof HTMLElement) element.appendChild(child);
        else if (typeof child === 'string') element.appendChild(document.createTextNode(child));
      });
    }
    return element;
  }

  // Scroll lock for modals (ref-counted)
  function lockScroll() {
    const count = parseInt(document.body.dataset.scrollLocked || '0') + 1;
    document.body.dataset.scrollLocked = count;
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    const count = parseInt(document.body.dataset.scrollLocked || '1') - 1;
    document.body.dataset.scrollLocked = Math.max(0, count);
    if (count <= 0) { document.body.style.overflow = ''; }
  }

  return {
    formatDate, relativeTime, formatMoney, formatNumber,
    debounce, throttle, infiniteScroll, keyboardAwareScroll,
    uid, plural, clone, $, $$, el, lockScroll, unlockScroll,
  };
})();


/* ============================================================
   8. APP INIT — Инициализация приложения
   ============================================================ */
const App = (() => {
  let initialized = false;

  /**
   * Determine if mobile shell should take over.
   * Returns true on mobile devices / narrow screens when MOBILE_V3_ENABLED is not false.
   */
  function shouldUseMobile() {
    const flags = window.ASGARD_FLAGS || {};
    if (flags.MOBILE_V3_ENABLED === false) return false;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const hasTouch = 'ontouchstart' in window;

    // Если явно включено — активировать для мобильных устройств
    if (flags.MOBILE_V3_ENABLED === true) return isMobile || (hasTouch && window.innerWidth <= 1024);

    // Авто-детект: мобильное устройство + тач
    return isMobile && hasTouch;
  }

  async function init() {
    if (initialized) return;

    // Only activate mobile shell on mobile devices
    if (!shouldUseMobile()) return;

    initialized = true;

    // ── Disable desktop CSS — proper isolation, no overrides needed ──
    // Desktop stylesheets are <link> tags loaded in index.html.
    // On mobile they conflict with DS.js styles (z-index, fonts, layouts).
    // Setting link.disabled = true is a standard DOM API — clean and reversible.
    const desktopCSS = [
      'design-tokens.css', 'components.css', 'layout.css',
      'app.css', 'responsive.css', 'my-mail.css'
    ];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (desktopCSS.some(name => href.includes(name))) {
        link.disabled = true;
      }
    });

    // Inject design system styles
    if (typeof DS !== 'undefined' && DS.injectStyles) {
      DS.injectStyles();
    }

    // Safari 100vh fix: --vh CSS custom property
    function _setVH() {
      document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
    }
    _setVH();
    window.addEventListener('resize', _setVH);

    // iOS anti-zoom: prevent pinch-zoom and double-tap zoom
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.content = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
    document.body.style.touchAction = 'pan-x pan-y';
    document.documentElement.style.touchAction = 'pan-x pan-y';
    document.body.style.webkitTextSizeAdjust = '100%';

    // Подхватить системную тему при загрузке (если пользователь не выбрал вручную)
    if (typeof DS !== 'undefined' && DS.setTheme) {
      if (!localStorage.getItem('asgard_theme')) {
        var _prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        DS.setTheme(_prefersDark ? 'dark' : 'light');
      }
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem('asgard_theme')) {
          DS.setTheme(e.matches ? 'dark' : 'light');
        }
      });
    }

    // Create layout (replaces body contents — desktop app.js won't run after this)
    Layout.create();

    // Auth guard
    Router.addGuard((path) => {
      const publicRoutes = ['/login', '/register', '/welcome', '/test', '/test-table', '/test2'];
      if (publicRoutes.includes(path)) return true;
      const user = Store.get('user');
      if (!user || !user.token) {
        Router.navigate('/welcome', { replace: true });
        return false;
      }
      return true;
    });

    // Setup tab bar based on role
    const user = Store.get('user');
    const role = user && user.role;
    const isPM = role === 'PM' || role === 'HEAD_PM' || role === 'DIRECTOR';
    Layout.renderTabBar(isPM ? Layout.getPMTabs() : Layout.getDefaultTabs());

    // Keyboard-aware
    Utils.keyboardAwareScroll();

    // Re-render current page on theme change
    window.addEventListener('asgard:theme', () => {
      Router.forceRerender();
    });

    // SSE notifications
    if (user && user.token) {
      API.subscribe('/sse/notifications', (data) => {
        if (data.type === 'mail') {
          Store.set('unreadMail', data.count || 0);
          Layout.setBadge('/my-mail', data.count || 0);
        }
        if (data.type === 'notification') {
          Store.set('notifications', [...(Store.get('notifications') || []), data]);
        }
      });
    }

    // Listen for role changes
    Store.on('user', (u) => {
      if (!u) return;
      Layout.renderTabBar(Layout.getDefaultTabs());
    });

    // Auth routes (auth.js must be loaded)
    if (typeof WelcomePage !== 'undefined') {
      Router.register('/welcome',  { render: () => WelcomePage.render() });
    }
    if (typeof LoginPage !== 'undefined') {
      Router.register('/login',    { render: () => LoginPage.render() });
    }
    if (typeof RegisterPage !== 'undefined') {
      Router.register('/register', { render: () => RegisterPage.render() });
    }

    // Mimir page — redirect legacy route to /mimir
    Router.register('/mimir-page', {
      render: function () {
        Router.navigate('/mimir', { replace: true });
        return document.createElement('div');
      }
    });

    // Home page — registered by dashboard.js via Router.register('/home', DashboardPage)

    // Hide tab bar on auth pages, show on app pages
    window.addEventListener('asgard:route', (e) => {
      const authPaths = ['/welcome', '/login', '/register'];
      const isAuth = authPaths.includes(e.detail.path);
      document.body.classList.toggle('auth-active', isAuth);
      const tb = Layout.getTabBar();
      if (tb) tb.style.display = isAuth ? 'none' : '';
      const content = Layout.getContentZone();
      if (content) {
        content.style.paddingBottom = isAuth ? '0' : '';
        content.style.overflow = isAuth ? 'hidden' : '';
      }
    });

    // Test routes
    if (typeof TestPage !== 'undefined') {
      Router.register('/test', { render: (params) => TestPage.render(params) });
    }
    if (typeof TestTablePage !== 'undefined') {
      Router.register('/test-table', { render: (params) => TestTablePage.render(params) });
    }

    // Init router
    Router.init();
  }

  return { init, shouldUseMobile };
})();

// Global exports
if (typeof window !== 'undefined') {
  window.Router = Router;
  window.Layout = Layout;
  window.Store = Store;
  window.IDB = IDB;
  window.API = API;
  window.Gestures = Gestures;
  window.Utils = Utils;
  window.App = App;
}

// Auto-initialization: всегда ждём DOMContentLoaded — defer-скрипты выполняются до него
document.addEventListener('DOMContentLoaded', () => App.init());
