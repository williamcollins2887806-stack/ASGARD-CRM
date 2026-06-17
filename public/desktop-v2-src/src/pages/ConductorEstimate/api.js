/**
 * API-клиент War Room Conductor.
 * Источник: vanilla `public/conductor-estimate.html` + `public/assets/js/mimir-conductor-ui.js` (1178 строк).
 * Backend: src/routes/mimir-conductor.js — /api/mimir/conductor/*.
 *
 *   Роли: ADMIN/PM/HEAD_PM/TO/HEAD_TO/DIRECTOR_*
 */
import { api } from '@/api/client';

const API = '/api/mimir/conductor';

// Полный набор фаз (32 агента).
export const PHASES = {
  'Фаза 0 · Глубокое понимание задачи': ['document_parser', 'work_scope_researcher'],
  'Фаза 1 · Контекст': ['tz_analyst', 'drawings_reader', 'gatekeeper'],
  'Фаза 2 · Декомпозиция и нормативы': ['contract_decomposer', 'resource_planner', 'method_validator', 'site_conditions', 'norms_compliance'],
  'Фаза 3 · Стоимость': ['warehouse_matcher', 'market_search', 'procurement_analyzer', 'crew_composer', 'labor_calculator', 'routing_planner', 'travel_pricer', 'permits_planner', 'consumables_calculator', 'pre_mob_calculator', 'site_access_planner', 'standby_estimator'],
  'Фаза 4 · Спец-условия': ['marine_permits', 'quality_control_planner', 'warranty_reserve'],
  'Фаза 5 · Контроль и отчёт': ['indirects_calculator', 'risk_quantifier', 'historical_comparator', 'financial_modeler', 'final_consolidator', 'devils_advocate', 'executive_docs_planner'],
};

export const AGENT_NAMES = {
  document_parser: 'Парсер документов',
  work_scope_researcher: '🔍 Исследователь задачи',
  tz_analyst: 'Аналитик ТЗ',
  drawings_reader: 'Чтение чертежей',
  gatekeeper: 'Гейткипер',
  contract_decomposer: 'Декомпозиция договора',
  resource_planner: 'Планировщик ресурсов',
  method_validator: 'Валидатор методов',
  site_conditions: 'Условия площадки',
  norms_compliance: 'Соответствие нормам',
  warehouse_matcher: 'Подбор по складу',
  market_search: 'Поиск по рынку',
  procurement_analyzer: 'Анализ закупок',
  crew_composer: 'Состав бригады',
  labor_calculator: 'Расчёт трудозатрат',
  routing_planner: 'Логистика маршрута',
  travel_pricer: 'Стоимость командировок',
  permits_planner: 'Допуски и разрешения',
  consumables_calculator: 'Расходники',
  pre_mob_calculator: 'Предмобилизация',
  site_access_planner: 'Доступ на объект',
  standby_estimator: 'Простои',
  marine_permits: 'Морские разрешения',
  quality_control_planner: 'Контроль качества',
  warranty_reserve: 'Гарантийный резерв',
  indirects_calculator: 'Накладные расходы',
  risk_quantifier: 'Оценка рисков',
  historical_comparator: 'Исторические аналоги',
  financial_modeler: 'Финмодель',
  final_consolidator: 'Сборка ССР',
  devils_advocate: 'Адвокат дьявола',
  executive_docs_planner: 'Директорский отчёт',
};

export const STATUS_ICON = {
  PENDING: '⚪',
  RUNNING: '🟡',
  SUCCESS: '🟢',
  ERROR: '🔴',
  CANCELLED: '⚫',
  BLOCKED_ON_CLARIFICATION: '🟣',
};

export const TERMINAL_RUN_STATUSES = new Set([
  'READY_FOR_REVIEW', 'ERROR', 'APPROVED', 'REJECTED', 'BLOCKED_BY_CUSTOMER', 'BLOCKED_BY_PM',
]);

export const ACTIVE_RUN_STATUSES = new Set([
  'DRAFT', 'RUNNING', 'CONSOLIDATING', 'BLOCKED_BY_PM', 'BLOCKED_BY_CUSTOMER', 'WAITING_FOR_SLOT',
]);

/** Старт нового прогона. */
export function startRun(workId, tenderId) {
  return api(`${API}/start`, {
    method: 'POST',
    body: { work_id: workId || null, tender_id: tenderId || null },
  });
}

/** Состояние прогона. */
export function getRun(runId) {
  return api(`${API}/run/${runId}`);
}

/** Список «Мои просчёты». */
export function getMyRuns(limit = 30) {
  return api(`${API}/my-runs?limit=${limit}`);
}

/** Прервать прогон. */
export function cancelRun(runId) {
  return api(`${API}/run/${runId}/cancel`, { method: 'POST' });
}

/** Артефакт. */
export function getArtifact(artifactId) {
  return api(`${API}/artifact/${artifactId}`);
}

/** Ответ на уточнение. */
export function answerClarification(clarId, body) {
  return api(`${API}/clarification/${clarId}/answer`, { method: 'POST', body });
}

/** Ответ на уточнение со структурированными нормативами. */
export function answerWithNorms(clarId, values) {
  return api(`${API}/clarification/${clarId}/answer-with-norms`, { method: 'POST', body: { values } });
}

/** Генерация письма заказчику. */
export function generateLetter(runId, clarificationIds) {
  return api(`${API}/letter/generate`, {
    method: 'POST',
    body: { run_id: Number(runId), clarification_ids: clarificationIds },
  });
}

/** Пересчёт с правкой. */
export function recomputeWithFeedback(runId, feedback, manualEstimate) {
  const body = { feedback_text: feedback };
  if (manualEstimate) body.manual_estimate = manualEstimate;
  return api(`${API}/run/${runId}/recompute-with-feedback`, { method: 'POST', body });
}

/** Подстройка маржи. */
export function adjustMargin(runId, newMarginPct) {
  return api(`${API}/run/${runId}/adjust-margin`, {
    method: 'POST',
    body: { new_margin_pct: newMarginPct },
  });
}

/**
 * SSE-подключение: возвращает EventSource.
 *
 * ⚠️ Browser EventSource API НЕ поддерживает `Authorization` header — нужно
 * передавать токен в query. Это «accepted compromise» уровня браузера, такой же
 * паттерн в vanilla pre_tenders.js:752. Чтобы минимизировать риск:
 *   – SSE-токен короткоживущий (TTL в бэке);
 *   – SSE-канал read-only, ничего не мутирует;
 *   – HTTPS обязателен (исключает MITM-перехват в URL).
 * Если потребуется убрать токен из URL — придётся переходить на fetch-стрим
 * через ReadableStream + ручной парс SSE, либо на cookie-based аутентификацию.
 */
// Conductor SSE-stream вынесен в singleton-хук — `src/hooks/useConductorRunStream.js`
// (открытие/закрытие/reconnect/lastEventId/мульти-подписчики per-runId).
// Если нужен ручной EventSource — используй openConductorRunStream().

export function fmtRub(n) {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
}
export function fmtTs(ts) { try { return new Date(ts).toLocaleTimeString('ru-RU'); } catch { return ''; } }
export function fmtDur(ms) { return ms ? Math.round(ms / 1000) + 'с' : ''; }
export function fmtCost(r) { return r ? Number(r).toFixed(2) + '₽' : ''; }
export function shortJson(o) { try { return JSON.stringify(o).slice(0, 60); } catch { return ''; } }
