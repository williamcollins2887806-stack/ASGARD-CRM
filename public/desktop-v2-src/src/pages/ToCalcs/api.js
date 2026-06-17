/**
 * API-клиент страницы /to-calcs — «Просчёты ТО» (inbox).
 * Источник: vanilla `public/assets/js/to_calcs.js` (306 строк).
 *
 * Бэк-эндпоинты (реальные, из `src/routes/`):
 *   GET  /api/tenders?limit=2000              — все тендеры (фильтрация на клиенте по calculator_kind='to')
 *   GET  /api/estimates?tender_id=N          — оценки по тендеру
 *   GET  /api/tkp?tender_id=N                — ТКП по тендеру
 *   POST /api/approval/estimates/:id/send       — отправить просчёт на согласование HEAD_TO
 *   POST /api/approval/estimates/:id/resubmit   — переотправить после rework/question
 *   POST /api/tkp/:id/send                       — отправить КП клиенту
 */
import { api } from '@/api/client';

export const TENDER_STATUS_TONES = {
  'Отправлено на просчёт': 'info',
  'Согласование ТКП': 'purple',
  'ТКП согласовано': 'ok',
  'Готово к отправке КП': 'gold',
  'КП отправлено': 'cyan',
  'Выиграли': 'ok',
  'Проиграли': 'err'
};

export const APPROVAL_TONES = {
  draft:    { tone: 'grey',   label: 'Черновик' },
  sent:     { tone: 'info',   label: 'На согласовании у Рук. ТО' },
  approved: { tone: 'ok',     label: 'Согласовано' },
  rework:   { tone: 'orange', label: 'На доработке' },
  question: { tone: 'amber',  label: 'Вопрос' },
  rejected: { tone: 'err',    label: 'Отклонено' }
};

export function loadTenders() {
  return api('/api/tenders?limit=2000').then((d) => d.tenders || d.items || []);
}

export function loadEstimatesForTender(tenderId) {
  return api(`/api/estimates?tender_id=${tenderId}`)
    .then((d) => d.estimates || d.items || [])
    .catch(() => []);
}

export function loadTkpsForTender(tenderId) {
  return api(`/api/tkp?tender_id=${tenderId}`)
    .then((d) => d.items || d.tkps || [])
    .catch(() => []);
}

/**
 * Загружает по списку тендеров последний estimate и последний ТКП параллельно.
 * Возвращает { estMap, tkpMap } — Map<tenderId, estimate|tkp|null>.
 */
export async function loadAggregates(tenderIds) {
  if (!tenderIds.length) return { estMap: new Map(), tkpMap: new Map() };
  const estPromises = tenderIds.map((id) =>
    loadEstimatesForTender(id).then((arr) => {
      const last = arr.slice().sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
      return [id, last];
    })
  );
  const tkpPromises = tenderIds.map((id) =>
    loadTkpsForTender(id).then((arr) => {
      const last = arr.slice().sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
      return [id, last];
    })
  );
  const [estPairs, tkpPairs] = await Promise.all([
    Promise.all(estPromises),
    Promise.all(tkpPromises)
  ]);
  return {
    estMap: new Map(estPairs.filter(([, v]) => v)),
    tkpMap: new Map(tkpPairs.filter(([, v]) => v))
  };
}

export function sendEstimateForApproval(estimateId) {
  return api(`/api/approval/estimates/${estimateId}/send`, { method: 'POST' });
}

export function resubmitEstimate(estimateId) {
  return api(`/api/approval/estimates/${estimateId}/resubmit`, { method: 'POST' });
}

export function sendKpToCustomer(tkpId) {
  return api(`/api/tkp/${tkpId}/send`, { method: 'POST', body: {} });
}

/**
 * Бакеты (этапы воронки) для отображения тендеров ТО по статусу.
 */
export function bucketOf(tender) {
  const s = tender.tender_status;
  if (['Отправлено на просчёт', 'Согласование ТКП'].includes(s)) return 'calc';
  if (s === 'ТКП согласовано') return 'tkp';
  if (s === 'Готово к отправке КП') return 'send';
  return 'other';
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n) || +n <= 0) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}
