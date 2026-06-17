/**
 * useGlobalSSE — единое глобальное SSE-подключение к /api/sse/stream.
 *
 * Архитектура:
 *   • Singleton на табе через window.__asgardGlobalSSE — несколько монтирований
 *     хука (Strict Mode, re-mounts при HMR) НЕ создают второй EventSource.
 *   • Каждое серверное событие диспатчится как CustomEvent('asgard:<channel>')
 *     на window. Любая страница/модалка подписывается через
 *     window.addEventListener('asgard:chat:new_message', e => e.detail).
 *   • Auto-reconnect 5с после error (если соединение разорвано без logout).
 *   • При logout/unmount Protected — closeAndCleanup() рвёт соединение и
 *     удаляет window.__asgardGlobalSSE.
 *
 * Каналы (полный список из backend src/routes/sse.js + chat_groups.js):
 *   notification, tender:new, tender:status_changed, tender:assigned,
 *   chat:new_message, chat:message_edited, chat:message_deleted,
 *   chat:typing, chat:reaction,
 *   call:incoming, call:ended,
 *   presence:online, presence:offline,
 *   pre_tender:new, pre_tender:updated, pre_tender:accepted, pre_tender:rejected.
 *
 * Reference: public/mobile-app/src/hooks/useSSE.js (точечный chat-канал),
 * public/assets/js/app.js:2621-2702 (vanilla v1 глобальный SSE).
 */
import { useEffect } from 'react';

const DEBUG = typeof import.meta !== 'undefined' && import.meta?.env?.DEV;

// Полный список каналов, которые мы слушаем глобально.
// Серверные event-имена приходят как `type` поля в SSEMessage (см. src/routes/sse.js).
const SSE_CHANNELS = [
  'notification',
  'tender:new',
  'tender:status_changed',
  'tender:assigned',
  'chat:new_message',
  'chat:message_edited',
  'chat:message_deleted',
  'chat:typing',
  'chat:reaction',
  'chat:estimate_updated',
  'call:incoming',
  'call:connected',
  'call:ended',
  'call:agi_event',
  'presence:online',
  'presence:offline',
  'pre_tender:new',
  'pre_tender:updated',
  'pre_tender:accepted',
  'pre_tender:rejected'
];

function readToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

/**
 * Открыть глобальный singleton EventSource. Если уже открыт — возвращает
 * существующий контроллер. Контроллер хранит ссылку на EventSource и
 * умеет cleanup.
 */
function openGlobalSSE() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null;
  if (window.__asgardGlobalSSE && window.__asgardGlobalSSE.es) {
    // уже открыт — переиспользуем
    return window.__asgardGlobalSSE;
  }

  const token = readToken();
  if (!token) return null;

  const ctrl = {
    es: null,
    reconnectTimer: null,
    stopped: false,
    handlers: {}
  };

  const connect = () => {
    if (ctrl.stopped) return;
    const t = readToken();
    if (!t) return; // токена нет — не пытаемся
    let es;
    try {
      es = new EventSource('/api/sse/stream?token=' + encodeURIComponent(t));
    } catch (e) {
      if (DEBUG) console.warn('[useGlobalSSE] EventSource ctor failed', e);
      return;
    }
    ctrl.es = es;

    SSE_CHANNELS.forEach((ch) => {
      const handler = (ev) => {
        let detail = null;
        try { detail = ev.data ? JSON.parse(ev.data) : null; } catch { detail = ev.data; }
        if (DEBUG) console.debug('[useGlobalSSE]', ch, detail);
        try {
          window.dispatchEvent(new CustomEvent('asgard:' + ch, { detail }));
        } catch (e) {
          if (DEBUG) console.warn('[useGlobalSSE] dispatch failed', ch, e);
        }
      };
      ctrl.handlers[ch] = handler;
      es.addEventListener(ch, handler);
    });

    // Диспатчим 'asgard:sse:reconnected' при УСПЕШНОМ переподключении
    // (после хотя бы одного onerror). На первом open после ctor — не шлём
    // (это не reconnect, это первичный коннект).
    es.addEventListener('open', () => {
      if (ctrl.wasError) {
        ctrl.wasError = false;
        try { window.dispatchEvent(new CustomEvent('asgard:sse:reconnected')); } catch { /* noop */ }
      }
    });

    es.onerror = () => {
      if (DEBUG) console.warn('[useGlobalSSE] error, reconnecting in 5s');
      ctrl.wasError = true;
      try { es.close(); } catch { /* noop */ }
      ctrl.es = null;
      if (ctrl.stopped) return;
      if (ctrl.reconnectTimer) clearTimeout(ctrl.reconnectTimer);
      ctrl.reconnectTimer = setTimeout(() => {
        ctrl.reconnectTimer = null;
        connect();
      }, 5000);
    };
  };

  ctrl.close = () => {
    ctrl.stopped = true;
    if (ctrl.reconnectTimer) { clearTimeout(ctrl.reconnectTimer); ctrl.reconnectTimer = null; }
    if (ctrl.es) { try { ctrl.es.close(); } catch { /* noop */ } ctrl.es = null; }
  };

  window.__asgardGlobalSSE = ctrl;
  connect();
  return ctrl;
}

/**
 * closeGlobalSSE — корректное закрытие соединения (вызывается на logout/unmount).
 */
export function closeGlobalSSE() {
  if (typeof window === 'undefined') return;
  const ctrl = window.__asgardGlobalSSE;
  if (!ctrl) return;
  try { ctrl.close(); } catch { /* noop */ }
  try { delete window.__asgardGlobalSSE; } catch { window.__asgardGlobalSSE = null; }
}

/**
 * Хук-обёртка: открывает SSE при первом монтировании компонента
 * (после успешного логина — внутри Protected), закрывает при размонтировании.
 * Singleton-логика внутри openGlobalSSE гарантирует, что повторные вызовы
 * не открывают второе соединение.
 */
export function useGlobalSSE(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const ctrl = openGlobalSSE();
    return () => {
      // Не закрываем сразу — Protected может перемонтироваться при навигации.
      // Закрытие выполняется в logout() (useAuth) и в beforeunload.
      // Здесь оставляем соединение живым между маршрутами.
      void ctrl;
    };
  }, [enabled]);
}

// При закрытии вкладки рвём соединение явно — браузер обычно это делает сам,
// но на всякий случай.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    closeGlobalSSE();
  });
}
