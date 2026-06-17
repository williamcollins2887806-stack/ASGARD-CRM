/**
 * API-клиент страницы /diag.
 *
 * Источники:
 *   • vanilla `public/assets/js/diag.js` (заглушала локальную IndexedDB — устарело)
 *   • backend `src/routes/admin-system.js`:
 *       GET    /api/admin/system/health      — RAM/Disk/CPU/DB/uptime/active_users/proc_mem
 *       GET    /api/admin/system/updates     — список релизов (app_updates)
 *       GET    /api/admin/system/crm-info    — техпаспорт CRM
 *       POST   /api/admin/system/action      — { action: 'restart' | 'bump-version' }
 *       GET    /api/admin/system/logs?lines=300&level=all
 *
 * RBAC: только ADMIN (см. adminOnly preHandler в admin-system.js).
 */
import { api } from '@/api/client';

export const ADMIN_ROLE = 'ADMIN';

export function loadHealth() {
  return api('/api/admin/system/health');
}

export function loadUpdates() {
  return api('/api/admin/system/updates').then((d) => d?.updates || []);
}

export function loadCrmInfo() {
  return api('/api/admin/system/crm-info').then((d) => d?.info || {});
}

export function loadLogs({ lines = 200, level = 'all' } = {}) {
  return api(
    `/api/admin/system/logs?lines=${encodeURIComponent(lines)}&level=${encodeURIComponent(level)}`
  ).then((d) => d?.logs || []);
}

export function runAction(action, command) {
  const body = { action };
  if (command) body.command = command;
  return api('/api/admin/system/action', { method: 'POST', body });
}

/* ── helpers ──────────────────────────────────────────────────────────── */
export function fmtBytes(n) {
  if (n === null || n === undefined || !Number.isFinite(+n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = +n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(v) : v.toFixed(1)) + ' ' + u[i];
}

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
  } catch {
    return '—';
  }
}

export function severityTone(pct) {
  if (!Number.isFinite(+pct)) return 'info';
  const v = +pct;
  if (v >= 90) return 'danger';
  if (v >= 75) return 'warn';
  return 'success';
}
