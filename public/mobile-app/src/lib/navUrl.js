/**
 * Нормализация URL из push / in-app уведомлений в путь React Router (basename `/m`).
 * Примеры:
 *   /m/director-tender-approvals?id=1 → /director-tender-approvals?id=1
 *   #/director-tender-approvals?id=1 → /director-tender-approvals?id=1
 *   https://asgard-crm.ru/m/alerts → /alerts
 */
export function normalizeMobileNavUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s === '/') return '/';

  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.pathname + u.search + u.hash;
    }
  } catch {
    /* keep as-is */
  }

  if (s.startsWith('#')) {
    s = s.slice(1);
  }
  if (s.startsWith('#/')) {
    s = s.slice(1);
  }
  // hash-routing: /#/path or path#/path
  const hashIdx = s.indexOf('#/');
  if (hashIdx >= 0) {
    s = s.slice(hashIdx + 1);
  }

  if (!s.startsWith('/')) s = `/${s}`;

  if (s === '/m' || s.startsWith('/m/')) {
    s = s.slice(2) || '/';
  }
  if (!s.startsWith('/')) s = `/${s}`;

  // Drop absolute desktop-only shells that aren't mobile routes
  if (s === '/index.html' || s.startsWith('/v2/')) return '/';

  return s;
}

const PIN_RETURN_KEY = 'asgard_pin_return';

export function savePinReturnTo(path) {
  if (!path || path === '/pin' || path.startsWith('/pin?')) return;
  try {
    sessionStorage.setItem(PIN_RETURN_KEY, path);
  } catch { /* ignore */ }
}

export function takePinReturnTo(fallback = '/') {
  try {
    const v = sessionStorage.getItem(PIN_RETURN_KEY);
    sessionStorage.removeItem(PIN_RETURN_KEY);
    if (v && v !== '/pin') return v;
  } catch { /* ignore */ }
  return fallback;
}
