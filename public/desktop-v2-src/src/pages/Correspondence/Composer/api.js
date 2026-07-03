/**
 * API-клиент для Composer официальной переписки (S-13H Stage 4 React v2).
 *
 * Контракт: tests/reports/letters/_LETTER_CONTRACT.md §4 (эндпоинты).
 * Дополняет уже существующий `pages/Correspondence/api.js` — здесь только то,
 * что относится к композеру/Мимиру (без CRUD списка).
 *
 * Все вызовы строго по ОДНОМУ (feedback-tokenator-constraints).
 */
import { api } from '@/api/client';

// ── Типы письма (LETTER_KINDS) ───────────────────────────────────────────
export function getLetterKinds() {
  return api('/api/letter/kinds')
    .then((d) => (d?.items || d?.kinds || []).filter(Boolean))
    .catch(() => DEFAULT_KINDS);
}

// Фолбэк на случай если /api/letter/kinds временно недоступен.
// Берётся из V251 миграции (settings.letter_kinds.items).
export const DEFAULT_KINDS = [
  { key: 'clarification', title: 'ПОЯСНЕНИЯ К ЦЕНОВОМУ ПРЕДЛОЖЕНИЮ',
    sub: '(об обстоятельствах, исключающих дальнейшее снижение цены)',
    subline: 'по дополнительному запросу Организатора к заявке {{company_name}}' },
  { key: 'request',      title: 'ЗАПРОС',                       sub: '', subline: '' },
  { key: 'response',     title: 'ОТВЕТ НА ЗАПРОС',              sub: '', subline: '' },
  { key: 'notification', title: 'УВЕДОМЛЕНИЕ',                  sub: '', subline: '' },
  { key: 'claim',        title: 'ПРЕТЕНЗИЯ',                    sub: '', subline: '' },
  { key: 'warranty',     title: 'ГАРАНТИЙНОЕ ПИСЬМО',           sub: '', subline: '' },
  { key: 'cover',        title: 'СОПРОВОДИТЕЛЬНОЕ ПИСЬМО',      sub: '', subline: '' },
  { key: 'information',  title: 'ИНФОРМАЦИОННОЕ ПИСЬМО',        sub: '', subline: '' },
  { key: 'free',         title: '',                             sub: '', subline: '' }
];

// ── 3 модели AI ([[project-letters-models]]) ──────────────────────────────
// Gemini ЗАПРЕЩЁН ([[feedback-no-gemini]]) — в селекторе НЕ упоминается.
export const AI_MODELS = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    hint: 'Стабильная · контекст 1M · ×1.0',
    default: true
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    hint: 'Дешевле · контекст 400K · ×0.8',
    default: false
  },
  {
    id: 'grok-4.20-fast',
    label: 'Grok 4.20 Fast',
    hint: 'xAI · контекст 2M · ×1.6',
    default: false
  }
];

export const DEFAULT_MODEL_ID = 'gpt-5.5';

// ── Correspondence CRUD ──────────────────────────────────────────────────
export function getCorrespondence(id) {
  const _id = encodeURIComponent(id);
  return api(`/api/data/correspondence/${_id}`)
    .then((d) => d?.item || d?.row || d || null);
}

export function saveDraft(payload) {
  // Либо POST (новый), либо PUT (правка существующего).
  if (payload && payload.id) {
    const id = encodeURIComponent(payload.id);
    return api(`/api/correspondence/${id}`, { method: 'PUT', body: payload });
  }
  return api('/api/correspondence', { method: 'POST', body: payload });
}

export function finalizeCorrespondence(id) {
  const _id = encodeURIComponent(id);
  // Контракт §4.5: канонический эндпоинт /api/letter/:id/finalize.
  // /api/correspondence/:id/finalize — alias (см. src/routes/correspondence.js:142),
  // оставляем как fallback.
  return api(`/api/letter/${_id}/finalize`, { method: 'POST', body: {} })
    .catch((err) => {
      if (err?.status === 404) {
        return api(`/api/correspondence/${_id}/finalize`, { method: 'POST', body: {} });
      }
      throw err;
    });
}

export function createNewRevision(id, revisionNote) {
  const _id = encodeURIComponent(id);
  return api(`/api/letter/${_id}/new-revision`, {
    method: 'POST',
    body: { revision_note: revisionNote || null }
  });
}

// ── Мимир в композере (discuss / edit) ───────────────────────────────────
export function mimirLetterEdit({ correspondence_id, conversation_id, current_doc, instruction, mode, model }) {
  return api('/api/mimir/letter-edit', {
    method: 'POST',
    body: {
      correspondence_id,
      conversation_id: conversation_id || null,
      current_doc: current_doc || null,
      instruction: instruction || '',
      mode: mode === 'edit' ? 'edit' : 'discuss',
      model: model || DEFAULT_MODEL_ID
    },
    // discuss/edit может быть медленным — даём провайдеру до 60с.
    timeout: 60_000
  });
}

// ── Health-чек шаблона DOCX (информативно — баннер в композере) ──────────
export function templateHealth() {
  return api('/api/letter/templates/health').catch(() => ({ ok: false }));
}

// ── Auto-context (опц. эндпоинт — graceful fallback) ─────────────────────
// Контракт §1: «POST /api/correspondence/auto-context (если есть в backend)».
// Сейчас ручка может отсутствовать → используем точечные GET'ы тендера/работы.
export async function loadParentContext({ parent_entity_type, parent_entity_id }) {
  if (!parent_entity_type || !parent_entity_id) return null;
  try {
    const r = await api('/api/correspondence/auto-context', {
      method: 'POST',
      body: { parent_entity_type, parent_entity_id },
      silent: true
    });
    if (r) return r;
  } catch { /* fallthrough */ }

  const id = encodeURIComponent(parent_entity_id);
  if (parent_entity_type === 'tender') {
    const t = await api(`/api/tenders/${id}`).catch(() => null);
    return t?.item || t || null;
  }
  if (parent_entity_type === 'work') {
    const w = await api(`/api/works/${id}`).catch(() => null);
    return w?.item || w || null;
  }
  if (parent_entity_type === 'calc' || parent_entity_type === 'estimate') {
    const e = await api(`/api/estimates/${id}`).catch(() => null);
    return e?.item || e || null;
  }
  if (parent_entity_type === 'pre_tender') {
    const p = await api(`/api/pre-tenders/${id}`).catch(() => null);
    return p?.item || p || null;
  }
  return null;
}

// ── Render DOCX/PDF на лету (для preview/download) ───────────────────────
export function renderLetterUrl(id, format, { with_signature, with_stamp } = {}) {
  const q = new URLSearchParams();
  if (with_signature === false) q.set('with_signature', '0');
  if (with_stamp === false)     q.set('with_stamp', '0');
  const tail = q.toString() ? `?${q.toString()}` : '';
  return `/api/letter/${encodeURIComponent(id)}/render/${encodeURIComponent(format)}${tail}`;
}
