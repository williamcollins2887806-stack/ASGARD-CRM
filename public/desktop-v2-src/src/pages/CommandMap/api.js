/* API для /command-map. */
import { api } from '@/api/client';

export const ALLOWED_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM', 'HEAD_TO'];

export const cmapMap     = () => api('/api/command-map');
export const cmapFlights = () => api('/api/command-map/flights');
export const cmapLive    = () => api('/api/command-map/live');
export const cmapSummary = () => api('/api/director-summary');
export const cmapSiteCrew = (id) => api('/api/command-map/site/' + id + '/crew');

/* E-6b: медицинские карты вахтовиков (vanilla command-map.js:4). */
export const cmapMedical = () => api('/api/command-map/medical').catch(() => null);

/* E-6b: табель присутствия офиса (vanilla command-map.js:5). */
export const cmapPresenceBoard = () => api('/api/daily-presence/board').catch(() => null);

/* E-6b: SSE-поток live-событий. Возвращает EventSource; presence:online/offline.
 *
 * onerror-handler: при разрыве соединения переподключаемся через 5с,
 * и при успешном реконнекте вызываем onSnapshotRefresh() — это нужно потому,
 * что во время «провала» сети мы могли пропустить delta-события, и состояние
 * на UI расходится с сервером. Полная перезагрузка снапшота закрывает gap.
 *
 * @param {() => void} onPresenceChange  — debounce-callback на presence-event
 * @param {() => void} [onSnapshotRefresh] — вызов после успешного реконнекта
 */
export function openLiveStream(onPresenceChange, onSnapshotRefresh) {
  if (typeof window === 'undefined') return { close() {} };
  // Используем единый глобальный SSE-канал (useGlobalSSE). Не открываем
  // второй EventSource — глобальный хук в App.jsx уже шлёт CustomEvent
  // 'asgard:presence:online/offline' на window. Reconnect+snapshot-refresh
  // полностью внутри useGlobalSSE; здесь только debounce-проксирование.
  let debounce = null;
  const presenceHandler = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { try { onPresenceChange?.(); } catch { /* noop */ } }, 800);
  };
  window.addEventListener('asgard:presence:online', presenceHandler);
  window.addEventListener('asgard:presence:offline', presenceHandler);

  // Slabe refresh-сигнал: если onSnapshotRefresh передан, дёргаем его
  // на первый presence-event (после реконнекта useGlobalSSE дойдёт сюда же).
  let firstRefreshDone = false;
  const refreshHandler = () => {
    if (firstRefreshDone) return;
    firstRefreshDone = true;
    try { onSnapshotRefresh?.(); } catch { /* noop */ }
  };
  // Эвент пометки «соединение пере-открыто» — диспатчится глобальным хуком
  // в момент reconnect. Если хук не шлёт его — refreshHandler не вызовется,
  // что безопасно (CommandMap всё равно периодически poll'ит снапшот).
  window.addEventListener('asgard:sse:reconnected', refreshHandler);

  return {
    close() {
      clearTimeout(debounce);
      window.removeEventListener('asgard:presence:online', presenceHandler);
      window.removeEventListener('asgard:presence:offline', presenceHandler);
      window.removeEventListener('asgard:sse:reconnected', refreshHandler);
    }
  };
}

export const fmtMln = (v) => {
  if (v == null) return '—';
  const sign = v < 0 ? '−' : '';
  return sign + Math.abs(Number(v)).toLocaleString('ru', { maximumFractionDigits: 1 }) + ' млн ₽';
};

export const fmtDT = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
