/**
 * API-клиент полевого модуля.
 * Источник: vanilla field-tab.js — функции api()/apiField()/apiPayments() и т.д.
 */
import { api } from '@/api/client';

const fm   = (path, opts) => api('/api/field/manage' + path, opts);
const f    = (path, opts) => api('/api/field' + path, opts);

export function loadDashboard(workId) {
  return fm(`/projects/${workId}/dashboard`).catch(() => ({}));
}

export function loadTariffs(category = 'all') {
  return fm(`/tariffs?category=${category}`)
    .then((d) => d.tariffs || d.items || [])
    .catch(() => []);
}

// D-3 FIX: GET /projects/:work_id/crew не существует на бэке (есть только POST).
// Vanilla читает `/api/data/employee_assignments` напрямую. Возвращаем ВСЕ
// назначения (включая departed) — компонент сам делит на активных/уехавших.
export function loadCrew(workId) {
  const where = encodeURIComponent(JSON.stringify({ work_id: workId }));
  return api(`/api/data/employee_assignments?where=${where}&limit=500`)
    .then((d) => {
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.employee_assignments)) return d.employee_assignments;
      if (Array.isArray(d?.items)) return d.items;
      for (const k of Object.keys(d || {})) {
        if (Array.isArray(d[k])) return d[k];
      }
      return [];
    })
    .then((arr) => arr.filter((a) => Number(a.work_id) === Number(workId)))
    .catch(() => []);
}

export function loadAvailableEmployees(workId) {
  return api(`/api/staff/employees/available?work_id=${workId}`)
    .then((d) => d.employees || d.items || [])
    .catch(() => []);
}

export function loadLogistics(workId) {
  return f(`/logistics?work_id=${workId}`)
    .then((d) => d.items || d.logistics || [])
    .catch(() => []);
}

export function loadTimesheet(workId, params = {}) {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to)   q.set('to',   params.to);
  return fm(`/projects/${workId}/timesheet?${q.toString()}`)
    .catch(() => ({ timesheet: [], per_diem_rate: 0 }));
}

export async function exportTimesheetExcel(workId, params = {}) {
  // G-5 SECURITY: blob-download без `?token=` в URL (D-4 продолжение).
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to)   q.set('to',   params.to);
  q.set('format', 'xlsx');
  const url = `/api/field/manage/projects/${workId}/timesheet?${q.toString()}`;
  const { downloadProtected } = await import('@/api/download');
  return downloadProtected(url, `timesheet-${workId}-${params.from || ''}-${params.to || ''}.xlsx`);
}

/* ─── Timesheet CRUD (vanilla field-tab.js inline-editor) ─── */
// POST   /api/field/manage/projects/:work_id/checkin       — создать смену
// PUT    /api/field/manage/projects/:work_id/checkin/:id   — обновить смену
// DELETE /api/field/manage/projects/:work_id/checkin/:id   — отменить смену
export function createCheckin(workId, payload) {
  return fm(`/projects/${workId}/checkin`, { method: 'POST', body: payload });
}
export function updateCheckin(workId, checkinId, payload) {
  return fm(`/projects/${workId}/checkin/${checkinId}`, { method: 'PUT', body: payload });
}
export function deleteCheckin(workId, checkinId) {
  return fm(`/projects/${workId}/checkin/${checkinId}`, { method: 'DELETE' });
}

export function loadDisputes(workId) {
  return api(`/api/pm/disputes?work_id=${workId}`)
    .then((d) => d.disputes || d.items || [])
    .catch(() => []);
}

export function loadFunds(workId) {
  return f(`/funds/?work_id=${workId}`)
    .then((d) => d.funds || d.items || [])
    .catch(() => []);
}

export function loadPacking(workId) {
  return f(`/packing/?work_id=${workId}`)
    .then((d) => d.lists || d.items || [])
    .catch(() => []);
}

export function loadStagesCalendar(workId, opts = {}) {
  // D-3 FIX: backend требует date_from + date_to (без них — 400, и вкладка падала в .catch).
  // Vanilla берёт [сегодня−30, сегодня+15] (field-tab.js:2466-2474).
  const now = new Date();
  const from = opts.from || (() => { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
  const to = opts.to || (() => { const d = new Date(now); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); })();
  return f(`/stages/project/${workId}/calendar?date_from=${from}&date_to=${to}`)
    .catch(() => ({ employees: [], days: [], stages: [] }));
}

export function loadPaymentsSummary(workId) {
  return api(`/api/worker-payments/project/${workId}/summary`)
    .catch(() => ({}));
}

export function loadPaymentsList(workId) {
  return api(`/api/worker-payments/?work_id=${workId}`)
    .then((d) => d.payments || d.items || [])
    .catch(() => []);
}

export function loadPendingDeliveries() {
  return api('/api/gamification/admin/pending-deliveries')
    .then((d) => d.deliveries || d.items || [])
    .catch(() => []);
}

/**
 * История выдач (vanilla parity: field-tab.js:3485 `/delivered-history`).
 * Возвращает последние выдачи (бэк сам ограничивает периодом ~30 дней).
 */
export function loadDeliveredHistory() {
  return api('/api/gamification/admin/delivered-history')
    .then((d) => d.history || d.deliveries || d.items || [])
    .catch(() => []);
}

/**
 * Отметить приз «готов к выдаче» (vanilla parity: field-tab.js:3597
 * `PUT /api/gamification/admin/inventory/:id/ready`). Используется
 * PM/Admin'ом когда фактически закуплен/собран приз и можно вручать.
 */
export function markPrizeReady(prizeId) {
  return api(`/api/gamification/admin/inventory/${prizeId}/ready`, {
    method: 'PUT',
    body: {}
  });
}

/* ─── CRUD-операции (без заглушек) ─── */

export function createLogistics(payload) {
  return f('/logistics', { method: 'POST', body: payload });
}
export function deleteLogistics(id) {
  return f(`/logistics/${id}`, { method: 'DELETE' });
}
export function sendLogistics(id, channel = 'sms') {
  return f(`/logistics/${id}/send`, { method: 'POST', body: { channel } });
}

export function takeDispute(disputeId) {
  return api(`/api/pm/disputes/${disputeId}/take`, { method: 'POST', body: {} });
}
export function resolveDispute(disputeId, payload) {
  return api(`/api/pm/disputes/${disputeId}/resolve`, { method: 'POST', body: payload });
}

export function createFund(payload) {
  return f('/funds/', { method: 'POST', body: payload });
}
export function closeFund(fundId) {
  return f(`/funds/${fundId}/close`, { method: 'PUT', body: {} });
}
/**
 * Подробности подотчёта (бэк src/routes/field-funds.js:98 GET /:id).
 * Возвращает { fund, expenses, returns }.
 */
export function loadFundDetail(fundId) {
  return f(`/funds/${fundId}`).catch(() => null);
}

export function createPackingList(payload) {
  return f('/packing', { method: 'POST', body: payload });
}
/** Подробности листа сборки + позиции (field-packing.js:124 GET /:id). */
export function loadPackingDetail(listId) {
  return f(`/packing/${listId}`).catch(() => null);
}
/** Обновить шапку листа (field-packing.js:154 PUT /:id). */
export function updatePackingList(listId, payload) {
  return f(`/packing/${listId}`, { method: 'PUT', body: payload });
}
/** Добавить позиции в лист (field-packing.js:182 POST /:id/items). */
export function addPackingItems(listId, items) {
  return f(`/packing/${listId}/items`, { method: 'POST', body: { items } });
}
/** Изменить позицию (field-packing.js:236 PUT /:id/items/:itemId). */
export function updatePackingItem(listId, itemId, payload) {
  return f(`/packing/${listId}/items/${itemId}`, { method: 'PUT', body: payload });
}
/** Удалить позицию (field-packing.js:269 DELETE /:id/items/:itemId). */
export function deletePackingItem(listId, itemId) {
  return f(`/packing/${listId}/items/${itemId}`, { method: 'DELETE' });
}
/** Назначить исполнителя + SMS (field-packing.js:298 POST /:id/assign). */
export function assignPackingList(listId, employeeId, sendSms = true) {
  return f(`/packing/${listId}/assign`, {
    method: 'POST',
    body: { employee_id: Number(employeeId), send_sms: !!sendSms }
  });
}

export function createStage(payload) {
  return f('/stages', { method: 'POST', body: payload });
}
/** PM подтверждает этап (field-stages.js:279 PUT /:id/approve). */
export function approveStage(stageId, payload = {}) {
  return f(`/stages/${stageId}/approve`, { method: 'PUT', body: payload });
}
/** PM отклоняет этап с обязательной причиной (field-stages.js:315 PUT /:id/reject). */
export function rejectStage(stageId, note) {
  return f(`/stages/${stageId}/reject`, { method: 'PUT', body: { adjustment_note: note } });
}
/** Массовое создание этапов (field-stages.js:396 POST /bulk). */
export function bulkCreateStages(payload) {
  return f('/stages/bulk', { method: 'POST', body: payload });
}
/** Полный список этапов с группировкой по сотрудникам (field-stages.js:164 GET /project/:work_id). */
export function loadStagesProject(workId) {
  return f(`/stages/project/${workId}`).catch(() => ({ employees: [], total_stages: 0 }));
}

/** Отметить «куплено» — Office-Manager workflow (field-logistics.js:314 POST /:id/purchased). */
export function markLogisticsPurchased(id) {
  return f(`/logistics/${id}/purchased`, { method: 'POST', body: {} });
}
/** Редактировать запись логистики (field-logistics.js:145 PUT /:id). */
export function updateLogistics(id, payload) {
  return f(`/logistics/${id}`, { method: 'PUT', body: payload });
}
/**
 * Загрузить документ к логистике (field-logistics.js:185 POST /:id/attach, multipart/form-data).
 * Возвращает { ok, document_id }. После прикрепления статус становится 'ready'.
 */
export async function attachLogisticsFile(id, file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/field/logistics/${id}/attach`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error || msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return r.json();
}

export function createPayment(payload) {
  return api('/api/worker-payments', { method: 'POST', body: payload });
}
export function deletePayment(id) {
  return api(`/api/worker-payments/${id}`, { method: 'DELETE' });
}

/* ─── Payments tab — расширения для PayWorker / Bulk / Salary ─── */

// GET /api/worker-payments/employee-summary?work_id=&employee_id= — SSoT для модалки PayWorker
// (src/routes/worker-payments.js:346)
export function loadEmployeePaymentSummary(workId, employeeId) {
  return api(`/api/worker-payments/employee-summary?work_id=${workId}&employee_id=${employeeId}`);
}

// POST /api/worker-payments/pay-worker — свободная выплата (статус 'paid' сразу).
// body: { employee_id, work_id, type, amount, payment_method, note }
// (src/routes/worker-payments.js:392)
export function payWorkerDirect(payload) {
  return api('/api/worker-payments/pay-worker', { method: 'POST', body: payload });
}

// PUT /api/worker-payments/:id/pay — отметить pending как выплачено.
// body: { payment_method, note }
// (src/routes/worker-payments.js:213)
export function markPaymentPaid(id, payload) {
  return api(`/api/worker-payments/${id}/pay`, { method: 'PUT', body: payload });
}

// POST /api/worker-payments/bulk-per-diem — массовые суточные.
// body: { work_id, employee_ids: [], period_from, period_to, rate_per_day, payment_method?, comment? }
// (src/routes/worker-payments.js:464)
export function bulkPerDiem(payload) {
  return api('/api/worker-payments/bulk-per-diem', { method: 'POST', body: payload });
}

// POST /api/worker-payments/generate-salary/:year/:month — ведомость из field_checkins.
// body: { point_value, work_id? }
// (src/routes/worker-payments.js:504)
export function generateSalary(year, month, payload) {
  return api(`/api/worker-payments/generate-salary/${year}/${month}`, {
    method: 'POST',
    body: payload
  });
}

// POST /api/worker-payments/pay-salary/:year/:month — массово отметить выплату.
// body: { payment_method, work_id? }
// (src/routes/worker-payments.js:590)
export function paySalary(year, month, payload) {
  return api(`/api/worker-payments/pay-salary/${year}/${month}`, {
    method: 'POST',
    body: payload
  });
}

/**
 * D-3 FIX (2026-06-14): backend exposes PUT /api/gamification/admin/inventory/:id/deliver
 * with body {delivery_note}. Эндпоинт /api/admin/deliveries/:id/delivered НЕ существует — был 404.
 */
export function markPrizeDelivered(prizeId, payload) {
  const note = payload?.note || payload?.delivery_note || null;
  return api(`/api/gamification/admin/inventory/${prizeId}/deliver`, {
    method: 'PUT',
    body: { delivery_note: note }
  });
}

/* ─── Бригада CRUD ─── */
/**
 * D-3 FIX (2026-06-14): vanilla parity.
 *   Backend имеет ТОЛЬКО POST /projects/:work_id/crew (массовый upsert с {employees:[...]}).
 *   Эндпоинтов /crew-operations/add|remove и PUT /crew НЕ существует — вызовы шли в 404.
 *   Удаление работника: POST /projects/:work_id/departure/:employee_id (vanilla pattern).
 *   Backend нормализует поля: field_role, tariff_id, combination_tariff_id, shift_type, per_diem.
 */
export function saveCrew(workId, crew) {
  // Bulk upsert (vanilla field-tab.js:403). body.employees — массив всех активных.
  return fm(`/projects/${workId}/crew`, { method: 'POST', body: { employees: crew } });
}
export function addCrewMember(workId, payload) {
  // Backend ждёт {employees:[{...}]}. Нормализуем поле role → field_role (бэк-имя).
  const member = {
    employee_id: payload.employee_id,
    field_role: payload.field_role || payload.role_in_field || payload.role || 'worker',
    tariff_id: payload.tariff_id || null,
    combination_tariff_id: payload.combination_tariff_id || null,
    shift_type: payload.shift_type || payload.shift || 'day',
    per_diem: payload.per_diem != null ? payload.per_diem : null
  };
  return fm(`/projects/${workId}/crew`, { method: 'POST', body: { employees: [member] } });
}
export function removeCrewMember(workId, employeeId, opts = {}) {
  return fm(`/projects/${workId}/departure/${employeeId}`, {
    method: 'POST',
    body: {
      reason: opts.reason || null,
      departure_date: opts.departure_date || new Date().toISOString().slice(0, 10)
    }
  });
}

/* ─── Бригада — массовые приглашения (vanilla field-tab.js:428,448) ─── */
// /api/field/manage/projects/:id/send-invites — SMS «приглашения» всем в бригаде, кому не отправлено.
// /api/field/manage/projects/:id/send-max-invites — SMS со ссылкой в MAX-чат всем, кто не вступил.
export function sendCrewInvites(workId) {
  return fm(`/projects/${workId}/send-invites`, { method: 'POST', body: {} });
}
export function sendCrewMaxInvites(workId) {
  return fm(`/projects/${workId}/send-max-invites`, { method: 'POST', body: {} });
}

/* ─── Бригада — отъезд / возврат / тарификация в строке ─── */

/**
 * Фин-сводка перед оформлением отъезда (SSoT).
 * Backend: src/routes/field-manage.js:1126 GET /projects/:work_id/departure-preview/:employee_id
 * Возвращает { employee, assignment, days_on_site, finances, finances_error }.
 */
export function loadDeparturePreview(workId, employeeId) {
  return fm(`/projects/${workId}/departure-preview/${employeeId}`);
}

/**
 * Оформить отъезд (мягко: is_active=false + departure_date).
 * Backend: src/routes/field-manage.js:1176 POST /projects/:work_id/departure/:employee_id
 */
export function departCrewMember(workId, employeeId, payload) {
  return fm(`/projects/${workId}/departure/${employeeId}`, {
    method: 'POST',
    body: {
      departure_date: payload?.departure_date || new Date().toISOString().slice(0, 10),
      reason: payload?.reason || null
    }
  });
}

/**
 * Вернуть работника на объект (revoke departure).
 * Backend: src/routes/field-manage.js:1221 POST /projects/:work_id/return/:employee_id
 */
export function returnCrewMember(workId, employeeId) {
  return fm(`/projects/${workId}/return/${employeeId}`, { method: 'POST', body: {} });
}

/**
 * Обновить тариф / совмещение / суточные строки.
 * Бэк не имеет отдельного PUT /tariff — переиспользуем POST /projects/:work_id/crew
 * (см. field-manage.js:148, ветка `if (existing.length > 0) UPDATE`).
 */
export function updateCrewMemberTariff(workId, payload) {
  const member = {
    employee_id: Number(payload.employee_id),
    field_role: payload.field_role || 'worker',
    shift_type: payload.shift_type || 'day',
    tariff_id: payload.tariff_id ? Number(payload.tariff_id) : null,
    combination_tariff_id: payload.combination_tariff_id ? Number(payload.combination_tariff_id) : null,
    per_diem: payload.per_diem != null && payload.per_diem !== '' ? Number(payload.per_diem) : null
  };
  return fm(`/projects/${workId}/crew`, { method: 'POST', body: { employees: [member] } });
}

/**
 * SMS-приглашение одному работнику. Backend: /send-invites c employee_ids:[id]
 * (vanilla field-tab.js:682). SMS уже содержит ссылку на ЛК /field.
 * После SMS работник сам устанавливает PIN через setup-pin (field-auth.js:349).
 */
export function sendSingleInvite(workId, employeeId) {
  return fm(`/projects/${workId}/send-invites`, {
    method: 'POST',
    body: { employee_ids: [Number(employeeId)] }
  });
}

/**
 * Активировать field-проект (vanilla field-tab.js:254).
 * Backend: src/routes/field-manage.js:46 POST /projects/:work_id/activate
 */
export function activateFieldProject(workId, payload) {
  return fm(`/projects/${workId}/activate`, {
    method: 'POST',
    body: {
      site_category: payload?.site_category || 'ground',
      per_diem: payload?.per_diem != null ? payload.per_diem : 0,
      schedule_type: payload?.schedule_type || 'shift',
      shift_hours: payload?.shift_hours != null ? payload.shift_hours : 11
    }
  });
}
