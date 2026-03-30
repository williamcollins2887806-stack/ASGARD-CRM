/**
 * ASGARD Field — Core (Router, API, Utils, Store)
 */
(() => {
'use strict';

// ─── Store ─────────────────────────────────────────────────────────────
const Store = {
  get(key) { try { return JSON.parse(localStorage.getItem('field_' + key)); } catch { return null; } },
  set(key, val) { localStorage.setItem('field_' + key, JSON.stringify(val)); },
  remove(key) { localStorage.removeItem('field_' + key); },
};

// ─── API ───────────────────────────────────────────────────────────────
const API_BASE = '/api/field';

const API = {
  getToken() { return localStorage.getItem('field_token'); },
  setToken(t) { localStorage.setItem('field_token', t); },
  clearToken() { localStorage.removeItem('field_token'); },

  async fetch(path, opts = {}) {
    const token = API.getToken();
    const url = path.startsWith('http') ? path : API_BASE + path;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const fetchOpts = { method: opts.method || 'GET', headers };
    if (opts.body && fetchOpts.method !== 'GET') {
      fetchOpts.body = JSON.stringify(opts.body);
    }

    try {
      const resp = await window.fetch(url, fetchOpts);
      if (resp.status === 401) {
        API.clearToken();
        Router.navigate('/field/login');
        return null;
      }
      const data = await resp.json();
      data._status = resp.status;
      data._ok = resp.ok;
      return data;
    } catch (err) {
      console.error('[API]', path, err);
      return null;
    }
  },

  post(path, body) { return API.fetch(path, { method: 'POST', body }); },
  put(path, body) { return API.fetch(path, { method: 'PUT', body }); },

  async upload(path, formData) {
    const token = API.getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      const resp = await window.fetch(API_BASE + path, { method: 'POST', headers, body: formData });
      return await resp.json();
    } catch (err) {
      console.error('[API upload]', err);
      return null;
    }
  },
};

// ─── Utils ─────────────────────────────────────────────────────────────
const Utils = {
  el(tag, props, ...children) {
    const element = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'style' && typeof v === 'object') {
          Object.assign(element.style, v);
        } else if (k === 'className') {
          element.className = v;
        } else if (k === 'innerHTML') {
          element.innerHTML = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          element.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.assign(element.dataset, v);
        } else {
          element.setAttribute(k, v);
        }
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        element.appendChild(document.createTextNode(String(child)));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    }
    return element;
  },

  formatMoney(amount) {
    if (amount == null) return '0';
    const n = parseFloat(amount);
    if (isNaN(n)) return '0';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  },

  formatDateFull(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  },

  formatPhone(phone) {
    if (!phone) return '';
    const d = phone.replace(/\D/g, '');
    if (d.length === 11) {
      return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`;
    }
    return phone;
  },

  formatHours(h) {
    if (h == null) return '0ч';
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return mins > 0 ? `${hrs}ч ${mins}мин` : `${hrs}ч`;
  },

  greeting() {
    const h = new Date().getHours();
    if (h < 6) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  },

  todayStr() {
    const d = new Date();
    return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  },

  debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  },

  vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 50);
  },

  async sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  countUp(el, target, duration) {
    const start = performance.now();
    const from = 0;
    const to = parseFloat(target) || 0;
    function tick(now) {
      const progress = Math.min((now - start) / (duration || 900), 1);
      const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = Math.round(from + (to - from) * ease);
      el.textContent = Utils.formatMoney(current);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  },
};

// ─── Router ────────────────────────────────────────────────────────────
const routes = {};
let currentRoute = null;

const Router = {
  register(path, page) {
    routes[path] = page;
  },

  navigate(path, opts = {}) {
    if (path !== window.location.hash.slice(1)) {
      if (opts.replace) {
        window.history.replaceState(null, '', '#' + path);
      } else {
        window.location.hash = path;
      }
    } else {
      Router._render(path);
    }
  },

  async _render(path) {
    const container = document.getElementById('field-content');
    if (!container) return;

    // Find route
    let page = routes[path];
    if (!page) {
      // Try matching patterns like /field/money/:id
      for (const [pattern, pg] of Object.entries(routes)) {
        const regex = new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$');
        const match = path.match(regex);
        if (match) {
          page = pg;
          page._params = match.slice(1);
          break;
        }
      }
    }

    if (!page) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--f-textSec)">404 — Страница не найдена</div>';
      return;
    }

    currentRoute = path;

    try {
      const el = await page.render(page._params);
      container.replaceChildren(el);
    } catch (err) {
      console.error('[Router] render error:', err);
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--f-red)">Ошибка загрузки страницы</div>';
    }
  },

  getCurrentRoute() { return currentRoute; },
};

window.addEventListener('hashchange', () => {
  const path = window.location.hash.slice(1) || '/field/login';
  Router._render(path);
});

// ─── Exports ───────────────────────────────────────────────────────────
window.Store = Store;
window.API = API;
window.Utils = Utils;
window.Router = Router;
})();
