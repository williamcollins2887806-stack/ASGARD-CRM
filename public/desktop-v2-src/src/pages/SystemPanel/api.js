/**
 * API-клиент страницы /system-panel.
 *
 * Источник истины:
 *   • backend `src/routes/admin-system.js` (prefix /api/admin/system)
 *   • backend `src/routes/app-updates.js` (для расширенного списка релизов)
 *   • backend `src/routes/mimir.js`       (/api/mimir/stats)
 *   • backend `src/routes/push.js`        (/api/push/badge-count)
 *
 * Доступ — только ADMIN (adminOnly preHandler в admin-system.js).
 */
import { api } from '@/api/client';

export const ADMIN_ROLE = 'ADMIN';

/* ── Server / Health ────────────────────────────────────────────────────── */
export function loadHealth() {
  return api('/api/admin/system/health');
}

export function loadCrmInfo() {
  return api('/api/admin/system/crm-info').then((d) => d?.info || {});
}

export function loadAiConfig() {
  return api('/api/admin/system/ai-config').catch(() => null);
}

/* ── Logs ───────────────────────────────────────────────────────────────── */
export function loadLogs({ lines = 300, level = 'all' } = {}) {
  return api(
    `/api/admin/system/logs?lines=${encodeURIComponent(lines)}&level=${encodeURIComponent(level)}`
  ).then((d) => d?.logs || []);
}

/**
 * Открытие SSE-потока логов. Токен передаётся в query.
 * @param {(line: {line:string, sev:string, ts:string}) => void} onLine
 * @returns EventSource — кому-то нужно вызвать close()
 */
export function openLogStream(onLine, onError) {
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const url = `/api/admin/system/logs/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  es.onmessage = (ev) => {
    try { onLine(JSON.parse(ev.data)); } catch { /* noop */ }
  };
  if (onError) es.onerror = onError;
  return es;
}

/* ── Actions ────────────────────────────────────────────────────────────── */
export function runAction(action, command) {
  const body = { action };
  if (command) body.command = command;
  return api('/api/admin/system/action', { method: 'POST', body });
}

/* ── Deploys / Updates ──────────────────────────────────────────────────── */
export function loadDeploys(limit = 30) {
  return api(`/api/admin/system/updates`).then((d) => {
    const list = d?.updates || [];
    return list.slice(0, limit);
  });
}

/* ── Mimir stats (общая статистика AI) ──────────────────────────────────── */
export function loadMimirStats() {
  return api('/api/mimir/stats').catch(() => null);
}

/**
 * Кост по агентам Conductor (выкл. при отсутствии — graceful):
 *   • mimir-conductor runs (последние 50)
 *   • суммарный usage (input/output tokens) за период
 */
export async function loadMimirConductorStats() {
  try {
    // Используем существующий /api/mimir/conductor/* если есть — иначе null.
    // (Эндпоинт /runs может быть закрыт ролями.)
    const r = await api('/api/mimir/conductor/runs?limit=20');
    return r;
  } catch {
    return null;
  }
}

/* ── Утилиты ────────────────────────────────────────────────────────────── */
export function fmtMb(mb) {
  if (!Number.isFinite(+mb)) return '—';
  const v = +mb;
  if (v >= 1024) return (v / 1024).toFixed(1) + ' GB';
  return Math.round(v) + ' MB';
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU');
  } catch { return '—'; }
}

export function severityTone(pct) {
  if (!Number.isFinite(+pct)) return 'info';
  const v = +pct;
  if (v >= 90) return 'danger';
  if (v >= 75) return 'warn';
  return 'success';
}

export function pct(val, total) { return total > 0 ? Math.round(val / total * 100) : 0; }
