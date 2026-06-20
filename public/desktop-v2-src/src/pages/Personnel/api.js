/**
 * API-клиент страницы /personnel — «Дружина» (справочник рабочих).
 * Источник истины — vanilla `public/assets/js/personnel.js` (763 строки)
 *                  + vanilla `public/assets/js/employee.js` (~755 строк, полная анкета).
 *
 * Endpoint'ы (см. src/routes/worker-readiness.js + src/routes/staff.js + permits.js + mimir.js):
 *   GET  /api/staff/readiness                  — список + группы по статусу
 *   GET  /api/staff/readiness/stats            — только цифры
 *   GET  /api/staff/readiness/reasons          — справочник причин
 *   GET  /api/staff/readiness/log/:employeeId  — история статусов
 *   PUT  /api/staff/readiness/:employeeId/status — HR обновляет статус
 *   GET  /api/staff/employees/:id              — карточка + 10 последних оценок
 *   POST /api/staff/employees                  — добавить (ADMIN/HR/HR_MANAGER/DIRECTOR_GEN)
 *   PUT  /api/staff/employees/:id              — обновить (EMPLOYEE_COLS allowlist на бэке)
 *   POST /api/staff/employees/:id/review       — оценить
 *
 *   GET  /api/data/employee_assignments?where={"employee_id":N}&limit=2000  — история работ
 *   GET  /api/works?limit=2000                 — справочник работ для подстановки названий/РП
 *   GET  /api/permits?employee_id=N            — допуски сотрудника (с computed_status)
 *   GET  /api/permits/types                    — справочник типов допусков (для модалки добавления)
 *   POST /api/permits                          — создать допуск (multipart или JSON)
 *   DELETE /api/permits/:id                    — деактивировать (soft)
 *   POST /api/permits/:id/scan                 — заменить скан
 *
 *   POST /api/mimir/employee-summary           — AI-характеристика Мимира (текст + источники)
 *
 *   POST /api/files/upload (multipart)         — загрузка документа (паспорт, военный билет, ВУ скан)
 */
import { api } from '@/api/client';
import { postMultipart } from '@/api/upload';

/* ─── Константы (повторяют vanilla personnel.js) ─────────────────────────── */
export const SE_YEAR_LIMIT = 2_400_000; // ₽ годовой лимит самозанятого

export const STATUSES = [
  { code: 'on_site',   label: 'На объекте', tone: 'ok',    icon: '🏗' },
  { code: 'approved',  label: 'Утверждён',  tone: 'info',  icon: '✓' },
  { code: 'ready',     label: 'Готов',      tone: 'gold',  icon: '★' },
  { code: 'not_ready', label: 'Не готов',   tone: 'warn',  icon: '⏸' },
  { code: 'archive',   label: 'Архив',      tone: 'mute',  icon: '📦' },
];
export const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.code, s]));

export const REASONS = [
  { key: 'illness',    label: 'Болезнь' },
  { key: 'vacation',   label: 'Отпуск' },
  { key: 'family',     label: 'Семейные обстоятельства' },
  { key: 'training',   label: 'Обучение' },
  { key: 'personal',   label: 'Личные дела' },
  { key: 'legal',      label: 'Юридические вопросы' },
  { key: 'injury',     label: 'Травма на производстве' },
  { key: 'no_contact', label: 'Не выходит на связь' },
  { key: 'refused',    label: 'Отказ без причины' },
  { key: 'other',      label: 'Другое' },
];

/* ─── RBAC ────────────────────────────────────────────────────────────────── */
const DIRECTOR_PREFIX = 'DIRECTOR_';
function isDirectorRole(role) {
  const r = String(role || '');
  return r === 'DIRECTOR' || r.startsWith(DIRECTOR_PREFIX);
}

// Просмотр /personnel: HR/PM/HEAD/директора/TO/HEAD_TO/OFFICE_MANAGER
export const VIEW_ROLES = [
  'ADMIN', 'HR', 'HR_MANAGER', 'PM', 'HEAD_PM',
  'OFFICE_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'TO', 'HEAD_TO',
];

// Редактирование анкет — HR/ADMIN/директора (PM read-only)
export const EDIT_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

// PII (паспорт, ИНН, СНИЛС, банк) видят HR/ADMIN/директора
export const PII_ROLES = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];

// Импорт остатков СЗ — финансовая операция. Зеркалит src/routes/staff.js FIN_ROLES.
export const FIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'BUH'];

export function canView(role) {
  return VIEW_ROLES.includes(role) || isDirectorRole(role);
}
export function canEdit(role) {
  return EDIT_ROLES.includes(role) || isDirectorRole(role);
}
export function canSeePII(role) {
  return PII_ROLES.includes(role) || isDirectorRole(role);
}
export function canImportSeLimits(role) {
  return FIN_ROLES.includes(role) || isDirectorRole(role);
}

/* ─── API ─────────────────────────────────────────────────────────────────── */
export function loadReadiness() {
  return api('/api/staff/readiness').then((d) => ({
    employees: d.employees || [],
    groups: d.groups || { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 },
  }));
}

/**
 * Последняя синхронизация остатков СЗ — отдаёт когда и кто импортировал.
 *   GET /api/staff/se-limits/last-import → { last_import_at, last_import_by_fio }
 * RBAC: FIN_ROLES. Silent — не критично если 401/недоступно.
 */
export function loadSeLastImport() {
  return api('/api/staff/se-limits/last-import', { silent: true })
    .then((d) => d || null)
    .catch(() => null);
}

export function loadEmployee(id) {
  return api('/api/staff/employees/' + encodeURIComponent(id));
}

export function loadReadinessLog(employeeId) {
  return api('/api/staff/readiness/log/' + encodeURIComponent(employeeId))
    .then((d) => d.log || []);
}

export function setReadinessStatus(employeeId, payload) {
  return api('/api/staff/readiness/' + encodeURIComponent(employeeId) + '/status', {
    method: 'PUT',
    body: payload, // { status, readiness_date?, reason?, comment? }
  });
}

export function createEmployee(payload) {
  return api('/api/staff/employees', { method: 'POST', body: payload })
    .then((d) => d.employee || d);
}

export function updateEmployee(id, payload) {
  return api('/api/staff/employees/' + encodeURIComponent(id), {
    method: 'PUT',
    body: payload,
  }).then((d) => d.employee || d);
}

/* ─── Получатели НПД-выплат (V240) ────────────────────────────────────────
 * Иногда рабочий получает оплату через РОДСТВЕННИКА (жена/брат/отец как СЗ).
 *   GET  /api/staff/payees?search=Q&limit=20  — поиск среди is_se_payee=true
 *   POST /api/staff/payees                    — создать нового получателя (FIN_ROLES only)
 * Связь: employees.se_payee_id указывает на employees.id (получателя).
 */
export function searchPayees(q, limit = 20) {
  const qs = '?search=' + encodeURIComponent(q || '') + '&limit=' + Number(limit || 20);
  return api('/api/staff/payees' + qs)
    .then((d) => d.payees || d.items || d.rows || [])
    .catch(() => []);
}

export function createPayee(payload) {
  // { fio (required), phone, inn }
  return api('/api/staff/payees', {
    method: 'POST',
    body: payload,
  }).then((d) => d.payee || d.employee || d);
}

export function createReview(employeeId, payload) {
  return api('/api/staff/employees/' + encodeURIComponent(employeeId) + '/review', {
    method: 'POST',
    body: payload, // { score_1_10, comment, work_id? }
  });
}

/* ─── История работ + Работы для подстановки названий ────────────────────── */
export function loadEmployeeAssignments(employeeId) {
  // /api/data/employee_assignments?where={"employee_id":N}
  const where = encodeURIComponent(JSON.stringify({ employee_id: Number(employeeId) }));
  return api(`/api/data/employee_assignments?where=${where}&limit=2000`)
    .then((d) => d.employee_assignments || d.items || d.rows || [])
    .catch(() => []);
}

export function loadWorksLookup() {
  return api('/api/works?limit=2000')
    .then((d) => d.works || d.items || [])
    .catch(() => []);
}

/* ─── Допуски сотрудника ──────────────────────────────────────────────────── */
export function loadEmployeePermits(employeeId) {
  return api(`/api/permits?employee_id=${encodeURIComponent(employeeId)}&limit=500`)
    .then((d) => d.permits || [])
    .catch(() => []);
}

export function loadPermitTypes() {
  return api('/api/permits/types')
    .then((d) => d.types || [])
    .catch(() => []);
}

export function createPermit(payload) {
  // { employee_id, type_id, doc_number, issuer, issue_date, expiry_date, notes }
  return api('/api/permits', { method: 'POST', body: payload })
    .then((d) => d.permit || d);
}

export function deletePermit(id) {
  return api(`/api/permits/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ─── AI-характеристика Мимира ────────────────────────────────────────────── */
export function loadAiSummary(employeeId) {
  return api('/api/mimir/employee-summary', {
    method: 'POST',
    body: { employee_id: Number(employeeId) },
    silent: true,
    timeout: 60000, // AI может думать долго
  });
}

/* ─── Анкета-характеристика (worker_profiles) ─────────────────────────────── */
// Источник: vanilla `public/assets/js/worker_profile_desktop.js` (878 строк) +
// backend `src/routes/worker_profiles.js`.
// GET /api/worker-profiles/:id?by=employee — возвращает { profile, user, employee_id }.
// PUT /api/worker-profiles/:id?by=employee body { data, filled_count, total_count, overall_score, employee_id, photo_url? }
export function loadWorkerProfile(employeeId) {
  return api(`/api/worker-profiles/${encodeURIComponent(employeeId)}?by=employee`, { silent: true });
}

export function saveWorkerProfile(employeeId, payload) {
  return api(`/api/worker-profiles/${encodeURIComponent(employeeId)}?by=employee`, {
    method: 'PUT',
    body: payload,
  });
}

/* ─── Загрузка документа (скан/фото) ──────────────────────────────────────── */
/**
 * Загружает файл в /api/files/upload, опционально привязывая к work_id.
 * Возвращает { file, download_url }.
 */
export async function uploadEmployeeDocument(file, docType = 'employee_doc') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', docType);
  const r = await postMultipart('/api/files/upload', fd);
  return r;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return String(d).slice(0, 10); }
}

export function fmtMoney(n) {
  if (n == null || !isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

export function fmtRating(v) {
  if (v == null || !isFinite(Number(v))) return null;
  return Number(v).toFixed(1);
}

/**
 * Фильтрация employees по поисковому запросу (ФИО / телефон).
 */
export function filterByQuery(list, q) {
  if (!q || !q.trim()) return list;
  const lq = q.trim().toLowerCase();
  return list.filter((e) =>
    (e.fio || '').toLowerCase().includes(lq) ||
    (e.phone || '').toLowerCase().includes(lq)
  );
}
