/**
 * ASGARD CRM — автоназначение РП из текста пересылки письма.
 * Паттерны: «РП Путков», «считает РП Андросов», «назначить Иванов».
 */
'use strict';

const db = require('./db');

const PM_PATTERNS = [
  /(?:^|[\s,.:;])(?:РП|рп)\s+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-]{1,30})/gi,
  /считает\s+(?:РП|рп)\s+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-]{1,30})/gi,
  /(?:назначить|передать|отдать)\s+([А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-]{1,30})/gi
];

function _norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function _fuzzyMatchPm(cand, user) {
  const c = _norm(cand);
  if (!c || c.length < 3) return false;
  const name = _norm(user.name);
  const login = _norm(user.login);
  if (name === c || login === c) return true;
  const parts = name.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    if (p.startsWith(c) || c.startsWith(p)) return true;
    if (p.length >= 4 && c.length >= 4 && (p.includes(c) || c.includes(p))) return true;
  }
  if (login && (login.startsWith(c) || c.startsWith(login))) return true;
  return false;
}

/**
 * @param {string} subject
 * @param {string} body
 * @param {string|null} aiSuggestedName — optional from AI analyzer
 * @returns {Promise<{pm_user_id:number, confidence:number, matched_name:string}|null>}
 */
async function resolvePmFromEmailText(subject, body, aiSuggestedName) {
  const text = `${subject || ''}\n${body || ''}`;
  const candidates = new Set();
  for (const re of PM_PATTERNS) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text)) !== null) {
      const w = (m[1] || '').trim();
      if (w.length >= 3) candidates.add(w);
    }
  }
  if (aiSuggestedName) candidates.add(String(aiSuggestedName).trim());

  if (!candidates.size) return null;

  const pms = await db.query(
    `SELECT id, name, login FROM users WHERE is_active = TRUE AND role IN ('PM','HEAD_PM')`
  );
  if (!pms.rows.length) return null;

  for (const cand of candidates) {
    for (const u of pms.rows) {
      if (_fuzzyMatchPm(cand, u)) {
        return {
          pm_user_id: u.id,
          confidence: 0.9,
          matched_name: u.name || u.login || `user#${u.id}`
        };
      }
    }
  }
  return null;
}

module.exports = { resolvePmFromEmailText };
