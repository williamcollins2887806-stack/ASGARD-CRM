/**
 * ASGARD CRM - Mimir AI Assistant Routes v3.0
 *
 * РџРѕР»РЅС‹Р№ С„СѓРЅРєС†РёРѕРЅР°Р»:
 * - Р§Р°С‚ СЃ AI (Claude / OpenAI)
 * - РЎС‚СЂРёРјРёРЅРі РѕС‚РІРµС‚РѕРІ (SSE)
 * - РСЃС‚РѕСЂРёСЏ РґРёР°Р»РѕРіРѕРІ
 * - Р—Р°РіСЂСѓР·РєР° Рё Р°РЅР°Р»РёР· С„Р°Р№Р»РѕРІ (PDF, DOCX, XLSX, РёР·РѕР±СЂР°Р¶РµРЅРёСЏ)
 * - Р“РµРЅРµСЂР°С†РёСЏ РўРљРџ
 * - РЈРјРЅС‹Рµ СЂРµРєРѕРјРµРЅРґР°С†РёРё
 * - РћРіСЂР°РЅРёС‡РµРЅРёСЏ РїРѕ СЂРѕР»СЏРј
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// РЎРµСЂРІРёСЃС‹
const aiProvider = require('../services/ai-provider');
const mimirData = require('../services/mimir-data');
const mimirSchema = require('../services/mimir-schema');
const { notClosedSql } = require('../helpers/work-status');
const mimirJobs = require('../services/mimir-jobs'); // persistent storage РґР»СЏ РїСЂРѕСЃС‡С‘С‚РѕРІ

async function mimirRoutes(fastify, options) {
  const db = fastify.db;

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 1: РЈРџР РђР’Р›Р•РќРР• Р”РРђР›РћР“РђРњР (CRUD)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // РџРѕР»СѓС‡РёС‚СЊ СЃРїРёСЃРѕРє РґРёР°Р»РѕРіРѕРІ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
  fastify.get('/conversations', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { limit = 30, archived = 'false' } = request.query;

    try {
      const isArchived = archived === 'true';
      const result = await db.query(`
        SELECT id, title, is_pinned, is_archived, message_count, last_message_at,
               last_message_preview, created_at, updated_at
        FROM mimir_conversations
        WHERE user_id = $1 AND is_archived = $2
        ORDER BY is_pinned DESC, updated_at DESC
        LIMIT $3
      `, [user.id, isArchived, parseInt(limit)]);

      return { success: true, conversations: result.rows };
    } catch (e) {
      fastify.log.error('Get conversations error:', e.message);
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РґРёР°Р»РѕРіРѕРІ' });
    }
  });

  // РЎРѕР·РґР°С‚СЊ РЅРѕРІС‹Р№ РґРёР°Р»РѕРі
  fastify.post('/conversations', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { title } = request.body || {};

    try {
      const result = await db.query(`
        INSERT INTO mimir_conversations (user_id, title)
        VALUES ($1, $2)
        RETURNING id, title, created_at
      `, [user.id, title || 'РќРѕРІС‹Р№ РґРёР°Р»РѕРі']);

      return { success: true, conversation: result.rows[0] };
    } catch (e) {
      fastify.log.error('Create conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РґРёР°Р»РѕРіР°' });
    }
  });

  // РџРѕР»СѓС‡РёС‚СЊ РґРёР°Р»РѕРі СЃ РёСЃС‚РѕСЂРёРµР№ СЃРѕРѕР±С‰РµРЅРёР№
  fastify.get('/conversations/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const convId = parseInt(request.params.id);

    try {
      // РџСЂРѕРІРµСЂСЏРµРј РїСЂРёРЅР°РґР»РµР¶РЅРѕСЃС‚СЊ РґРёР°Р»РѕРіР°
      const conv = await db.query(
        'SELECT * FROM mimir_conversations WHERE id = $1 AND user_id = $2',
        [convId, user.id]
      );

      if (conv.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'Р”РёР°Р»РѕРі РЅРµ РЅР°Р№РґРµРЅ' });
      }

      // РџРѕР»СѓС‡Р°РµРј СЃРѕРѕР±С‰РµРЅРёСЏ
      const messages = await db.query(`
        SELECT id, role, content, content_type, has_files, file_names,
               search_results, tokens_input, tokens_output, model_used, created_at
        FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `, [convId]);

      return {
        success: true,
        conversation: conv.rows[0],
        messages: messages.rows
      };
    } catch (e) {
      fastify.log.error('Get conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РґРёР°Р»РѕРіР°' });
    }
  });

  // РћР±РЅРѕРІРёС‚СЊ РґРёР°Р»РѕРі (title, is_pinned)
  fastify.patch('/conversations/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const convId = parseInt(request.params.id);
    const { title, is_pinned } = request.body || {};

    try {
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramIndex++}`);
        params.push(title);
      }
      if (is_pinned !== undefined) {
        updates.push(`is_pinned = $${paramIndex++}`);
        params.push(is_pinned);
      }

      if (updates.length === 0) {
        return { success: true, message: 'РќРµС‚ РёР·РјРµРЅРµРЅРёР№' };
      }

      params.push(convId, user.id);
      const result = await db.query(`
        UPDATE mimir_conversations
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
        RETURNING *
      `, params);

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'Р”РёР°Р»РѕРі РЅРµ РЅР°Р№РґРµРЅ' });
      }

      return { success: true, conversation: result.rows[0] };
    } catch (e) {
      fastify.log.error('Update conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ РґРёР°Р»РѕРіР°' });
    }
  });

  // РЈРґР°Р»РёС‚СЊ РґРёР°Р»РѕРі (РјСЏРіРєРѕРµ СѓРґР°Р»РµРЅРёРµ вЂ” Р°СЂС…РёРІР°С†РёСЏ)
  fastify.delete('/conversations/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const convId = parseInt(request.params.id);

    try {
      const result = await db.query(`
        UPDATE mimir_conversations
        SET is_archived = TRUE
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [convId, user.id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'Р”РёР°Р»РѕРі РЅРµ РЅР°Р№РґРµРЅ' });
      }

      return { success: true, message: 'Р”РёР°Р»РѕРі Р°СЂС…РёРІРёСЂРѕРІР°РЅ' };
    } catch (e) {
      fastify.log.error('Delete conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° СѓРґР°Р»РµРЅРёСЏ РґРёР°Р»РѕРіР°' });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 2: РћРЎРќРћР’РќРћР™ Р§РђРў
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // Р“Р»Р°РІРЅС‹Р№ С‡Р°С‚ (РѕР±СЂР°С‚РЅРѕ СЃРѕРІРјРµСЃС‚РёРјС‹Р№)
  fastify.post('/chat', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context, conversation_id } = request.body;
    const user = request.user;

    if (!message?.trim()) {
      return reply.code(400).send({ success: false, message: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
    }

    const startTime = Date.now();

    try {
      let convId = conversation_id;

      // РЎРѕР·РґР°С‘Рј РґРёР°Р»РѕРі РµСЃР»Рё РЅРµ РїРµСЂРµРґР°РЅ
      if (!convId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'РќРѕРІС‹Р№ РґРёР°Р»РѕРі']);
        convId = newConv.rows[0].id;
      }

      // Р—Р°РіСЂСѓР¶Р°РµРј Р’РЎР® РёСЃС‚РѕСЂРёСЋ (270K РєРѕРЅС‚РµРєСЃС‚ РїРѕР·РІРѕР»СЏРµС‚)
      const history = await db.query(`
        SELECT role, content FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `, [convId]);

      const historyMessages = history.rows;

      // РћР±СЂР°Р±РѕС‚РєР° Р·Р°РїСЂРѕСЃР° вЂ” РїРѕРёСЃРє РґР°РЅРЅС‹С… (regex)
      const { additionalData, results, action } = await mimirData.processQuery(db, message, user);

      // Text-to-SQL: AI РіРµРЅРµСЂРёСЂСѓРµС‚ SQL в†’ СЃРµСЂРІРµСЂ РІС‹РїРѕР»РЅСЏРµС‚ в†’ РґР°РЅРЅС‹Рµ РІ РєРѕРЅС‚РµРєСЃС‚
      let sqlContext = '';
      try {
        const { dataContext, sql, rowCount } = await mimirSchema.textToSQL(aiProvider, db, message, user);
        if (dataContext) {
          sqlContext = '\n\n[Р”РђРќРќР«Р• РР— Р‘Р”]\n' + dataContext;
        }
      } catch (e) { /* Text-to-SQL РЅРµ РєСЂРёС‚РёС‡РµРЅ, РїСЂРѕРґРѕР»Р¶Р°РµРј Р±РµР· РґР°РЅРЅС‹С… */ }

      let userMessage = message;
      if (context) userMessage = '[Р Р°Р·РґРµР»: ' + context + ']\n' + userMessage;
      if (additionalData) userMessage += additionalData;
      if (sqlContext) userMessage += sqlContext;

      // РЎС‚СЂРѕРёРј СЃРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚
      const systemPrompt = await mimirData.buildSystemPrompt(db, user);

      // Р¤РѕСЂРјРёСЂСѓРµРј РјР°СЃСЃРёРІ СЃРѕРѕР±С‰РµРЅРёР№ РґР»СЏ AI
      const aiMessages = [
        ...historyMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      // Р’С‹Р·РѕРІ AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.5
      });

      const durationMs = Date.now() - startTime;
      const aiResponse = aiResult.text || 'Р СѓРЅС‹ РјРѕР»С‡Р°С‚. РџРѕРїСЂРѕР±СѓР№ РїРµСЂРµС„СЂР°Р·РёСЂРѕРІР°С‚СЊ.';

      // РЎРѕС…СЂР°РЅСЏРµРј СЃРѕРѕР±С‰РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, search_results)
        VALUES ($1, 'user', $2, $3)
      `, [convId, message, results ? JSON.stringify(results) : null]);

      // РЎРѕС…СЂР°РЅСЏРµРј РѕС‚РІРµС‚ Р°СЃСЃРёСЃС‚РµРЅС‚Р°
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
      `, [convId, aiResponse, aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, aiResult.model, durationMs]);

      // РћР±РЅРѕРІР»СЏРµРј РјРµС‚Р°РґР°РЅРЅС‹Рµ РґРёР°Р»РѕРіР°
      const preview = aiResponse.substring(0, 100);
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [(aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0), preview, convId]);

      // РђРІС‚РѕРіРµРЅРµСЂР°С†РёСЏ Р·Р°РіРѕР»РѕРІРєР° РґР»СЏ РЅРѕРІРѕРіРѕ РґРёР°Р»РѕРіР°
      if (!conversation_id && historyMessages.length === 0) {
        generateTitle(db, convId, message, aiResponse).catch(e => {
          fastify.log.warn('Title generation failed:', e.message);
        });
      }

      // Р›РѕРіРёСЂСѓРµРј РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ
      await logUsage(db, user.id, convId, aiResult);

      return {
        success: true,
        response: aiResponse,
        results: results,
        action: action || null,
        conversation_id: convId,
        userRole: user?.role,
        tokens: aiResult.usage
      };

    } catch (error) {
      fastify.log.error('Mimir error: ' + error.message);

      // Р›РѕРіРёСЂСѓРµРј РѕС€РёР±РєСѓ
      try {
        const prov = (aiProvider.getProvider && aiProvider.getProvider()) || 'unknown';
        const mdl = (aiProvider.getConfig && aiProvider.getConfig()?.model) || 'unknown';
        await db.query(`
          INSERT INTO mimir_usage_log (user_id, provider, model, success, error_message)
          VALUES ($1, $2, $3, FALSE, $4)
        `, [user.id, prov, mdl, String(error.message || error).slice(0, 2000)]);
      } catch (e) { /* ignore */ }

      // Р§РµР»РѕРІРµС‡РµСЃРєРёРµ СЃРѕРѕР±С‰РµРЅРёСЏ РґР»СЏ РёР·РІРµСЃС‚РЅС‹С… РѕС€РёР±РѕРє
      const errMsg = String(error.message || '');
      let userMessage = 'РћРґРёРЅ РёР· РІРѕСЂРѕРЅРѕРІ Р·Р°Р±Р»СѓРґРёР»СЃСЏ... РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.';
      if (errMsg.includes('402') || errMsg.includes('РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ') || errMsg.includes('insufficient')) {
        userMessage = 'AI-РїСЂРѕРІР°Р№РґРµСЂ РІСЂРµРјРµРЅРЅРѕ РЅРµРґРѕСЃС‚СѓРїРµРЅ (Р±Р°Р»Р°РЅСЃ РёСЃС‡РµСЂРїР°РЅ). РћР±СЂР°С‚РёС‚РµСЃСЊ Рє Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.';
      } else if (errMsg.includes('403') || errMsg.includes('PermissionDenied')) {
        userMessage = 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє AI-СЃРµСЂРІРёСЃСѓ. РћР±СЂР°С‚РёС‚РµСЃСЊ Рє Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂСѓ.';
      } else if (errMsg.includes('timeout') || errMsg.includes('AbortError')) {
        userMessage = 'AI-СЃРµСЂРІРёСЃ РЅРµ РѕС‚РІРµС‚РёР» РІРѕРІСЂРµРјСЏ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.';
      }
      return reply.code(500).send({
        success: false,
        error: userMessage,
        message: userMessage
      });
    }
  });

  // GET /chat/models вЂ” СЃРїРёСЃРѕРє РґРѕСЃС‚СѓРїРЅС‹С… РјРѕРґРµР»РµР№ С‡Р°С‚Р° (РґР»СЏ UI-selector'a РІ РҐСѓРіРёРЅРµ Рё Р¤РђР‘).
  fastify.get('/chat/models', { preHandler: [fastify.authenticate] }, async () => {
    const chatModels = require('../services/chat-models');
    return { models: chatModels.getModels(), default: chatModels.getDefault().id };
  });

  // Р§Р°С‚ СЃРѕ СЃС‚СЂРёРјРёРЅРіРѕРј (SSE)
  fastify.post('/chat-stream', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context, conversation_id, model: requestedModel } = request.body || {};
    const user = request.user;

    // Р РµР·РѕР»РІ РјРѕРґРµР»Рё РёР· СЂРµРµСЃС‚СЂР°. Р•СЃР»Рё РєР»РёРµРЅС‚ РїСЂРёСЃР»Р°Р» РЅРµРІР°Р»РёРґРЅС‹Р№ id вЂ” fallback РЅР° default.
    const chatModels = require('../services/chat-models');
    const modelConfig = chatModels.getModel(requestedModel) || chatModels.getDefault();
    const systemMode = modelConfig.system_mode;     // 'light' | 'full'
    const modelId = modelConfig.id;

    if (!message?.trim()) {
      return reply.code(400).send({ success: false, message: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
    }

    // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј SSE headers
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendEvent = (data) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const startTime = Date.now();
    let convId = conversation_id;
    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // РЎРѕР·РґР°С‘Рј РґРёР°Р»РѕРі РµСЃР»Рё РЅРµ РїРµСЂРµРґР°РЅ
      if (!convId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'РќРѕРІС‹Р№ РґРёР°Р»РѕРі']);
        convId = newConv.rows[0].id;
      }

      sendEvent({ type: 'start', conversation_id: convId, model: modelId, system_mode: systemMode });

      // === LIGHT-СЂРµР¶РёРј: РјРёРЅРёРјР°Р»СЊРЅС‹Р№ РїСЂРѕРјРїС‚, Р±РµР· Р‘Р”-РєРѕРЅС‚РµРєСЃС‚Р°, Р±РµР· РёСЃС‚РѕСЂРёРё, Р±РµР· Text-to-SQL ===
      // РџРѕРґС…РѕРґРёС‚ РґР»СЏ Р±С‹СЃС‚СЂС‹С… РІРѕРїСЂРѕСЃРѕРІ РІСЂРѕРґРµ В«РєР°Рє СЃРѕР·РґР°С‚СЊ С‚РµРЅРґРµСЂВ», В«РіРґРµ РїРѕСЃРјРѕС‚СЂРµС‚СЊ РѕС‚С‡С‘С‚В».
      // РќРµ РЅР°РіСЂСѓР¶Р°РµС‚ РјРѕРґРµР»СЊ вЂ” light-tier РЅР° РґР»РёРЅРЅРѕРј СЃРёСЃС‚РµРјРЅРѕРј prompt'Рµ РѕР±СЂС‹РІР°РµС‚ РѕС‚РІРµС‚
      // РїРѕСЃР»Рµ РѕРґРЅРѕРіРѕ chunk'Р°. Р­С‚Р° РІРµС‚РєР° РѕР±С…РѕРґРёС‚ РїСЂРѕР±Р»РµРјСѓ.
      let systemPrompt;
      let aiMessages;

      if (systemMode === 'light') {
        systemPrompt = 'РўС‹ РњРёРјРёСЂ вЂ” РР-РїРѕРјРѕС‰РЅРёРє РІ ASGARD CRM (СЃС‚СЂРѕР№РїРѕРґСЂСЏРґ, ' +
          'РїСЂРѕРјС‹РІРєРё, С…РёРјРѕС‡РёСЃС‚РєРё). РџРѕРјРѕРіР°РµС€СЊ СЃРѕС‚СЂСѓРґРЅРёРєР°Рј СЃ РЅР°РІРёРіР°С†РёРµР№ РїРѕ СЃРёСЃС‚РµРјРµ ' +
          'Рё РѕР±С‰РёРјРё РІРѕРїСЂРѕСЃР°РјРё. РћС‚РІРµС‡Р°Р№ РєСЂР°С‚РєРѕ (2вЂ“4 РїСЂРµРґР»РѕР¶РµРЅРёСЏ), РЅР° СЂСѓСЃСЃРєРѕРј, Р±РµР· СЌРјРѕРґР·Рё. ' +
          'Р•СЃР»Рё РІРѕРїСЂРѕСЃ С‚СЂРµР±СѓРµС‚ РґР°РЅРЅС‹С… РёР· Р‘Р” вЂ” РїРѕРїСЂРѕСЃРё РїРµСЂРµРєР»СЋС‡РёС‚СЊ РјРѕРґРµР»СЊ РЅР° В«РґСѓРјР°СЋС‰СѓСЋВ» (GPT-5.5).';
        let userMessage = message;
        if (context) userMessage = '[Р Р°Р·РґРµР»: ' + context + ']\n' + userMessage;
        aiMessages = [{ role: 'user', content: userMessage }];
      } else {
        // === FULL-СЂРµР¶РёРј: С‚РµРєСѓС‰РёР№ С‚СЏР¶С‘Р»С‹Р№ РїСѓС‚СЊ СЃ РёСЃС‚РѕСЂРёРµР№+Р‘Р”+text-to-SQL. ===
        const history = await db.query(`
          SELECT role, content FROM mimir_messages
          WHERE conversation_id = $1
          ORDER BY created_at ASC
        `, [convId]);
        const historyMessages = history.rows;

        const { additionalData, results, action: streamAction } = await mimirData.processQuery(db, message, user);
        if (results) sendEvent({ type: 'results', data: results });
        if (streamAction) sendEvent({ type: 'action', data: streamAction });

        let sqlContext = '';
        try {
          const { dataContext } = await mimirSchema.textToSQL(aiProvider, db, message, user);
          if (dataContext) {
            sqlContext = '\n\n[Р”РђРќРќР«Р• РР— Р‘Р”]\n' + dataContext;
            sendEvent({ type: 'status', message: 'Р”Р°РЅРЅС‹Рµ РёР· Р‘Р” РїРѕР»СѓС‡РµРЅС‹' });
          }
        } catch (e) { /* Text-to-SQL РЅРµ РєСЂРёС‚РёС‡РµРЅ */ }

        let userMessage = message;
        if (context) userMessage = '[Р Р°Р·РґРµР»: ' + context + ']\n' + userMessage;
        if (additionalData) userMessage += additionalData;
        if (sqlContext) userMessage += sqlContext;

        systemPrompt = await mimirData.buildSystemPrompt(db, user);
        aiMessages = [
          ...historyMessages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage }
        ];
      }

      const streamResponse = await aiProvider.stream({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.5,
        model: modelId
      });

      // РџР°СЂСЃРёРј РїРѕС‚РѕРє
      const streamParser = aiProvider.parseStream(streamResponse, aiProvider.getProvider());

      for await (const event of streamParser) {
        // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ РѕС‚РєР»СЋС‡РёР»СЃСЏ Р»Рё РєР»РёРµРЅС‚
        if (request.raw.destroyed) {
          break;
        }

        if (event.type === 'text') {
          fullResponse += event.content;
          sendEvent({ type: 'text', content: event.content });
        } else if (event.type === 'reasoning') {
          // reasoning_content РѕС‚ reasoning-РјРѕРґРµР»РµР№ вЂ” РѕС‚РґРµР»СЊРЅС‹Р№ РїРѕС‚РѕРє
          // РјС‹СЃР»РµР№. РЁР»С‘Рј РєР»РёРµРЅС‚Сѓ РґР»СЏ UX (РјРѕР¶РЅРѕ РїРѕРєР°Р·Р°С‚СЊ В«РњРёРјРёСЂ СЂР°Р·РјС‹С€Р»СЏРµС‚: вЂ¦В»),
          // РЅРѕ РЅРµ РґРѕР±Р°РІР»СЏРµРј РІ fullResponse вЂ” СЌС‚Рѕ РЅРµ С„РёРЅР°Р»СЊРЅС‹Р№ РѕС‚РІРµС‚.
          sendEvent({ type: 'reasoning', content: event.content });
        } else if (event.type === 'done') {
          inputTokens = event.usage?.inputTokens || 0;
          outputTokens = event.usage?.outputTokens || 0;
        } else if (event.type === 'error') {
          sendEvent({ type: 'error', message: event.message });
        }
      }

      const durationMs = Date.now() - startTime;

      // РЎРѕС…СЂР°РЅСЏРµРј СЃРѕРѕР±С‰РµРЅРёСЏ
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, search_results)
        VALUES ($1, 'user', $2, $3)
      `, [convId, message, results ? JSON.stringify(results) : null]);

      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
      `, [convId, fullResponse, inputTokens, outputTokens, aiProvider.getConfig().model, durationMs]);

      // РћР±РЅРѕРІР»СЏРµРј РґРёР°Р»РѕРі
      const preview = fullResponse.substring(0, 100);
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [inputTokens + outputTokens, preview, convId]);

      // РђРІС‚РѕРіРµРЅРµСЂР°С†РёСЏ Р·Р°РіРѕР»РѕРІРєР°
      if (!conversation_id && historyMessages.length === 0) {
        generateTitle(db, convId, message, fullResponse).catch(() => {});
      }

      // Р›РѕРіРёСЂСѓРµРј
      await logUsage(db, user.id, convId, {
        provider: aiProvider.getProvider(),
        model: aiProvider.getConfig().model,
        usage: { inputTokens, outputTokens },
        durationMs
      });

      sendEvent({
        type: 'done',
        tokens: { input: inputTokens, output: outputTokens },
        duration_ms: durationMs
      });

    } catch (error) {
      fastify.log.error({ err: error }, 'Stream error details');
      // РџСЂРµРѕР±СЂР°Р·СѓРµРј РєРѕРґ РѕС€РёР±РєРё РІ РїРѕРЅСЏС‚РЅРѕРµ СЋР·РµСЂСѓ СЃРѕРѕР±С‰РµРЅРёРµ + РїРѕРґСЃРєР°Р·РєСѓ РІС‹Р±СЂР°С‚СЊ
      // РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ. UI СЃРјРѕС‚СЂРёС‚ code='model_unavailable' С‡С‚РѕР±С‹ РїРѕРґСЃРІРµС‚РёС‚СЊ
      // СЃРµР»РµРєС‚РѕСЂ РјРѕРґРµР»Рё.
      const errMsg = String(error?.message || '');
      let humanMsg, code = 'model_error';
      if (/Insufficient balance|balance_rub/.test(errMsg)) {
        humanMsg = `РњРѕРґРµР»СЊ В«${modelId}В» РЅРµРґРѕСЃС‚СѓРїРЅР°: РЅР° USD-Р±Р°Р»Р°РЅСЃРµ РўРѕРєРµРЅР°С‚РѕСЂР° Р·Р°РєРѕРЅС‡РёР»РёСЃСЊ РґРµРЅСЊРіРё. Р’С‹Р±РµСЂРё РІ С€Р°РїРєРµ С‡Р°С‚Р° РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ (РЅР°РїСЂРёРјРµСЂ GPT-5.4 РёР»Рё GPT-5.5).`;
        code = 'model_unavailable';
      } else if (/HTTP 401|Request error/.test(errMsg)) {
        humanMsg = `РњРѕРґРµР»СЊ В«${modelId}В» РЅРµРґРѕСЃС‚СѓРїРЅР° РїРѕ СЌС‚РѕРјСѓ РєР»СЋС‡Сѓ РўРѕРєРµРЅР°С‚РѕСЂР°. Р’С‹Р±РµСЂРё РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ РІ С€Р°РїРєРµ С‡Р°С‚Р°.`;
        code = 'model_unavailable';
      } else if (/HTTP 5\d{2}/.test(errMsg)) {
        humanMsg = `РњРѕРґРµР»СЊ В«${modelId}В» СЃРµР№С‡Р°СЃ РЅРµРґРѕСЃС‚СѓРїРЅР° РЅР° СЃС‚РѕСЂРѕРЅРµ РўРѕРєРµРЅР°С‚РѕСЂР°. РџРѕРїСЂРѕР±СѓР№ РµС‰С‘ СЂР°Р· РёР»Рё РІС‹Р±РµСЂРё РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ.`;
        code = 'model_unavailable';
      } else {
        humanMsg = `РћС€РёР±РєР° РјРѕРґРµР»Рё В«${modelId}В»: ${errMsg.slice(0, 200)}. РџРѕРїСЂРѕР±СѓР№ РґСЂСѓРіСѓСЋ РјРѕРґРµР»СЊ РІ С€Р°РїРєРµ С‡Р°С‚Р°.`;
      }
      sendEvent({ type: 'error', code, model: modelId, message: humanMsg });
    }

    reply.raw.end();
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 3: РђРќРђР›РР— Р¤РђР™Р›РћР’
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  fastify.post('/analyze', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const parts = request.parts ? request.parts() : null;

    let message = '';
    let context = '';
    let conversationId = null;
    const filesData = [];

    try {
      if (parts) {
        for await (const part of parts) {
          if (part.file) {
            const chunks = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            // РћРіСЂР°РЅРёС‡РµРЅРёРµ СЂР°Р·РјРµСЂР°
            if (buffer.length > 20 * 1024 * 1024) {
              continue; // Skip files > 20MB
            }

            const fileData = await extractFileContent(buffer, part.filename, part.mimetype);
            filesData.push({
              name: part.filename,
              size: buffer.length,
              type: part.mimetype,
              data: fileData
            });
          } else {
            if (part.fieldname === 'message') message = part.value;
            if (part.fieldname === 'context') context = part.value;
            if (part.fieldname === 'conversation_id') conversationId = parseInt(part.value) || null;
          }
        }
      }
    } catch (e) {
      fastify.log.error('File parse error:', e.message);
    }

    if (filesData.length === 0) {
      return reply.code(400).send({ success: false, message: 'Р¤Р°Р№Р»С‹ РЅРµ Р·Р°РіСЂСѓР¶РµРЅС‹' });
    }

    const startTime = Date.now();

    try {
      // РЎРѕР·РґР°С‘Рј РґРёР°Р»РѕРі РµСЃР»Рё РЅСѓР¶РЅРѕ
      if (!conversationId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'РђРЅР°Р»РёР· С„Р°Р№Р»РѕРІ']);
        conversationId = newConv.rows[0].id;
      }

      const systemPrompt = await mimirData.buildSystemPrompt(db, user);

      // Р¤РѕСЂРјРёСЂСѓРµРј РєРѕРЅС‚РµРЅС‚ РґР»СЏ AI
      const aiMessages = [];
      const fileNames = filesData.map(f => f.name);

      // Р”Р»СЏ С‚РµРєСЃС‚РѕРІС‹С… С„Р°Р№Р»РѕРІ вЂ” РґРѕР±Р°РІР»СЏРµРј СЃРѕРґРµСЂР¶РёРјРѕРµ
      // Р”Р»СЏ РёР·РѕР±СЂР°Р¶РµРЅРёР№ вЂ” multimodal content
      const hasImages = filesData.some(f => f.data.type === 'image');

      if (hasImages) {
        // Multimodal Р·Р°РїСЂРѕСЃ СЃ РёР·РѕР±СЂР°Р¶РµРЅРёСЏРјРё
        const content = [];

        for (const file of filesData) {
          if (file.data.type === 'image') {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.data.media_type,
                data: file.data.data
              }
            });
          } else if (file.data.type === 'text') {
            content.push({
              type: 'text',
              text: `\n=== Р¤Р°Р№Р»: ${file.name} ===\n${file.data.content}\n`
            });
          }
        }

        content.push({
          type: 'text',
          text: message || 'РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЌС‚Рё РґРѕРєСѓРјРµРЅС‚С‹. Р”Р°Р№ РїРѕРґСЂРѕР±РЅС‹Р№ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РѕС‚С‡С‘С‚.'
        });

        aiMessages.push({ role: 'user', content });
      } else {
        // РўРѕР»СЊРєРѕ С‚РµРєСЃС‚РѕРІС‹Рµ С„Р°Р№Р»С‹
        let combinedContent = '';
        for (const file of filesData) {
          if (file.data.type === 'text') {
            combinedContent += `\n=== Р¤Р°Р№Р»: ${file.name} (${(file.size / 1024).toFixed(1)} РљР‘) ===\n`;
            combinedContent += file.data.content + '\n';
          }
        }

        combinedContent += '\n' + (message || 'РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЌС‚Рё РґРѕРєСѓРјРµРЅС‚С‹. Р”Р°Р№ РїРѕРґСЂРѕР±РЅС‹Р№ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РѕС‚С‡С‘С‚.');

        aiMessages.push({ role: 'user', content: combinedContent });
      }

      // Р’С‹Р·РѕРІ AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt + '\n\nРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р·Р°РіСЂСѓР·РёР» С„Р°Р№Р»С‹ РґР»СЏ Р°РЅР°Р»РёР·Р°. РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЃРѕРґРµСЂР¶РёРјРѕРµ Рё РґР°Р№ СЂР°Р·РІС‘СЂРЅСѓС‚С‹Р№ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РѕС‚РІРµС‚.',
        messages: aiMessages,
        maxTokens: 4096,
        temperature: 0.5
      });

      const durationMs = Date.now() - startTime;
      const aiResponse = aiResult.text || 'РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР°РЅР°Р»РёР·РёСЂРѕРІР°С‚СЊ С„Р°Р№Р»С‹.';

      // РЎРѕС…СЂР°РЅСЏРµРј СЃРѕРѕР±С‰РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, content_type, has_files, file_names)
        VALUES ($1, 'user', $2, 'file_analysis', TRUE, $3)
      `, [conversationId, message || 'РђРЅР°Р»РёР· С„Р°Р№Р»РѕРІ', fileNames]);

      // РЎРѕС…СЂР°РЅСЏРµРј РѕС‚РІРµС‚
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, content_type, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, 'file_analysis', $3, $4, $5, $6)
      `, [conversationId, aiResponse, aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, aiResult.model, durationMs]);

      // РћР±РЅРѕРІР»СЏРµРј РґРёР°Р»РѕРі
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [(aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0), aiResponse.substring(0, 100), conversationId]);

      // Р›РѕРіРёСЂСѓРµРј
      await logUsage(db, user.id, conversationId, aiResult);

      return {
        success: true,
        response: aiResponse,
        files: filesData.map(f => ({ name: f.name, size: f.size, type: f.type })),
        conversation_id: conversationId,
        tokens: aiResult.usage
      };

    } catch (error) {
      fastify.log.error({ err: error }, 'Analyze error');
      return reply.code(500).send({
        success: false,
        message: 'РћС€РёР±РєР° Р°РЅР°Р»РёР·Р° С„Р°Р№Р»РѕРІ'
      });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 4: РђРќРђР›РРўРРљРђ (СЃРѕС…СЂР°РЅРµРЅРѕ РёР· СЃС‚Р°СЂРѕР№ РІРµСЂСЃРёРё)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // Health check
  fastify.get('/health', {
    preHandler: [fastify.authenticate]
  }, async () => {
    const config = aiProvider.getConfig();
    return {
      status: 'ok',
      service: 'Mimir AI v3',
      provider: config.hasAnthropicKey || config.hasOpenAIKey ? config.provider : 'demo',
      model: config.hasAnthropicKey || config.hasOpenAIKey ? config.model : 'demo',
      demo: !config.hasAnthropicKey && !config.hasOpenAIKey,
      timestamp: new Date().toISOString()
    };
  });

  // РЎС‚Р°С‚РёСЃС‚РёРєР°
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const stats = await mimirData.getDbStats(db, request.user);
    return { success: true, userRole: request.user?.role, stats };
  });

  // РџРѕРёСЃРє
  fastify.get('/search', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { q, type } = request.query;
    if (!q || q.length < 2) return { success: false, results: [] };

    let results = [];
    if (type === 'works') {
      results = await mimirData.searchWorks(db, q, request.user);
    } else if (type === 'employees') {
      results = await mimirData.searchEmployees(db, q, request.user);
    } else {
      results = await mimirData.searchTenders(db, q, request.user);
    }

    return { success: true, count: results.length, results };
  });

  // РџРµСЂСЃРѕРЅР°Р»СЊРЅС‹Рµ РїРѕРґСЃРєР°Р·РєРё РґР»СЏ С‡РёРїРѕРІ РњРёРјРёСЂР°
  fastify.get('/suggestions', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    const suggestions = [];

    try {
      // РћР±С‰РёРµ РїРѕРґСЃРєР°Р·РєРё вЂ” РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ
      const unreadRes = await db.query(
        'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND is_read = false',
        [user.id]
      );
      const unread = parseInt(unreadRes.rows[0]?.cnt || 0);
      if (unread > 0) {
        suggestions.push({ icon: 'рџ””', label: `РЈРІРµРґРѕРјР»РµРЅРёСЏ (${unread})`, query: `РЈ РјРµРЅСЏ ${unread} РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹С… СѓРІРµРґРѕРјР»РµРЅРёР№. Р§С‚Рѕ РІР°Р¶РЅРѕРіРѕ?` });
      }

      // Р”РёСЂРµРєС‚РѕСЂР° Рё Р°РґРјРёРЅС‹ вЂ” СЂР°СЃС€РёСЂРµРЅРЅС‹Рµ РїРѕРґСЃРєР°Р·РєРё
      if (mimirData.hasFullAccess(role)) {
        // РџСЂРѕРїСѓС‰РµРЅРЅС‹Рµ Р·РІРѕРЅРєРё
        const missedRes = await db.query(
          `SELECT COUNT(*) as cnt FROM call_history
           WHERE call_type = 'inbound' AND duration_seconds < 5
           AND created_at > NOW() - INTERVAL '24 hours'`
        );
        const missed = parseInt(missedRes.rows[0]?.cnt || 0);
        if (missed > 0) {
          suggestions.push({ icon: 'рџ“ћ', label: `РџСЂРѕРїСѓС‰РµРЅРѕ: ${missed}`, query: `РџРѕРєР°Р¶Рё РїСЂРѕРїСѓС‰РµРЅРЅС‹Рµ Р·РІРѕРЅРєРё Р·Р° СЃРµРіРѕРґРЅСЏ` });
        }

        // РЎСЂРѕС‡РЅС‹Рµ С‚РµРЅРґРµСЂС‹ (РґРµРґР»Р°Р№РЅ < 3 РґРЅРµР№)
        const urgentRes = await db.query(
          `SELECT COUNT(*) as cnt FROM tenders
           WHERE archived_at IS NULL AND tender_status NOT IN ('Р—Р°РєСЂС‹С‚', 'РћС‚РјРµРЅС‘РЅ', 'Р’С‹РёРіСЂР°Р»Рё', 'РџСЂРѕРёРіСЂР°Р»Рё')
           AND docs_deadline IS NOT NULL AND docs_deadline < CURRENT_DATE + INTERVAL '3 days' AND docs_deadline >= CURRENT_DATE`
        );
        const urgent = parseInt(urgentRes.rows[0]?.cnt || 0);
        if (urgent > 0) {
          suggestions.push({ icon: 'вљЎ', label: `РЎСЂРѕС‡РЅС‹Рµ С‚РµРЅРґРµСЂС‹: ${urgent}`, query: `РџРѕРєР°Р¶Рё С‚РµРЅРґРµСЂС‹ СЃ РґРµРґР»Р°Р№РЅРѕРј РІ Р±Р»РёР¶Р°Р№С€РёРµ 3 РґРЅСЏ` });
        }

        // РќРµРѕРїР»Р°С‡РµРЅРЅС‹Рµ СЃС‡РµС‚Р°
        const overdueRes = await db.query(
          `SELECT COUNT(*) as cnt FROM invoices
           WHERE status NOT IN ('paid','cancelled') AND due_date < CURRENT_DATE`
        );
        const overdue = parseInt(overdueRes.rows[0]?.cnt || 0);
        if (overdue > 0) {
          suggestions.push({ icon: 'рџ’°', label: `РџСЂРѕСЃСЂРѕС‡РµРЅРѕ: ${overdue}`, query: `РџРѕРєР°Р¶Рё РїСЂРѕСЃСЂРѕС‡РµРЅРЅС‹Рµ СЃС‡РµС‚Р°` });
        }
      }

      // PM вЂ” Р°РєС‚РёРІРЅС‹Рµ С‚РµРЅРґРµСЂС‹ Рё СЂР°Р±РѕС‚С‹
      if (mimirData.isPM(role)) {
        const myTendersRes = await db.query(
          `SELECT COUNT(*) as cnt FROM tenders WHERE archived_at IS NULL AND responsible_pm_id = $1 AND tender_status NOT IN ('Р—Р°РєСЂС‹С‚', 'РћС‚РјРµРЅС‘РЅ', 'Р’С‹РёРіСЂР°Р»Рё', 'РџСЂРѕРёРіСЂР°Р»Рё')`,
          [user.id]
        );
        const myTenders = parseInt(myTendersRes.rows[0]?.cnt || 0);
        if (myTenders > 0) {
          suggestions.push({ icon: 'рџ“‹', label: `РњРѕРё С‚РµРЅРґРµСЂС‹: ${myTenders}`, query: `РџРѕРєР°Р¶Рё РјРѕРё Р°РєС‚РёРІРЅС‹Рµ С‚РµРЅРґРµСЂС‹` });
        }

        const staleRes = await db.query(
          `SELECT COUNT(*) as cnt FROM works
           WHERE deleted_at IS NULL AND pm_id = $1 AND ${notClosedSql('work_status')} AND updated_at < NOW() - INTERVAL '14 days'`,
          [user.id]
        );
        const stale = parseInt(staleRes.rows[0]?.cnt || 0);
        if (stale > 0) {
          suggestions.push({ icon: 'вЏі', label: `Р—Р°СЃС‚РѕР№: ${stale} СЂР°Р±РѕС‚`, query: `РџРѕРєР°Р¶Рё СЂР°Р±РѕС‚С‹ Р±РµР· РѕР±РЅРѕРІР»РµРЅРёР№ Р±РѕР»РµРµ 2 РЅРµРґРµР»СЊ` });
        }
      }

      // BUH вЂ” РѕР¶РёРґР°СЋС‰РёРµ РѕРїР»Р°С‚С‹
      if (mimirData.isBUH(role)) {
        const pendingRes = await db.query(
          `SELECT COUNT(*) as cnt FROM invoices WHERE status = 'pending'`
        );
        const pending = parseInt(pendingRes.rows[0]?.cnt || 0);
        if (pending > 0) {
          suggestions.push({ icon: 'рџ’і', label: `Рљ РѕРїР»Р°С‚Рµ: ${pending}`, query: `РџРѕРєР°Р¶Рё СЃС‡РµС‚Р° РѕР¶РёРґР°СЋС‰РёРµ РѕРїР»Р°С‚С‹` });
        }
      }

      // TO вЂ” С‚РµРЅРґРµСЂРЅС‹Р№ РѕС‚РґРµР»
      if (mimirData.isTO(role)) {
        suggestions.push({ icon: 'рџ“Љ', label: 'РЎС‚Р°С‚РёСЃС‚РёРєР° С‚РµРЅРґРµСЂРѕРІ', query: 'РџРѕРєР°Р¶Рё СЃС‚Р°С‚РёСЃС‚РёРєСѓ РїРѕ С‚РµРЅРґРµСЂР°Рј Р·Р° СЌС‚РѕС‚ РјРµСЃСЏС†' });
      }

      // Р”РµС„РѕР»С‚РЅС‹Рµ РїРѕРґСЃРєР°Р·РєРё РїРѕ СЂРѕР»Рё (РµСЃР»Рё РјР°Р»Рѕ РїРµСЂСЃРѕРЅР°Р»СЊРЅС‹С…)
      if (suggestions.length < 2) {
        suggestions.push({ icon: 'рџ“Љ', label: 'РўРµРЅРґРµСЂС‹', query: 'РЎРєРѕР»СЊРєРѕ Сѓ РЅР°СЃ Р°РєС‚РёРІРЅС‹С… С‚РµРЅРґРµСЂРѕРІ?' });
        suggestions.push({ icon: 'рџ”Ќ', label: 'РџРѕРёСЃРє', query: 'РќР°Р№РґРё СЂР°Р±РѕС‚С‹ РїРѕ Р“Р°Р·РїСЂРѕРј' });
        suggestions.push({ icon: 'вќ“', label: 'РџРѕРјРѕС‰СЊ', query: 'РљР°Рє РґРѕР±Р°РІРёС‚СЊ РЅРѕРІС‹Р№ СЂР°СЃС…РѕРґ?' });
      }

      return { success: true, suggestions: suggestions.slice(0, 6) };
    } catch (err) {
      fastify.log.error({ err }, '[Mimir Suggestions] Error');
      return {
        success: true,
        suggestions: [
          { icon: 'рџ“Љ', label: 'РўРµРЅРґРµСЂС‹', query: 'РЎРєРѕР»СЊРєРѕ Сѓ РЅР°СЃ Р°РєС‚РёРІРЅС‹С… С‚РµРЅРґРµСЂРѕРІ?' },
          { icon: 'рџ”Ќ', label: 'РџРѕРёСЃРє', query: 'РќР°Р№РґРё СЂР°Р±РѕС‚С‹ РїРѕ Р“Р°Р·РїСЂРѕРј' },
          { icon: 'вќ“', label: 'РџРѕРјРѕС‰СЊ', query: 'РљР°Рє РґРѕР±Р°РІРёС‚СЊ РЅРѕРІС‹Р№ СЂР°СЃС…РѕРґ?' }
        ]
      };
    }
  });

  // Р¤РёРЅР°РЅСЃРѕРІР°СЏ СЃС‚Р°С‚РёСЃС‚РёРєР°
  fastify.get('/finance-stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';

    if (!mimirData.hasFullAccess(role) && !mimirData.isBUH(role)) {
      return { success: false, message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє С„РёРЅР°РЅСЃРѕРІРѕР№ РёРЅС„РѕСЂРјР°С†РёРё' };
    }

    try {
      const overdue = await db.query(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as sum
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE
      `);

      const debtors = await db.query(`
        SELECT customer_name, COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as debt
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled')
        GROUP BY customer_name
        HAVING SUM(total_amount - COALESCE(paid_amount, 0)) > 0
        ORDER BY debt DESC
        LIMIT 5
      `);

      const expected = await db.query(`
        SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as sum
        FROM invoices
        WHERE status NOT IN ('paid', 'cancelled')
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      `);

      return {
        success: true,
        stats: {
          overdueInvoices: {
            count: parseInt(overdue.rows[0]?.cnt || 0),
            sum: parseFloat(overdue.rows[0]?.sum || 0)
          },
          topDebtors: debtors.rows,
          expectedThisWeek: parseFloat(expected.rows[0]?.sum || 0)
        }
      };
    } catch (e) {
      fastify.log.error('Finance stats error:', e.message);
      return { success: false, message: 'РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РґР°РЅРЅС‹С…' };
    }
  });

  // РђРЅР°Р»РёС‚РёРєР° СЂР°Р±РѕС‚
  fastify.get('/works-analytics', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    const userId = user?.id;

    if (!mimirData.hasFullAccess(role) && !mimirData.isPM(role)) {
      return { success: false, message: 'РќРµС‚ РґРѕСЃС‚СѓРїР° Рє Р°РЅР°Р»РёС‚РёРєРµ СЂР°Р±РѕС‚' };
    }

    try {
      let whereClause = '';
      let params = [];

      if (mimirData.isPM(role) && !mimirData.hasFullAccess(role)) {
        params.push(userId);
        whereClause = ` WHERE pm_id = $${params.length}`;
      }

      const byStatus = await db.query(`
        SELECT work_status, COUNT(*) as cnt
        FROM works ${whereClause || 'WHERE 1=1'}
        GROUP BY work_status
      `, params);

      const deadlines = await db.query(`
        SELECT id, work_number, work_title, customer_name, end_plan
        FROM works
        ${whereClause || 'WHERE 1=1'}
          AND end_plan IS NOT NULL
          AND ${notClosedSql('work_status')}
        ORDER BY end_plan ASC
        LIMIT 5
      `, params);

      return {
        success: true,
        stats: {
          byStatus: byStatus.rows,
          upcomingDeadlines: deadlines.rows
        }
      };
    } catch (e) {
      fastify.log.error('Works analytics error:', e.message);
      return { success: false, message: 'РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РґР°РЅРЅС‹С…' };
    }
  });

  // Р РµРєРѕРјРµРЅРґР°С†РёСЏ РїРѕ С‚РµРЅРґРµСЂСѓ
  fastify.get('/tender-recommendation/:id', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const tenderId = request.params.id;

    try {
      const tender = await db.query('SELECT * FROM tenders WHERE id = $1', [tenderId]);
      if (tender.rows.length === 0) {
        return { success: false, message: 'РўРµРЅРґРµСЂ РЅРµ РЅР°Р№РґРµРЅ' };
      }

      const t = tender.rows[0];

      const history = await db.query(`
        SELECT tender_status, COUNT(*) as cnt
        FROM tenders WHERE customer_name = $1
        GROUP BY tender_status
      `, [t.customer_name]);

      const wonCount = parseInt(history.rows.find(r => r.tender_status === 'Р’С‹РёРіСЂР°Р»Рё')?.cnt || 0);
      const totalCount = history.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
      const winRate = totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0;

      let recommendation = '';
      let score = 0;

      if (totalCount === 0) {
        recommendation = 'РќРѕРІС‹Р№ РєР»РёРµРЅС‚. РўСЂРµР±СѓРµС‚СЃСЏ РєР°С‡РµСЃС‚РІРµРЅРЅРѕРµ РљРџ.';
        score = 50;
      } else if (winRate >= 60) {
        recommendation = 'Р’С‹СЃРѕРєРёРµ С€Р°РЅСЃС‹! РљР»РёРµРЅС‚ Р»РѕСЏР»РµРЅ, % РІС‹РёРіСЂР°РЅРЅС‹С… ' + winRate + '%';
        score = 85;
      } else if (winRate >= 30) {
        recommendation = 'РЎСЂРµРґРЅРёРµ С€Р°РЅСЃС‹. % РІС‹РёРіСЂР°РЅРЅС‹С… ' + winRate + '%. РџРѕРґРіРѕС‚РѕРІСЊ РєРѕРЅРєСѓСЂРµРЅС‚РЅРѕРµ РљРџ.';
        score = 60;
      } else {
        recommendation = 'РќРёР·РєРёРµ С€Р°РЅСЃС‹. % РІС‹РёРіСЂР°РЅРЅС‹С… ' + winRate + '%. РћС†РµРЅРё С†РµР»РµСЃРѕРѕР±СЂР°Р·РЅРѕСЃС‚СЊ СѓС‡Р°СЃС‚РёСЏ.';
        score = 30;
      }

      return {
        success: true,
        tender: { id: t.id, customer_name: t.customer_name, tender_title: t.tender_title },
        history: { total: totalCount, won: wonCount, winRate },
        recommendation,
        score
      };
    } catch (e) {
      return { success: false, message: 'РћС€РёР±РєР° Р°РЅР°Р»РёР·Р°' };
    }
  });

  // Р“РµРЅРµСЂР°С†РёСЏ РўРљРџ
  fastify.post('/generate-tkp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_id, work_title, customer_name, services, total_sum, deadline } = request.body;

    try {
      const prompt = `РЎРѕСЃС‚Р°РІСЊ РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅРѕРµ РєРѕРјРјРµСЂС‡РµСЃРєРѕРµ РїСЂРµРґР»РѕР¶РµРЅРёРµ (РўРљРџ) РґР»СЏ Р·Р°РєР°Р·С‡РёРєР°.

Р—Р°РєР°Р·С‡РёРє: ${customer_name || 'РќРµ СѓРєР°Р·Р°РЅ'}
РќР°Р·РІР°РЅРёРµ СЂР°Р±РѕС‚: ${work_title || 'РќРµ СѓРєР°Р·Р°РЅРѕ'}
РџРµСЂРµС‡РµРЅСЊ СѓСЃР»СѓРі: ${services || 'РЎРµСЂРІРёСЃРЅС‹Рµ СЂР°Р±РѕС‚С‹'}
РћСЂРёРµРЅС‚РёСЂРѕРІРѕС‡РЅР°СЏ СЃСѓРјРјР°: ${total_sum ? total_sum + ' СЂСѓР±.' : 'РџРѕ Р·Р°РїСЂРѕСЃСѓ'}
РЎСЂРѕРє РІС‹РїРѕР»РЅРµРЅРёСЏ: ${deadline || 'РџРѕ СЃРѕРіР»Р°СЃРѕРІР°РЅРёСЋ'}

Рћ РєРѕРјРїР°РЅРёРё:
- РћРћРћ В«РђСЃРіР°СЂРґ РЎРµСЂРІРёСЃВ» вЂ” СЂРѕСЃСЃРёР№СЃРєР°СЏ СЃРµСЂРІРёСЃРЅР°СЏ РєРѕРјРїР°РЅРёСЏ РЅРµС„С‚РµРіР°Р·РѕРІРѕРіРѕ СЃРµРєС‚РѕСЂР°
- РћРїС‹С‚ СЂР°Р±РѕС‚С‹ РЅР° РїР»Р°С‚С„РѕСЂРјРµ В«РџСЂРёСЂР°Р·Р»РѕРјРЅР°СЏВ» РІ РђСЂРєС‚РёРєРµ
- РљРІР°Р»РёС„РёС†РёСЂРѕРІР°РЅРЅС‹Рµ СЃРїРµС†РёР°Р»РёСЃС‚С‹ СЃ РґРѕРїСѓСЃРєР°РјРё (РќРђРљРЎ, РіР°Р·РѕРѕРїР°СЃРЅС‹Рµ СЂР°Р±РѕС‚С‹, РІС‹СЃРѕС‚Р°)
- РЎРѕР±СЃС‚РІРµРЅРЅРѕРµ РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ

Р¤РѕСЂРјР°С‚:
1. Р—Р°РіРѕР»РѕРІРѕРє Рё РѕР±СЂР°С‰РµРЅРёРµ (1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ)
2. РћРїРёСЃР°РЅРёРµ РїСЂРµРґР»Р°РіР°РµРјС‹С… СѓСЃР»СѓРі (2-3 Р°Р±Р·Р°С†Р°)
3. РќР°С€Рё РїСЂРµРёРјСѓС‰РµСЃС‚РІР° (4-5 РїСѓРЅРєС‚РѕРІ)
4. РЈСЃР»РѕРІРёСЏ, СЃС‚РѕРёРјРѕСЃС‚СЊ Рё СЃСЂРѕРєРё
5. РљРѕРЅС‚Р°РєС‚РЅР°СЏ РёРЅС„РѕСЂРјР°С†РёСЏ

РџРёС€Рё РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅРѕ, СЂР°Р·РІС‘СЂРЅСѓС‚Рѕ, РЅРѕ Р±РµР· РІРѕРґС‹.`;

      const aiResult = await aiProvider.complete({
        system: 'РўС‹ вЂ” РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅС‹Р№ РјРµРЅРµРґР¶РµСЂ РїРѕ РїСЂРѕРґР°Р¶Р°Рј СЃРµСЂРІРёСЃРЅРѕР№ РєРѕРјРїР°РЅРёРё. РЎРѕСЃС‚Р°РІР»СЏРµС€СЊ РєРѕРјРјРµСЂС‡РµСЃРєРёРµ РїСЂРµРґР»РѕР¶РµРЅРёСЏ.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.7
      });

      const tkpText = aiResult.text || '';

      await logUsage(db, request.user.id, null, aiResult);

      return { success: true, tkp: tkpText };
    } catch (error) {
      fastify.log.error({ err: error }, 'TKP generation error');
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РўРљРџ' });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 4.5: Р“Р•РќР•Р РђР¦РРЇ Р РЎРћР—Р”РђРќРР• РўРљРџ Р§Р•Р Р•Р— РњРРњРР 
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  fastify.post('/suggest-tkp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_id, work_id, customer_name, description, mode } = request.body;
    const user = request.user;

    try {
      // 1. РЎРѕР±СЂР°С‚СЊ РєРѕРЅС‚РµРєСЃС‚ РёР· Р‘Р”
      let context = '';
      let customerData = {};
      let tenderData = {};

      if (tender_id) {
        const t = await db.query(`
          SELECT t.*, c.address, c.phone, c.email, c.contact_person, c.kpp
          FROM tenders t
          LEFT JOIN customers c ON c.inn = t.customer_inn
          WHERE t.id = $1
        `, [tender_id]);
        if (t.rows[0]) {
          tenderData = t.rows[0];
          context += 'РўРµРЅРґРµСЂ: ' + tenderData.tender_title + '\n';
          context += 'Р—Р°РєР°Р·С‡РёРє: ' + tenderData.customer_name + ' (РРќРќ: ' + tenderData.customer_inn + ')\n';
          if (tenderData.tender_description) context += 'РћРїРёСЃР°РЅРёРµ: ' + tenderData.tender_description + '\n';
          if (tenderData.tender_sum) context += 'Р‘СЋРґР¶РµС‚: ' + tenderData.tender_sum + ' СЂСѓР±.\n';
          customerData = {
            name: tenderData.customer_name,
            inn: tenderData.customer_inn,
            address: tenderData.address || '',
            phone: tenderData.phone || '',
            email: tenderData.email || '',
            contact_person: tenderData.contact_person || '',
            kpp: tenderData.kpp || ''
          };
        }
      }

      if (work_id) {
        const w = await db.query('SELECT * FROM works WHERE id = $1', [work_id]);
        if (w.rows[0]) {
          const work = w.rows[0];
          context += 'Р Р°Р±РѕС‚Р°: ' + work.work_title + ' (' + work.work_number + ')\n';
          context += 'Р—Р°РєР°Р·С‡РёРє: ' + work.customer_name + '\n';
          if (work.work_description) context += 'РћРїРёСЃР°РЅРёРµ: ' + work.work_description + '\n';
          if (!customerData.name) {
            customerData.name = work.customer_name;
            customerData.inn = work.customer_inn || '';
          }
        }
      }

      if (customer_name && !customerData.name) {
        customerData.name = customer_name;
        const c = await db.query(
          'SELECT * FROM customers WHERE LOWER(name) LIKE $1 LIMIT 1',
          ['%' + customer_name.toLowerCase() + '%']
        );
        if (c.rows[0]) {
          customerData = {
            name: c.rows[0].name,
            inn: c.rows[0].inn || '',
            address: c.rows[0].address || c.rows[0].legal_address || '',
            phone: c.rows[0].phone || '',
            email: c.rows[0].email || '',
            contact_person: c.rows[0].contact_person || '',
            kpp: c.rows[0].kpp || ''
          };
        }
      }

      if (description) context += 'Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ: ' + description + '\n';

      // 2. Р—Р°РіСЂСѓР·РёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РќР”РЎ
      const settingsRow = await db.query("SELECT value_json FROM settings WHERE key = 'app'");
      const vatPct = settingsRow.rows[0]
        ? (JSON.parse(settingsRow.rows[0].value_json || '{}').vat_pct || 22)
        : 22;

      // 3. РЎРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ С‡РµСЂРµР· AI
      const prompt = 'РќР° РѕСЃРЅРѕРІРµ РґР°РЅРЅС‹С… СЃРѕР·РґР°Р№ СЃС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅРѕРµ РєРѕРјРјРµСЂС‡РµСЃРєРѕРµ РїСЂРµРґР»РѕР¶РµРЅРёРµ (РўРљРџ).\n\n' +
        'Р”РђРќРќР«Р•:\n' + (context || 'РћРїРёСЃР°РЅРёРµ: ' + (description || 'РЎРµСЂРІРёСЃРЅС‹Рµ СЂР°Р±РѕС‚С‹')) + '\n\n' +
        'РџР РђР’РР›Рђ:\n' +
        '- РљРѕРјРїР°РЅРёСЏ: РћРћРћ В«РђСЃРіР°СЂРґ РЎРµСЂРІРёСЃВ» вЂ” РїСЂРѕРјС‹С€Р»РµРЅРЅС‹Р№ СЃРµСЂРІРёСЃ (С…РёРјРёС‡РµСЃРєР°СЏ РѕС‡РёСЃС‚РєР°, РіРёРґСЂРѕРґРёРЅР°РјРёС‡РµСЃРєР°СЏ РѕС‡РёСЃС‚РєР°, HVAC)\n' +
        '- РќР”РЎ: ' + vatPct + '%\n' +
        '- Р Р°Р·Р±РµР№ СЂР°Р±РѕС‚С‹ РЅР° 3-8 Р»РѕРіРёС‡РЅС‹С… РїРѕР·РёС†РёР№ (РЅРµ РјРµРЅСЊС€Рµ 3)\n' +
        '- Р¦РµРЅС‹ РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ СЂРµР°Р»РёСЃС‚РёС‡РЅС‹РјРё РґР»СЏ РїСЂРѕРјС‹С€Р»РµРЅРЅРѕРіРѕ СЃРµСЂРІРёСЃР° (РѕС‚ 50 000 РґРѕ 2 000 000 СЂСѓР±. Р·Р° РїРѕР·РёС†РёСЋ)\n' +
        '- Р•РґРёРЅРёС†С‹: СѓСЃР»., РєРѕРјРїР»., С€С‚., РјВІ, Рї.Рј., С‚., С‡Р°СЃ, СЃРјРµРЅР°\n' +
        '- РЎСЂРѕРєРё: РѕР±С‹С‡РЅРѕ 5-15 СЂР°Р±РѕС‡РёС… РґРЅРµР№\n' +
        '- РЈСЃР»РѕРІРёСЏ РѕРїР»Р°С‚С‹: РѕР±С‹С‡РЅРѕ "РђРІР°РЅСЃ 50% РїРѕ РґРѕРіРѕРІРѕСЂСѓ, РѕСЃС‚Р°С‚РѕРє 50% РїРѕ Р°РєС‚Сѓ РІС‹РїРѕР»РЅРµРЅРЅС‹С… СЂР°Р±РѕС‚"\n\n' +
        'РћРўР’Р•Рў РЎРўР РћР“Рћ Р’ JSON (Р±РµР· markdown, Р±РµР· ```, С‚РѕР»СЊРєРѕ С‡РёСЃС‚С‹Р№ JSON):\n' +
        '{\n' +
        '  "subject": "РќР°Р·РІР°РЅРёРµ РўРљРџ",\n' +
        '  "work_description": "РџРѕРґСЂРѕР±РЅРѕРµ РѕРїРёСЃР°РЅРёРµ СЂР°Р±РѕС‚ (2-3 РїСЂРµРґР»РѕР¶РµРЅРёСЏ)",\n' +
        '  "items": [\n' +
        '    {"name": "РќР°Р·РІР°РЅРёРµ СЂР°Р±РѕС‚С‹", "unit": "СѓСЃР».", "qty": 1, "price": 280000, "total": 280000}\n' +
        '  ],\n' +
        '  "deadline": "10 СЂР°Р±РѕС‡РёС… РґРЅРµР№ СЃ РјРѕРјРµРЅС‚Р° РґРѕРїСѓСЃРєР° РЅР° РѕР±СЉРµРєС‚",\n' +
        '  "payment_terms": "РђРІР°РЅСЃ 50% РїРѕ РґРѕРіРѕРІРѕСЂСѓ, РѕСЃС‚Р°С‚РѕРє 50% РїРѕ Р°РєС‚Сѓ РІС‹РїРѕР»РЅРµРЅРЅС‹С… СЂР°Р±РѕС‚",\n' +
        '  "notes": "Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ СѓСЃР»РѕРІРёСЏ (1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ)"\n' +
        '}';

      const aiResult = await aiProvider.complete({
        system: 'РўС‹ вЂ” РјРµРЅРµРґР¶РµСЂ РїРѕ РїСЂРѕРґР°Р¶Р°Рј РћРћРћ В«РђСЃРіР°СЂРґ РЎРµСЂРІРёСЃВ». Р“РµРЅРµСЂРёСЂСѓРµС€СЊ РєРѕРјРјРµСЂС‡РµСЃРєРёРµ РїСЂРµРґР»РѕР¶РµРЅРёСЏ. РћС‚РІРµС‡Р°Р№ РўРћР›Р¬РљРћ РІР°Р»РёРґРЅС‹Рј JSON Р±РµР· РѕР±С‘СЂС‚РѕРє.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.5
      });

      // 4. РџР°СЂСЃРёРЅРі РѕС‚РІРµС‚Р° (Р°РіСЂРµСЃСЃРёРІРЅС‹Р№).
      // Р РµР°Р»СЊРЅС‹Р№ РїСЂРѕРґ-РёРЅС†РёРґРµРЅС‚: DeepSeek РІРµСЂРЅСѓР» content="" (РІСЃРµ completion-С‚РѕРєРµРЅС‹
      // СѓС€Р»Рё РІ reasoning_content) в†’ JSON.parse('') Р±СЂРѕСЃР°Р» в†’ 500 В«РЅРµРІР°Р»РёРґРЅС‹Р№ JSONВ».
      // Р’РђР–РќРћ: ai-provider РќР• РІРѕР·РІСЂР°С‰Р°РµС‚ .reasoning вЂ” reasoning Р»РµР¶РёС‚ С‚РѕР»СЊРєРѕ РІ
      // _rawMessage.reasoning_content (СЃРј. src/services/ai-provider.js:619-632).
      // РџСЂРѕР±СѓРµРј content, Р·Р°С‚РµРј reasoning_content; РµСЃР»Рё РїСѓСЃС‚Рѕ вЂ” РћР”РРќ РїРѕРІС‚РѕСЂ.
      function extractTkpJson(result) {
        if (!result) return null;
        const raw = result._rawMessage || {};
        const candidates = [result.text, result.reasoning, raw.reasoning_content, raw.reasoning];
        for (const src of candidates) {
          let text = String(src || '').trim();
          if (!text) continue;
          text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          const firstBrace = text.indexOf('{');
          const lastBrace = text.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            text = text.substring(firstBrace, lastBrace + 1);
          }
          try { return JSON.parse(text); } catch (_) { /* РїСЂРѕР±СѓРµРј СЃР»РµРґСѓСЋС‰РёР№ РёСЃС‚РѕС‡РЅРёРє */ }
        }
        return null;
      }

      let tkpData = extractTkpJson(aiResult);
      if (!tkpData) {
        // РџРѕРІС‚РѕСЂ: РїСЂРѕСЃРёРј С‚РѕС‚ Р¶Рµ JSON, РЅРѕ РєРѕСЂРѕС‚РєРѕ Рё Р±РµР· В«СЂР°Р·РјС‹С€Р»РµРЅРёР№В».
        try {
          const retry = await aiProvider.complete({
            system: 'РћС‚РІРµС‡Р°Р№ РўРћР›Р¬РљРћ РІР°Р»РёРґРЅС‹Рј JSON Р±РµР· РѕР±С‘СЂС‚РѕРє Рё РїРѕСЏСЃРЅРµРЅРёР№.',
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 2000,
            temperature: 0.2
          });
          tkpData = extractTkpJson(retry);
        } catch (_) { /* РїРѕРІС‚РѕСЂ РЅРµ СѓРґР°Р»СЃСЏ вЂ” РЅРёР¶Рµ РѕС‚РґР°РґРёРј РїРѕРЅСЏС‚РЅСѓСЋ РѕС€РёР±РєСѓ */ }
      }
      if (!tkpData) {
        return reply.code(502).send({
          success: false,
          message: 'AI РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚. РџРѕРІС‚РѕСЂРёС‚Рµ Р·Р°РїСЂРѕСЃ С‡РµСЂРµР· РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ.'
        });
      }

      // mode='items' вЂ” РІРµСЂРЅСѓС‚СЊ С‚РѕР»СЊРєРѕ СЃС‚СЂРѕРєРё СЂР°Р±РѕС‚
      if (mode === 'items') {
        return { success: true, items: tkpData.items || [], description: tkpData.work_description || '' };
      }
      if (mode === 'description') {
        return { success: true, description: tkpData.work_description || '' };
      }

      // 5. РЎРѕР·РґР°С‚СЊ С‡РµСЂРЅРѕРІРёРє РўРљРџ РІ Р‘Р”
      const items = tkpData.items || [];
      let subtotal = 0;
      items.forEach(function(i) { subtotal += (i.total || i.qty * i.price || 0); });
      const vatSum = Math.round(subtotal * vatPct / 100);
      const totalWithVat = subtotal + vatSum;

      const itemsJson = JSON.stringify({
        vat_pct: vatPct,
        items: items,
        subtotal: subtotal,
        vat_sum: vatSum,
        total_with_vat: totalWithVat,
        payment_terms: tkpData.payment_terms || '',
        author_name: 'РљСѓРґСЂСЏС€РѕРІ Рћ.РЎ.',
        author_position: 'Р“РµРЅРµСЂР°Р»СЊРЅС‹Р№ РґРёСЂРµРєС‚РѕСЂ',
        notes: tkpData.notes || ''
      });

      const result = await db.query(`
        INSERT INTO tkp (subject, tender_id, work_id, customer_name, customer_inn,
                          contact_person, contact_phone, contact_email,
                          customer_address, work_description,
                          items, total_sum, deadline, validity_days,
                          author_id, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'mimir')
        RETURNING *
      `, [
        tkpData.subject || 'РўРљРџ',
        tender_id || null, work_id || null,
        customerData.name || null, customerData.inn || null,
        customerData.contact_person || null, customerData.phone || null,
        customerData.email || null, customerData.address || null,
        tkpData.work_description || null,
        itemsJson, totalWithVat,
        tkpData.deadline || null, 30,
        user.id
      ]);

      const tkp = result.rows[0];

      await logUsage(db, user.id, null, aiResult);

      return {
        success: true,
        tkp_id: tkp.id,
        tkp_number: tkp.tkp_number,
        subject: tkp.subject,
        total_sum: totalWithVat,
        customer_name: customerData.name,
        items_count: items.length,
        message: 'РЎРѕР·РґР°РЅРѕ ' + tkp.tkp_number + ': "' + tkp.subject + '". ' + items.length + ' РїРѕР·РёС†РёР№, РёС‚РѕРіРѕ ' + totalWithVat.toLocaleString('ru-RU') + ' \u20BD (СЃ РќР”РЎ ' + vatPct + '%)'
      };

    } catch (error) {
      fastify.log.error({ err: error }, 'Mimir suggest-tkp error');
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РўРљРџ: ' + error.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // AI-РҐРђР РђРљРўР•Р РРЎРўРРљРђ РЎРћРўР РЈР”РќРРљРђ
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  fastify.post('/employee-summary', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { employee_id } = request.body;
    if (!employee_id) return reply.code(400).send({ success: false, message: 'employee_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    try {
      // 1. РћСЃРЅРѕРІРЅС‹Рµ РґР°РЅРЅС‹Рµ СЃРѕС‚СЂСѓРґРЅРёРєР°
      const empResult = await db.query('SELECT * FROM employees WHERE id = $1', [employee_id]);
      const emp = empResult.rows[0];
      if (!emp) return reply.code(404).send({ success: false, message: 'РЎРѕС‚СЂСѓРґРЅРёРє РЅРµ РЅР°Р№РґРµРЅ' });

      // 2. РђРЅРєРµС‚Р°-С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєР° (worker_profiles)
      let profile = null;
      try {
        const profResult = await db.query(
          'SELECT * FROM worker_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
          [emp.user_id || employee_id]
        );
        profile = profResult.rows[0] || null;
      } catch (_) {
        // РўР°Р±Р»РёС†Р° РјРѕР¶РµС‚ РЅРµ СЃСѓС‰РµСЃС‚РІРѕРІР°С‚СЊ вЂ” РЅРµ РєСЂРёС‚РёС‡РЅРѕ
      }

      // 3. РћС‚Р·С‹РІС‹ Р Рџ
      const reviews = await db.query(`
        SELECT r.rating, r.comment, r.created_at,
               w.work_title, u.name as reviewer_name
        FROM employee_reviews r
        LEFT JOIN works w ON w.id = r.work_id
        LEFT JOIN users u ON u.id = r.pm_id
        WHERE r.employee_id = $1
        ORDER BY r.created_at DESC LIMIT 10
      `, [employee_id]);

      // 4. РСЃС‚РѕСЂРёСЏ СЂР°Р±РѕС‚ (РЅР°Р·РЅР°С‡РµРЅРёСЏ)
      const assigns = await db.query(`
        SELECT ea.date_from, ea.date_to, ea.role,
               w.work_title, w.work_number, w.customer_name, w.work_status, w.city
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY ea.date_from DESC LIMIT 15
      `, [employee_id]);

      // 5. Р”РѕРїСѓСЃРєРё Рё РєРІР°Р»РёС„РёРєР°С†РёСЏ
      const permits = Array.isArray(emp.permits) ? emp.permits : [];

      // 6. Р—Р°СЂРїР»Р°С‚РЅС‹Рµ РґР°РЅРЅС‹Рµ (СЃСЂРµРґРЅРёР№ РґРѕС…РѕРґ)
      let avgPay = null;
      try {
        const payResult = await db.query(`
          SELECT AVG(pi.base_amount + COALESCE(pi.bonus,0)) as avg_total,
                 SUM(pi.days_worked) as total_days
          FROM payroll_items pi
          WHERE pi.employee_id = $1
            AND pi.base_amount > 0
        `, [employee_id]);
        if (payResult.rows[0]?.avg_total) {
          avgPay = {
            avg_total: Math.round(parseFloat(payResult.rows[0].avg_total)),
            total_days: parseInt(payResult.rows[0].total_days) || 0
          };
        }
      } catch (_) {}

      // в”Ђв”Ђв”Ђ РЎРѕР±СЂР°С‚СЊ РєРѕРЅС‚РµРєСЃС‚ РґР»СЏ AI в”Ђв”Ђв”Ђ
      let context = 'Р”РђРќРќР«Р• Рћ РЎРћРўР РЈР”РќРРљР•:\n';
      context += 'Р¤РРћ: ' + (emp.fio || emp.full_name || 'вЂ”') + '\n';
      context += 'Р”РѕР»Р¶РЅРѕСЃС‚СЊ: ' + (emp.position || emp.role_tag || 'вЂ”') + '\n';
      context += 'Р Р°Р·СЂСЏРґ: ' + (emp.grade || 'вЂ”') + '\n';
      context += 'Р‘СЂРёРіР°РґР°: ' + (emp.brigade || 'вЂ”') + '\n';
      context += 'РљРІР°Р»РёС„РёРєР°С†РёСЏ: ' + (emp.qualification_name || 'вЂ”') + ' ' + (emp.qualification_grade || '') + '\n';
      context += 'Р“РѕСЂРѕРґ: ' + (emp.city || 'вЂ”') + '\n';
      context += 'Р’ РєРѕРјРїР°РЅРёРё СЃ: ' + (emp.hire_date || emp.employment_date || 'вЂ”') + '\n';
      context += 'РђРєС‚РёРІРµРЅ: ' + (emp.is_active ? 'Р”Р°' : 'РЈРІРѕР»РµРЅ') + '\n';
      context += 'РљРѕРЅС‚СЂР°РєС‚: ' + (emp.contract_type || 'labor') + '\n';
      context += 'Р”РЅРµРІРЅР°СЏ СЃС‚Р°РІРєР°: ' + (emp.day_rate || 'вЂ”') + ' в‚Ѕ\n';
      context += 'Р РµР№С‚РёРЅРі: ' + (emp.rating_avg || 'вЂ”') + '/10 (' + (emp.rating_count || 0) + ' РѕС‚Р·С‹РІРѕРІ)\n';

      // Р”РѕРїСѓСЃРєРё
      context += '\nР”РћРџРЈРЎРљР:\n';
      if (emp.naks) context += 'РќРђРљРЎ: ' + emp.naks + ' (СѓРґРѕСЃС‚РѕРІРµСЂРµРЅРёРµ ' + (emp.naks_number || 'вЂ”') + ', РґРѕ ' + (emp.naks_expiry || 'вЂ”') + ')\n';
      if (emp.imt_number) context += 'РРњРў: ' + emp.imt_number + ' (РґРѕ ' + (emp.imt_expires || 'вЂ”') + ')\n';
      if (emp.fsb_pass) context += 'Р¤РЎР‘-РґРѕРїСѓСЃРє: ' + emp.fsb_pass + '\n';
      if (permits.length > 0) context += 'Р”РѕРїСѓСЃРєРё: ' + permits.join(', ') + '\n';
      if (emp.skills && emp.skills.length) context += 'РќР°РІС‹РєРё: ' + emp.skills.join(', ') + '\n';

      // РђРЅРєРµС‚Р°-С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєР°
      if (profile && profile.data) {
        context += '\nРђРќРљР•РўРђ-РҐРђР РђРљРўР•Р РРЎРўРРљРђ (РѕС‚ Р Рџ):\n';
        try {
          const pData = typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data;
          for (const [key, val] of Object.entries(pData)) {
            if (val && typeof val === 'object' && val.value) {
              context += key + ': ' + val.value;
              if (val.comment) context += ' (РєРѕРјРјРµРЅС‚Р°СЂРёР№: ' + val.comment + ')';
              context += '\n';
            } else if (val && typeof val !== 'object') {
              context += key + ': ' + val + '\n';
            }
          }
        } catch (_) {}
      }

      // РћС‚Р·С‹РІС‹
      if (reviews.rows.length > 0) {
        context += '\nРћРўР—Р«Р’Р« Р Рџ (' + reviews.rows.length + ' С€С‚.):\n';
        reviews.rows.forEach((r, i) => {
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : '';
          context += (i + 1) + '. РћС†РµРЅРєР° ' + r.rating + '/10';
          if (r.work_title) context += ' (СЂР°Р±РѕС‚Р°: ' + r.work_title + ')';
          if (r.reviewer_name) context += ' РѕС‚ ' + r.reviewer_name;
          if (date) context += ' [' + date + ']';
          if (r.comment) context += ': ' + r.comment;
          context += '\n';
        });
      }

      // РСЃС‚РѕСЂРёСЏ СЂР°Р±РѕС‚
      if (assigns.rows.length > 0) {
        context += '\nРРЎРўРћР РРЇ Р РђР‘РћРў (' + assigns.rows.length + ' РЅР°Р·РЅР°С‡РµРЅРёР№):\n';
        assigns.rows.forEach(a => {
          const from = a.date_from ? new Date(a.date_from).toLocaleDateString('ru-RU') : '?';
          const to = a.date_to ? new Date(a.date_to).toLocaleDateString('ru-RU') : 'РїРѕ РЅ.РІ.';
          context += 'вЂў ' + from + 'вЂ“' + to + ': ' + (a.work_title || 'вЂ”') + ' (' + (a.customer_name || 'вЂ”') + ', ' + (a.city || 'вЂ”') + ') СЂРѕР»СЊ: ' + (a.role || 'вЂ”') + '\n';
        });
      }

      // Р—Р°СЂРїР»Р°С‚Р°
      if (avgPay) {
        context += '\nР—РђР РџР›РђРўРђ:\n';
        context += 'РЎСЂРµРґРЅРёР№ РґРѕС…РѕРґ: ~' + avgPay.avg_total.toLocaleString('ru-RU') + ' в‚Ѕ/РјРµСЃСЏС†\n';
        context += 'Р’СЃРµРіРѕ РѕС‚СЂР°Р±РѕС‚Р°РЅРѕ: ' + avgPay.total_days + ' РґРЅРµР№\n';
      }

      // в”Ђв”Ђв”Ђ Р“РµРЅРµСЂР°С†РёСЏ С‡РµСЂРµР· AI в”Ђв”Ђв”Ђ
      const aiResult = await aiProvider.complete({
        system: `РўС‹ вЂ” HR-Р°РЅР°Р»РёС‚РёРє РћРћРћ В«РђСЃРіР°СЂРґ РЎРµСЂРІРёСЃВ» (РїСЂРѕРјС‹С€Р»РµРЅРЅС‹Р№ СЃРµСЂРІРёСЃ: С…РёРјРёС‡РµСЃРєР°СЏ РѕС‡РёСЃС‚РєР°, РіРёРґСЂРѕС‡РёСЃС‚РєР°, HVAC РЅР° РќРџР— Рё РЅРµС„С‚РµРіР°Р·РѕРІС‹С… РѕР±СЉРµРєС‚Р°С…).

РЎРѕСЃС‚Р°РІСЊ РљР РђРўРљРЈР® (5-8 РїСЂРµРґР»РѕР¶РµРЅРёР№) РґРµР»РѕРІСѓСЋ С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєСѓ СЃРѕС‚СЂСѓРґРЅРёРєР°.

РЎС‚СЂСѓРєС‚СѓСЂР°:
1. РљС‚Рѕ: Р¤РРћ, РґРѕР»Р¶РЅРѕСЃС‚СЊ, СЃС‚Р°Р¶ РІ РєРѕРјРїР°РЅРёРё (1 РїСЂРµРґР»РѕР¶РµРЅРёРµ)
2. РћРїС‹С‚: РЅР° РєР°РєРёС… РѕР±СЉРµРєС‚Р°С…/Р·Р°РєР°Р·С‡РёРєР°С… СЂР°Р±РѕС‚Р°Р», РѕСЃРЅРѕРІРЅС‹Рµ СЂРѕР»Рё (1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ)
3. РљР°С‡РµСЃС‚РІР°: РЅР° РѕСЃРЅРѕРІРµ Р°РЅРєРµС‚С‹ Рё РѕС‚Р·С‹РІРѕРІ Р Рџ вЂ” СЃРёР»СЊРЅС‹Рµ СЃС‚РѕСЂРѕРЅС‹ Рё Р·РѕРЅС‹ СЂРѕСЃС‚Р° (2-3 РїСЂРµРґР»РѕР¶РµРЅРёСЏ)
4. Р РµРєРѕРјРµРЅРґР°С†РёСЏ: РЅР° РєР°РєРёРµ Р·Р°РґР°С‡Рё/РїСЂРѕРµРєС‚С‹ СЂРµРєРѕРјРµРЅРґСѓРµС‚СЃСЏ (1 РїСЂРµРґР»РѕР¶РµРЅРёРµ)

РџСЂР°РІРёР»Р°:
- РџРёС€Рё РїРѕ-РґРµР»РѕРІРѕРјСѓ, Р±РµР· РІРѕРґС‹, РєРѕРЅРєСЂРµС‚РЅРѕ
- Р•СЃР»Рё РґР°РЅРЅС‹С… РјР°Р»Рѕ вЂ” РїРёС€Рё С‡С‚Рѕ РµСЃС‚СЊ, РЅРµ РґРѕРґСѓРјС‹РІР°Р№
- Р•СЃР»Рё СЂРµР№С‚РёРЅРі РЅРёР·РєРёР№ РёР»Рё РµСЃС‚СЊ РїСЂРѕР±Р»РµРјС‹ вЂ” СѓРїРѕРјСЏРЅРё РєРѕСЂСЂРµРєС‚РЅРѕ
- РСЃРїРѕР»СЊР·СѓР№ С„Р°РєС‚С‹ РёР· РґР°РЅРЅС‹С…, РЅРµ РѕР±С‰РёРµ С„СЂР°Р·С‹
- РќР• РёСЃРїРѕР»СЊР·СѓР№ РјР°СЂРєРґР°СѓРЅ, С‚РѕР»СЊРєРѕ С‚РµРєСЃС‚`,
        messages: [{ role: 'user', content: context }],
        maxTokens: 800,
        temperature: 0.4
      });

      const summary = (aiResult.text || '').trim();

      return {
        success: true,
        employee_id: employee_id,
        fio: emp.fio || emp.full_name,
        summary: summary,
        data_sources: {
          has_profile: !!profile,
          reviews_count: reviews.rows.length,
          assignments_count: assigns.rows.length,
          has_payroll: !!avgPay
        }
      };

    } catch (error) {
      fastify.log.error({ err: error }, 'Employee summary error');
      return reply.code(500).send({ success: false, message: 'РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё: ' + error.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р‘Р›РћРљ 5: РђР”РњРРќ-РџРђРќР•Р›Р¬ AI
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // РЎС‚Р°С‚РёСЃС‚РёРєР° РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ AI
  fastify.get('/admin/usage', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    if (!mimirData.hasFullAccess(user?.role)) {
      return reply.code(403).send({ success: false, message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
    }

    try {
      // РћР±С‰Р°СЏ СЃС‚Р°С‚РёСЃС‚РёРєР°
      const total = await db.query(`
        SELECT
          COUNT(*) as total_requests,
          SUM(tokens_input) as total_input_tokens,
          SUM(tokens_output) as total_output_tokens,
          AVG(duration_ms) as avg_duration_ms,
          COUNT(CASE WHEN success = FALSE THEN 1 END) as failed_requests
        FROM mimir_usage_log
        WHERE created_at > NOW() - INTERVAL '30 days'
      `);

      // РџРѕ РґРЅСЏРј
      const byDay = await db.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as requests,
          SUM(tokens_input + tokens_output) as tokens
        FROM mimir_usage_log
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      // РўРѕРї РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
      const topUsers = await db.query(`
        SELECT
          u.name as user_name,
          COUNT(*) as requests,
          SUM(l.tokens_input + l.tokens_output) as tokens
        FROM mimir_usage_log l
        JOIN users u ON l.user_id = u.id
        WHERE l.created_at > NOW() - INTERVAL '30 days'
        GROUP BY u.id, u.name
        ORDER BY tokens DESC
        LIMIT 10
      `);

      return {
        success: true,
        usage: {
          summary: total.rows[0],
          byDay: byDay.rows,
          topUsers: topUsers.rows
        }
      };
    } catch (e) {
      fastify.log.error('Usage stats error:', e.message);
      return { success: false, message: 'РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ СЃС‚Р°С‚РёСЃС‚РёРєРё' };
    }
  });

  // РўРµРєСѓС‰Р°СЏ РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ AI
  fastify.get('/admin/config', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    if (!mimirData.hasFullAccess(user?.role)) {
      return reply.code(403).send({ success: false, message: 'РќРµС‚ РґРѕСЃС‚СѓРїР°' });
    }

    const config = aiProvider.getConfig();

    // РњР°СЃРєРёСЂСѓРµРј РєР»СЋС‡Рё
    return {
      success: true,
      config: {
        provider: config.provider,
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        hasAnthropicKey: config.hasAnthropicKey,
        hasOpenAIKey: config.hasOpenAIKey
      }
    };
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Р’РЎРџРћРњРћР“РђРўР•Р›Р¬РќР«Р• Р¤РЈРќРљР¦РР
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  /**
   * РР·РІР»РµС‡РµРЅРёРµ СЃРѕРґРµСЂР¶РёРјРѕРіРѕ С„Р°Р№Р»Р°
   */
  async function extractFileContent(buffer, filename, mimetype) {
    const ext = path.extname(filename).toLowerCase();

    try {
      // PDF в†’ С‚РµРєСЃС‚
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        return { type: 'text', content: data.text.substring(0, 100000), pages: data.numpages };
      }

      // DOCX в†’ С‚РµРєСЃС‚
      if (ext === '.docx') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return { type: 'text', content: result.value.substring(0, 100000) };
      }

      // Excel в†’ С‚РµРєСЃС‚
      if (['.xlsx', '.xls'].includes(ext)) {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        let text = '';
        workbook.eachSheet((sheet, sheetId) => {
          text += `\n=== Р›РёСЃС‚: ${sheet.name} ===\n`;
          sheet.eachRow((row, rowNum) => {
            const vals = [];
            row.eachCell((cell, colNum) => {
              vals.push(String(cell.value ?? ''));
            });
            text += vals.join(' | ') + '\n';
          });
        });
        return { type: 'text', content: text.substring(0, 100000) };
      }

      // CSV
      if (ext === '.csv') {
        return { type: 'text', content: buffer.toString('utf8').substring(0, 100000) };
      }

      // РР·РѕР±СЂР°Р¶РµРЅРёСЏ в†’ base64 РґР»СЏ Claude Vision
      if (mimetype?.startsWith('image/')) {
        const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!supportedTypes.includes(mimetype)) {
          return { type: 'text', content: `[РќРµРїРѕРґРґРµСЂР¶РёРІР°РµРјС‹Р№ С„РѕСЂРјР°С‚ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ: ${mimetype}]` };
        }
        return {
          type: 'image',
          media_type: mimetype,
          data: buffer.toString('base64')
        };
      }

      // TXT Рё РїСЂРѕС‡РёРµ С‚РµРєСЃС‚РѕРІС‹Рµ
      return { type: 'text', content: buffer.toString('utf8').substring(0, 100000) };

    } catch (e) {
      fastify.log.error('File extraction error:', e.message);
      return { type: 'text', content: `[РћС€РёР±РєР° С‡С‚РµРЅРёСЏ С„Р°Р№Р»Р°: ${e.message}]` };
    }
  }

  /**
   * РђРІС‚РѕРіРµРЅРµСЂР°С†РёСЏ Р·Р°РіРѕР»РѕРІРєР° РґРёР°Р»РѕРіР°
   */
  async function generateTitle(db, conversationId, userMessage, assistantResponse) {
    try {
      const result = await aiProvider.complete({
        system: 'РџСЂРёРґСѓРјР°Р№ РєРѕСЂРѕС‚РєРёР№ Р·Р°РіРѕР»РѕРІРѕРє (3-7 СЃР»РѕРІ) РґР»СЏ РґРёР°Р»РѕРіР° РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ. РћС‚РІРµС‡Р°Р№ РўРћР›Р¬РљРћ Р·Р°РіРѕР»РѕРІРєРѕРј, Р±РµР· РєР°РІС‹С‡РµРє Рё РїРѕСЏСЃРЅРµРЅРёР№.',
        messages: [{
          role: 'user',
          content: `Р’РѕРїСЂРѕСЃ: ${userMessage.substring(0, 200)}\nРћС‚РІРµС‚: ${assistantResponse.substring(0, 300)}`
        }],
        maxTokens: 30,
        temperature: 0.3
      });

      const title = result.text.trim().substring(0, 100);

      await db.query(
        'UPDATE mimir_conversations SET title = $1 WHERE id = $2',
        [title, conversationId]
      );

      return title;
    } catch (e) {
      // Ignore errors
      return null;
    }
  }

  /**
   * Р›РѕРіРёСЂРѕРІР°РЅРёРµ РёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ AI
   */
  async function logUsage(db, userId, conversationId, aiResult) {
    try {
      const prov = aiResult.provider || (aiProvider.getProvider && aiProvider.getProvider()) || 'unknown';
      const mdl = aiResult.model || (aiProvider.getConfig && aiProvider.getConfig()?.model) || 'unknown';
      await db.query(`
        INSERT INTO mimir_usage_log (user_id, conversation_id, provider, model, tokens_input, tokens_output, duration_ms, success)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      `, [
        userId,
        conversationId,
        prov,
        mdl,
        aiResult.usage?.inputTokens || 0,
        aiResult.usage?.outputTokens || 0,
        aiResult.durationMs || 0
      ]);
    } catch (e) {
      // Ignore logging errors
    }
  }

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РЈРќРР’Р•Р РЎРђР›Р¬РќРћР• РђР’РўРћР—РђРџРћР›РќР•РќРР• Р¤РћР Рњ вЂ” POST /mimir/suggest-form
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  fastify.post('/suggest-form', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { form_type, context = {} } = request.body || {};
    if (!form_type) return reply.code(400).send({ error: 'form_type РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    try {
      let systemPrompt = '';
      let userPrompt = '';
      let dbContext = '';

      // в”Ђв”Ђ РљРѕРЅС‚РµРєСЃС‚ РёР· Р‘Р” РїРѕ С‚РёРїСѓ С„РѕСЂРјС‹ в”Ђв”Ђ
      switch (form_type) {

        case 'contract': {
          // Р”РѕРіРѕРІРѕСЂ: РїРѕРґС‚СЏРЅСѓС‚СЊ РґР°РЅРЅС‹Рµ РєРѕРЅС‚СЂР°РіРµРЅС‚Р° Рё С‚РµРЅРґРµСЂР°
          const { counterparty_id, tender_id, existing_fields = {} } = context;
          if (counterparty_id) {
            const c = await db.query('SELECT * FROM customers WHERE inn = $1', [counterparty_id]);
            if (c.rows[0]) dbContext += 'РљРѕРЅС‚СЂР°РіРµРЅС‚: ' + JSON.stringify(c.rows[0]) + '\n';
          }
          if (tender_id) {
            const t = await db.query('SELECT tender_title, tender_description, tender_sum, customer_name, deadline FROM tenders WHERE id = $1', [tender_id]);
            if (t.rows[0]) dbContext += 'РўРµРЅРґРµСЂ: ' + JSON.stringify(t.rows[0]) + '\n';
          }
          systemPrompt = 'РўС‹ AI-Р°СЃСЃРёСЃС‚РµРЅС‚ CRM-СЃРёСЃС‚РµРјС‹ РђРЎР“РђР Р”. РџРѕРјРѕРіРё Р·Р°РїРѕР»РЅРёС‚СЊ С„РѕСЂРјСѓ РґРѕРіРѕРІРѕСЂР°. Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё: number, subject, start_date (YYYY-MM-DD), end_date, amount, responsible, comment. РўРѕР»СЊРєРѕ С‚Рµ РїРѕР»СЏ, РєРѕС‚РѕСЂС‹Рµ РјРѕР¶РµС€СЊ СѓРІРµСЂРµРЅРЅРѕ Р·Р°РїРѕР»РЅРёС‚СЊ РЅР° РѕСЃРЅРѕРІРµ РєРѕРЅС‚РµРєСЃС‚Р°. РќРµ РІС‹РґСѓРјС‹РІР°Р№ РґР°РЅРЅС‹Рµ.';
          userPrompt = 'РљРѕРЅС‚РµРєСЃС‚:\n' + dbContext + '\nРЈР¶Рµ Р·Р°РїРѕР»РЅРµРЅРѕ: ' + JSON.stringify(existing_fields) + '\nР—Р°РїРѕР»РЅРё РѕСЃС‚Р°РІС€РёРµСЃСЏ РїРѕР»СЏ С„РѕСЂРјС‹ РґРѕРіРѕРІРѕСЂР°.';
          break;
        }

        case 'customer': {
          // РљРѕРЅС‚СЂР°РіРµРЅС‚: РїРѕРёСЃРє РїРѕ РРќРќ/РЅР°Р·РІР°РЅРёСЋ вЂ” РІРѕР·РІСЂР°С‰Р°РµРј С‚РѕР»СЊРєРѕ Р±РµР·РѕРїР°СЃРЅС‹Рµ РїРѕР»СЏ
          const SAFE_CUSTOMER_FIELDS = ['inn', 'kpp', 'name', 'full_name', 'address', 'contact_person', 'phone', 'email'];
          const pickSafe = (row) => {
            const safe = {};
            SAFE_CUSTOMER_FIELDS.forEach(k => { if (row[k]) safe[k] = row[k]; });
            return safe;
          };
          const { inn, name, search_query, existing_fields = {} } = context;
          if (inn) {
            const c = await db.query('SELECT inn, kpp, name, full_name, address, contact_person, phone, email FROM customers WHERE inn = $1', [inn]);
            if (c.rows[0]) {
              return reply.send({ fields: pickSafe(c.rows[0]), source: 'database' });
            }
          }
          if (name || search_query) {
            const q = name || search_query;
            const c = await db.query('SELECT inn, kpp, name, full_name, address, contact_person, phone, email FROM customers WHERE LOWER(name) LIKE $1 LIMIT 3', ['%' + q.toLowerCase() + '%']);
            if (c.rows[0]) {
              return reply.send({ fields: pickSafe(c.rows[0]), source: 'database' });
            }
          }
          systemPrompt = 'РўС‹ AI-Р°СЃСЃРёСЃС‚РµРЅС‚. РџРѕРјРѕРіРё Р·Р°РїРѕР»РЅРёС‚СЊ С„РѕСЂРјСѓ РєРѕРЅС‚СЂР°РіРµРЅС‚Р°. Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё: name, full_name, inn, kpp, address, contact_person, phone, email. РўРѕР»СЊРєРѕ С‚Рµ С‡С‚Рѕ РјРѕР¶РµС€СЊ СѓРІРµСЂРµРЅРЅРѕ РѕРїСЂРµРґРµР»РёС‚СЊ.';
          userPrompt = 'Р—Р°РїСЂРѕСЃ: ' + (search_query || name || inn || '') + '\nРЈР¶Рµ Р·Р°РїРѕР»РЅРµРЅРѕ: ' + JSON.stringify(existing_fields);
          break;
        }

        case 'correspondence': {
          // РљРѕСЂСЂРµСЃРїРѕРЅРґРµРЅС†РёСЏ вЂ” РїРѕР»СЏ СЃРѕРіР»Р°СЃРѕРІР°РЅС‹ СЃ С„СЂРѕРЅС‚РµРЅРґРѕРј (subject, note, counterparty)
          const { direction, existing_fields = {} } = context;
          systemPrompt = 'РўС‹ AI-Р°СЃСЃРёСЃС‚РµРЅС‚ CRM РђРЎР“РђР Р”. РџРѕРјРѕРіРё Р·Р°РїРѕР»РЅРёС‚СЊ С„РѕСЂРјСѓ РєРѕСЂСЂРµСЃРїРѕРЅРґРµРЅС†РёРё (' + (direction === 'outgoing' ? 'РёСЃС…РѕРґСЏС‰РёР№' : 'РІС…РѕРґСЏС‰РёР№') + ' РґРѕРєСѓРјРµРЅС‚). Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё: subject (С‚РµРјР° РґРѕРєСѓРјРµРЅС‚Р°), note (РїСЂРёРјРµС‡Р°РЅРёРµ/СЃРѕРґРµСЂР¶Р°РЅРёРµ), counterparty (РѕСЂРіР°РЅРёР·Р°С†РёСЏ-РѕС‚РїСЂР°РІРёС‚РµР»СЊ/РїРѕР»СѓС‡Р°С‚РµР»СЊ), contact_person (РєРѕРЅС‚Р°РєС‚РЅРѕРµ Р»РёС†Рѕ). РћСЃРЅРѕРІС‹РІР°Р№СЃСЏ РЅР° РєРѕРЅС‚РµРєСЃС‚Рµ. РўРѕР»СЊРєРѕ С‚Рµ РїРѕР»СЏ С‡С‚Рѕ РјРѕР¶РµС€СЊ СѓРІРµСЂРµРЅРЅРѕ Р·Р°РїРѕР»РЅРёС‚СЊ.';
          userPrompt = 'РќР°РїСЂР°РІР»РµРЅРёРµ: ' + (direction || 'unknown') + '\nРЈР¶Рµ Р·Р°РїРѕР»РЅРµРЅРѕ: ' + JSON.stringify(existing_fields) + '\nРџСЂРµРґР»РѕР¶Рё Р·РЅР°С‡РµРЅРёСЏ РґР»СЏ РѕСЃС‚Р°РІС€РёС…СЃСЏ РїРѕР»РµР№.';
          break;
        }

        case 'proxy': {
          // Р”РѕРІРµСЂРµРЅРЅРѕСЃС‚СЊ
          const { employee_id, existing_fields = {} } = context;
          if (employee_id) {
            const e = await db.query('SELECT name, position, department FROM employees WHERE id = $1', [employee_id]);
            if (e.rows[0]) dbContext += 'РЎРѕС‚СЂСѓРґРЅРёРє: ' + JSON.stringify(e.rows[0]) + '\n';
          }
          systemPrompt = 'РўС‹ AI-Р°СЃСЃРёСЃС‚РµРЅС‚ CRM РђРЎР“РђР Р”. РџРѕРјРѕРіРё Р·Р°РїРѕР»РЅРёС‚СЊ С„РѕСЂРјСѓ РґРѕРІРµСЂРµРЅРЅРѕСЃС‚Рё. Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё РєРѕС‚РѕСЂС‹Рµ РјРѕР¶РµС€СЊ СѓРІРµСЂРµРЅРЅРѕ Р·Р°РїРѕР»РЅРёС‚СЊ: subject, valid_from (YYYY-MM-DD), valid_to, powers_text.';
          userPrompt = dbContext + '\nРЈР¶Рµ Р·Р°РїРѕР»РЅРµРЅРѕ: ' + JSON.stringify(existing_fields);
          break;
        }

        case 'pass_request': {
          // Р—Р°СЏРІРєР° РЅР° РїСЂРѕРїСѓСЃРє
          const { employee_id, work_id, existing_fields = {} } = context;
          if (employee_id) {
            const e = await db.query('SELECT name, position, phone FROM employees WHERE id = $1', [employee_id]);
            if (e.rows[0]) dbContext += 'РЎРѕС‚СЂСѓРґРЅРёРє: ' + JSON.stringify(e.rows[0]) + '\n';
          }
          if (work_id) {
            const w = await db.query('SELECT work_title, customer_name, city, address FROM works WHERE id = $1', [work_id]);
            if (w.rows[0]) dbContext += 'Р Р°Р±РѕС‚Р°: ' + JSON.stringify(w.rows[0]) + '\n';
          }
          systemPrompt = 'РўС‹ AI-Р°СЃСЃРёСЃС‚РµРЅС‚ CRM РђРЎР“РђР Р”. РџРѕРјРѕРіРё Р·Р°РїРѕР»РЅРёС‚СЊ Р·Р°СЏРІРєСѓ РЅР° РїСЂРѕРїСѓСЃРє. Р’РµСЂРЅРё JSON СЃ РїРѕР»СЏРјРё: object_name, object_address, date_from (YYYY-MM-DD), date_to, purpose.';
          userPrompt = dbContext + '\nРЈР¶Рµ Р·Р°РїРѕР»РЅРµРЅРѕ: ' + JSON.stringify(existing_fields);
          break;
        }

        default:
          return reply.code(400).send({ error: 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ form_type: ' + form_type });
      }

      // Р•СЃР»Рё РЅРµС‚ РїСЂРѕРјРїС‚Р° вЂ” РЅРµС‡РµРіРѕ РґРµР»Р°С‚СЊ
      if (!systemPrompt) {
        return reply.send({ fields: {}, message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РєРѕРЅС‚РµРєСЃС‚Р°' });
      }

      // в”Ђв”Ђ Р’С‹Р·РѕРІ AI в”Ђв”Ђ
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 1000,
        temperature: 0.3
      });

      // РџР°СЂСЃРёРј JSON РёР· РѕС‚РІРµС‚Р°
      let fields = {};
      try {
        const text = aiResult.text || aiResult.content || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          fields = JSON.parse(jsonMatch[0]);
        }
      } catch (_) {
        // РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°СЃРїР°СЂСЃРёС‚СЊ вЂ” РІРµСЂРЅС‘Рј РїСѓСЃС‚РѕРµ
      }

      // Р¤РёР»СЊС‚СЂСѓРµРј РїСѓСЃС‚С‹Рµ Р·РЅР°С‡РµРЅРёСЏ
      Object.keys(fields).forEach(k => {
        if (fields[k] === null || fields[k] === undefined || fields[k] === '') {
          delete fields[k];
        }
      });

      return reply.send({ fields, source: 'ai' });

    } catch (error) {
      fastify.log.error({ err: error }, 'Mimir suggest-form error');
      return reply.code(500).send({ error: 'РћС€РёР±РєР° AI: ' + error.message });
    }
  });
  // в•ђв•ђв•ђ H1: РњРёРјРёСЂ-Р°РІС‚РѕРѕС‚РІРµС‚С‡РёРє РґР»СЏ РїСЂРѕСЃС‡С‘С‚РѕРІ в•ђв•ђв•ђ

  /**
   * POST /api/mimir/auto-respond
   * Р’РЅСѓС‚СЂРµРЅРЅРёР№ СЌРЅРґРїРѕРёРЅС‚: РњРёРјРёСЂ Р°РЅР°Р»РёР·РёСЂСѓРµС‚ РєРѕРјРјРµРЅС‚Р°СЂРёР№ РґРёСЂРµРєС‚РѕСЂР° Рё РѕС‚РІРµС‡Р°РµС‚ РІ С‡Р°С‚.
   * Body: { estimate_id, chat_id, trigger_action, director_comment, director_name }
   */
  fastify.post('/auto-respond', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { estimate_id, chat_id, trigger_action, director_comment, director_name } = request.body || {};
    if (!estimate_id || !chat_id || !trigger_action || !director_comment) {
      return reply.code(400).send({ error: 'estimate_id, chat_id, trigger_action, director_comment required' });
    }

    const startTime = Date.now();

    try {
      // 1. РџСЂРѕРІРµСЂРёС‚СЊ mimir_auto_config
      const configResult = await db.query(
        "SELECT * FROM mimir_auto_config WHERE entity_type = 'estimate' AND trigger_action = $1 AND enabled = true",
        [trigger_action]
      );
      if (!configResult.rows[0]) {
        return reply.send({ skipped: true, reason: 'auto-respond disabled for this action' });
      }
      const config = configResult.rows[0];

      // 2. РџРѕР»СѓС‡РёС‚СЊ mimir_bot user id
      const botResult = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
      const botUserId = botResult.rows[0]?.id;
      if (!botUserId) {
        return reply.code(500).send({ error: 'mimir_bot user not found' });
      }

      // 3. РџРѕР»СѓС‡РёС‚СЊ РєРѕРЅС‚РµРєСЃС‚: estimate + calculation + Р°РЅР°Р»РѕРіРё
      const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimate_id]);
      const estimate = estResult.rows[0];
      if (!estimate) return reply.code(404).send({ error: 'РџСЂРѕСЃС‡С‘С‚ РЅРµ РЅР°Р№РґРµРЅ' });

      let calcData = null;
      try {
        const calcResult = await db.query(
          'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
          [estimate_id]
        );
        calcData = calcResult.rows[0] || null;
      } catch (e) { /* ok */ }

      let analogs = [];
      try {
        const analogsResult = await db.query(
          "SELECT title, total_cost, total_with_margin, margin_pct, crew_count, work_days FROM estimates WHERE id != $1 AND work_type = $2 AND approval_status = 'approved' ORDER BY created_at DESC LIMIT 3",
          [estimate_id, estimate.work_type]
        );
        analogs = analogsResult.rows;
      } catch (e) { /* ok */ }

      // PM name
      let pmName = 'Р Рџ';
      if (estimate.pm_id) {
        const pmResult = await db.query('SELECT name FROM users WHERE id = $1', [estimate.pm_id]);
        pmName = pmResult.rows[0]?.name || 'Р Рџ';
      }

      // 4. РЎРѕР±СЂР°С‚СЊ СЂР°СЃС‡С‘С‚ summary СЃ РґРµС‚Р°Р»РёР·Р°С†РёРµР№ РїРѕ Р±Р»РѕРєР°Рј
      let calcSummary = 'Р Р°СЃС‡С‘С‚ РїРѕРєР° РЅРµ СЃРѕР·РґР°РЅ.';
      if (calcData) {
        const fmt = v => Math.round(Number(v) || 0).toLocaleString('ru-RU');

        const parseBlock = (json) => {
          try {
            const arr = typeof json === 'string' ? JSON.parse(json) : (json || []);
            return arr.map(r => ({
              name: r.item || r.role || r.description || 'вЂ”',
              total: Number(r.total || r.amount || 0)
            }));
          } catch { return []; }
        };

        const blockSection = (label, rows) => {
          if (!rows.length) return null;
          const sum = rows.reduce((s, r) => s + r.total, 0);
          const lines = rows.map(r => `  вЂў ${r.name}: ${fmt(r.total)} в‚Ѕ`).join('\n');
          return `${label} (РёС‚РѕРіРѕ ${fmt(sum)} в‚Ѕ):\n${lines}`;
        };

        const personnel  = parseBlock(calcData.personnel_json);
        const currCosts  = parseBlock(calcData.current_costs_json);
        const travel     = parseBlock(calcData.travel_json);
        const transport  = parseBlock(calcData.transport_json);
        const chemistry  = parseBlock(calcData.chemistry_json);

        const parts = [
          blockSection('РџР•Р РЎРћРќРђР›', personnel),
          blockSection('РўР•РљРЈР©РР• Р РђРЎРҐРћР”Р«', currCosts),
          blockSection('РљРћРњРђРќР”РР РћР’РћР§РќР«Р•', travel),
          blockSection('РўР РђРќРЎРџРћР Рў', transport),
          blockSection('РҐРРњРРЇ/РњРђРўР•Р РРђР›Р«', chemistry),
        ].filter(Boolean);

        const contPct = calcData.contingency_pct || 5;
        const contAmt = Number(calcData.contingency_amount || 0);
        parts.push(`РќР•РџР Р•Р”Р’РР”Р•РќРќР«Р• (${contPct}%): ${fmt(contAmt)} в‚Ѕ`);
        parts.push(`в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ`);
        parts.push(`РРўРћР“Рћ СЃРµР±РµСЃС‚РѕРёРјРѕСЃС‚СЊ: ${fmt(calcData.total_cost)} в‚Ѕ`);
        parts.push(`РљР»РёРµРЅС‚Сѓ (СЃ РјР°СЂР¶РѕР№): ${fmt(calcData.total_with_margin)} в‚Ѕ`);
        parts.push(`РњР°СЂР¶Р°: ${calcData.margin_pct || '?'}%`);

        calcSummary = parts.join('\n');
      }

      let analogsSummary = 'РђРЅР°Р»РѕРіРѕРІ РЅРµС‚.';
      if (analogs.length > 0) {
        analogsSummary = analogs.map(a =>
          `- ${a.title}: СЃРµР±РµСЃ ${a.total_cost}в‚Ѕ, РєР»РёРµРЅС‚Сѓ ${a.total_with_margin}в‚Ѕ, РјР°СЂР¶Р° ${a.margin_pct}%, Р±СЂРёРіР°РґР° ${a.crew_count} С‡РµР», ${a.work_days} РґРЅРµР№`
        ).join('\n');
      }

      // 5. System prompt
      const systemPrompt = `РўС‹ РњРёРјРёСЂ вЂ” РР-Р°СЃСЃРёСЃС‚РµРЅС‚ РћРћРћ В«РђСЃРіР°СЂРґ-РЎРµСЂРІРёСЃВ». Р”РёСЂРµРєС‚РѕСЂ ${director_name || 'РґРёСЂРµРєС‚РѕСЂ'} РѕСЃС‚Р°РІРёР» РєРѕРјРјРµРЅС‚Р°СЂРёР№ Рє РїСЂРѕСЃС‡С‘С‚Сѓ.

РџР РћРЎР§РЃРў: ${estimate.title || estimate.object_name || 'Р‘РµР· РЅР°Р·РІР°РЅРёСЏ'}
Р—Р°РєР°Р·С‡РёРє: ${estimate.customer || 'вЂ”'}
РћР±СЉРµРєС‚: ${estimate.object_city || 'вЂ”'}, ${estimate.object_distance_km || '?'} РєРј
РўРёРї СЂР°Р±РѕС‚: ${estimate.work_type || 'вЂ”'}
Р‘СЂРёРіР°РґР°: ${estimate.crew_count || '?'} С‡РµР», ${estimate.work_days || '?'} СЂР°Р±. РґРЅРµР№

Р РђРЎР§РЃРў (СЃРµР±РµСЃС‚РѕРёРјРѕСЃС‚СЊ):
${calcSummary}

РљРћРњРњР•РќРўРђР РР™ Р”РР Р•РљРўРћР Рђ (${trigger_action}):
"${director_comment}"

РђРќРђР›РћР“РР§РќР«Р• РџР РћР•РљРўР«:
${analogsSummary}

РўР’РћРЇ Р—РђР”РђР§Рђ:
1. РќР°С‡РЅРё СЃ С„СЂР°Р·С‹ "РџРѕРєР° Р¶РґС‘Рј РѕС‚РІРµС‚Р° РѕС‚ ${pmName}, СЏ РїРѕСЃРјРѕС‚СЂРµР» РёРЅС„РѕСЂРјР°С†РёСЋ Рё РІРѕС‚ С‡С‚Рѕ РјРѕРіСѓ СЃРєР°Р·Р°С‚СЊ:"
2. РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ РєРѕРјРјРµРЅС‚Р°СЂРёР№ РґРёСЂРµРєС‚РѕСЂР°
3. Р•СЃР»Рё РјРѕР¶РµС€СЊ РїРѕРјРѕС‡СЊ вЂ” РґР°Р№ РєРѕРЅРєСЂРµС‚РЅС‹Рµ С†РёС„СЂС‹, СЃСЂР°РІРЅРµРЅРёСЏ СЃ Р°РЅР°Р»РѕРіР°РјРё, РїРµСЂРµСЃС‡РёС‚Р°Р№ РµСЃР»Рё РЅСѓР¶РЅРѕ
4. Р•СЃР»Рё РЅРµ РјРѕР¶РµС€СЊ вЂ” РЅР°РїРёС€Рё: "РЇ С…РѕС‚РµР» РїРѕРјРѕС‡СЊ, РЅРѕ РЅРµ СЃРјРѕРі РЅР°Р№С‚Рё РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РёРЅС„РѕСЂРјР°С†РёРё РїРѕ СЌС‚РѕРјСѓ РІРѕРїСЂРѕСЃСѓ. Р–РґС‘Рј, С‡С‚Рѕ СЃРєР°Р¶РµС‚ ${pmName}."
5. Р•СЃР»Рё РІРёРґРёС€СЊ СЂРёСЃРє (РјР°СЂР¶Р° РїР°РґР°РµС‚ РЅРёР¶Рµ 15%, СЃРµР±РµСЃС‚РѕРёРјРѕСЃС‚СЊ РїСЂРµРІС‹С€Р°РµС‚ Р°РЅР°Р»РѕРіРё РЅР° >30%) вЂ” РїСЂРµРґСѓРїСЂРµРґРё

РџР РђР’РР›Рђ:
- РћС‚РІРµС‡Р°Р№ РїРѕ-СЂСѓСЃСЃРєРё
- Р‘СѓРґСЊ РєРѕРЅРєСЂРµС‚РЅС‹Рј вЂ” С†РёС„СЂС‹, РїСЂРѕС†РµРЅС‚С‹, СЃСѓРјРјС‹
- РЎСЃС‹Р»Р°Р№СЃСЏ РЅР° Р°РЅР°Р»РѕРіРё РµСЃР»Рё РµСЃС‚СЊ
- РќРµ РїСЂРёРЅРёРјР°Р№ СЂРµС€РµРЅРёРµ Р·Р° РґРёСЂРµРєС‚РѕСЂР° РёР»Рё Р Рџ вЂ” С‚РѕР»СЊРєРѕ СЂРµРєРѕРјРµРЅРґСѓР№
- РњР°РєСЃРёРјСѓРј 200 СЃР»РѕРІ
- РСЃРїРѕР»СЊР·СѓР№ С‚Р°СЂРёС„С‹ Рё С„РѕСЂРјСѓР»С‹ РёР· СЂР°СЃС‡С‘С‚РЅРѕРіРѕ РґРІРёР¶РєР° (Р¤РћРў 55%, РЅР°РєР»Р°РґРЅС‹Рµ 15%, СЂР°СЃС…РѕРґРЅС‹Рµ 3%, РЅРµРїСЂРµРґРІРёРґРµРЅРЅС‹Рµ 5%)`;

      // 6. Р’С‹Р·РІР°С‚СЊ AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: director_comment }],
        maxTokens: config.max_tokens || 8000,
        temperature: 0.4
      });

      const responseText = aiResult.text || '';
      const durationMs = Date.now() - startTime;

      // 7. РћРїСЂРµРґРµР»РёС‚СЊ СЃС†РµРЅР°СЂРёР№
      let scenario = 'can_help';
      if (responseText.includes('РЅРµ СЃРјРѕРі РЅР°Р№С‚Рё РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РёРЅС„РѕСЂРјР°С†РёРё') || responseText.includes('Р–РґС‘Рј, С‡С‚Рѕ СЃРєР°Р¶РµС‚')) {
        scenario = 'cannot_help';
      }
      if (responseText.includes('РїСЂРµРґСѓРїСЂРµРґ') || responseText.includes('СЂРёСЃРє') || responseText.includes('РЅРёР¶Рµ 15%')) {
        scenario = 'warning';
      }

      // 8. Р—Р°РїРёСЃР°С‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РІ С‡Р°С‚ РѕС‚ mimir_bot
      const msgMetadata = {
        confidence: scenario === 'can_help' ? 'high' : scenario === 'warning' ? 'medium' : 'low',
        trigger_action,
        scenario,
        tokens_input: aiResult.usage?.inputTokens || 0,
        tokens_output: aiResult.usage?.outputTokens || 0
      };
      const { rows: [mimirMsg] } = await db.query(`
        INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
        VALUES ($1, $2, $3, 'mimir_response', $4, false, NOW()) RETURNING *
      `, [chat_id, botUserId, responseText, JSON.stringify(msgMetadata)]);

      // Update chat counters
      await db.query(
        'UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
        [chat_id]
      );

      // 9. SSE notify members
      const { sendToUser: sse } = require('./sse');
      const members = await db.query('SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chat_id]);
      for (const m of members.rows) {
        sse(m.user_id, 'chat:new_message', {
          chat_id,
          message: { ...mimirMsg, user_name: 'РњРёРјРёСЂ', is_mimir_bot: true }
        });
      }

      // 10. Р—Р°РїРёСЃР°С‚СЊ РІ mimir_auto_log
      await db.query(`
        INSERT INTO mimir_auto_log (chat_id, estimate_id, trigger_action, trigger_comment, response, tokens_input, tokens_output, duration_ms, scenario)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [chat_id, estimate_id, trigger_action, director_comment, responseText,
          aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, durationMs, scenario]);

      return reply.send({
        message_id: mimirMsg.id,
        scenario,
        duration_ms: durationMs
      });

    } catch (error) {
      fastify.log.error({ err: error }, '[Mimir auto-respond error]');
      return reply.code(500).send({ error: 'РћС€РёР±РєР° Р°РІС‚РѕРѕС‚РІРµС‚Р° РњРёРјРёСЂР°: ' + error.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РЎРµСЂРІРµСЂРЅС‹Р№ С‚СЂРµРєРµСЂ РїСЂРѕСЃС‡С‘С‚РѕРІ РњРёРјРёСЂР° вЂ” С‚РµРїРµСЂСЊ PERSISTENT (Р‘Р”, РЅРµ in-memory).
  // mimirJobs.get/set/del СЂР°Р±РѕС‚Р°СЋС‚ СЃ С‚Р°Р±Р»РёС†РµР№ mimir_estimate_jobs (V119).
  // РҐСЂР°РЅРёС‚СЃСЏ: done РЅР°РІСЃРµРіРґР°, error 24С‡, running РґРѕ Р·Р°РІРµСЂС€РµРЅРёСЏ РёР»Рё sweep С‚Р°Р№РјР°СѓС‚Р°.
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  // Р—Р°РїСѓСЃРєР°РµРј С„РѕРЅРѕРІСѓСЋ Р°РІС‚РѕС‡РёСЃС‚РєСѓ (СЃС‚Р°СЂС‹Рµ error, Р·Р°РІРёСЃС€РёРµ running)
  mimirJobs.startSweep();

  // GET /api/mimir/auto-estimate-status вЂ” РїСЂРѕРІРµСЂРёС‚СЊ, РµСЃС‚СЊ Р»Рё Р°РєС‚РёРІРЅС‹Р№/РіРѕС‚РѕРІС‹Р№ РїСЂРѕСЃС‡С‘С‚
  fastify.get('/auto-estimate-status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id, tender_id } = request.query || {};
    const key = work_id ? 'w' + work_id : 't' + tender_id;
    if (!key || key === 'wundefined' || key === 'tundefined') return { status: 'none' };

    const job = await mimirJobs.get(key);
    if (!job) return { status: 'none' };

    return {
      status: job.status,  // 'running', 'questions', 'done', 'error'
      result: job.result || null,
      session_id: job.session_id || null,
      questions: job.questions || null,
      error: job.error || null,
      error_code: job.error_code || null,
      provider_message: job.provider_message || null,
      elapsed_ms: Date.now() - job.startedAt
    };
  });

  // GET /api/mimir/auto-estimate-status-batch вЂ” СЃС‚Р°С‚СѓСЃ РЅРµСЃРєРѕР»СЊРєРёС… С‚РµРЅРґРµСЂРѕРІ СЃСЂР°Р·Сѓ
  // РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ pm_calcs.js РґР»СЏ РѕРєСЂР°СЃРєРё РєРЅРѕРїРѕРє В«вљЎ РџСЂРѕСЃС‡РёС‚Р°С‚СЊВ»
  fastify.get('/auto-estimate-status-batch', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_ids } = request.query || {};
    if (!tender_ids) return {};
    const ids = String(tender_ids).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0).slice(0, 50);
    if (!ids.length) return {};
    const { rows } = await db.query(`
      SELECT DISTINCT ON (tender_id) tender_id, status, estimate_id
      FROM mimir_estimate_jobs
      WHERE tender_id = ANY($1::int[])
        AND (
          status IN ('running','questions')
          OR (status = 'done' AND started_at > NOW() - INTERVAL '7 days')
          OR (status = 'error' AND started_at > NOW() - INTERVAL '24 hours')
        )
      ORDER BY tender_id, started_at DESC
    `, [ids]);
    const result = {};
    for (const r of rows) result[r.tender_id] = { status: r.status, estimate_id: r.estimate_id || null };
    return result;
  });

  // GET /api/mimir/auto-estimate-active вЂ” РІРµСЂРЅСѓС‚СЊ РІСЃРµ РёРґСѓС‰РёРµ/РЅРµРґР°РІРЅРёРµ РїСЂРѕСЃС‡С‘С‚С‹ СЋР·РµСЂР°
  fastify.get('/auto-estimate-active', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user?.id || null;
    const jobs = await mimirJobs.listActive({ user_id: userId });
    const active = jobs.map(j => {
      const key = j.job_key;
      const isWork = key.startsWith('w');
      const id = parseInt(key.slice(1));
      return {
        key, status: j.status,
        work_id: isWork ? id : null,
        tender_id: isWork ? null : id,
        elapsed_ms: Date.now() - j.startedAt,
        estimate_id: j.estimate_id || j.result?.estimate_id || null
      };
    });
    return { active };
  });

  // GET /api/mimir/auto-estimate-history вЂ” РёСЃС‚РѕСЂРёСЏ Р’РЎР•РҐ РїСЂРѕСЃС‡С‘С‚РѕРІ work/tender (done РЅР°РІСЃРµРіРґР°)
  fastify.get('/auto-estimate-history', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id, tender_id, limit } = request.query || {};
    const wid = work_id ? parseInt(work_id) : null;
    const tid = tender_id ? parseInt(tender_id) : null;
    if (!wid && !tid) return { history: [] };
    const hist = await mimirJobs.historyFor({
      work_id: wid, tender_id: tid,
      limit: Math.min(parseInt(limit) || 10, 50)
    });
    return {
      history: hist.map(j => ({
        id: j._id,
        status: j.status,
        started_at: new Date(j.startedAt).toISOString(),
        completed_at: j.completedAt ? new Date(j.completedAt).toISOString() : null,
        estimate_id: j.estimate_id || j.result?.estimate_id || null,
        error: j.error,
        error_code: j.error_code,
        card: j.result?.card || null
      }))
    };
  });

  // DELETE /api/mimir/auto-estimate-status вЂ” СЃР±СЂРѕСЃРёС‚СЊ Р°РєС‚РёРІРЅС‹Р№ РґР¶РѕР± (СЋР·РµСЂ Р·Р°РєСЂС‹Р» РјРѕРґР°Р»РєСѓ)
  // Note: СЂРµР°Р»СЊРЅРѕ СѓРґР°Р»СЏРµС‚ С‚РѕР»СЊРєРѕ running/questions. done РѕСЃС‚Р°С‘С‚СЃСЏ РЅР°РІСЃРµРіРґР°.
  fastify.delete('/auto-estimate-status', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id, tender_id } = request.query || {};
    const key = work_id ? 'w' + work_id : 't' + tender_id;
    if (key && key !== 'wundefined' && key !== 'tundefined') {
      await mimirJobs.del(key);
    }
    return { ok: true };
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // AP1: POST /api/mimir/auto-estimate вЂ” РђРІС‚Рѕ-РїСЂРѕСЃС‡С‘С‚ СЂР°Р±РѕС‚С‹ (SSE РїСЂРѕРіСЂРµСЃСЃ)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РљР»РёРµРЅС‚: fetch streaming (POST СЃ body, С‡РёС‚Р°РµС‚ С‡Р°РЅРєРё РєР°Рє SSE).
  fastify.post('/auto-estimate', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id, tender_id } = request.body || {};
    const user = request.user;

    let workId = work_id ? parseInt(work_id) : null;
    let tenderId = tender_id ? parseInt(tender_id) : null;

    // If tender_id given without work_id, check if work exists for this tender
    if (!workId && tenderId) {
      if (isNaN(tenderId)) return reply.code(400).send({ success: false, message: 'tender_id РЅРµРєРѕСЂСЂРµРєС‚РµРЅ' });
      const workRow = (await db.query('SELECT id FROM works WHERE tender_id = $1 LIMIT 1', [tenderId])).rows[0];
      if (workRow) {
        workId = workRow.id;
        tenderId = null; // work found, use normal flow
      }
    }

    if (!workId && !tenderId) {
      return reply.code(400).send({ success: false, message: 'work_id РёР»Рё tender_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });
    }

    // РџСЂРѕРІРµСЂРєР°: СѓР¶Рµ Р±РµР¶РёС‚ РїСЂРѕСЃС‡С‘С‚?
    const jobKey = workId ? 'w' + workId : 't' + tenderId;
    const existingJob = await mimirJobs.get(jobKey);
    if (existingJob && existingJob.status === 'running') {
      // Р•СЃР»Рё РїРѕСЃР»РµРґРЅРµРµ РѕР±РЅРѕРІР»РµРЅРёРµ Р±С‹Р»Рѕ РґР°РІРЅРѕ (5+ РјРёРЅ РЅР°Р·Р°Рґ) вЂ” СЌС‚РѕС‚ running РїСЂРѕС‚СѓС…
      // (РїСЂРѕС†РµСЃСЃ СѓРїР°Р» РјРµР¶РґСѓ updated_at Рё СЃРµР№С‡Р°СЃ). РџРѕРјРµС‡Р°РµРј РєР°Рє error Рё РїСѓСЃРєР°РµРј РЅРѕРІС‹Р№.
      const stale = (Date.now() - existingJob.updatedAt) > 5 * 60 * 1000;
      if (stale) {
        console.log(`[Mimir] Stale running РѕР±РЅР°СЂСѓР¶РµРЅ (${Math.round((Date.now()-existingJob.updatedAt)/1000)}s Р±РµР· РѕР±РЅРѕРІР»РµРЅРёР№) вЂ” РїРѕРјРµС‡Р°СЋ РєР°Рє error Рё Р·Р°РїСѓСЃРєР°СЋ Р·Р°РЅРѕРІРѕ`);
        await mimirJobs.set(jobKey, {
          status: 'error',
          error: 'РџСЂРµРґС‹РґСѓС‰РёР№ РїСЂРѕС†РµСЃСЃ СѓРїР°Р» РІРѕ РІСЂРµРјСЏ РїСЂРѕСЃС‡С‘С‚Р° (timeout >5 РјРёРЅ)',
          error_code: 'orphaned'
        }, { user_id: request.user?.id || null });
      } else {
        return reply.code(409).send({
          success: false,
          message: 'РџСЂРѕСЃС‡С‘С‚ СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ',
          status: 'running',
          elapsed_ms: Date.now() - existingJob.startedAt
        });
      }
    }
    // Р РµРіРёСЃС‚СЂРёСЂСѓРµРј РґР¶РѕР± РІ Р‘Р”
    await mimirJobs.set(jobKey, { status: 'running', result: null }, { user_id: request.user?.id || null });

    // SSE headers
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendEvent = (data) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) { /* client disconnected */ }
    };

    const startTime = Date.now();

    try {
      const collector = require('../services/mimir-collector');
      const { getSystemPrompt, serializeContext } = require('../services/mimir-prompt');
      const mimirAutoEstimate = require('../services/mimir-auto-estimate');

      sendEvent({ type: 'start', work_id: workId, tender_id: tenderId, message: 'рџ§  РњРёРјРёСЂ РїСЂРёСЃС‚СѓРїР°РµС‚ Рє Р°РЅР°Р»РёР·Сѓ' });

      // в”Ђв”Ђ Р¤Р°Р·Р° 1: РЎРµСЂРІРµСЂ СЃРѕР±РёСЂР°РµС‚ Р’РЎР• РґР°РЅРЅС‹Рµ (15 С‚РёРїРѕРІ, ~200РјСЃ) в”Ђв”Ђ
      const collectorArg = workId ? workId : { tenderId };
      const ctx = await collector.collectAll(db, collectorArg, (event) => sendEvent(event));

      // в”Ђв”Ђ Р¤Р°Р·Р° 2: OCR РґРѕРєСѓРјРµРЅС‚РѕРІ в†’ Claude Р°РЅР°Р»РёР·РёСЂСѓРµС‚ Рё СЃС‡РёС‚Р°РµС‚ в”Ђв”Ђ
      sendEvent({ type: 'progress', step: 'ocr_documents', message: 'рџ“– Р Р°СЃРїРѕР·РЅР°СЋ С‚РµРєСЃС‚ РёР· РўР—-РґРѕРєСѓРјРµРЅС‚РѕРІ (OCR)...' });

      const dataText = serializeContext(ctx);
      const systemPrompt = getSystemPrompt();

      // KRITICHNO: routerai РЅРµ РїРµСЂРµРґР°С‘С‚ PDF РІ Claude (РІРѕР·РІСЂР°С‰Р°РµС‚ 503 РЅР° type:file).
      // РР·-Р·Р° СЌС‚РѕРіРѕ Claude СѓРіР°РґС‹РІР°Р» РєРѕРЅС‚РµРєСЃС‚ РІРјРµСЃС‚Рѕ С‡С‚РµРЅРёСЏ РґРѕРєСѓРјРµРЅС‚РѕРІ.
      // Р РµС€РµРЅРёРµ: OCR-РёСЂСѓРµРј PDF РЅР° СЃРµСЂРІРµСЂРµ С‡РµСЂРµР· gemini-2.5-flash, РєСЌС€РёСЂСѓРµРј
      // СЂРµР·СѓР»СЊС‚Р°С‚ РІ documents.ocr_text, РѕС‚РґР°С‘Рј С‚РµРєСЃС‚ РѕР±С‹С‡РЅС‹Рј user-СЃРѕРѕР±С‰РµРЅРёРµРј.
      const pdfOcr = require('../services/pdf-ocr');
      const ocrTexts = [];
      try {
        const ocrResults = tenderId
          ? await pdfOcr.ocrTenderDocuments(tenderId)
          : await pdfOcr.ocrWorkDocuments(workId);
        for (const r of ocrResults) {
          if (r.text && r.text.length > 50) {
            ocrTexts.push(`в•ђв•ђв•ђ Р”РћРљРЈРњР•РќРў: ${r.original_name} в•ђв•ђв•ђ\n${r.text}`);
            sendEvent({ type: 'progress', step: 'ocr_done',
              message: `рџ“„ Р Р°СЃРїРѕР·РЅР°РЅ "${r.original_name}" (${(r.text.length/1024).toFixed(1)} KB${r.cached ? ', РёР· РєСЌС€Р°' : ''})` });
          } else if (r.error) {
            console.warn(`[AP6 OCR] doc ${r.document_id} (${r.original_name}) failed: ${r.error}`);
          }
        }
        console.log(`[AP6 OCR] РР·РІР»РµС‡РµРЅРѕ С‚РµРєСЃС‚Р° РёР· ${ocrTexts.length} РґРѕРєСѓРјРµРЅС‚РѕРІ`);
      } catch (e) {
        console.error('[AP6 OCR] Pipeline failed:', e.message);
        sendEvent({ type: 'progress', step: 'ocr_failed',
          message: 'вљ пёЏ OCR РЅРµ СЃСЂР°Р±РѕС‚Р°Р», Claude РїРѕР»СѓС‡РёС‚ С‚РѕР»СЊРєРѕ РјРµС‚Р°РґР°РЅРЅС‹Рµ РґРѕРєСѓРјРµРЅС‚РѕРІ' });
      }

      // РўРµРєСЃС‚РѕРІРѕРµ user-СЃРѕРѕР±С‰РµРЅРёРµ: Р·Р°РґР°С‡Р° + РєРѕРЅС‚РµРєСЃС‚ + РџРћР›РќР«Р™ РўР•РљРЎРў РР— РўР—
      const userContent = [];
      const ocrBlock = ocrTexts.length > 0
        ? `\n\nв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ\nрџ“‘ РўР•РљРЎРў РР— РџР РР›РћР–Р•РќРќР«РҐ Р”РћРљРЈРњР•РќРўРћР’ (OCR):\nв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ\n\n${ocrTexts.join('\n\n')}\n\nв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ\nРљРћРќР•Р¦ РўР•РљРЎРўРђ Р”РћРљРЈРњР•РќРўРћР’\nв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ`
        : '';
      userContent.push({
        type: 'text',
        text: `РЎРѕСЃС‚Р°РІСЊ РїСЂРѕСЃС‡С‘С‚ РґР»СЏ ${workId ? 'СЂР°Р±РѕС‚С‹ #' + workId : 'С‚РµРЅРґРµСЂР° #' + tenderId}.\n\n${dataText}${ocrBlock}`
      });

      // Р”Р°Р»СЊС€Рµ РёРґС‘С‚ AI-Р°РЅР°Р»РёР·
      sendEvent({ type: 'progress', step: 'ai_thinking', message: 'рџ§  РњРёРјРёСЂ РіР»СѓР±РѕРєРѕ Р°РЅР°Р»РёР·РёСЂСѓРµС‚ РґР°РЅРЅС‹Рµ...' });

      // AP6: РґРѕРјРµРЅС‹ РїРѕРёСЃРєР° РґР»СЏ web search (РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ РІ agent loop РєРѕРіРґР° Claude РїСЂРѕСЃРёС‚)
      const WEB_SEARCH_DOMAINS = [
        'rzd.ru', 'aviasales.ru', 'tutu.ru', 'yandex.ru',
        'pulscen.ru', 'tiu.ru', 'tn.ru',
        'b2b-center.ru', 'etp-ets.ru', 'zakupki.gov.ru',
        'taifun-vakuum.ru', 'practick.ru', 'gidromashservice.ru',
        'wildberries.ru', 'ozon.ru'
      ];

      // Heartbeat РєР°Р¶РґС‹Рµ 3 СЃРµРє вЂ” UI РґРѕР»Р¶РµРЅ РІРёРґРµС‚СЊ С‡С‚Рѕ РїСЂРѕС†РµСЃСЃ Р¶РёРІ
      let thinkingSec = 0;
      let currentPhase = 'thinking'; // 'thinking', 'searching', 'finalization', 'creating'
      let currentDetail = 'рџ§  РњРёРјРёСЂ Р°РЅР°Р»РёР·РёСЂСѓРµС‚ РўР— Рё СЃРѕР±РёСЂР°РµС‚ С‚СЂРµР±РѕРІР°РЅРёСЏ...';
      let _touchCounter = 0;
      const heartbeat = setInterval(() => {
        thinkingSec += 3;
        try {
          // РњРµРЅСЏРµРј РїРѕРґРїРёСЃСЊ РєР°Р¶РґС‹Рµ 15 СЃРµРє РІ "thinking" С‡С‚РѕР±С‹ Р±С‹Р»Рѕ РІРёРґРЅРѕ Р¶РёРІРѕР№
          if (currentPhase === 'thinking') {
            const variants = [
              'рџ§  РњРёРјРёСЂ Р°РЅР°Р»РёР·РёСЂСѓРµС‚ РўР— Рё С‡РёС‚Р°РµС‚ РґРѕРєСѓРјРµРЅС‚С‹...',
              'рџ”¬ РР·СѓС‡Р°СЋ С‚СЂРµР±РѕРІР°РЅРёСЏ Рё С…Р°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё СЂР°Р±РѕС‚...',
              'рџ’­ Р”СѓРјР°СЋ РЅР°Рґ РєРѕРјР°РЅРґРѕР№, РјР°СЂС€СЂСѓС‚РѕРј Рё РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµРј...',
              'рџ“Љ РЎРѕРїРѕСЃС‚Р°РІР»СЏСЋ СЃ Р°РЅР°Р»РѕРіРёС‡РЅС‹РјРё СЂР°Р±РѕС‚Р°РјРё РёР· РёСЃС‚РѕСЂРёРё...',
              'рџ§® РџСЂРёРєРёРґС‹РІР°СЋ РѕР±СЉС‘РјС‹ Рё СЂРµСЃСѓСЂСЃС‹...'
            ];
            currentDetail = variants[Math.floor(thinkingSec / 15) % variants.length];
          }
          sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: `${currentDetail} (${thinkingSec} СЃРµРє)` });
          // РљР°Р¶РґС‹Рµ 30 СЃРµРє РґРѕС‚СЂР°РіРёРІР°РµРјСЃСЏ РґРѕ Р‘Р” вЂ” С‡С‚РѕР±С‹ stale-РґРµС‚РµРєС‚РѕСЂ РЅРµ РїРѕРјРµС‚РёР» РєР°Рє Р·РѕРјР±Рё
          _touchCounter++;
          if (_touchCounter % 10 === 0) {
            mimirJobs.touch(jobKey).catch(()=>{});
          }
        } catch {}
      }, 3000);

      let aiResult;
      try {
        // Agent loop: РµСЃР»Рё Claude РІС‹Р·С‹РІР°РµС‚ WebSearch tool вЂ” РјС‹ СЃР°РјРё РІС‹РїРѕР»РЅСЏРµРј РµРіРѕ
        // С‡РµСЂРµР· routerai plugin 'web' Рё РІРѕР·РІСЂР°С‰Р°РµРј СЂРµР·СѓР»СЊС‚Р°С‚С‹ РІ СЃР»РµРґСѓСЋС‰РёР№ Р·Р°РїСЂРѕСЃ.
        // РўР°Рє Claude РјРѕР¶РµС‚ РёС‚РµСЂР°С‚РёРІРЅРѕ РёСЃРєР°С‚СЊ С†РµРЅС‹/РєРѕРјР°РЅРґРёСЂРѕРІРєРё Рё Р·Р°С‚РµРј СЃС‚СЂРѕРёС‚СЊ РїСЂРѕСЃС‡С‘С‚.
        aiResult = await aiProvider.runAgentLoop({
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          maxTokens: 32000,           // AP6: СЂР°СЃС€РёСЂРµРЅРЅС‹Р№ output РґР»СЏ extended thinking
          temperature: 0.4,            // AP6: РіР»СѓР±Р¶Рµ Р°РЅР°Р»РёР· РІ risk/comment
          verbosity: 'max',            // AP6: extended thinking вЂ” РЅСѓР¶РЅС‹ РўРћР§РќР«Р• РїСЂРѕСЃС‡С‘С‚С‹,
                                       // РЅРµ РїСЂРёРјРµСЂРЅС‹Рµ. Р¤РёРЅР°Р» РґР°Р¶Рµ СЃ thinking в‰¤ 2-3 РјРёРЅ
                                       // РїРѕС‚РѕРјСѓ С‡С‚Рѕ РІС…РѕРґРЅРѕР№ РєРѕРЅС‚РµРєСЃС‚ С‚РµРїРµСЂСЊ РєРѕРјРїР°РєС‚РЅС‹Р№
                                       // (РЅРµС‚ PDF base64, РµСЃС‚СЊ СЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С‚РµРєСЃС‚).
          maxIterations: 5,            // AgentLoop: 5 РёС‚РµСЂР°С†РёР№ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РєРѕРіРґР° РўР—
                                       // РґРµР№СЃС‚РІРёС‚РµР»СЊРЅРѕ РµСЃС‚СЊ РІ РєРѕРЅС‚РµРєСЃС‚Рµ.
          webSearchIncludeDomains: WEB_SEARCH_DOMAINS,
          plugins: [
            // РўРѕР»СЊРєРѕ web-search. file-parser СѓР±СЂР°РЅ вЂ” routerai РµРіРѕ РЅРµ РїРµСЂРµРґР°С‘С‚ РІ
            // Anthropic API (РІРѕР·РІСЂР°С‰Р°РµС‚ 503). OCR С‚РµРїРµСЂСЊ РІС‹РїРѕР»РЅСЏРµРј РЅР° СЃРµСЂРІРµСЂРµ
            // С‡РµСЂРµР· src/services/pdf-ocr.js РґРѕ РѕС‚РїСЂР°РІРєРё РєРѕРЅС‚РµРєСЃС‚Р°.
            {
              id: 'web',
              engine: 'native',
              max_results: 8,
              search_prompt: 'РС‰Рё Р°РєС‚СѓР°Р»СЊРЅС‹Рµ С†РµРЅС‹ 2026 РіРѕРґР° РЅР° СЂРѕСЃСЃРёР№СЃРєРёС… СЃР°Р№С‚Р°С… РїРѕСЃС‚Р°РІС‰РёРєРѕРІ, С‚РµРЅРґРµСЂРЅС‹С… РїР»РѕС‰Р°РґРєР°С… Рё Р Р–Р”/Aviasales',
              include_domains: WEB_SEARCH_DOMAINS
            }
          ],
          // SSE РїСЂРѕРіСЂРµСЃСЃ: СЃРѕРѕР±С‰Р°РµРј UI Рѕ РєР°Р¶РґРѕР№ РёС‚РµСЂР°С†РёРё/РїРѕРёСЃРєРµ
          // + РѕР±РЅРѕРІР»СЏРµРј currentPhase/currentDetail С‡С‚РѕР±С‹ heartbeat Р¶РёР»
          onProgress: (evt) => {
            try {
              if (evt.type === 'iteration_start' && evt.iteration > 0) {
                currentPhase = 'thinking';
                currentDetail = `рџ”„ РђРЅР°Р»РёР·РёСЂСѓСЋ СЂРµР·СѓР»СЊС‚Р°С‚С‹ РїРѕРёСЃРєР° (РёС‚РµСЂР°С†РёСЏ ${evt.iteration + 1} РёР· 8)`;
                sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: currentDetail });
              } else if (evt.type === 'tool_calls') {
                currentPhase = 'searching';
                const queries = evt.tool_calls.map(t => t.query).filter(Boolean);
                currentDetail = queries.length > 0
                  ? `рџ”Ќ РС‰Сѓ РІ РёРЅС‚РµСЂРЅРµС‚Рµ: ${queries.slice(0,2).join(' вЂў ').substring(0, 150)}`
                  : `рџ”§ Р—Р°РїСЂР°С€РёРІР°СЋ ${evt.tool_calls.length} РёРЅСЃС‚СЂСѓРјРµРЅС‚(РѕРІ)`;
                sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: currentDetail });
              } else if (evt.type === 'tool_results') {
                const totalChars = evt.results.reduce((s, r) => s + (r.result_chars || 0), 0);
                currentPhase = 'thinking';
                currentDetail = `вњ… РџРѕР»СѓС‡РµРЅРѕ ${(totalChars/1024).toFixed(1)} KB С„Р°РєС‚РѕРІ, Р°РЅР°Р»РёР·РёСЂСѓСЋ...`;
                sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: currentDetail });
              } else if (evt.type === 'finalization') {
                currentPhase = 'finalization';
                currentDetail = `рџЏЃ Р”РѕСЃС‚Р°С‚РѕС‡РЅРѕ РїРѕРёСЃРєРѕРІ. РЎРѕР±РёСЂР°СЋ РёС‚РѕРіРѕРІС‹Р№ РїСЂРѕСЃС‡С‘С‚ СЃРѕ РІСЃРµРјРё С†РёС„СЂР°РјРё (СЌС‚Рѕ СЃР°РјС‹Р№ РґРѕР»РіРёР№ СЌС‚Р°Рї вЂ” Claude РґСѓРјР°РµС‚ 1-5 РјРёРЅ)...`;
                sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: currentDetail });
              }
            } catch {}
          }
        });
      } finally {
        clearInterval(heartbeat);
      }

      if (!aiResult || !aiResult.text) {
        // РЎС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅР°СЏ РѕС€РёР±РєР° вЂ” caller-РѕР±СЂР°Р±РѕС‚С‡РёРє РЅРёР¶Рµ РїСЂРµРІСЂР°С‚РёС‚ РµС‘ РІ РїРѕРЅСЏС‚РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ
        throw new aiProvider.AIProviderError({
          code: 'empty_response',
          providerMessage: 'AI РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ content (РЅРµС‚ С‚РµРєСЃС‚Р° Рё РЅРµС‚ tool_calls)',
          requestSummary: {
            model: aiResult?.model,
            finish_reason: aiResult?.stopReason,
            usage: aiResult?.usage
          }
        });
      }

      console.log(`[AP5] Claude responded: ${aiResult.text.length} chars, model=${aiResult.model}, ${aiResult.durationMs}ms`);
      console.log(`[AP5] First 200 chars: ${aiResult.text.substring(0, 200)}`);

      // в”Ђв”Ђ РџР°СЂСЃРёРј РѕС‚РІРµС‚ (РјРѕР¶РµС‚ Р±С‹С‚СЊ questions РёР»Рё estimate) в”Ђв”Ђ
      let parsed;
      try { parsed = mimirAutoEstimate.parseAIResponse(aiResult.text); }
      catch (e) {
        // РќРµ JSON вЂ” С‚РµРєСЃС‚РѕРІС‹Р№ РѕС‚РІРµС‚. Р­С‚Рѕ Р±С‹РІР°РµС‚ РєРѕРіРґР° agent loop СѓРїС‘СЂСЃСЏ РІ
        // upstream-С‚Р°Р№РјР°СѓС‚ Рё РІРµСЂРЅСѓР» fallback-СЃРІРѕРґРєСѓ РёР· РїРѕРёСЃРєРѕРІ. Р‘Р” РѕСЃС‚Р°РІР»СЏС‚СЊ
        // РІ running РЅРµР»СЊР·СЏ вЂ” РїРѕРјРµС‚РёРј РєР°Рє error СЃРѕ СЃРїРµС†РёР°Р»СЊРЅС‹Рј РєРѕРґРѕРј, С‡С‚РѕР±С‹
        // СЋР·РµСЂ РјРѕРі СѓРІРёРґРµС‚СЊ СЃРІРѕРґРєСѓ Рё СЂРµС€РёС‚СЊ РІСЂСѓС‡РЅСѓСЋ.
        const isFallbackText = aiResult.agentExceeded || aiResult.stopReason === 'agent_loop_timeout';
        await mimirJobs.set(jobKey, {
          status: 'error',
          error: isFallbackText
            ? 'Р¤РёРЅР°Р»СЊРЅС‹Р№ Р·Р°РїСЂРѕСЃ Claude СѓРїС‘СЂСЃСЏ РІ С‚Р°Р№РјР°СѓС‚ (5+ РјРёРЅ). РЎРѕР±СЂР°РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ РµСЃС‚СЊ РІ С‚РµРєСЃС‚РѕРІРѕРј РІРёРґРµ РЅРёР¶Рµ.'
            : 'AI РІРµСЂРЅСѓР» РЅРµ-JSON РѕС‚РІРµС‚. РЎРј. С‚РµРєСЃС‚ РЅРёР¶Рµ.',
          error_code: isFallbackText ? 'upstream_timeout' : 'non_json_response',
          provider_message: aiResult.text?.substring(0, 2000) || null
        }, { user_id: request.user?.id || null });
        sendEvent({ type: 'text_response', text: aiResult.text, model: aiResult.model });
        sendEvent({ type: 'done' });
        reply.raw.end();
        return;
      }

      // Р¤Р°Р·Р° РІРѕРїСЂРѕСЃРѕРІ вЂ” СЃРѕС…СЂР°РЅСЏРµРј РєРѕРЅС‚РµРєСЃС‚ РґР»СЏ /auto-estimate-answer
      if (parsed.phase === 'questions' && parsed.questions) {
        const sessionId = `ae_${workId || 't' + tenderId}_${Date.now()}`;
        // РћР±РЅРѕРІРёС‚СЊ РґР¶РѕР±-С‚СЂРµРєРµСЂ: С„Р°Р·Р° РІРѕРїСЂРѕСЃРѕРІ
        await mimirJobs.set(jobKey, {
          status: 'questions',
          session_id: sessionId, questions: parsed.questions, result: null
        }, { user_id: request.user?.id || null });
        // РљСЌС€РёСЂСѓРµРј РєРѕРЅС‚РµРєСЃС‚ (5 РјРёРЅ TTL)
        if (!fastify._aeQuestionCache) fastify._aeQuestionCache = new Map();
        fastify._aeQuestionCache.set(sessionId, {
          workId, tenderId, dataText, systemPrompt, ctx, user,
          questions: parsed.questions,
          expires: Date.now() + 300000
        });
        // Р§РёСЃС‚РёРј СЃС‚Р°СЂС‹Рµ
        for (const [k, v] of fastify._aeQuestionCache) {
          if (v.expires < Date.now()) fastify._aeQuestionCache.delete(k);
        }

        sendEvent({
          type: 'questions',
          session_id: sessionId,
          questions: parsed.questions,
          model: aiResult.model,
          elapsed_ms: Date.now() - startTime
        });
        sendEvent({ type: 'done' });
        reply.raw.end();
        return;
      }

      // Р¤Р°Р·Р° СЂР°СЃС‡С‘С‚Р°
      sendEvent({ type: 'progress', step: 'creating_estimate', message: 'рџ“ќ РЎРѕР·РґР°СЋ РїСЂРѕСЃС‡С‘С‚ РІ СЃРёСЃС‚РµРјРµ...' });

      const ai = parsed;
      ai._meta = { model: aiResult.model, provider: aiResult.provider };

      // РЎРµСЂРІРµСЂРЅР°СЏ РІР°Р»РёРґР°С†РёСЏ РјР°С‚РµРјР°С‚РёРєРё
      const settings = ctx.settings;
      const recomputed = mimirAutoEstimate.validateAndRecomputeMath(ai, settings,
        { work: ctx.work, tender: ctx.tender, warehouse: ctx.warehouse, workType: ai.estimate?.work_type });
      mimirAutoEstimate.normalizeCalcRows(recomputed.calculation);
      mimirAutoEstimate.resolveEquipmentFromWarehouse(ai, { warehouse: ctx.warehouse, workType: ai.estimate?.work_type });

      // РЎРѕР·РґР°РЅРёРµ estimate РІ Р‘Р”
      const created = await mimirAutoEstimate.createDraftEstimate(db, ctx, ai, recomputed, user);

      const totals = recomputed.totals || {};

      sendEvent({
        type: 'result',
        success: true,
        ap_phase: 'AP5',
        estimate_id: created.estimate_id,
        version_no: created.version_no,
        card: {
          title: ai.estimate?.title || ctx.work.work_title,
          customer: ctx.work.customer_name || ctx.tender?.customer_name,
          object: ctx.work.object_name,
          city: ai.estimate?.object_city || ctx.work.city,
          crew_count: ai.estimate?.crew_count,
          work_days: ai.estimate?.work_days,
          road_days: ai.estimate?.road_days,
          markup_multiplier: totals.markup_multiplier,
          total_cost: totals.total_cost,
          total_with_margin: totals.total_with_margin,
          total_with_vat: totals.total_with_vat,
          margin_pct: totals.margin_pct,
          fot_subtotal: totals.personnel_with_tax,
          travel_subtotal: totals.travel_subtotal,
          transport_subtotal: totals.transport_subtotal,
          chemistry_subtotal: totals.chemistry_subtotal,
          current_subtotal: totals.current_subtotal,
          drift_pct: recomputed.drift,
          time_overflow_fix: recomputed.timeOverflowFix
        },
        analysis: {
          markup_reasoning: ai.analysis?.markup_reasoning || null,
          warnings: ai.analysis?.warnings || []
        },
        equipment_status: ai.equipment_status || null,
        permits_status: ai.permits_status || null,
        route_plan: ai.route_plan || null,
        recommended_crew: ai.recommended_crew || null,
        comment: ai.estimate?.comment || null,
        self_check: ai.self_check || null,
        ai_meta: {
          model: aiResult.model,
          provider: aiResult.provider,
          tokens: aiResult.usage,
          duration_ms: aiResult.durationMs
        },
        elapsed_ms: Date.now() - startTime
      });

      // РЎРѕС…СЂР°РЅРёС‚СЊ СЂРµР·СѓР»СЊС‚Р°С‚ РІ Р‘Р” вЂ” РїРѕР»РЅР°СЏ РєР°СЂС‚РѕС‡РєР°, С‡С‚РѕР±С‹ РїСЂРё РїРѕРІС‚РѕСЂРЅРѕРј РѕС‚РєСЂС‹С‚РёРё РїРѕРєР°Р·Р°С‚СЊ РІСЃС‘
      await mimirJobs.set(jobKey, {
        status: 'done',
        result: {
          estimate_id: created.estimate_id,
          version_no: created.version_no,
          card: {
            title: ai.estimate?.title || ctx.work.work_title,
            customer: ctx.work.customer_name || ctx.tender?.customer_name,
            city: ai.estimate?.object_city || ctx.work.city,
            crew_count: ai.estimate?.crew_count,
            work_days: ai.estimate?.work_days,
            road_days: ai.estimate?.road_days,
            markup_multiplier: totals.markup_multiplier,
            total_cost: totals.total_cost,
            total_with_margin: totals.total_with_margin,
            total_with_vat: totals.total_with_vat,
            margin_pct: totals.margin_pct,
            fot_subtotal: totals.personnel_with_tax,
            travel_subtotal: totals.travel_subtotal,
            transport_subtotal: totals.transport_subtotal,
            chemistry_subtotal: totals.chemistry_subtotal,
            current_subtotal: totals.current_subtotal,
            drift_pct: recomputed.drift
          },
          comment: ai.estimate?.comment || null,
          analysis: {
            markup_reasoning: ai.analysis?.markup_reasoning || null,
            warnings: ai.analysis?.warnings || []
          },
          equipment_status: ai.equipment_status || null,
          route_plan: ai.route_plan || null,
          recommended_crew: ai.recommended_crew || null
        }
      }, { user_id: request.user?.id || null });

      // в”Ђв”Ђ Р“РµРЅРµСЂР°С†РёСЏ РґРѕРєСѓРјРµРЅС‚РѕРІ (СЃРјРµС‚Р°.xlsx + РѕС‚С‡С‘С‚.docx) в”Ђв”Ђ
      // РЎРѕС…СЂР°РЅСЏСЋС‚СЃСЏ РІ works.manual_documents / tenders.manual_documents (JSONB).
      // РћС€РёР±РєРё РЅРµ РІР°Р»СЏС‚ РѕСЃРЅРѕРІРЅРѕР№ РїР°Р№РїР»Р°Р№РЅ вЂ” auto-estimate СѓР¶Рµ РѕС‚СЂР°Р±РѕС‚Р°Р».
      try {
        const docGen = require('../services/document-generator');
        const project = {
          subject: ai.estimate?.title || ctx.work?.work_title || '',
          object: ctx.work?.object_name || '',
          deadline: ctx.work?.start_plan && ctx.work?.end_plan
            ? `${new Date(ctx.work.start_plan).toLocaleDateString('ru-RU')} вЂ“ ${new Date(ctx.work.end_plan).toLocaleDateString('ru-RU')}`
            : ''
        };
        const customer = {
          name: ctx.work?.customer_name || ctx.tender?.customer_name || '',
          inn: ctx.tender?.customer_inn || ctx.tender?.inn || '',
          address: ctx.work?.address || ctx.work?.object_address || ''
        };

        // PM-Р°РІС‚РѕСЂ РґР»СЏ Р±Р»РѕРєР° В«РљРѕРЅС‚Р°РєС‚С‹ РґР»СЏ СѓС‚РѕС‡РЅРµРЅРёР№В» РІ СЃРјРµС‚Рµ + РїРѕРґРїРёСЃСЊ РѕС‚С‡С‘С‚Р°.
        // Р‘РµСЂС‘Рј РїРѕ РїСЂРёРѕСЂРёС‚РµС‚Сѓ: pm_id СЂР°Р±РѕС‚С‹ (С‚РѕС‚, РєС‚Рѕ РІРµРґС‘С‚ РїСЂРѕРµРєС‚) в†’ user РёР· Р·Р°РїСЂРѕСЃР°.
        let pmUser = null;
        try {
          const pmId = ctx.work?.pm_id || (request.user && request.user.id);
          if (pmId) {
            const u = await db.query(
              `SELECT id, name, phone, email, role FROM users WHERE id = $1`,
              [pmId]
            );
            pmUser = u.rows[0] || null;
          }
        } catch (e) {
          console.warn('[Mimir auto-estimate] РЅРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРіСЂСѓР·РёС‚СЊ pmUser:', e.message);
        }

        const docOpts = {
          author: pmUser ? {
            name: pmUser.name || 'вЂ”',
            phone: pmUser.phone || '',
            email: pmUser.email || ''
          } : undefined,
          workCategory: recomputed?.estimate?.site_category
            || ctx?.workType
            || 'ground',
          assumptions: Array.isArray(recomputed?.analysis?.assumptions)
            ? recomputed.analysis.assumptions
            : (Array.isArray(ai?.analysis?.assumptions) ? ai.analysis.assumptions : []),
          warnings: Array.isArray(recomputed?.analysis?.warnings)
            ? recomputed.analysis.warnings
            : (Array.isArray(ai?.analysis?.warnings) ? ai.analysis.warnings : [])
        };

        const [xlsxBuf, docxBuf] = await Promise.all([
          docGen.generateSmetaXlsx(recomputed, project, customer, docOpts),
          docGen.generateDirectorReportDocx(recomputed, project, customer, ai.analysis || {}, docOpts)
        ]);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const entityKind = workId ? 'work' : 'tender';
        const entityId = workId || tenderId;
        await docGen.saveDocumentsForEntity(entityKind, entityId, [
          { filename: `smeta_${stamp}.xlsx`, buffer: xlsxBuf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'mimir_smeta' },
          { filename: `director_report_${stamp}.docx`, buffer: docxBuf, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'mimir_director_report' }
        ]);
        sendEvent({ type: 'docs_generated', count: 2, kinds: ['mimir_smeta', 'mimir_director_report'] });
      } catch (e) {
        console.warn('[Mimir auto-estimate] doc-generator failed:', e.message);
        sendEvent({ type: 'docs_error', message: e.message });
      }

      sendEvent({ type: 'done' });

    } catch (error) {
      // РЎС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅРѕРµ Р»РѕРіРёСЂРѕРІР°РЅРёРµ: РїРѕРЅРёРјР°РµРј С‚РёРї РѕС€РёР±РєРё Рё РґР°С‘Рј РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ
      // С‡РµР»РѕРІРµС‡РµСЃРєРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РІРјРµСЃС‚Рѕ Р°Р±СЃС‚СЂР°РєС‚РЅРѕРіРѕ "AI РЅРµ РІРµСЂРЅСѓР» РѕС‚РІРµС‚".
      const isAIErr = error && error.name === 'AIProviderError';
      const userMsg = isAIErr ? error.userMessage() : (error?.message || 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°');
      const errCode = isAIErr ? error.code : 'internal';

      console.error('[Mimir auto-estimate ERROR]');
      console.error('  code:', errCode);
      console.error('  status:', isAIErr ? error.status : 'n/a');
      console.error('  user_msg:', userMsg);
      console.error('  provider_msg:', isAIErr ? error.providerMessage : 'n/a');
      if (isAIErr && error.requestSummary) {
        console.error('  request_summary:', JSON.stringify(error.requestSummary));
      }
      if (isAIErr && error.body) {
        console.error('  provider_body (first 1000):', String(error.body).substring(0, 1000));
      }
      console.error('  stack:', error.stack);

      await mimirJobs.set(jobKey, {
        status: 'error',
        error: String(userMsg).substring(0, 500),
        error_code: errCode,
        provider_message: isAIErr ? (error.providerMessage || null) : null
      }, { user_id: request.user?.id || null });
      sendEvent({
        type: 'error',
        message: String(userMsg).substring(0, 500),
        code: errCode,
        elapsed_ms: Date.now() - startTime
      });
    }

    reply.raw.end();
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // AP5.1: POST /api/mimir/auto-estimate-answer вЂ” РѕС‚РІРµС‚ РЅР° РІРѕРїСЂРѕСЃС‹ Claude
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Body: { session_id, answers: ["РѕС‚РІРµС‚1","РѕС‚РІРµС‚2",...] }
  // Р—Р°РіСЂСѓР¶Р°РµС‚ РєСЌС€РёСЂРѕРІР°РЅРЅС‹Р№ РєРѕРЅС‚РµРєСЃС‚, РѕС‚РїСЂР°РІР»СЏРµС‚ Claude СЃ РѕС‚РІРµС‚Р°РјРё в†’ РІРѕР·РІСЂР°С‰Р°РµС‚ result
  fastify.post('/auto-estimate-answer', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { session_id, answers } = request.body || {};
    const user = request.user;

    if (!session_id || !answers) {
      return reply.code(400).send({ success: false, message: 'session_id Рё answers РѕР±СЏР·Р°С‚РµР»СЊРЅС‹' });
    }

    const cache = fastify._aeQuestionCache?.get(session_id);
    if (!cache) {
      return reply.code(404).send({ success: false, message: 'РЎРµСЃСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РёСЃС‚РµРєР»Р° (5 РјРёРЅ)' });
    }

    // SSE РѕС‚РІРµС‚
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const sendEvent = (data) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    const startTime = Date.now();

    try {
      const collector = require('../services/mimir-collector');
      const { getSystemPrompt, serializeContext } = require('../services/mimir-prompt');
      const mimirAutoEstimate = require('../services/mimir-auto-estimate');

      sendEvent({ type: 'progress', step: 'ai_thinking', message: 'рџ§® Claude СЃС‡РёС‚Р°РµС‚ СЃ СѓС‡С‘С‚РѕРј РІР°С€РёС… РѕС‚РІРµС‚РѕРІ...' });

      // Р¤РѕСЂРјРёСЂСѓРµРј РѕС‚РІРµС‚С‹ РєР°Рє С‚РµРєСЃС‚
      const answersText = cache.questions.map((q, i) =>
        `Р’РѕРїСЂРѕСЃ: ${q}\nРћС‚РІРµС‚: ${answers[i] || 'Р‘РµР· РѕС‚РІРµС‚Р°'}`
      ).join('\n\n');

      let thinkingSec = 0;
      const heartbeat = setInterval(() => {
        thinkingSec += 5;
        try { sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: `рџ§® РњРёРјРёСЂ СЃС‡РёС‚Р°РµС‚... ${thinkingSec} СЃРµРє` }); } catch {}
      }, 5000);

      let aiResult;
      try {
        // Agent loop С‚РѕР¶Рµ Р·РґРµСЃСЊ вЂ” Claude РјРѕР¶РµС‚ РїРѕРїСЂРѕСЃРёС‚СЊ WebSearch РЅР° СЌС‚Р°РїРµ С„РёРЅР°Р»СЊРЅРѕРіРѕ РїСЂРѕСЃС‡С‘С‚Р°
        aiResult = await aiProvider.runAgentLoop({
          system: cache.systemPrompt,
          messages: [
            { role: 'user', content: `РЎРѕСЃС‚Р°РІСЊ РїСЂРѕСЃС‡С‘С‚ РґР»СЏ СЂР°Р±РѕС‚С‹ #${cache.workId}.\n\n${cache.dataText}` },
            { role: 'assistant', content: JSON.stringify({ phase: 'questions', questions: cache.questions }) },
            { role: 'user', content: `Р’РѕС‚ РѕС‚РІРµС‚С‹ РЅР° С‚РІРѕРё РІРѕРїСЂРѕСЃС‹:\n\n${answersText}\n\nРўРµРїРµСЂСЊ СЃРѕСЃС‚Р°РІСЊ РїРѕР»РЅС‹Р№ РїСЂРѕСЃС‡С‘С‚. Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON.` }
          ],
          maxTokens: 16000,
          temperature: 0.2,
          maxIterations: 6,
          onProgress: (evt) => {
            try {
              if (evt.type === 'tool_calls') {
                const queries = evt.tool_calls.map(t => t.query).filter(Boolean);
                const msg = queries.length > 0
                  ? `рџ”Ќ РС‰Сѓ: ${queries.slice(0,2).join('; ').substring(0, 120)}`
                  : `рџ”§ Р—Р°РїСЂР°С€РёРІР°СЋ РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹ (${evt.tool_calls.length})`;
                sendEvent({ type: 'heartbeat', seconds: thinkingSec, message: msg });
              }
            } catch {}
          }
        });
      } finally {
        clearInterval(heartbeat);
      }

      // РЈРґР°Р»СЏРµРј СЃРµСЃСЃРёСЋ
      fastify._aeQuestionCache.delete(session_id);

      if (!aiResult?.text) {
        throw new aiProvider.AIProviderError({
          code: 'empty_response',
          providerMessage: 'AI РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ content (РЅРµС‚ С‚РµРєСЃС‚Р° Рё РЅРµС‚ tool_calls)',
          requestSummary: {
            model: aiResult?.model,
            finish_reason: aiResult?.stopReason,
            usage: aiResult?.usage
          }
        });
      }

      console.log(`[AP5-answer] Claude: ${aiResult.text.length} chars, ${aiResult.durationMs}ms`);

      const parsed = mimirAutoEstimate.parseAIResponse(aiResult.text);

      sendEvent({ type: 'progress', step: 'creating_estimate', message: 'рџ“ќ РЎРѕР·РґР°СЋ РїСЂРѕСЃС‡С‘С‚...' });

      const ai = parsed;
      ai._meta = { model: aiResult.model, provider: aiResult.provider };
      const ctx = cache.ctx;
      const recomputed = mimirAutoEstimate.validateAndRecomputeMath(ai, ctx.settings,
        { work: ctx.work, tender: ctx.tender, warehouse: ctx.warehouse, workType: ai.estimate?.work_type });
      mimirAutoEstimate.normalizeCalcRows(recomputed.calculation);
      mimirAutoEstimate.resolveEquipmentFromWarehouse(ai, { warehouse: ctx.warehouse, workType: ai.estimate?.work_type });
      const created = await mimirAutoEstimate.createDraftEstimate(db, ctx, ai, recomputed, user);

      const totals = recomputed.totals || {};
      sendEvent({
        type: 'result',
        success: true,
        estimate_id: created.estimate_id,
        card: {
          title: ai.estimate?.title || ctx.work.work_title,
          customer: ctx.work.customer_name,
          crew_count: ai.estimate?.crew_count,
          work_days: ai.estimate?.work_days,
          road_days: ai.estimate?.road_days,
          markup_multiplier: totals.markup_multiplier,
          total_cost: totals.total_cost,
          total_with_margin: totals.total_with_margin,
          total_with_vat: totals.total_with_vat,
          margin_pct: totals.margin_pct
        },
        analysis: ai.analysis || {},
        equipment_status: ai.equipment_status || null,
        permits_status: ai.permits_status || null,
        route_plan: ai.route_plan || null,
        recommended_crew: ai.recommended_crew || null,
        comment: ai.estimate?.comment || null,
        ai_meta: { model: aiResult.model, tokens: aiResult.usage, duration_ms: aiResult.durationMs },
        elapsed_ms: Date.now() - startTime
      });

      // РћР±РЅРѕРІРёС‚СЊ СЃРµСЂРІРµСЂРЅС‹Р№ РєСЌС€ РґР¶РѕР±РѕРІ (Р‘Р” вЂ” done РЅР°РІСЃРµРіРґР°)
      const ansJobKey = cache.workId ? 'w' + cache.workId : 't' + cache.tenderId;
      await mimirJobs.set(ansJobKey, {
        status: 'done',
        result: { estimate_id: created.estimate_id, card: {
          title: ai.estimate?.title || ctx.work.work_title,
          total_with_margin: totals.total_with_margin
        }}
      }, { user_id: request.user?.id || null });

      sendEvent({ type: 'done' });
    } catch (err) {
      const isAIErr = err && err.name === 'AIProviderError';
      const userMsg = isAIErr ? err.userMessage() : (err?.message || 'РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°');
      const errCode = isAIErr ? err.code : 'internal';

      console.error('[auto-estimate-answer ERROR]');
      console.error('  code:', errCode);
      console.error('  status:', isAIErr ? err.status : 'n/a');
      console.error('  user_msg:', userMsg);
      console.error('  provider_msg:', isAIErr ? err.providerMessage : 'n/a');
      if (isAIErr && err.requestSummary) {
        console.error('  request_summary:', JSON.stringify(err.requestSummary));
      }
      if (isAIErr && err.body) {
        console.error('  provider_body (first 1000):', String(err.body).substring(0, 1000));
      }
      console.error('  stack:', err.stack);

      sendEvent({
        type: 'error',
        message: String(userMsg).substring(0, 500),
        code: errCode,
        elapsed_ms: Date.now() - startTime
      });
    }
    reply.raw.end();
  });

  // AP2: POST /api/mimir/auto-estimate-chat вЂ” РґРёР°Р»РѕРі СЃ РїРµСЂРµСЃС‡С‘С‚РѕРј
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // Body: { work_id, estimate_id, message, history? }
  // Р’РѕР·РІСЂР°С‰Р°РµС‚ JSON: { success, response (С‚РµРєСЃС‚ РѕС‚РІРµС‚Р° РњРёРјРёСЂР°),
  //                    updated_card?, updated_analysis?, recomputed? }
  //
  // Р›РѕРіРёРєР°:
  //   1. Р—Р°РіСЂСѓР¶Р°РµРј РєРѕРЅС‚РµРєСЃС‚ СЂР°Р±РѕС‚С‹ (С‚РѕС‚ Р¶Рµ С‡С‚Рѕ РёСЃРїРѕР»СЊР·РѕРІР°Р»СЃСЏ РґР»СЏ СЃРѕР·РґР°РЅРёСЏ)
  //   2. Р’С‹Р·С‹РІР°РµРј Claude СЃ СЃРѕРѕР±С‰РµРЅРёРµРј Р Рџ в†’ AI РІРѕР·РІСЂР°С‰Р°РµС‚ РѕР±РЅРѕРІР»С‘РЅРЅС‹Р№ JSON СЂР°СЃС‡С‘С‚Р°
  //   3. РџРµСЂРµСЃС‡РёС‚С‹РІР°РµРј РјР°С‚РµРјР°С‚РёРєСѓ РЅР° СЃРµСЂРІРµСЂРµ
  //   4. UPDATE estimate_calculation_data
  //   5. Р’РѕР·РІСЂР°С‰Р°РµРј РЅРѕРІС‹Рµ С†РёС„СЂС‹ + С‚РµРєСЃС‚РѕРІС‹Р№ РѕС‚РІРµС‚
  fastify.post('/auto-estimate-chat', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id, tender_id, estimate_id, message, history, model: requestedModel } = request.body || {};
    const user = request.user;

    if (!estimate_id || !message?.trim()) {
      return reply.code(400).send({ success: false, message: 'estimate_id Рё message РѕР±СЏР·Р°С‚РµР»СЊРЅС‹' });
    }

    // Р РµР·РѕР»РІ РјРѕРґРµР»Рё РёР· СЂРµРµСЃС‚СЂР° /api/mimir/chat/models. light-СЂРµР¶РёРј С‚СѓС‚ РїРµСЂРµСЃС‡С‘С‚
    // РЅРµ РґРµР»Р°РµС‚ РєРѕСЂСЂРµРєС‚РЅРѕ (РєРѕСЂРѕС‚РєРёР№ prompt Р±РµР· РєРѕРЅС‚РµРєСЃС‚Р° РїСЂРѕСЃС‡С‘С‚Р°), РїРѕСЌС‚РѕРјСѓ
    // РµСЃР»Рё РІС‹Р±СЂР°РЅР° light вЂ” РјСЏРіРєРѕ РїСЂРµРґСѓРїСЂРµР¶РґР°РµРј Рё РІСЃС‘ СЂР°РІРЅРѕ РіРѕРЅРёРј С‡РµСЂРµР· РІС‹Р±СЂР°РЅРЅСѓСЋ
    // РјРѕРґРµР»СЊ, РЅРѕ Р±РµР· UPDATE РІ Р‘Р”.
    const chatModels = require('../services/chat-models');
    const modelCfg = chatModels.getModel(requestedModel) || chatModels.getDefault();

    // work_id РјРѕР¶РµС‚ РїСЂРёР№С‚Рё РЅР°РїСЂСЏРјСѓСЋ РёР»Рё С‡РµСЂРµР· estimate
    let workId = work_id ? parseInt(work_id) : null;
    const estimateId = parseInt(estimate_id);

    // Р•СЃР»Рё work_id РЅРµ РїРµСЂРµРґР°РЅ вЂ” РґРѕСЃС‚Р°С‘Рј РёР· estimate
    if (!workId) {
      const estRow = await db.query('SELECT work_id FROM estimates WHERE id = $1', [estimateId]);
      workId = estRow.rows[0]?.work_id || null;
    }
    if (!workId) {
      return reply.code(400).send({ success: false, message: 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ work_id РґР»СЏ РїСЂРѕСЃС‡С‘С‚Р°' });
    }

    try {
      const mimirAutoEstimate = require('../services/mimir-auto-estimate');
      const collector = require('../services/mimir-collector');
      const { getSystemPrompt, serializeContext } = require('../services/mimir-prompt');

      // 1. РџРѕР»РЅС‹Р№ РєРѕРЅС‚РµРєСЃС‚ (15 С‚РёРїРѕРІ РґР°РЅРЅС‹С…, realtime)
      const ctx = await collector.collectAll(db, workId, null);
      const dataText = serializeContext(ctx);

      // РџСЂРѕРІРµСЂСЏРµРј РєРѕРјРјРµРЅС‚Р°СЂРёР№ РґРёСЂРµРєС‚РѕСЂР° (РґР»СЏ РґРѕСЂР°Р±РѕС‚РєРё)
      let directorContext = '';
      try {
        const estInfo = await db.query('SELECT approval_status, last_director_comment, director_id FROM estimates WHERE id = $1', [estimateId]);
        const est = estInfo.rows[0];
        if (est && ['rework', 'question'].includes(est.approval_status) && est.last_director_comment) {
          const dirName = est.director_id
            ? (await db.query('SELECT name FROM users WHERE id = $1', [est.director_id])).rows[0]?.name || 'Р”РёСЂРµРєС‚РѕСЂ'
            : 'Р”РёСЂРµРєС‚РѕСЂ';
          directorContext = `\n\nР—РђРњР•Р§РђРќРР• Р”РР Р•РљРўРћР Рђ (${dirName}):\n"${est.last_director_comment}"\nРЎС‚Р°С‚СѓСЃ РїСЂРѕСЃС‡С‘С‚Р°: ${est.approval_status === 'question' ? 'Р’РѕРїСЂРѕСЃ РѕС‚ РґРёСЂРµРєС‚РѕСЂР°' : 'РћС‚РїСЂР°РІР»РµРЅРѕ РЅР° РґРѕСЂР°Р±РѕС‚РєСѓ'}.\nРЈС‡С‚Рё Р·Р°РјРµС‡Р°РЅРёРµ РґРёСЂРµРєС‚РѕСЂР° РїСЂРё РїРµСЂРµСЃС‡С‘С‚Рµ.\n`;
        }
      } catch (e) { /* ok */ }

      // 2. AI РІС‹Р·РѕРІ С‡РµСЂРµР· Claude СЃ РїРѕР»РЅС‹Рј РєРѕРЅС‚РµРєСЃС‚РѕРј + СЃРѕРѕР±С‰РµРЅРёРµ Р Рџ
      const userTurn = `Р”Р°РЅРЅС‹Рµ РїСЂРѕСЃС‡С‘С‚Р°:\n${dataText}${directorContext}\n\n---\nР РЈРљРћР’РћР”РРўР•Р›Р¬ РџР РћР•РљРўРђ (${user.name || user.login}) РџРРЁР•Рў:
"${message.trim()}"

${history && history.length > 0 ? `\nРљРћРќРўР•РљРЎРў Р”РРђР›РћР“Рђ:\n${history.slice(-6).map(h => `${h.role === 'user' ? 'Р Рџ' : 'РњРёРјРёСЂ'}: ${h.text}`).join('\n')}` : ''}

Р—РђР”РђР§Рђ: РЈС‡С‚Рё РїСЂРѕСЃСЊР±Сѓ Р Рџ Рё РІРµСЂРЅРё РћР‘РќРћР’Р›РЃРќРќР«Р™ JSON СЃ РїРµСЂРµСЃС‡РёС‚Р°РЅРЅС‹Рј РїСЂРѕСЃС‡С‘С‚РѕРј.
РџРёС€Рё РІ estimate.comment РѕР±СЉСЏСЃРЅРµРЅРёРµ С‡С‚Рѕ РёР·РјРµРЅРёР»РѕСЃСЊ (1-2 РїСЂРµРґР»РѕР¶РµРЅРёСЏ).
Р’ analysis.markup_reasoning вЂ” РѕР±РЅРѕРІР»С‘РЅРЅРѕРµ РѕР±РѕСЃРЅРѕРІР°РЅРёРµ.
Р’Р•Р РќР РўРћР›Р¬РљРћ JSON, Р±РµР· РїРѕСЏСЃРЅРµРЅРёР№.`;

      // light-РјРѕРґРµР»СЊ РЅРµ СѓРјРµРµС‚ РІ РїРµСЂРµСЃС‡С‘С‚ СЃРјРµС‚С‹ (РЅРµС‚ РЅРё prompt'Р°, РЅРё JSON-РІС‹С…РѕРґР°).
      // Р’РѕР·РІСЂР°С‰Р°РµРј Р±РµР·РѕРїР°СЃРЅС‹Р№ С‚РµРєСЃС‚ Р±РµР· UPDATE вЂ” РїСѓСЃС‚СЊ СЋР·РµСЂ РїРµСЂРµРєР»СЋС‡РёС‚ РЅР° full.
      if (modelCfg.system_mode === 'light') {
        return reply.send({
          success: true,
          response: 'РЇ СЃРµР№С‡Р°СЃ РІ Р±С‹СЃС‚СЂРѕРј СЂРµР¶РёРјРµ (' + modelCfg.label + ') вЂ” РЅРµ РјРѕРіСѓ РїРµСЂРµСЃС‡РёС‚Р°С‚СЊ СЃРјРµС‚Сѓ. ' +
            'РџРµСЂРµРєР»СЋС‡Рё РјРѕРґРµР»СЊ РІ С€Р°РїРєРµ С‡Р°С‚Р° РЅР° В«рџ§  РЎ РґР°РЅРЅС‹РјРё CRMВ», Рё СЏ СѓС‡С‚Сѓ С‚РІРѕС‘ Р·Р°РјРµС‡Р°РЅРёРµ.',
          ai_meta: { model: modelCfg.id, provider: 'routerai', light_mode: true }
        });
      }

      const aiResult = await aiProvider.complete({
        system: getSystemPrompt(),
        messages: [{ role: 'user', content: userTurn }],
        maxTokens: 16000,
        temperature: 0.2,
        model: modelCfg.id
      });

      if (!aiResult?.text) throw new Error('AI РЅРµ РѕС‚РІРµС‚РёР»');
      const ai = mimirAutoEstimate.parseAIResponse(aiResult.text);
      ai._meta = { model: aiResult.model, provider: aiResult.provider };
      const recomputed = mimirAutoEstimate.validateAndRecomputeMath(ai, ctx.settings,
        { work: ctx.work, tender: ctx.tender, warehouse: ctx.warehouse, workType: ai.estimate?.work_type });
      mimirAutoEstimate.normalizeCalcRows(recomputed.calculation);
      mimirAutoEstimate.resolveEquipmentFromWarehouse(ai, { warehouse: ctx.warehouse, workType: ai.estimate?.work_type });

      // 3. UPDATE РІ Р‘Р”
      await mimirAutoEstimate.updateDraftEstimate(db, estimateId, ai, recomputed, user, {
        user_message: message.trim(),
        mimir_response: ai.estimate?.comment || ai.analysis?.markup_reasoning || ''
      });

      const totals = recomputed.totals;

      return reply.send({
        success: true,
        response: ai.estimate?.comment || ai.analysis?.markup_reasoning || 'Р“РѕС‚РѕРІРѕ, РїРµСЂРµСЃС‡РёС‚Р°Р».',
        updated_card: {
          crew_count: ai.estimate?.crew_count,
          work_days: ai.estimate?.work_days,
          markup_multiplier: totals.markup_multiplier,
          total_cost: totals.total_cost,
          total_with_margin: totals.total_with_margin,
          total_with_vat: totals.total_with_vat,
          margin_pct: totals.margin_pct,
          fot_subtotal: totals.personnel_with_tax,
          travel_subtotal: totals.travel_subtotal,
          transport_subtotal: totals.transport_subtotal,
          chemistry_subtotal: totals.chemistry_subtotal,
          current_subtotal: totals.current_subtotal
        },
        updated_analysis: {
          markup_reasoning: ai.analysis?.markup_reasoning || null,
          warnings: ai.analysis?.warnings || [],
          warehouse_status: ai.analysis?.warehouse_status || null,
          workers_status: ai.analysis?.workers_status || null,
          purchases_needed: ai.analysis?.purchases_needed || []
        },
        ai_meta: {
          model: aiBundle.model,
          provider: aiBundle.provider,
          tokens: aiBundle.tokens,
          duration_ms: aiBundle.duration_ms
        }
      });
    } catch (err) {
      fastify.log.error({ err }, '[Mimir auto-estimate-chat]');
      return reply.code(500).send({ success: false, message: err.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // AP1: POST /api/mimir/auto-estimate-context вЂ” JSON РІРµСЂСЃРёСЏ (Р±РµР· SSE)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РўРѕС‚ Р¶Рµ СЃР±РѕСЂ РєРѕРЅС‚РµРєСЃС‚Р° РЅРѕ Р±РµР· СЃС‚СЂРёРјРёРЅРіР° вЂ” РґР»СЏ Р±С‹СЃС‚СЂРѕР№ РѕС‚Р»Р°РґРєРё Рё С‚РµСЃС‚РѕРІ.
  // Р’РѕР·РІСЂР°С‰Р°РµС‚ С‚РѕР»СЊРєРѕ summary + РєР»СЋС‡РµРІС‹Рµ РјРµС‚СЂРёРєРё (Р±РµР· СЃС‹СЂС‹С… РґР°РЅРЅС‹С…).
  fastify.post('/auto-estimate-context', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { work_id } = request.body || {};
    if (!work_id || isNaN(parseInt(work_id))) {
      return reply.code(400).send({ success: false, message: 'work_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });
    }
    try {
      const mimirAutoEstimate = require('../services/mimir-auto-estimate');
      const context = await mimirAutoEstimate.buildAutoEstimateContext(
        db, parseInt(work_id), request.user, null
      );
      return reply.send({
        success: true,
        summary: context.summary,
        documents_preview: context.documents.map(d => ({
          name: d.original_name,
          size_kb: d.size_kb,
          content_chars: d.content_chars,
          content_head: (d.content || '').substring(0, 200)
        })),
        analogs_preview: context.analogs.map(a => ({
          id: a.id, title: a.title,
          total_cost: a.total_cost, total_with_margin: a.total_with_margin,
          markup_multiplier: a.markup_multiplier,
          approval_status: a.approval_status
        })),
        customer_history_preview: context.customer_history.map(t => ({
          id: t.id, title: t.tender_title,
          status: t.status || t.tender_status,
          markup: t.markup_multiplier
        })),
        warehouse_categories: [...new Set(context.warehouse.map(w => w.category_name))],
        warehouse_count: context.warehouse.length,
        workers_available: (context.workers.itr_available?.length || 0) + (context.workers.field_available?.length || 0),
        itr_available: context.workers.itr_available?.length || 0,
        field_available: context.workers.field_available?.length || 0,
        permits_total: context.permits?.total_active || 0,
        tariff_categories: Object.keys(context.tariffs.grouped || {}),
        settings: context.settings
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[Mimir auto-estimate-context]');
      return reply.code(500).send({ success: false, message: error.message });
    }
  });

  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // AP3: GET /api/mimir/auto-estimate/check?work_id=N
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // РџСЂРѕРІРµСЂСЏРµС‚ СЃСѓС‰РµСЃС‚РІСѓРµС‚ Р»Рё СѓР¶Рµ draft estimate РґР»СЏ work. РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ
  // С„СЂРѕРЅС‚РѕРј РїРµСЂРµРґ Р·Р°РїСѓСЃРєРѕРј SSE pipeline С‡С‚РѕР±С‹ РїСЂРµРґР»РѕР¶РёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РІС‹Р±РѕСЂ:
  // "РЈ РІР°СЃ СѓР¶Рµ РµСЃС‚СЊ РїСЂРѕСЃС‡С‘С‚ #N вЂ” РѕС‚РєСЂС‹С‚СЊ РёР»Рё РїРµСЂРµСЃС‡РёС‚Р°С‚СЊ РЅРѕРІС‹Р№?"
  fastify.get('/auto-estimate/check', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const workId = parseInt(request.query.work_id);
    if (!workId) return reply.code(400).send({ success: false, message: 'work_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });
    try {
      const mimirAutoEstimate = require('../services/mimir-auto-estimate');
      const existing = await mimirAutoEstimate.loadExistingDraftForWork(db, workId);
      if (!existing) return reply.send({ exists: false });

      // РџР°СЂСЃРёРј mimir_suggestions РґР»СЏ UI
      let suggestions = null;
      if (existing.calc?.mimir_suggestions) {
        try {
          suggestions = typeof existing.calc.mimir_suggestions === 'string'
            ? JSON.parse(existing.calc.mimir_suggestions)
            : existing.calc.mimir_suggestions;
        } catch (e) { /* ok */ }
      }

      return reply.send({
        exists: true,
        estimate: {
          id: existing.estimate.id,
          title: existing.estimate.title,
          crew_count: existing.estimate.crew_count,
          work_days: existing.estimate.work_days,
          markup_multiplier: existing.estimate.markup_multiplier,
          cost_plan: existing.estimate.cost_plan,
          price_tkp: existing.estimate.price_tkp,
          margin_pct: existing.estimate.margin_pct,
          created_at: existing.estimate.created_at,
          updated_at: existing.estimate.updated_at
        },
        calc: existing.calc ? {
          total_cost: existing.calc.total_cost,
          total_with_margin: existing.calc.total_with_margin,
          margin_pct: existing.calc.margin_pct
        } : null,
        chat_history: existing.chat_history || [],
        suggestions
      });
    } catch (err) {
      fastify.log.error({ err }, '[Mimir auto-estimate/check]');
      return reply.code(500).send({ success: false, message: err.message });
    }
  });
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
  // EXPENSE WALLET: РњРёРјРёСЂ СЂР°СЃРїРѕР·РЅР°С‘С‚ СЂР°СЃС…РѕРґС‹ (QR/С„РѕС‚Рѕ/С„Р°Р№Р»/С‚РµРєСЃС‚)
  // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

  /**
   * POST /api/mimir/expense-recognize
   * Body: { work_id, type: "qr"|"image"|"text", data: "..." }
   *   - qr: data = СЃРѕРґРµСЂР¶РёРјРѕРµ QR-РєРѕРґР°
   *   - image: data = base64, mime_type = "image/jpeg"
   *   - text: data = "Р·Р°РїР»Р°С‚РёР» Р·Р° С‚Р°РєСЃРё 3500"
   *
   * РћС‚РІРµС‚: { success, preview: { amount, date, category, supplier, ... }, financials }
   */
  const EXPENSE_ROLES = ['PM', 'HEAD_PM'];

  fastify.post('/expense-recognize', {
    preHandler: [fastify.requireRoles(EXPENSE_ROLES)]
  }, async (request, reply) => {
    const { work_id, type, data, mime_type } = request.body || {};

    if (!work_id) return reply.code(400).send({ error: 'work_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });
    if (!type || !data) return reply.code(400).send({ error: 'type Рё data РѕР±СЏР·Р°С‚РµР»СЊРЅС‹' });

    const expRecognize = require('../services/expense-recognize');
    const startTime = Date.now();

    try {
      // Р”Р°РЅРЅС‹Рµ СЂР°Р±РѕС‚С‹
      const wRes = await db.query('SELECT * FROM works WHERE id = $1', [work_id]);
      const work = wRes.rows[0];
      if (!work) return reply.code(404).send({ error: 'Р Р°Р±РѕС‚Р° РЅРµ РЅР°Р№РґРµРЅР°' });

      let recognized;

      if (type === 'qr') {
        // QR С„РёСЃРєР°Р»СЊРЅРѕРіРѕ С‡РµРєР° в†’ Р¤РќРЎ API
        const fiscal = expRecognize.parseFiscalQR(data);
        if (!fiscal) {
          return reply.send({
            success: false,
            error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°СЃРїРѕР·РЅР°С‚СЊ QR-РєРѕРґ С„РёСЃРєР°Р»СЊРЅРѕРіРѕ С‡РµРєР°. Р¤РѕСЂРјР°С‚: t=...&s=...&fn=...&i=...&fp=...'
          });
        }
        recognized = await expRecognize.fetchFromFNS(fiscal);
        // РђРІС‚РѕРѕРїСЂРµРґРµР»РµРЅРёРµ РєР°С‚РµРіРѕСЂРёРё РїРѕ РїРѕР·РёС†РёСЏРј
        if (recognized.items && recognized.items.length > 0 && !recognized.category) {
          recognized.category = guessCategory(recognized);
        }
        if (!recognized.description && recognized.items && recognized.items.length > 0) {
          recognized.description = recognized.items.slice(0, 3).map(i => i.name).join(', ');
          if (recognized.items.length > 3) recognized.description += ` Рё РµС‰С‘ ${recognized.items.length - 3}`;
        }
      } else if (type === 'image') {
        // Р¤РѕС‚Рѕ в†’ Claude Vision
        recognized = await expRecognize.recognizeImage(aiProvider, data, mime_type || 'image/jpeg');
      } else if (type === 'text') {
        // РўРµРєСЃС‚ в†’ Claude
        recognized = await expRecognize.recognizeText(aiProvider, data);
      } else {
        return reply.code(400).send({ error: 'РќРµРёР·РІРµСЃС‚РЅС‹Р№ type. Р”РѕРїСѓСЃС‚РёРјРѕ: qr, image, text' });
      }

      if (recognized.error) {
        return reply.send({ success: false, error: recognized.error });
      }

      // РЎС‚СЂРѕРёРј РєР°СЂС‚РѕС‡РєСѓ-РїСЂРµРІСЊСЋ
      const preview = expRecognize.buildPreviewCard(recognized, work);
      // РўРµРєСѓС‰Р°СЏ С„РёРЅР°РЅСЃРѕРІР°СЏ СЃРІРѕРґРєР°
      const financials = await expRecognize.getWorkFinancials(db, work_id);

      return reply.send({
        success: true,
        preview,
        financials,
        elapsed_ms: Date.now() - startTime
      });
    } catch (err) {
      console.error('[expense-recognize ERROR]:', err.message, err.stack);
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/mimir/expense-confirm
   * Body: { work_id, amount, date, category, supplier, description, document_id?,
   *         doc_number?, vat_rate?, vat_amount?, amount_ex_vat?, inn?, items?[] }
   *
   * Р’РЅРѕСЃРёС‚ СЂР°СЃС…РѕРґ + РїРѕР·РёС†РёРё items в†’ С‚СЂРёРіРіРµСЂ РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚ cost_fact в†’ РІРѕР·РІСЂР°С‰Р°РµС‚ РЅРѕРІСѓСЋ СЃРІРѕРґРєСѓ.
   */
  fastify.post('/expense-confirm', {
    preHandler: [fastify.requireRoles(EXPENSE_ROLES)]
  }, async (request, reply) => {
    const {
      work_id, amount, date, category, subcategory, supplier, description, notes, document_id,
      doc_number, vat_rate, vat_amount, amount_ex_vat, inn, items, receipt_url,
      payment_method
    } = request.body || {};
    const user = request.user;

    if (!work_id || !amount) {
      return reply.code(400).send({ error: 'work_id Рё amount РѕР±СЏР·Р°С‚РµР»СЊРЅС‹' });
    }

    const expRecognize = require('../services/expense-recognize');

    try {
      // РЎРІРѕРґРєР° Р”Рћ
      const before = await expRecognize.getWorkFinancials(db, work_id);
      if (!before) return reply.code(404).send({ error: 'Р Р°Р±РѕС‚Р° РЅРµ РЅР°Р№РґРµРЅР°' });

      // INSERT С‡РµСЂРµР· РµРґРёРЅСѓСЋ С‚РѕС‡РєСѓ Р·Р°РїРёСЃРё (СЃРј. src/services/work-expense-writer.js).
      // РњРёРјРёСЂ-РљРѕС€РµР»С‘Рє вЂ” СЌС‚Рѕ СЂР°СЃРїРѕР·РЅР°РІР°РЅРёРµ С‡РµРєРѕРІ (QR/С„РѕС‚Рѕ/С‚РµРєСЃС‚), РІСЃРµ РµРіРѕ СЂР°СЃС…РѕРґС‹
      // РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ payment_method='cash' (РїРѕР»СѓС‡Р°СЋС‚ 55% РЅР°Р»РѕРі). Р•СЃР»Рё Р±РµР·РЅР°Р»/СЃР°РјРѕР·Р°РЅСЏС‚С‹Р№ вЂ”
      // РєР»РёРµРЅС‚ РґРѕР»Р¶РµРЅ СЏРІРЅРѕ РїСЂРёСЃР»Р°С‚СЊ payment_method РІ body.
      const { insertWorkExpense } = require('../services/work-expense-writer');
      const expense = await insertWorkExpense(db, {
        work_id,
        category: category || 'other',
        subcategory: subcategory || null,
        description,
        amount,
        date,
        supplier,
        notes,
        doc_number,
        vat_rate,
        vat_amount,
        amount_ex_vat,
        receipt_url,
        payment_method: payment_method || 'cash',
        source_table: 'mimir_expense',
        status: 'confirmed',
        created_by: user.id,
      });

      // РЎРѕС…СЂР°РЅРёС‚СЊ РїРѕР·РёС†РёРё (items) РІ work_expense_items
      if (Array.isArray(items) && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await db.query(
            `INSERT INTO work_expense_items (expense_id, position, name, unit, quantity, price, amount, vat_rate, vat_amount, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              expense.id, i + 1,
              String(it.name || it.description || '').substring(0, 500),
              it.unit || 'С€С‚',
              it.quantity || 1,
              it.price != null ? Number(it.price) : null,
              it.sum != null ? Number(it.sum) : (it.amount != null ? Number(it.amount) : null),
              it.vat_rate != null ? Number(it.vat_rate) : null,
              it.vat_amount != null ? Number(it.vat_amount) : null,
              it.note || null
            ]
          );
        }
      }

      // РџСЂРёРІСЏР·РєР° РґРѕРєСѓРјРµРЅС‚Р° (РµСЃР»Рё Р·Р°РіСЂСѓР¶РµРЅ)
      if (document_id) {
        await db.query(
          'UPDATE documents SET work_id = $1 WHERE id = $2',
          [work_id, document_id]
        ).catch(() => {});
        // РџСЂРёРІСЏР·Р°С‚СЊ preview Рє СЂР°СЃС…РѕРґСѓ
        const { rows: [doc] } = await db.query('SELECT filename FROM documents WHERE id = $1', [document_id]).catch(() => ({ rows: [] }));
        if (doc && !receipt_url) {
          await db.query('UPDATE work_expenses SET receipt_url = $1 WHERE id = $2',
            [`/api/files/preview/${doc.filename}`, expense.id]).catch(() => {});
        }
      }

      // РЎРІРѕРґРєР° РџРћРЎР›Р• (С‚СЂРёРіРіРµСЂ СѓР¶Рµ РѕР±РЅРѕРІРёР» cost_fact)
      const after = await expRecognize.getWorkFinancials(db, work_id);

      return reply.send({
        success: true,
        expense,
        items_count: Array.isArray(items) ? items.length : 0,
        before,
        after,
        delta: {
          cost_fact: after.cost_fact - before.cost_fact,
          profit: after.profit - before.profit,
          margin_pct: Math.round((after.margin_pct - before.margin_pct) * 10) / 10
        }
      });
    } catch (err) {
      console.error('[expense-confirm ERROR]:', err.message, err.stack);
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/mimir/expense-works вЂ” СЃРїРёСЃРѕРє СЂР°Р±РѕС‚ Р Рџ РґР»СЏ РІС‹Р±РѕСЂР° РІ РљРѕС€РµР»СЊРєРµ
   * Р’РѕР·РІСЂР°С‰Р°РµС‚ СЂР°Р±РѕС‚С‹ СЃ С„РёРЅР°РЅСЃРѕРІРѕР№ СЃРІРѕРґРєРѕР№.
   */
  fastify.get('/expense-works', {
    preHandler: [fastify.requireRoles(EXPENSE_ROLES)]
  }, async (request, reply) => {
    const user = request.user;
    const isAdmin = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'].includes(user.role);

    let sql = `SELECT id, work_title, work_number, contract_value, cost_fact, cost_plan, work_status, customer_name, city
               FROM works WHERE deleted_at IS NULL`;
    const params = [];

    if (!isAdmin) {
      sql += ' AND pm_id = $1';
      params.push(user.id);
    }
    sql += ` ORDER BY
      CASE WHEN btrim(lower(work_status)) IN ('РІ СЂР°Р±РѕС‚Рµ', 'РјРѕР±РёР»РёР·Р°С†РёСЏ') THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST
      LIMIT 50`;

    const result = await db.query(sql, params);

    const works = result.rows.map(w => {
      const costFact = Number(w.cost_fact) || 0;
      const contractValue = Number(w.contract_value) || 0;
      const profit = contractValue - costFact;
      return {
        ...w,
        cost_fact: costFact,
        contract_value: contractValue,
        profit: Math.round(profit),
        margin_pct: contractValue > 0 ? Math.round(((profit / contractValue) * 100) * 10) / 10 : 0
      };
    });

    return { works };
  });

  /**
   * GET /api/mimir/expense-history?work_id=N вЂ” РїРѕСЃР»РµРґРЅРёРµ СЂР°СЃС…РѕРґС‹ СЂР°Р±РѕС‚С‹
   */
  fastify.get('/expense-history', {
    preHandler: [fastify.requireRoles(EXPENSE_ROLES)]
  }, async (request, reply) => {
    const { work_id, limit = 20 } = request.query;
    if (!work_id) return reply.code(400).send({ error: 'work_id РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const result = await db.query(
      `SELECT e.*, u.name as created_by_name
       FROM work_expenses e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.work_id = $1
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [work_id, limit]
    );

    const expRecognize = require('../services/expense-recognize');
    const financials = await expRecognize.getWorkFinancials(db, work_id);

    return { expenses: result.rows, financials };
  });
}

/**
 * РђРІС‚РѕРѕРїСЂРµРґРµР»РµРЅРёРµ РєР°С‚РµРіРѕСЂРёРё РїРѕ РїРѕР·РёС†РёСЏРј С‡РµРєР°.
 */
function guessCategory(recognized) {
  const text = (recognized.items || []).map(i => (i.name || '').toLowerCase()).join(' ')
    + ' ' + ((recognized.seller || '') + ' ' + (recognized.address || '')).toLowerCase();

  if (/С‚Р°РєСЃРё|uber|СЏРЅРґРµРєСЃ.С‚Р°РєСЃРё|СЃРёС‚РёРјРѕР±РёР»/i.test(text)) return 'tickets';
  if (/РѕС‚РµР»|РіРѕСЃС‚РёРЅРёС†|booking|hostel|РєРІР°СЂС‚РёСЂ|Р°СЂРµРЅРґР° Р¶РёР»/i.test(text)) return 'accommodation';
  if (/РєР°С„Рµ|СЂРµСЃС‚РѕСЂР°РЅ|СЃС‚РѕР»РѕРІ|Р±СѓС„РµС‚|РѕР±РµРґ|СѓР¶РёРЅ|Р·Р°РІС‚СЂР°Рє|РїСЂРѕРґСѓРєС‚|РјР°РіРЅРёС‚|РїСЏС‚С‘СЂРѕС‡Рє|РїРµСЂРµРєСЂС‘СЃС‚Рѕ/i.test(text)) return 'per_diem';
  if (/Р±РёР»РµС‚|СЂР¶Рґ|Р°СЌСЂРѕС„Р»РѕС‚|s7|РїРѕР±РµРґР°|Р°РІРёР°|Р¶Рґ|РїРѕРµР·Рґ|СЌР»РµРєС‚СЂРёС‡Рє/i.test(text)) return 'tickets';
  if (/Р»РµСЂСѓР°|СЃС‚СЂРѕР№|РєСЂРµРїС‘Р¶|РіРµСЂРјРµС‚Рё|РёРЅСЃС‚СЂСѓРјРµРЅС‚|Р±РѕР»С‚|РіР°Р№Рє|С‚СЂСѓР±|РєР°Р±РµР»|РїСЂРѕРІРѕРґ/i.test(text)) return 'materials';
  if (/Р±РµРЅР·РёРЅ|Р°Р·СЃ|С‚РѕРїР»РёРІ|Р»СѓРєРѕР№Р»|РіР°Р·РїСЂРѕРј|СЂРѕСЃРЅРµС„С‚|shell/i.test(text)) return 'other';

  return 'other';
}

module.exports = mimirRoutes;
