/**
 * Ting TV — нативный клиент зала на React Native.
 *
 * Зачем отдельный клиент: WebView на Android TV открывает микрофон, но
 * получает цифровую тишину (логи с телека: «MIC published» → «MIC level=0.0000»).
 * Это ограничение системного WebView, а не нашего кода. React Native — нативный
 * процесс, звук идёт через AudioRecord, как у TrueConf.
 */

export const API_BASE = 'https://asgard-crm.ru';

export const TOKENS = {
  bg: '#0A0C10',
  surface: '#11151C',
  surfaceHi: '#1A2230',
  line: '#232B38',
  text: '#F4F6F8',
  textMuted: '#B0B8C4',
  gold: '#C8A84E',
  goldSoft: 'rgba(200,168,78,0.16)',
  danger: '#E05A5A',
  live: '#4CC38A',
};

export const TYPE = {
  title: 42,
  h1: 32,
  h2: 24,
  body: 18,
  small: 15,
  tiny: 13,
};

export const HALL_MODES = {
  wait: { tiles: 1 },
  spot: { tiles: 1 },
  'spot-rail': { tiles: 2 },
  dual: { tiles: 2 },
  g3: { tiles: 9 },
  g4: { tiles: 12 },
  g5: { tiles: 15 },
};

/**
 * Раскладка зала по числу удалённых участников. Повторяет логику
 * веб-версии (hallModeFor), чтобы поведение не разошлось.
 */
export function hallModeFor(remoteCount, hasScreenShare) {
  if (hasScreenShare) return 'share';
  if (remoteCount <= 0) return 'wait';
  if (remoteCount === 1) return 'spot';
  if (remoteCount === 2) return 'dual';
  if (remoteCount <= 7) return 'spot-rail';
  if (remoteCount <= 9) return 'g3';
  if (remoteCount <= 12) return 'g4';
  return 'g5';
}

/** Сетка зала: колонки/строки для режима. */
export function gridFor(mode) {
  switch (mode) {
    case 'dual': return { cols: 2, rows: 1 };
    case 'g3': return { cols: 3, rows: 3 };
    case 'g4': return { cols: 4, rows: 3 };
    case 'g5': return { cols: 5, rows: 3 };
    default: return { cols: 1, rows: 1 };
  }
}

/** Инициалы для заглушки. */
export function initials(name) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Запрос к бэкенду. Токен и PIN передаются в теле, не в URL. */
export async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* не JSON */ }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return json || {};
}

export async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  let json = null;
  try { json = await res.json(); } catch (_) { /* не JSON */ }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return json || {};
}

export const ENDPOINTS = {
  meta: (code) => '/api/thing/public/' + encodeURIComponent(code),
  lobbyStatus: (code) => '/api/thing/public/' + encodeURIComponent(code) + '/lobby-status',
  guestToken: (code) => '/api/thing/public/' + encodeURIComponent(code) + '/guest-token',
  leave: (code) => '/api/thing/public/' + encodeURIComponent(code) + '/leave',
  clientLog: (code) => '/api/thing/public/' + encodeURIComponent(code) + '/client-log',
};
