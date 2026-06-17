/**
 * API-клиент страницы /funnel — воронка тендеров.
 * Источник истины — vanilla `public/assets/js/funnel.js` (456 строк).
 *
 * Endpoint'ы:
 *   GET  /api/tenders?limit=1000   — все тендеры
 *   GET  /api/tenders/transition-map — карта разрешённых переходов для роли
 *   GET  /api/tenders/archive-reasons — категории отсева
 *   POST /api/tenders/:id/archive  — отсеять (статус «Не подходит»)
 *   POST /api/tenders/:id/unarchive — вернуть из архива
 *   PUT  /api/tenders/:id          — смена статуса
 */
import { api } from '@/api/client';

/* 11 стадий воронки — 10 по статусам тендеров (зеркало TENDER_TRANSITIONS) + completed
   для тендеров, чья работа уже завершена (vanilla funnel.js:236-238 ставит stage='completed').
   Используем кириллические статусы из БД (см. src/routes/tenders.js). */
export const STAGES = [
  { id: 'draft',     label: 'Черновики',            color: '#6c757d', statuses: ['Черновик'] },
  { id: 'new',       label: 'Новые',                color: '#5b8def', statuses: ['Новый', 'На анализе'] },
  { id: 'calc',      label: 'На просчёте',          color: '#f39c12', statuses: ['Отправлено на просчёт'] },
  { id: 'approval',  label: 'Согласование',         color: '#e67e22', statuses: ['Согласование ТКП'] },
  { id: 'approved',  label: 'Просчёт согласован',   color: '#27ae60', statuses: ['ТКП согласовано'] },
  { id: 'kp_ready',  label: 'Готово к отправке КП', color: '#c8a84e', statuses: ['Готово к отправке КП'] },
  { id: 'sent',      label: 'КП отправлено',        color: '#17a2b8', statuses: ['КП отправлено'] },
  { id: 'won',       label: 'Выиграли',             color: '#2ecc71', statuses: ['Выиграли'] },
  { id: 'completed', label: 'Завершено',            color: '#0ea5a4', statuses: [] },
  { id: 'lost',      label: 'Проиграли',            color: '#e74c3c', statuses: ['Проиграли'] },
  { id: 'rejected',  label: 'Не подходит',          color: '#95a5a6', statuses: ['Не подходит'] }
];

export function getStageForStatus(status) {
  if (!status) return 'new';
  for (const stage of STAGES) {
    if (stage.statuses.includes(status)) return stage.id;
  }
  return 'new';
}

/**
 * Статусы работ, считающиеся «завершёнными» (vanilla funnel.js:236
 * проверял == 'Завершена'; на проде также встречаются «Закрыт»/«Закрыта»/
 * «Работы сдали» — все они означают окончание контракта).
 */
const COMPLETED_WORK_STATUSES = new Set(['Завершена', 'Завершен', 'Закрыт', 'Закрыта', 'Работы сдали']);

export function isCompletedWorkStatus(status) {
  return COMPLETED_WORK_STATUSES.has(String(status || '').trim());
}

export function loadTenders(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 1000));
  return api(`/api/tenders?${q.toString()}`, { method: 'GET' }).then((d) => d.tenders || d.items || []);
}

/**
 * Загружаем работы для определения стадии «Завершено» в воронке.
 * Vanilla funnel.js:225-238 матчит tender→work по tender_id.
 */
export function loadWorks(params = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit ?? 1000));
  return api(`/api/works?${q.toString()}`, { method: 'GET' })
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

export function loadTransitionMap() {
  return api('/api/tenders/transition-map', { method: 'GET' })
    .catch(() => ({ transitions: {}, can_move: false }));
}

export function loadArchiveReasons() {
  return api('/api/tenders/archive-reasons', { method: 'GET' })
    .then((d) => d.reasons || d.items || [])
    .catch(() => []);
}

/**
 * POST /api/tenders/:id/archive — отсев тендера. Vanilla передаёт `reason` и `comment`.
 * См. funnel.js:402.
 */
export function postArchive(tenderId, payload) {
  return api(`/api/tenders/${tenderId}/archive`, {
    method: 'POST',
    body: {
      reason: payload?.reason || null,
      comment: payload?.comment || ''
    }
  });
}

/**
 * POST /api/tenders/:id/unarchive — возврат из архива. Vanilla передаёт `comment`.
 * См. funnel.js:410.
 */
export function postUnarchive(tenderId, payload) {
  return api(`/api/tenders/${tenderId}/unarchive`, {
    method: 'POST',
    body: {
      comment: payload?.comment || ''
    }
  });
}

/**
 * PUT /api/tenders/:id — смена статуса/полей тендера. Vanilla передаёт `tender_status`
 * + опционально `reject_reason`, `winner_name`, `contract_sum`, `status_comment`.
 * См. funnel.js:422.
 */
export function putTender(tenderId, payload) {
  return api(`/api/tenders/${tenderId}`, {
    method: 'PUT',
    body: {
      tender_status: payload?.tender_status,
      reject_reason: payload?.reject_reason ?? null,
      winner_name: payload?.winner_name ?? null,
      contract_sum: payload?.contract_sum ?? null,
      status_comment: payload?.status_comment ?? null
    }
  });
}

/* Сумма тендера — приоритет: contract_value (после выигрыша) → tender_price → 0 */
export function tenderSum(t) {
  return Number(t.contract_value || t.tender_price || t.estimated_sum || 0) || 0;
}

export function fmtMoney(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
}
