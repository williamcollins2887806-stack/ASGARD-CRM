/**
 * Удалённый лог ТВ-клиента (D-413).
 *
 * Зачем: на телеке нет консоли, а adb по сети требует режим разработчика.
 * Поэтому клиент сам отправляет свои сообщения на наш сервер, а сервер пишет
 * их в journald как [TING-DIAG]. Я читаю их через `journalctl -u asgard-crm`
 * и вижу, что реально произошло при входе и включении камеры.
 *
 * Эндпоинт — существующий `/public/:code/client-log`: поле `line` сервер
 * логирует, остальное игнорирует. Ничего на сервере менять не нужно.
 *
 * Безопасность объёма: буфер ограничен, строка обрезается до 400 символов,
 * отправка пачками раз в 4 секунды, при ошибке — тихо пропускаем.
 */
import { API_BASE } from './api';

const MAX_BUFFER = 200;
const MAX_TEXT = 400;
const FLUSH_MS = 4000;
const PER_FLUSH = 6;

let roomCode = null;
let buffer = [];
let timer = null;
let installed = false;
let sending = false;

function toText(args) {
  const parts = [];
  for (const a of args) {
    try {
      if (a instanceof Error) parts.push(a.name + ': ' + a.message);
      else if (typeof a === 'object') parts.push(JSON.stringify(a));
      else parts.push(String(a));
    } catch (_) {
      parts.push('[object]');
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, MAX_TEXT);
}

function push(level, args) {
  try {
    buffer.push({ level, text: toText(args), ts: Date.now() });
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  } catch (_) { /* не роняем приложение из-за лога */ }
}

function flush() {
  if (sending || !roomCode || !buffer.length) return;
  const batch = buffer.splice(0, Math.min(PER_FLUSH, buffer.length));
  sending = true;
  (async () => {
    try {
      for (const item of batch) {
        const line = '[' + item.level + '] ' + item.text;
        await fetch(API_BASE + '/api/thing/public/' + encodeURIComponent(roomCode) + '/client-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: 'tv-log',
            surface: 'tv',
            device_class: 'tv',
            line,
          }),
        });
      }
    } catch (_) {
      /* офлайн — не критично, продолжм при следующем тике */
    } finally {
      sending = false;
    }
  })();
}

/** Задать код комнаты: логи начнут уходить после входа. */
export function setLogRoom(code) {
  const next = code ? String(code).trim().toLowerCase() : null;
  if (next === roomCode) return;
  roomCode = next;
  if (roomCode) {
    push('info', ['--- сессия логов начата ---']);
    flush();
  }
}

/** Сразу отправить накопленное (перед выходом). */
export function flushLogs() {
  flush();
}

/** Установить перехват консоли. Вызывать один раз, до рендера App. */
export function installRemoteLog() {
  if (installed) return;
  installed = true;

  const orig = {
    info: console.info ? console.info.bind(console) : () => {},
    warn: console.warn ? console.warn.bind(console) : () => {},
    error: console.error ? console.error.bind(console) : () => {},
  };

  console.info = (...a) => { push('info', a); orig.info(...a); };
  console.warn = (...a) => { push('warn', a); orig.warn(...a); };
  console.error = (...a) => { push('error', a); orig.error(...a); };

  /* Необработанные ошибки — самое важное, что нужно видеть. */
  try {
    const g = global.ErrorUtils;
    if (g && typeof g.setGlobalHandler === 'function') {
      const prev = g.getGlobalHandler && g.getGlobalHandler();
      g.setGlobalHandler((err, isFatal) => {
        push('fatal', [err && err.name, err && err.message, isFatal ? '(fatal)' : '']);
        flush();
        if (prev) prev(err, isFatal);
      });
    }
  } catch (_) { /* */ }

  if (!timer) timer = setInterval(flush, FLUSH_MS);
}
