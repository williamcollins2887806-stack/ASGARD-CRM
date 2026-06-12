'use strict';

/**
 * Embeddings Watch Cron — мониторинг доступности embedding-моделей у AI-провайдера.
 *
 * Задача: у токенатора (api.tokenator.top) сейчас embedding-модели (text-embedding-3-large,
 * voyage-3-large) — offline. Mimir Conductor RAG нормативов (mimir_norms_index + pgvector)
 * остановлен из-за этого. Этот cron раз в 5 часов проверяет, не появились ли embeddings.
 * При первом успешном ответе → уведомление в Telegram + notifications для DIRECTOR_GEN/ADMIN.
 *
 * Состояние хранится в settings.embeddings_watch:
 *   { last_check_at, last_status, available_at, notified_at }
 * Когда available_at установлен — повторных уведомлений нет (UI / Telegram спама не будет).
 *
 * Расписание: «0 минут каждый 5-й час» (00:00, 05:00, 10:00, 15:00, 20:00 MSK).
 * Дополнительно: первый probe — через 30 секунд после старта сервиса (lazy initial check).
 */

const cron = require('node-cron');

let _task = null;
let _initialProbeTimer = null;
let _telegram = null;
let _notify = null;

// Модели для проверки. Пытаемся обе подряд — успех любой = embeddings работают.
const PROBE_MODELS = ['text-embedding-3-large', 'voyage-3-large'];
const PROBE_TIMEOUT_MS = 15000;
const SETTINGS_KEY = 'embeddings_watch';

async function _loadState(db) {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = $1", [SETTINGS_KEY]);
    if (!r.rows[0]) return {};
    let raw = r.rows[0].value_json;
    try { return JSON.parse(raw); } catch (_) { return {}; }
  } catch (_) { return {}; }
}

async function _saveState(db, state) {
  const json = JSON.stringify(state);
  await db.query(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()
  `, [SETTINGS_KEY, json]);
}

/** Достать base_url + api_key из текущего ai_config (settings). */
async function _loadAiConfig(db) {
  try {
    const r = await db.query("SELECT value_json FROM settings WHERE key = 'ai_config'");
    if (!r.rows[0]) return null;
    let raw = r.rows[0].value_json;
    let cfg;
    try { cfg = JSON.parse(raw); } catch (_) { return null; }
    if (cfg && cfg.value_json) {
      try { cfg = JSON.parse(cfg.value_json); } catch (_) {}
    }
    const chatUrl = cfg.openai_url || '';
    // /v1/chat/completions → /v1/embeddings
    const embeddingsUrl = chatUrl.replace(/\/v1\/chat\/completions\b.*$/, '/v1/embeddings');
    return { embeddingsUrl, apiKey: cfg.openai_api_key || '' };
  } catch (_) { return null; }
}

/** Один пробник: возвращает {ok, model, status, error}. */
async function _probeOne(url, apiKey, model) {
  if (!url || !apiKey) return { ok: false, status: 0, error: 'no_config' };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({ model, input: 'ping' }),
      signal: controller.signal
    });
    clearTimeout(t);
    if (resp.ok) return { ok: true, model, status: resp.status };
    const txt = await resp.text().catch(() => '');
    return { ok: false, model, status: resp.status, error: txt.substring(0, 200) };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, model, status: 0, error: e.message || 'network' };
  }
}

/** Пробуем все модели. Успех любой = embeddings работают. */
async function _probe(db) {
  const cfg = await _loadAiConfig(db);
  if (!cfg || !cfg.embeddingsUrl || !cfg.apiKey) {
    return { ok: false, status: 0, error: 'ai_config not found' };
  }
  for (const m of PROBE_MODELS) {
    const r = await _probeOne(cfg.embeddingsUrl, cfg.apiKey, m);
    if (r.ok) return r;
  }
  // Все провалились — возвращаем последний результат
  return await _probeOne(cfg.embeddingsUrl, cfg.apiKey, PROBE_MODELS[0]);
}

/** Список получателей уведомления (директора + админы с telegram). */
async function _getRecipients(db) {
  const r = await db.query(`
    SELECT id, name, telegram_chat_id
    FROM users
    WHERE is_active = true
      AND role IN ('ADMIN','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV')
  `);
  return r.rows;
}

async function _notifyAvailable(db, log, probeResult) {
  let recipients = [];
  try { recipients = await _getRecipients(db); } catch (e) {
    log && log.warn && log.warn('[embeddings-watch] cannot load recipients:', e.message);
  }

  const title = '✅ Embeddings снова доступны';
  const message =
    'У AI-провайдера снова работают embedding-модели (модель ' + probeResult.model + ', HTTP ' + probeResult.status + ').\n\n' +
    'Можно включать RAG нормативов ГЭСН/ФЕР в Mimir Conductor и заливать нормативы в mimir_norms_index. ' +
    'Скажите ассистенту «включай RAG» — он переключит models-config.js обратно на embedding-режим и проверит.';

  for (const u of recipients) {
    // 1) В CRM-колокольчик
    try {
      if (_notify && _notify.createNotification) {
        await _notify.createNotification(db, {
          user_id: u.id, title, message, type: 'ai_provider', link: '#/settings/ai'
        });
      }
    } catch (e) {
      log && log.warn && log.warn(`[embeddings-watch] notif fail for u=${u.id}:`, e.message);
    }
    // 2) Telegram (если бот подключён и chat_id есть)
    if (u.telegram_chat_id && _telegram && _telegram.sendNotification) {
      try {
        await _telegram.sendNotification(u.id, `${title}\n\n${message}`);
      } catch (e) {
        log && log.warn && log.warn(`[embeddings-watch] telegram fail for u=${u.id}:`, e.message);
      }
    }
  }
  log && log.info && log.info(`[embeddings-watch] notified ${recipients.length} recipients`);
}

async function runCheck(db, log) {
  const now = new Date().toISOString();
  const state = await _loadState(db);
  const probe = await _probe(db);

  state.last_check_at = now;
  state.last_status = probe.ok ? 'available' : 'unavailable';
  state.last_http = probe.status || 0;
  state.last_model = probe.model || null;
  state.last_error = probe.ok ? null : (probe.error || null);

  if (probe.ok) {
    if (!state.available_at) state.available_at = now;
    if (!state.notified_at) {
      // первый успех — уведомляем
      try {
        await _notifyAvailable(db, log, probe);
        state.notified_at = now;
      } catch (e) {
        log && log.warn && log.warn('[embeddings-watch] notify error:', e.message);
      }
    }
  } else {
    // если был доступен, а теперь упал — сбросим notified_at, чтобы при следующем восстановлении уведомить ещё раз
    if (state.available_at && state.last_status === 'unavailable') {
      // НО: не дёргаем при первом «временном» 503 — добавим счётчик подряд-фейлов
      state.consecutive_failures = (state.consecutive_failures || 0) + 1;
      if (state.consecutive_failures >= 3) {
        state.available_at = null;
        state.notified_at = null;
      }
    }
    if (!probe.ok) state.consecutive_failures = (state.consecutive_failures || 0) + 1;
  }
  if (probe.ok) state.consecutive_failures = 0;

  try { await _saveState(db, state); } catch (e) {
    log && log.warn && log.warn('[embeddings-watch] state save failed:', e.message);
  }

  log && log.info && log.info(`[embeddings-watch] check → ${state.last_status} (model=${state.last_model||'-'}, http=${state.last_http})`);
  return state;
}

function start(db, log) {
  if (_task) return;
  try { _telegram = require('./telegram'); } catch (_) { _telegram = null; }
  try { _notify = require('./notify'); } catch (_) { _notify = null; }

  // Каждые 5 часов в 0 минут (00:00, 05:00, 10:00, 15:00, 20:00 MSK)
  _task = cron.schedule('0 */5 * * *', () => runCheck(db, log), {
    timezone: 'Europe/Moscow'
  });

  // Первая проверка — через 30 сек после старта (лениво, не блокируем startup)
  _initialProbeTimer = setTimeout(() => runCheck(db, log), 30000);

  log && log.info && log.info('[embeddings-watch] Started — probe every 5h (0 */5 * * * MSK), initial probe in 30s');
}

function stop() {
  if (_task) { try { _task.stop(); } catch (_) {} _task = null; }
  if (_initialProbeTimer) { try { clearTimeout(_initialProbeTimer); } catch (_) {} _initialProbeTimer = null; }
}

module.exports = { start, stop, runCheck };
