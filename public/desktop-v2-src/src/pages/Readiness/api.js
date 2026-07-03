/**
 * Readiness — API helpers.
 *
 * Backend: src/routes/work-readiness.js — endpoints:
 *   GET    /api/work-readiness/:workId                 → полная карта 7 этапов
 *   GET    /api/work-readiness/summary?ids=1,2,3       → батч {workId:{slim}}
 *   POST   /api/work-readiness/:workId/override        → закрыть этап вручную
 *   DELETE /api/work-readiness/:workId/override/:stage → снять override
 *
 *   GET    /api/works                                  → список работ (для PM фильтр my=1; HEAD/dir видят все)
 *   GET    /api/users?role=PM&is_active=true           → список РП для группировки (директор)
 */
import { api } from '@/api/client';
// 23.06.2026 BUG-FIX (Sites D-M10/D-M11): единые статусы из helpers/work-status.
import { PREP_SET, isClosedWork } from '@/helpers/work-status';

/* Статусы «в подготовке» (Set re-export для совместимости с .has()). */
export const PREP_STATUSES = PREP_SET;

export function isClosed(workStatus) {
  return isClosedWork(workStatus);
}

export function isPrep(workStatus) {
  return PREP_STATUSES.has(workStatus || '');
}

/* Роли, которым доступна страница РП. */
export const PM_PAGE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
/* Роли руководителей (страница директора + override любых работ). */
export const DIRECTOR_PAGE_ROLES = ['ADMIN', 'HEAD_PM', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];
/* Роли, которые могут принудительно закрывать этап. */
export const OVERRIDE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_COMM', 'DIRECTOR_GEN', 'DIRECTOR_DEV'];

export function canOverride(role) {
  return OVERRIDE_ROLES.includes(role);
}

export function isDirectorRole(role) {
  return DIRECTOR_PAGE_ROLES.includes(role);
}

/* ── Works ─────────────────────────────────────────────────────────────── */

export async function loadWorks({ my = false } = {}) {
  // /api/works — на проде возвращает { works:[...] } (или items, реже массив)
  const qs = new URLSearchParams();
  qs.set('limit', '1000');
  if (my) qs.set('my', 'true');
  const r = await api('/api/works?' + qs.toString());
  return r?.works || r?.items || (Array.isArray(r) ? r : []);
}

/* ── Users (для группировки по РП на странице директора) ──────────────── */

export async function loadPMs() {
  const r = await api('/api/users?role=PM&is_active=true&limit=500').catch(() => ({}));
  return r?.users || r?.items || [];
}

/* ── Work readiness ────────────────────────────────────────────────────── */

export async function loadSummary(ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return {};
  const r = await api('/api/work-readiness/summary?ids=' + list.join(','));
  return r || {};
}

export async function loadFullReadiness(workId) {
  return api('/api/work-readiness/' + workId);
}

export function setOverride(workId, stage, forced = true, note) {
  return api('/api/work-readiness/' + workId + '/override', {
    method: 'POST',
    body: { stage, forced_done: forced, note: note || null }
  });
}

export function clearOverride(workId, stage) {
  return api('/api/work-readiness/' + workId + '/override/' + stage, { method: 'DELETE' });
}

/* ── Хелперы для UI ────────────────────────────────────────────────────── */

export function daysLeft(dateStr) {
  if (!dateStr) return null;
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.round((dt.getTime() - Date.now()) / 86400000);
}

/** Цвет кольца готовности — общий между PM/director. */
export function readyColor(pct) {
  if (pct >= 80) return 'var(--ok)';
  if (pct >= 50) return 'var(--amber)';
  return 'var(--err)';
}

/** Светофор по РП: 🔴 горящие (есть hot), 🟡 средняя <70%, иначе 🟢. */
export function trafficLight(avg, hot) {
  if (hot > 0) return '🔴';
  if (avg < 70) return '🟡';
  return '🟢';
}
