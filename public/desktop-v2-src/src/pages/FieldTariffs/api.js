/**
 * API-клиент страницы /field-tariffs — Тарифная сетка Полевого модуля.
 *
 * Источник: vanilla `public/assets/js/field-tariffs.js` +
 * backend `src/routes/field-manage.js` (prefix `/api/field/manage`).
 *
 * Endpoint'ы:
 *   GET    /api/field/manage/tariffs?category=all  — список тарифов
 *   POST   /api/field/manage/tariffs               — создать (ADMIN)
 *   PUT    /api/field/manage/tariffs/:id           — обновить (ADMIN)
 *   DELETE /api/field/manage/tariffs/:id           — soft-delete (ADMIN)
 *
 * RBAC: ADMIN.
 */
import { api } from '@/api/client';

export const SETTINGS_ROLES = ['ADMIN'];

export const CATEGORY_LABELS = {
  mlsp:        'МЛСП (морские)',
  ground:      'Наземные (обычные)',
  ground_hard: 'Наземные (тяжёлые)',
  warehouse:   'Склад/база',
  special:     'Специальные',
};

export const CATEGORY_ORDER = ['mlsp', 'ground', 'ground_hard', 'warehouse', 'special'];

export const CATEGORY_OPTIONS = [
  { value: 'mlsp',        label: 'МЛСП (морские)' },
  { value: 'ground',      label: 'Наземные (обычные)' },
  { value: 'ground_hard', label: 'Наземные (тяжёлые)' },
  { value: 'warehouse',   label: 'Склад/база' },
  { value: 'special',     label: 'Специальные' },
];

export const DEFAULT_POINT_VALUE = 500;

/**
 * GET /api/field/manage/tariffs — список тарифов.
 * Бэкенд отдаёт `{ tariffs, specials, point_value }`. Возвращаем в исходной форме
 * чтобы страница могла сама собрать единый список и сгруппировать по категории.
 */
export function loadTariffs() {
  return api('/api/field/manage/tariffs?category=all').then((d) => ({
    tariffs: d?.tariffs || [],
    specials: d?.specials || [],
    point_value: d?.point_value ?? DEFAULT_POINT_VALUE,
  }));
}

export function createTariff(payload) {
  return api('/api/field/manage/tariffs', { method: 'POST', body: payload });
}

export function updateTariff(id, payload) {
  const _id = encodeURIComponent(id);
  return api(`/api/field/manage/tariffs/${_id}`, { method: 'PUT', body: payload });
}

export function deleteTariff(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/field/manage/tariffs/${_id}`, { method: 'DELETE' });
}

/* ── Хелперы форматирования ──────────────────────────────────────────────── */

export function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat || '—';
}

export function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}
