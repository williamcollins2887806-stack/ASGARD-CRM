/**
 * API-клиент страницы /approvals.
 * Источник vanilla: public/assets/js/approvals.js (~641 строка, AsgardApprovalsPage).
 *
 * Бэк:
 *   GET  /api/estimates?status=<sent|approved|rework|question|rejected>
 *   GET  /api/estimates/:id  — полная карточка с calculation, documents
 *   POST /api/approval/estimates/:id/approve|rework|question|reject  body {comment}
 *   GET  /api/approval/estimates/:id/comments
 *   POST /api/approval/estimates/:id/comments  body {comment}
 *   GET  /api/users?role=PM
 */
import { api } from '@/api/client';

/* RBAC — синхронно с vanilla approvals.js строки 3, 221:
 * Просмотр и решения по очереди согласования доступны:
 *   - ADMIN (полные права)
 *   - DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV (директорские решения)
 *   - HEAD_TO (для просчётов с calculator_kind='to')
 * Список ролей в литералах нужен, чтобы скрипт rbac-audit видел их без раскрытия helper-функций. */
export const VIEW_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_TO'];
export const DECIDE_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export function canViewApprovals(user) {
  return VIEW_ROLES.includes(user?.role);
}
export function canDecideApprovals(user) {
  return DECIDE_ROLES.includes(user?.role);
}

export const APPROVAL_STATUSES = [
  { value: 'sent',      label: 'На согласовании', tone: 'sent',     color: 'var(--info)'   },
  { value: 'approved',  label: 'Согласована',     tone: 'approved', color: 'var(--ok)'     },
  { value: 'rework',    label: 'На доработке',    tone: 'question', color: 'var(--amber)'  },
  { value: 'question',  label: 'Вопрос',          tone: 'question', color: 'var(--purple)' },
  { value: 'rejected',  label: 'Отклонена',       tone: 'rejected', color: 'var(--err)'    },
  { value: 'cancelled', label: 'Отменена',        tone: 'draft',    color: 'var(--t-3)'    },
  { value: 'draft',     label: 'Черновик',        tone: 'draft',    color: 'var(--t-3)'    }
];

export function statusMeta(s) {
  return APPROVAL_STATUSES.find((x) => x.value === s) || APPROVAL_STATUSES[6];
}

export const MODE_OPTIONS = [
  { value: 'sent', label: 'Только на согласовании' },
  { value: 'all',  label: 'Все решения' }
];

export function loadEstimates(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 500));
  if (params.status) q.set('status', params.status);
  if (params.pm_id)  q.set('pm_id',  String(params.pm_id));
  return api(`/api/estimates?${q.toString()}`).then((d) => d.estimates || d.items || []).catch(() => []);
}

export function loadEstimateDetails(id) {
  return api(`/api/estimates/${id}`).then((d) => d.estimate || d);
}

/* Тендер — нужен для purchase_url («Открыть площадку» в DocsPack). */
export function loadTender(id) {
  if (!id) return Promise.resolve(null);
  return api(`/api/tenders/${id}`).then((d) => d.tender || d.item || d).catch(() => null);
}

/* Настройки приложения — vat_pct + пороги прибыли/чел-день (зелёная/жёлтая зона). */
export function loadAppSettings() {
  return api('/api/settings/app').then((d) => d?.value || d || {}).catch(() => ({}));
}

export function loadComments(id) {
  return api(`/api/approval/estimates/${id}/comments`)
    .then((d) => d.comments || [])
    .catch(() => []);
}

export function postComment(id, comment) {
  return api(`/api/approval/estimates/${id}/comments`, {
    method: 'POST',
    body: { comment }
  });
}

export function approveEstimate(id, comment = '') {
  return api(`/api/approval/estimates/${id}/approve`, {
    method: 'POST', body: { comment }
  });
}

export function reworkEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/rework`, {
    method: 'POST', body: { comment }
  });
}

export function questionEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/question`, {
    method: 'POST', body: { comment }
  });
}

export function rejectEstimate(id, comment) {
  return api(`/api/approval/estimates/${id}/reject`, {
    method: 'POST', body: { comment }
  });
}

export function loadPms() {
  return api('/api/users?role=PM&limit=200').then((d) => d.users || d.items || []).catch(() => []);
}

/* ─── helpers ─── */
export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/* Безопасный парсинг JSON-поля БД (приходит строкой или уже объектом). */
export function safeParseJSON(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    const parsed = JSON.parse(String(v));
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

/**
 * Светофор «прибыль/чел-день».
 * Пороги: norm — зелёная зона, min — жёлтая, ниже — красная.
 * Vanilla approvals.js:432-437.
 */
export function profitZone(profitPerDay, settings) {
  const min  = Number(settings?.calc?.min_profit_per_person_day  ?? settings?.min_profit_per_person_day  ?? 20000);
  const norm = Number(settings?.calc?.norm_profit_per_person_day ?? settings?.norm_profit_per_person_day ?? 25000);
  const p = Number(profitPerDay) || 0;
  if (p >= norm) return { code: 'green',  label: '🟢 ЗЕЛЁНАЯ ЗОНА', tone: 'success' };
  if (p >= min)  return { code: 'yellow', label: '🟡 ЖЁЛТАЯ ЗОНА',  tone: 'warn'    };
  return { code: 'red', label: '🔴 КРАСНАЯ ЗОНА', tone: 'danger' };
}

export function calcMargin(price, cost) {
  const p = Number(price);
  const c = Number(cost);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return Math.round(((p - c) / p) * 100);
}

export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((e) => {
    const c = (e.customer || e.customer_name || '').toLowerCase();
    const t = (e.title || e.tender_title || '').toLowerCase();
    const p = (e.pm_name || '').toLowerCase();
    return c.includes(lq) || t.includes(lq) || p.includes(lq) || String(e.id).includes(lq);
  });
}

export function filterByPm(items, pmId) {
  if (!pmId || pmId === 'all') return items;
  return items.filter((e) => String(e.pm_id || '') === String(pmId));
}
