'use strict';

/**
 * Нормализация идентификаторов Mango Office.
 *
 * Webhook часто кладёт entry_id как base64 цифр (Mjcz…= → 273…),
 * Stats API — сырой numeric. recording_id приходит строкой или массивом.
 */

function entryIdAliases(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [];
  const out = new Set([s]);
  if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length >= 8) {
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf8');
      if (/^\d+$/.test(decoded)) out.add(decoded);
    } catch (_) { /* ignore */ }
  }
  if (/^\d+$/.test(s)) {
    out.add(Buffer.from(s, 'utf8').toString('base64'));
  }
  return Array.from(out);
}

function firstRecordingId(raw) {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const id = firstRecordingId(raw[i]);
      if (id) return id;
    }
    return null;
  }
  if (typeof raw === 'object') {
    if (raw.recording_id != null) return firstRecordingId(raw.recording_id);
    if (raw.id != null) return firstRecordingId(raw.id);
    return null;
  }
  const s = String(raw).trim();
  return s || null;
}

function isRecordingComplete(event) {
  if (!event || typeof event !== 'object') return false;
  const code = event.completion_code;
  if (code === 1000 || code === '1000') return true;
  const state = String(event.recording_state || event.state || '').toLowerCase();
  if (state === 'completed' || state === 'complete' || state === 'done') return true;
  if (state === 'started' || state === 'in_progress' || state === 'processing') return false;
  return !!firstRecordingId(event.recording_id);
}

module.exports = {
  entryIdAliases,
  firstRecordingId,
  isRecordingComplete,
};
