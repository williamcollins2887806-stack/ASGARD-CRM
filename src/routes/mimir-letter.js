'use strict';

/**
 * src/routes/mimir-letter.js — Stage 2.5: Мимир-помощник в композере письма.
 *
 * Prefix: `/api/mimir` (зарегистрирован в src/index.js).
 *
 * Эндпоинт:
 *   POST /api/mimir/letter-edit — два режима:
 *     - mode='discuss': обсуждение текста (markdown-ответ для UI чата).
 *     - mode='edit':    JSON {ops:[...], summary, confidence} для TipTap.
 *
 * Контракт §4.9.
 *
 * Зависимости:
 *   - correspondenceService.getCorrespondenceById — гард на наличие письма.
 *   - letterContextBuilder.buildLetterContext — собирает system + 4 слоя контекста.
 *   - aiProvider.complete — RouterAI → реальные модели.
 *
 * Решения:
 *   - Модели whitelist: deepseek (default), gemini flash, grok 4.20.
 *   - При HTTP 400 от провайдера (перегруз) — однократный retry на DEFAULT_MODEL.
 *   - response_format: { type: 'json_object' } для mode='edit'.
 */

const correspondenceService = require('../services/correspondence');
const letterContextBuilder  = require('../services/letter/letter-context-builder');
const aiProvider            = require('../services/ai-provider');
const {
  MODEL_DEFAULT,
  LETTER_AI_MODELS,
  normalizeModelId,
  getLetterContextBudget,
} = require('../services/ai-models');

const ALLOWED_MODELS = LETTER_AI_MODELS.map((m) => m.id);
const DEFAULT_MODEL  = MODEL_DEFAULT;
const OP_WHITELIST   = [
  'replace_all',
  'insert_at_end',
  'replace_range',
  'replace_text',
  'append_paragraph',
  'wrap_in'
];
const CORRESPONDENCE_ROLES = [
  'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV',
  'OFFICE_MANAGER', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'
];
const HISTORY_LIMIT = 20;       // последние 20 сообщений из mimir_messages
const PROVIDER_RETRY_DELAY_MS = 30000;

function hasCorrespondenceAccess(user) {
  return !!user && CORRESPONDENCE_ROLES.includes(user.role);
}

/**
 * Применить model-whitelist. Не-whitelist (включая gemini) → DEFAULT_MODEL.
 * Возвращает {model, was_replaced, requested}.
 */
function resolveModel(requested) {
  const r = normalizeModelId(String(requested || '').trim() || MODEL_DEFAULT);
  if (!requested) return { model: DEFAULT_MODEL, was_replaced: false, requested: null };
  const norm = normalizeModelId(requested);
  if (ALLOWED_MODELS.includes(norm)) return { model: norm, was_replaced: norm !== String(requested).trim(), requested };
  return { model: DEFAULT_MODEL, was_replaced: true, requested };
}

/**
 * Парс mode='edit' ответа AI.
 * Ожидаем JSON {ops:[...], summary:'...', confidence:0..1}.
 * Если AI отдал в код-блоке ```json ... ``` — извлекаем содержимое.
 * Возвращает {ops, summary, confidence, raw, parse_error}.
 */
function parseEditResponse(text) {
  if (!text || typeof text !== 'string') {
    return { ops: [], summary: '', confidence: 0, raw: '', parse_error: 'empty response' };
  }
  // Удалим markdown-обёртку ```json ... ``` если есть
  let body = text.trim();
  const fenceMatch = body.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) body = fenceMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return { ops: [], summary: '', confidence: 0, raw: text, parse_error: e.message };
  }

  const ops = Array.isArray(parsed.ops) ? parsed.ops : [];
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;
  return { ops, summary, confidence, raw: text, parse_error: null };
}

/**
 * Преобразовать TipTap doc JSON → HTML строку (только paragraph/heading/text).
 * Нужен потому что AI возвращает op либо как `text` (plain), либо `content`/`doc`
 * (TipTap JSON) — фронт хочет HTML для editor.commands.setContent.
 */
function _tiptapDocToHtml(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const escape = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  const out = [];
  for (const node of nodes) {
    const t = node && node.type;
    const children = Array.isArray(node && node.content) ? node.content : [];
    const text = children
      .map(c => (c && c.type === 'text' && typeof c.text === 'string') ? escape(c.text) : '')
      .join('');
    if (!text.trim()) continue;
    if (t === 'paragraph') out.push(`<p>${text}</p>`);
    else if (t === 'heading') {
      const lvl = Math.min(6, Math.max(1, (node.attrs && node.attrs.level) || 2));
      out.push(`<h${lvl}>${text}</h${lvl}>`);
    } else {
      out.push(`<p>${text}</p>`);
    }
  }
  return out.join('');
}

/**
 * Нормализовать op: добавить унифицированное поле `html` независимо от того,
 * что AI вернул — `text`, `content`, `doc`, `html`. Фронт-парсер (applyOps.js)
 * в первую очередь читает `html`, остальные ключи остаются как есть для
 * обратной совместимости.
 */
function _normalizeOp(op) {
  if (op.html && typeof op.html === 'string') return op;
  if (typeof op.text === 'string') {
    const escape = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const paras = op.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    return { ...op, html: paras.map(p => `<p>${escape(p)}</p>`).join('') };
  }
  for (const k of ['content', 'doc']) {
    if (op[k] && typeof op[k] === 'object' && op[k].type === 'doc') {
      return { ...op, html: _tiptapDocToHtml(op[k]) };
    }
  }
  return op;
}

/**
 * Валидация ops через whitelist. Незнакомые → отбрасываем + список причин.
 * Дополнительно нормализуем формат: добавляем `html` если AI вернул text/content/doc.
 */
function filterOpsByWhitelist(ops) {
  const valid = [];
  const rejected = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') {
      rejected.push({ op: null, reason: 'not_object' });
      continue;
    }
    const name = String(op.op || op.type || '').trim();
    if (!OP_WHITELIST.includes(name)) {
      rejected.push({ op: name, reason: 'not_in_whitelist' });
      continue;
    }
    valid.push(_normalizeOp({ ...op, op: name }));
  }
  return { valid, rejected };
}

/**
 * Sleep helper для retry.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Один вызов AI с graceful обработкой retriable 400.
 */
async function callAiOnce({ system, messages, model, mode }) {
  const responseFormat = mode === 'edit' ? { type: 'json_object' } : null;
  return aiProvider.complete({
    system,
    messages,
    maxTokens: 8000,
    temperature: mode === 'edit' ? 0.2 : 0.5,
    model,
    responseFormat
  });
}

/**
 * Распознать retriable HTTP 400 от RouterAI (перегруз / Request error).
 */
function isRetriableProvider400(err) {
  const msg = String(err && err.message || err || '');
  if (/HTTP\s*400/i.test(msg)) return true;
  if (/Request\s*error/i.test(msg)) return true;
  if (/Bad\s*Request/i.test(msg)) return true;
  return false;
}

module.exports = async function mimirLetterRoutes(fastify) {
  const db = fastify.db;

  fastify.post('/letter-edit', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['correspondence_id', 'instruction', 'mode'],
        properties: {
          correspondence_id: { type: 'integer', minimum: 1 },
          conversation_id:   { type: ['integer', 'null'], minimum: 1 },
          current_doc:       { type: ['object', 'null'] },
          instruction:       { type: 'string', minLength: 1, maxLength: 8000 },
          mode:              { type: 'string', enum: ['discuss', 'edit'] },
          model:             { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    if (!hasCorrespondenceAccess(request.user)) {
      return reply.code(403).send({ error: 'Нет доступа к корреспонденции' });
    }

    const {
      correspondence_id,
      conversation_id: convInBody,
      current_doc,
      instruction,
      mode
    } = request.body;

    // ─── 1) Model resolution ──────────────────────────────────────────
    const modelResolution = resolveModel(request.body.model);
    let model = modelResolution.model;
    if (modelResolution.was_replaced) {
      request.log.warn(
        `[mimir-letter] requested model="${modelResolution.requested}" не в whitelist → fallback на ${model}`
      );
    }

    // ─── 2) Load correspondence + RBAC (свои/чужие через ownership) ───
    const corr = await correspondenceService.getCorrespondenceById(db, correspondence_id);
    if (!corr) {
      return reply.code(404).send({ error: 'Корреспонденция не найдена' });
    }
    // Минимальный RBAC: PM/TO/HEAD_* — только своя или сущность-родитель.
    // Override-роли (ADMIN/DIRECTOR_*/OFFICE_MANAGER) — всё.
    const OVERRIDE = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'OFFICE_MANAGER'];
    if (!OVERRIDE.includes(request.user.role) && Number(corr.created_by) !== Number(request.user.id)) {
      // Дополнительно: разрешаем если у пользователя есть владение по parent_entity.
      // Упрощённая проверка (full team-aware → S-10 AUD как F-15).
      return reply.code(403).send({ error: 'Доступ только к своим письмам или с override-ролью' });
    }

    // ─── 3) Build context ─────────────────────────────────────────────
    let ctx;
    try {
      ctx = await letterContextBuilder.buildLetterContext({
        correspondence_id,
        conversation_id: convInBody || null,
        model,
        db,
        userId: request.user.id
      });
    } catch (e) {
      request.log.error({ err: e }, '[mimir-letter] buildLetterContext failed');
      return reply.code(500).send({ error: `Не удалось собрать контекст: ${e.message}` });
    }

    // ─── 4) Build messages (history + user instruction + current_doc для edit) ──
    let convId = convInBody || null;
    let historyMessages = [];
    if (convId) {
      try {
        const r = await db.query(
          `SELECT role, content FROM mimir_messages
             WHERE conversation_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
          [convId, HISTORY_LIMIT]
        );
        historyMessages = r.rows.reverse().map(m => ({ role: m.role, content: m.content }));
      } catch (e) {
        request.log.warn({ err: e }, '[mimir-letter] history fetch failed, продолжаем без неё');
      }
    }

    const userContentParts = [];
    // Контекст-блок добавим первой user-сообщением (или влепим в system?), решаем
    // вкладывать его в user, чтобы system остался чисто инструкцией.
    if (ctx.contextBlock && ctx.contextBlock.length > 0) {
      userContentParts.push(`КОНТЕКСТ:\n${ctx.contextBlock}`);
    }
    userContentParts.push(`ЗАДАЧА: ${instruction}`);
    if (mode === 'edit') {
      // Минификация — TipTap-doc'и могут быть толстыми. По спеке pretty-печатаем,
      // но если >100KB — компактируем.
      const docStr = JSON.stringify(current_doc || {}, null, 2);
      const docCompact = docStr.length > 100000 ? JSON.stringify(current_doc || {}) : docStr;
      userContentParts.push(`ТЕКУЩИЙ ДОК (TipTap JSON):\n${docCompact}`);
    }

    const messages = [
      ...historyMessages,
      { role: 'user', content: userContentParts.join('\n\n') }
    ];

    // ─── 5) AI вызов с retry на DEFAULT при 400 ────────────────────────
    let aiResult;
    try {
      aiResult = await callAiOnce({ system: ctx.system, messages, model, mode });
    } catch (e) {
      if (isRetriableProvider400(e) && model !== DEFAULT_MODEL) {
        request.log.warn(
          `[mimir-letter] Provider 400 на model=${model} — retry через ${PROVIDER_RETRY_DELAY_MS}ms на ${DEFAULT_MODEL}`
        );
        await sleep(PROVIDER_RETRY_DELAY_MS);
        try {
          model = DEFAULT_MODEL;
          aiResult = await callAiOnce({ system: ctx.system, messages, model, mode });
        } catch (e2) {
          request.log.error({ err: e2 }, '[mimir-letter] retry на DEFAULT тоже упал');
          return reply.code(502).send({
            error: `AI недоступен: ${e2.message}`,
            context_stats: ctx.stats
          });
        }
      } else {
        request.log.error({ err: e }, '[mimir-letter] AI call failed');
        return reply.code(502).send({
          error: `AI недоступен: ${e.message}`,
          context_stats: ctx.stats
        });
      }
    }

    const aiText = aiResult.text || '';

    // ─── 6) Парсинг ответа ────────────────────────────────────────────
    let payload;
    if (mode === 'discuss') {
      payload = {
        success: true,
        mode: 'discuss',
        text: aiText
      };
    } else {
      const parsed = parseEditResponse(aiText);
      const filtered = filterOpsByWhitelist(parsed.ops);

      // Если parse_error или ops пуст И summary пуст — отдадим 422 + raw для UI
      if (parsed.parse_error || (filtered.valid.length === 0 && !parsed.summary)) {
        // Залогируем в mimir_usage_log для последующего анализа.
        if (parsed.parse_error) {
          try {
            await db.query(
              `INSERT INTO mimir_usage_log (user_id, provider, model, success, error_message)
               VALUES ($1, $2, $3, FALSE, $4)`,
              [
                request.user.id,
                aiResult.provider || 'unknown',
                aiResult.model || model,
                `letter-edit JSON parse error: ${parsed.parse_error}`
              ]
            );
          } catch (_) { /* mimir_usage_log может не существовать на тестовом клоне */ }
        }
        return reply.code(422).send({
          success: false,
          mode: 'edit',
          ops: [],
          summary: '',
          confidence: 0,
          parse_error: parsed.parse_error || 'empty_ops_and_summary',
          raw_text: aiText.slice(0, 4000),
          context_stats: ctx.stats,
          model
        });
      }

      // Залогируем выброшенные ops (если были)
      if (filtered.rejected.length > 0) {
        for (const rej of filtered.rejected) {
          try {
            await db.query(
              `INSERT INTO mimir_usage_log (user_id, provider, model, success, error_message)
               VALUES ($1, $2, $3, TRUE, $4)`,
              [
                request.user.id,
                aiResult.provider || 'unknown',
                aiResult.model || model,
                `unknown_op:${rej.op || 'null'}`
              ]
            );
          } catch (_) { /* */ }
        }
      }

      payload = {
        success: true,
        mode: 'edit',
        ops: filtered.valid,
        summary: parsed.summary,
        confidence: parsed.confidence,
        rejected_ops: filtered.rejected.length > 0 ? filtered.rejected : undefined
      };
    }

    // ─── 7) Сохранить в mimir_messages + создать conversation если нет ──
    if (!convId) {
      try {
        const newConv = await db.query(
          `INSERT INTO mimir_conversations (user_id, title, last_message_at, message_count)
             VALUES ($1, $2, NOW(), 0)
             RETURNING id`,
          [request.user.id, `Письмо #${correspondence_id}`]
        );
        convId = newConv.rows[0].id;
      } catch (e) {
        request.log.warn({ err: e }, '[mimir-letter] не удалось создать conversation, сохранение messages пропущено');
      }
    }
    if (convId) {
      try {
        await db.query(
          `INSERT INTO mimir_messages (conversation_id, role, content, content_type)
             VALUES ($1, 'user', $2, 'text')`,
          [convId, instruction]
        );
        await db.query(
          `INSERT INTO mimir_messages (conversation_id, role, content, content_type,
                                        tokens_input, tokens_output, model_used, duration_ms)
             VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7)`,
          [
            convId,
            mode === 'discuss' ? payload.text : JSON.stringify({
              ops: payload.ops,
              summary: payload.summary,
              confidence: payload.confidence
            }),
            mode === 'discuss' ? 'text' : 'json',
            aiResult.usage?.inputTokens || 0,
            aiResult.usage?.outputTokens || 0,
            aiResult.model || model,
            aiResult.durationMs || null
          ]
        );
        // Обновим conversation метаданные
        const preview = (mode === 'discuss' ? payload.text : (payload.summary || ''))
          .replace(/\s+/g, ' ').slice(0, 200);
        await db.query(
          `UPDATE mimir_conversations
              SET message_count = message_count + 2,
                  total_tokens = total_tokens + $1,
                  last_message_at = NOW(),
                  last_message_preview = $2
            WHERE id = $3`,
          [
            (aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0),
            preview,
            convId
          ]
        );
      } catch (e) {
        request.log.warn({ err: e }, '[mimir-letter] сохранение messages упало (не блокер)');
      }
    }

    // ─── 8) UPDATE correspondence: ai_thread_id / ai_model / ai_tokens_used ──
    try {
      const usedTokens = (aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0);
      await db.query(
        `UPDATE correspondence
            SET ai_thread_id = COALESCE($1, ai_thread_id),
                ai_model = $2,
                ai_tokens_used = COALESCE(ai_tokens_used, 0) + $3,
                updated_at = NOW()
          WHERE id = $4`,
        [convId, model, usedTokens, correspondence_id]
      );
    } catch (e) {
      request.log.warn({ err: e }, '[mimir-letter] UPDATE correspondence ai_* упало (не блокер)');
    }

    // ─── 9) Финальный ответ ───────────────────────────────────────────
    return {
      ...payload,
      conversation_id: convId,
      context_stats: ctx.stats,
      model: aiResult.model || model,
      requested_model: modelResolution.was_replaced ? modelResolution.requested : undefined,
      usage: aiResult.usage || null
    };
  });
};

// Экспортируем константы для тестов и для AUD-проверки.
module.exports.ALLOWED_MODELS = ALLOWED_MODELS;
module.exports.DEFAULT_MODEL = DEFAULT_MODEL;
module.exports.OP_WHITELIST = OP_WHITELIST;
module.exports.CORRESPONDENCE_ROLES = CORRESPONDENCE_ROLES;
module.exports.parseEditResponse = parseEditResponse;
module.exports.filterOpsByWhitelist = filterOpsByWhitelist;
module.exports.resolveModel = resolveModel;
module.exports.isRetriableProvider400 = isRetriableProvider400;
