'use strict';

/**
 * Huginn AI Editor (F11) — rewrite / translate / grammar / style.
 * Corporate CRM: no premium gate. Uses ai-provider.completeFast.
 * Policy: server-side processing; texts not used for model training by us.
 */

const crypto = require('crypto');
const aiProvider = require('./ai-provider');

const PRESET_STYLES = [
  { id: 'formal', name: 'Formal', icon_emoji: '🤝', prompt: 'Перепиши текст формальным деловым стилем. Только результат, без пояснений.' },
  { id: 'short', name: 'Short', icon_emoji: '🎯', prompt: 'Сократи текст, сохрани смысл. Только результат.' },
  { id: 'tribal', name: 'Tribal', icon_emoji: '🪓', prompt: 'Перепиши энергично, коротко, как для рабочей бригады. Только результат.' },
  { id: 'corp', name: 'Corp', icon_emoji: '💼', prompt: 'Перепиши в корпоративном тоне ASGARD CRM. Только результат.' },
  { id: 'zen', name: 'Zen', icon_emoji: '🧘', prompt: 'Перепиши спокойно и ясно. Только результат.' },
  { id: 'biblical', name: 'Biblical', icon_emoji: '📜', prompt: 'Перепиши возвышенным архаичным стилем. Только результат.' },
  { id: 'viking', name: 'Viking', icon_emoji: '⚔️', prompt: 'Перепиши в духе викингов, но понятно по-русски. Только результат.' },
  { id: 'friendly', name: 'Friendly', icon_emoji: '😊', prompt: 'Перепиши дружелюбно и тепло, без панибратства. Только результат.' },
  { id: 'clarify', name: 'Clarify', icon_emoji: '🔍', prompt: 'Перепиши яснее: короткие предложения, без канцелярита. Только результат.' }
];

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;

async function checkRateLimit(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM huginn_ai_editor_log
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
    [userId]
  );
  return (rows[0] && rows[0].n) < RATE_MAX;
}

function buildSystem(mode, { targetLang, stylePrompt, emoji }) {
  const emojiHint = emoji
    ? ' Можно добавить уместные эмодзи.'
    : ' Не добавляй эмодзи, если их не было в исходнике.';
  if (mode === 'translate') {
    const lang = (targetLang || 'английский').trim();
    return `Ты переводчик. Переведи текст на ${lang}. Верни только перевод.${emojiHint}`;
  }
  if (mode === 'grammar') {
    return `Исправь орфографию, пунктуацию и грамматику. Сохрани смысл и язык оригинала. Только исправленный текст.${emojiHint}`;
  }
  if (mode === 'style') {
    return `${stylePrompt || PRESET_STYLES[0].prompt}${emojiHint}`;
  }
  return `Перепиши текст аккуратно. Только результат.${emojiHint}`;
}

async function resolveStylePrompt(db, userId, styleId) {
  if (!styleId) return PRESET_STYLES[0].prompt;
  const preset = PRESET_STYLES.find((s) => s.id === String(styleId));
  if (preset) return preset.prompt;
  const id = parseInt(styleId, 10);
  if (!Number.isFinite(id)) return PRESET_STYLES[0].prompt;
  const { rows } = await db.query(
    `SELECT prompt FROM huginn_ai_styles
     WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
    [id, userId]
  );
  return rows[0] ? rows[0].prompt : PRESET_STYLES[0].prompt;
}

async function rewrite(db, {
  userId,
  text,
  mode,
  targetLang,
  styleId,
  emoji
}) {
  const clean = String(text || '').trim();
  if (!clean) {
    const err = new Error('text_required');
    err.code = 'text_required';
    throw err;
  }
  if (clean.length > 12000) {
    const err = new Error('text_too_long');
    err.code = 'text_too_long';
    throw err;
  }
  const okRate = await checkRateLimit(db, userId);
  if (!okRate) {
    const err = new Error('rate_limit');
    err.code = 'rate_limit';
    throw err;
  }

  const m = ['translate', 'style', 'grammar'].includes(mode) ? mode : 'grammar';
  const stylePrompt = m === 'style' ? await resolveStylePrompt(db, userId, styleId) : null;
  const system = buildSystem(m, { targetLang, stylePrompt, emoji: !!emoji });

  let out = '';
  let ok = true;
  let errorText = null;
  try {
    const result = await aiProvider.completeFast({
      system,
      messages: [{ role: 'user', content: clean }],
      maxTokens: 2048,
      temperature: 0.3
    });
    out = String((result && (result.text || result.content)) || '').trim();
    if (!out) {
      ok = false;
      errorText = 'empty_response';
    }
  } catch (e) {
    ok = false;
    errorText = e.userMessage ? e.userMessage() : (e.message || 'ai_error');
    out = '';
  }

  const styleRef = (m === 'style' && /^\d+$/.test(String(styleId || '')))
    ? parseInt(styleId, 10)
    : null;

  await db.query(
    `INSERT INTO huginn_ai_editor_log (user_id, mode, style_id, chars_in, chars_out, ok, error_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, m, styleRef, clean.length, out.length, ok, errorText]
  );

  if (!ok) {
    const err = new Error(errorText || 'ai_error');
    if (errorText === 'rate_limit') err.code = 'rate_limit';
    else if (errorText === 'empty_response') err.code = 'ai_error';
    else err.code = 'ai_error';
    err.retryable = true;
    throw err;
  }
  return { text: out, mode: m, provider: 'routerai' };
}

async function listStyles(db, userId) {
  const { rows } = await db.query(
    `SELECT id, name, icon_emoji, prompt, share_token, is_public, created_at
     FROM huginn_ai_styles WHERE user_id = $1 ORDER BY id DESC`,
    [userId]
  );
  return {
    presets: PRESET_STYLES.map((s) => ({ ...s, is_preset: true })),
    custom: rows
  };
}

async function createStyle(db, userId, { name, iconEmoji, prompt }) {
  const n = String(name || '').trim().slice(0, 64);
  const p = String(prompt || '').trim().slice(0, 4000);
  if (!n || !p) {
    const err = new Error('name_and_prompt_required');
    err.code = 'bad_request';
    throw err;
  }
  const { rows } = await db.query(
    `INSERT INTO huginn_ai_styles (user_id, name, icon_emoji, prompt)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, n, iconEmoji || null, p]
  );
  return rows[0];
}

async function shareStyle(db, userId, styleId, withProfileLink) {
  const id = parseInt(styleId, 10);
  if (!Number.isFinite(id)) {
    const err = new Error('bad_id');
    err.code = 'bad_request';
    throw err;
  }
  const token = crypto.randomBytes(12).toString('hex');
  const { rows } = await db.query(
    `UPDATE huginn_ai_styles
     SET share_token = $3, is_public = true, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, userId, token]
  );
  if (!rows[0]) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return {
    style: rows[0],
    share_path: `/h?ai_style=${token}`,
    with_profile_link: !!withProfileLink
  };
}

module.exports = {
  PRESET_STYLES,
  RATE_MAX,
  RATE_WINDOW_MS,
  rewrite,
  listStyles,
  createStyle,
  shareStyle,
  checkRateLimit
};
