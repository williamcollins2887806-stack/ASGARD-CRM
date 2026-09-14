/**
 * reportClientError — fire-and-forget отправка JS/API ошибок на /api/client-errors.
 * sendBeacon предпочтителен (не блокирует unload); fallback — fetch keepalive.
 * Не репортит 401/403 и ChunkLoadError.
 */

const ENDPOINT = '/api/client-errors';

function isChunkLoadError(msg) {
  const s = String(msg || '');
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module/i.test(s);
}

function pickToken() {
  try {
    return localStorage.getItem('field_token') || localStorage.getItem('asgard_token') || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ source: 'm'|'v2'|'vanilla', kind: 'js'|'rejection'|'boundary'|'api', message?: string, stack?: string, endpoint?: string, status?: number }} payload
 */
export function reportClientError(payload) {
  try {
    if (!payload || typeof payload !== 'object') return;
    const status = payload.status;
    if (status === 401 || status === 403) return;
    if (isChunkLoadError(payload.message) || isChunkLoadError(payload.stack)) return;

    const body = {
      source: payload.source || 'm',
      kind: payload.kind || 'js',
      message: String(payload.message || 'client error').slice(0, 500),
      stack: payload.stack ? String(payload.stack).slice(0, 2000) : undefined,
      url: typeof window !== 'undefined' ? String(window.location.href || '').slice(0, 300) : undefined,
      ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 300) : undefined,
      endpoint: payload.endpoint ? String(payload.endpoint).slice(0, 300) : undefined,
      status: typeof status === 'number' ? status : undefined,
    };

    const json = JSON.stringify(body);
    const token = pickToken();

    // sendBeacon не умеет кастомные заголовки — без токена ок (auth optional)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && !token) {
      const blob = new Blob([json], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: json,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throw from reporter */
  }
}

/** Подписка на window.onerror + unhandledrejection. Вызвать один раз при старте. */
export function installGlobalErrorListeners(source) {
  if (typeof window === 'undefined') return;
  if (window.__asgardClientErrorsInstalled) return;
  window.__asgardClientErrorsInstalled = true;

  window.addEventListener('error', (event) => {
    try {
      const err = event?.error;
      reportClientError({
        source,
        kind: 'js',
        message: err?.message || event?.message || 'window.error',
        stack: err?.stack,
      });
    } catch { /* noop */ }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event?.reason;
      const message = reason instanceof Error
        ? reason.message
        : (typeof reason === 'string' ? reason : 'unhandledrejection');
      const stack = reason instanceof Error ? reason.stack : undefined;
      reportClientError({ source, kind: 'rejection', message, stack });
    } catch { /* noop */ }
  });
}

export default reportClientError;
