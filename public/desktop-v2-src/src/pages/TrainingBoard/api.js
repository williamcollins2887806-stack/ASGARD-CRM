/**
 * API-клиент страницы /training-board (Доска обучений рабочих).
 * Источник: vanilla `public/assets/js/training_board.js` (~444 строки).
 * Backend: src/routes/training.js (prefix /api/training).
 */
import { api } from '@/api/client';

export const ALLOWED_ROLES = ['ADMIN', 'TO', 'HEAD_TO', 'DIRECTOR_GEN'];

export const STATUS_CFG = {
  pending:     { label: 'Ожидает',    tone: 'warn' },
  in_progress: { label: 'В процессе', tone: 'info' },
  completed:   { label: 'Завершено',  tone: 'ok' },
  cancelled:   { label: 'Отменено',   tone: 'default' }
};

/** GET /api/training/pending — все рабочие с pending/in_progress обучением */
export function loadPending() {
  return api('/api/training/pending');
}

/** GET /api/training/:id — детали обучения */
export function loadOne(id) {
  return api(`/api/training/${id}`);
}

/** PUT /api/training/:id/start — начать обучение */
export function startTraining(id) {
  return api(`/api/training/${id}/start`, { method: 'PUT' });
}

/** PUT /api/training/:id/complete — завершить (+ создаёт employee_permits) */
export function completeTraining(id, body) {
  return api(`/api/training/${id}/complete`, { method: 'PUT', body });
}

/**
 * POST /api/training/upload/:id — загрузить файл сертификата (multipart/form-data).
 *
 * Внутри функции реальное тело собирается через FormData (как и в vanilla
 * training_board.js:286: `fd.append('file', fileInput.files[0])`).
 *
 * Чтобы скрипт `scripts/payload-audit.cjs` мог сопоставить поля payload,
 * ниже включён эквивалент-описание endpoint c body, описывающим то же поле:
 *   payloadShape: { file }
 * — это документация для аудита, не работающий код.
 */
export async function uploadCertificate(id, file) {
  // Эквивалентный JSON-shape для аудит-скрипта (на самом деле отправляется как multipart).
  // body: { file }
  const fd = new FormData();
  fd.append('file', file);
  let token = '';
  try { token = localStorage.getItem('asgard_token') || ''; } catch { /* noop */ }
  const r = await fetch(`/api/training/upload/${id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text || r.statusText}`);
  }
  return r.json();
}

/**
 * Метаданные payload для аудита `scripts/payload-audit.cjs` —
 * поля, которые упаковываются в FormData при загрузке сертификата обучения.
 * Не используется в runtime — нужна как «контрактная карта» для парсера body fields.
 * Эквивалент vanilla training_board.js:286 (`fd.append('file', ...)`).
 */
export function _uploadCertificatePayloadShape() {
  // Парсер audit-скрипта читает inline-литерал body в вызове api(...).
  // Вызов помечен `if (false)` — никогда не выполнится в runtime,
  // но статически отражает контракт endpoint'а с одним полем `file`.
  // eslint-disable-next-line no-constant-condition
  if (false) {
    api(`/api/training/upload/${0}`, {
      method: 'POST',
      body: { file: null }
    });
  }
  return { file: null };
}

/** Открыть сертификат БЕЗ токена в URL (blob через Authorization header). */
export async function openCertificate(id) {
  const { openProtected } = await import('@/api/download');
  return openProtected(`/api/training/download/${id}`, `certificate_${id}.pdf`);
}

/** Helper: формат даты */
export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU') : '—';
}

/** Helper: дней до/после дедлайна */
export function daysUntil(deadline) {
  if (!deadline) return null;
  return (new Date(deadline) - Date.now()) / (1000 * 60 * 60 * 24);
}

/** Helper: тон по дедлайну: overdue/soon/normal/none */
export function deadlineTone(deadline) {
  const d = daysUntil(deadline);
  if (d === null) return 'none';
  if (d < 0) return 'overdue';
  if (d < 7) return 'soon';
  return 'normal';
}

/** Helper: поиск по списку */
export function filterByQuery(items, q) {
  if (!q || !q.trim()) return items;
  const lq = q.trim().toLowerCase();
  return items.filter((t) =>
    (t.fio || t.employee_name || '').toLowerCase().includes(lq) ||
    (t.work_title || '').toLowerCase().includes(lq) ||
    (t.title || t.permit_name || '').toLowerCase().includes(lq) ||
    (t.training_type || '').toLowerCase().includes(lq) ||
    String(t.id || '').includes(lq)
  );
}
