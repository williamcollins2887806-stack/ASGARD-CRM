/**
 * ASGARD CRM - Mimir AI Assistant Routes v3.0
 *
 * Полный функционал:
 * - Чат с AI (Claude / OpenAI)
 * - Стриминг ответов (SSE)
 * - История диалогов
 * - Загрузка и анализ файлов (PDF, DOCX, XLSX, изображения)
 * - Генерация ТКП
 * - Умные рекомендации
 * - Ограничения по ролям
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

// Сервисы
const aiProvider = require('../services/ai-provider');
const mimirData = require('../services/mimir-data');

async function mimirRoutes(fastify, options) {
  const db = fastify.db;

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 1: УПРАВЛЕНИЕ ДИАЛОГАМИ (CRUD)
  // ═══════════════════════════════════════════════════════════════════════════

  // Получить список диалогов пользователя
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
      return reply.code(500).send({ success: false, message: 'Ошибка получения диалогов' });
    }
  });

  // Создать новый диалог
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
      `, [user.id, title || 'Новый диалог']);

      return { success: true, conversation: result.rows[0] };
    } catch (e) {
      fastify.log.error('Create conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'Ошибка создания диалога' });
    }
  });

  // Получить диалог с историей сообщений
  fastify.get('/conversations/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const convId = parseInt(request.params.id);

    try {
      // Проверяем принадлежность диалога
      const conv = await db.query(
        'SELECT * FROM mimir_conversations WHERE id = $1 AND user_id = $2',
        [convId, user.id]
      );

      if (conv.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'Диалог не найден' });
      }

      // Получаем сообщения
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
      return reply.code(500).send({ success: false, message: 'Ошибка получения диалога' });
    }
  });

  // Обновить диалог (title, is_pinned)
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
        return { success: true, message: 'Нет изменений' };
      }

      params.push(convId, user.id);
      const result = await db.query(`
        UPDATE mimir_conversations
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
        RETURNING *
      `, params);

      if (result.rows.length === 0) {
        return reply.code(404).send({ success: false, message: 'Диалог не найден' });
      }

      return { success: true, conversation: result.rows[0] };
    } catch (e) {
      fastify.log.error('Update conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'Ошибка обновления диалога' });
    }
  });

  // Удалить диалог (мягкое удаление — архивация)
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
        return reply.code(404).send({ success: false, message: 'Диалог не найден' });
      }

      return { success: true, message: 'Диалог архивирован' };
    } catch (e) {
      fastify.log.error('Delete conversation error:', e.message);
      return reply.code(500).send({ success: false, message: 'Ошибка удаления диалога' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 2: ОСНОВНОЙ ЧАТ
  // ═══════════════════════════════════════════════════════════════════════════

  // Главный чат (обратно совместимый)
  fastify.post('/chat', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context, conversation_id } = request.body;
    const user = request.user;

    if (!message?.trim()) {
      return reply.code(400).send({ success: false, message: 'Пустое сообщение' });
    }

    const startTime = Date.now();

    try {
      let convId = conversation_id;

      // Создаём диалог если не передан
      if (!convId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'Новый диалог']);
        convId = newConv.rows[0].id;
      }

      // Загружаем историю (последние 50 сообщений)
      const history = await db.query(`
        SELECT role, content FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC LIMIT 50
      `, [convId]);

      const historyMessages = history.rows.reverse();

      // Обработка запроса — поиск данных
      const { additionalData, results, action } = await mimirData.processQuery(db, message, user);

      let userMessage = message;
      if (context) userMessage = '[Раздел: ' + context + ']\n' + userMessage;
      if (additionalData) userMessage += additionalData;

      // Строим системный промпт
      const systemPrompt = await mimirData.buildSystemPrompt(db, user);

      // Формируем массив сообщений для AI
      const aiMessages = [
        ...historyMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      // Вызов AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.6
      });

      const durationMs = Date.now() - startTime;
      const aiResponse = aiResult.text || 'Руны молчат. Попробуй перефразировать.';

      // Сохраняем сообщение пользователя
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, search_results)
        VALUES ($1, 'user', $2, $3)
      `, [convId, message, results ? JSON.stringify(results) : null]);

      // Сохраняем ответ ассистента
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
      `, [convId, aiResponse, aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, aiResult.model, durationMs]);

      // Обновляем метаданные диалога
      const preview = aiResponse.substring(0, 100);
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [(aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0), preview, convId]);

      // Автогенерация заголовка для нового диалога
      if (!conversation_id && historyMessages.length === 0) {
        generateTitle(db, convId, message, aiResponse).catch(e => {
          fastify.log.warn('Title generation failed:', e.message);
        });
      }

      // Логируем использование
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

      // Логируем ошибку
      try {
        const prov = (aiProvider.getProvider && aiProvider.getProvider()) || 'unknown';
        const mdl = (aiProvider.getConfig && aiProvider.getConfig()?.model) || 'unknown';
        await db.query(`
          INSERT INTO mimir_usage_log (user_id, provider, model, success, error_message)
          VALUES ($1, $2, $3, FALSE, $4)
        `, [user.id, prov, mdl, String(error.message || error).slice(0, 2000)]);
      } catch (e) { /* ignore */ }

      return reply.code(500).send({
        success: false,
        message: 'Ошибка. Один из воронов заблудился...'
      });
    }
  });

  // Чат со стримингом (SSE)
  fastify.post('/chat-stream', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { message, context, conversation_id } = request.body;
    const user = request.user;

    if (!message?.trim()) {
      return reply.code(400).send({ success: false, message: 'Пустое сообщение' });
    }

    // Устанавливаем SSE headers
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
      // Создаём диалог если не передан
      if (!convId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'Новый диалог']);
        convId = newConv.rows[0].id;
      }

      sendEvent({ type: 'start', conversation_id: convId });

      // Загружаем историю (последние 50 сообщений)
      const history = await db.query(`
        SELECT role, content FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC LIMIT 50
      `, [convId]);

      const historyMessages = history.rows.reverse();

      // Обработка запроса
      const { additionalData, results, action: streamAction } = await mimirData.processQuery(db, message, user);

      if (results) {
        sendEvent({ type: 'results', data: results });
      }
      if (streamAction) {
        sendEvent({ type: 'action', data: streamAction });
      }

      let userMessage = message;
      if (context) userMessage = '[Раздел: ' + context + ']\n' + userMessage;
      if (additionalData) userMessage += additionalData;

      const systemPrompt = await mimirData.buildSystemPrompt(db, user);

      const aiMessages = [
        ...historyMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ];

      // Запускаем стриминг
      const streamResponse = await aiProvider.stream({
        system: systemPrompt,
        messages: aiMessages,
        maxTokens: 8000,
        temperature: 0.6
      });

      // Парсим поток
      const streamParser = aiProvider.parseStream(streamResponse, aiProvider.getProvider());

      for await (const event of streamParser) {
        // Проверяем, не отключился ли клиент
        if (request.raw.destroyed) {
          break;
        }

        if (event.type === 'text') {
          fullResponse += event.content;
          sendEvent({ type: 'text', content: event.content });
        } else if (event.type === 'done') {
          inputTokens = event.usage?.inputTokens || 0;
          outputTokens = event.usage?.outputTokens || 0;
        } else if (event.type === 'error') {
          sendEvent({ type: 'error', message: event.message });
        }
      }

      const durationMs = Date.now() - startTime;

      // Сохраняем сообщения
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, search_results)
        VALUES ($1, 'user', $2, $3)
      `, [convId, message, results ? JSON.stringify(results) : null]);

      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
      `, [convId, fullResponse, inputTokens, outputTokens, aiProvider.getConfig().model, durationMs]);

      // Обновляем диалог
      const preview = fullResponse.substring(0, 100);
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [inputTokens + outputTokens, preview, convId]);

      // Автогенерация заголовка
      if (!conversation_id && historyMessages.length === 0) {
        generateTitle(db, convId, message, fullResponse).catch(() => {});
      }

      // Логируем
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
      fastify.log.error('Stream error details:', error.message, error.stack);
      sendEvent({ type: 'error', message: 'Ошибка стриминга: ' + (error.message || 'неизвестная ошибка') });
    }

    reply.raw.end();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 3: АНАЛИЗ ФАЙЛОВ
  // ═══════════════════════════════════════════════════════════════════════════

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

            // Ограничение размера
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
      return reply.code(400).send({ success: false, message: 'Файлы не загружены' });
    }

    const startTime = Date.now();

    try {
      // Создаём диалог если нужно
      if (!conversationId) {
        const newConv = await db.query(`
          INSERT INTO mimir_conversations (user_id, title)
          VALUES ($1, $2)
          RETURNING id
        `, [user.id, 'Анализ файлов']);
        conversationId = newConv.rows[0].id;
      }

      const systemPrompt = await mimirData.buildSystemPrompt(db, user);

      // Формируем контент для AI
      const aiMessages = [];
      const fileNames = filesData.map(f => f.name);

      // Для текстовых файлов — добавляем содержимое
      // Для изображений — multimodal content
      const hasImages = filesData.some(f => f.data.type === 'image');

      if (hasImages) {
        // Multimodal запрос с изображениями
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
              text: `\n=== Файл: ${file.name} ===\n${file.data.content}\n`
            });
          }
        }

        content.push({
          type: 'text',
          text: message || 'Проанализируй эти документы. Дай подробный структурированный отчёт.'
        });

        aiMessages.push({ role: 'user', content });
      } else {
        // Только текстовые файлы
        let combinedContent = '';
        for (const file of filesData) {
          if (file.data.type === 'text') {
            combinedContent += `\n=== Файл: ${file.name} (${(file.size / 1024).toFixed(1)} КБ) ===\n`;
            combinedContent += file.data.content + '\n';
          }
        }

        combinedContent += '\n' + (message || 'Проанализируй эти документы. Дай подробный структурированный отчёт.');

        aiMessages.push({ role: 'user', content: combinedContent });
      }

      // Вызов AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt + '\n\nПользователь загрузил файлы для анализа. Проанализируй содержимое и дай развёрнутый структурированный ответ.',
        messages: aiMessages,
        maxTokens: 4096,
        temperature: 0.5
      });

      const durationMs = Date.now() - startTime;
      const aiResponse = aiResult.text || 'Не удалось проанализировать файлы.';

      // Сохраняем сообщение пользователя
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, content_type, has_files, file_names)
        VALUES ($1, 'user', $2, 'file_analysis', TRUE, $3)
      `, [conversationId, message || 'Анализ файлов', fileNames]);

      // Сохраняем ответ
      await db.query(`
        INSERT INTO mimir_messages (conversation_id, role, content, content_type, tokens_input, tokens_output, model_used, duration_ms)
        VALUES ($1, 'assistant', $2, 'file_analysis', $3, $4, $5, $6)
      `, [conversationId, aiResponse, aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, aiResult.model, durationMs]);

      // Обновляем диалог
      await db.query(`
        UPDATE mimir_conversations
        SET message_count = message_count + 2,
            total_tokens = total_tokens + $1,
            last_message_at = NOW(),
            last_message_preview = $2
        WHERE id = $3
      `, [(aiResult.usage?.inputTokens || 0) + (aiResult.usage?.outputTokens || 0), aiResponse.substring(0, 100), conversationId]);

      // Логируем
      await logUsage(db, user.id, conversationId, aiResult);

      return {
        success: true,
        response: aiResponse,
        files: filesData.map(f => ({ name: f.name, size: f.size, type: f.type })),
        conversation_id: conversationId,
        tokens: aiResult.usage
      };

    } catch (error) {
      fastify.log.error('Analyze error:', error.message);
      return reply.code(500).send({
        success: false,
        message: 'Ошибка анализа файлов'
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 4: АНАЛИТИКА (сохранено из старой версии)
  // ═══════════════════════════════════════════════════════════════════════════

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

  // Статистика
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const stats = await mimirData.getDbStats(db, request.user);
    return { success: true, userRole: request.user?.role, stats };
  });

  // Поиск
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

  // Персональные подсказки для чипов Мимира
  fastify.get('/suggestions', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    const suggestions = [];

    try {
      // Общие подсказки — непрочитанные уведомления
      const unreadRes = await db.query(
        'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND is_read = false',
        [user.id]
      );
      const unread = parseInt(unreadRes.rows[0]?.cnt || 0);
      if (unread > 0) {
        suggestions.push({ icon: '🔔', label: `Уведомления (${unread})`, query: `У меня ${unread} непрочитанных уведомлений. Что важного?` });
      }

      // Директора и админы — расширенные подсказки
      if (mimirData.hasFullAccess(role)) {
        // Пропущенные звонки
        const missedRes = await db.query(
          `SELECT COUNT(*) as cnt FROM call_history
           WHERE call_type = 'inbound' AND duration_seconds < 5
           AND created_at > NOW() - INTERVAL '24 hours'`
        );
        const missed = parseInt(missedRes.rows[0]?.cnt || 0);
        if (missed > 0) {
          suggestions.push({ icon: '📞', label: `Пропущено: ${missed}`, query: `Покажи пропущенные звонки за сегодня` });
        }

        // Срочные тендеры (дедлайн < 3 дней)
        const urgentRes = await db.query(
          `SELECT COUNT(*) as cnt FROM tenders
           WHERE status IN ('in_progress','active','new')
           AND deadline IS NOT NULL AND deadline < CURRENT_DATE + INTERVAL '3 days' AND deadline >= CURRENT_DATE`
        );
        const urgent = parseInt(urgentRes.rows[0]?.cnt || 0);
        if (urgent > 0) {
          suggestions.push({ icon: '⚡', label: `Срочные тендеры: ${urgent}`, query: `Покажи тендеры с дедлайном в ближайшие 3 дня` });
        }

        // Неоплаченные счета
        const overdueRes = await db.query(
          `SELECT COUNT(*) as cnt FROM invoices
           WHERE status NOT IN ('paid','cancelled') AND due_date < CURRENT_DATE`
        );
        const overdue = parseInt(overdueRes.rows[0]?.cnt || 0);
        if (overdue > 0) {
          suggestions.push({ icon: '💰', label: `Просрочено: ${overdue}`, query: `Покажи просроченные счета` });
        }
      }

      // PM — активные тендеры и работы
      if (mimirData.isPM(role)) {
        const myTendersRes = await db.query(
          `SELECT COUNT(*) as cnt FROM tenders WHERE responsible_id = $1 AND status IN ('in_progress','active','new')`,
          [user.id]
        );
        const myTenders = parseInt(myTendersRes.rows[0]?.cnt || 0);
        if (myTenders > 0) {
          suggestions.push({ icon: '📋', label: `Мои тендеры: ${myTenders}`, query: `Покажи мои активные тендеры` });
        }

        const staleRes = await db.query(
          `SELECT COUNT(*) as cnt FROM works
           WHERE pm_id = $1 AND status = 'active' AND updated_at < NOW() - INTERVAL '14 days'`,
          [user.id]
        );
        const stale = parseInt(staleRes.rows[0]?.cnt || 0);
        if (stale > 0) {
          suggestions.push({ icon: '⏳', label: `Застой: ${stale} работ`, query: `Покажи работы без обновлений более 2 недель` });
        }
      }

      // BUH — ожидающие оплаты
      if (mimirData.isBUH(role)) {
        const pendingRes = await db.query(
          `SELECT COUNT(*) as cnt FROM invoices WHERE status = 'pending'`
        );
        const pending = parseInt(pendingRes.rows[0]?.cnt || 0);
        if (pending > 0) {
          suggestions.push({ icon: '💳', label: `К оплате: ${pending}`, query: `Покажи счета ожидающие оплаты` });
        }
      }

      // TO — тендерный отдел
      if (mimirData.isTO(role)) {
        suggestions.push({ icon: '📊', label: 'Статистика тендеров', query: 'Покажи статистику по тендерам за этот месяц' });
      }

      // Дефолтные подсказки по роли (если мало персональных)
      if (suggestions.length < 2) {
        suggestions.push({ icon: '📊', label: 'Тендеры', query: 'Сколько у нас активных тендеров?' });
        suggestions.push({ icon: '🔍', label: 'Поиск', query: 'Найди работы по Газпром' });
        suggestions.push({ icon: '❓', label: 'Помощь', query: 'Как добавить новый расход?' });
      }

      return { success: true, suggestions: suggestions.slice(0, 6) };
    } catch (err) {
      fastify.log.error('[Mimir Suggestions] Error:', err.message);
      return {
        success: true,
        suggestions: [
          { icon: '📊', label: 'Тендеры', query: 'Сколько у нас активных тендеров?' },
          { icon: '🔍', label: 'Поиск', query: 'Найди работы по Газпром' },
          { icon: '❓', label: 'Помощь', query: 'Как добавить новый расход?' }
        ]
      };
    }
  });

  // Финансовая статистика
  fastify.get('/finance-stats', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';

    if (!mimirData.hasFullAccess(role) && !mimirData.isBUH(role)) {
      return { success: false, message: 'Нет доступа к финансовой информации' };
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
      return { success: false, message: 'Ошибка получения данных' };
    }
  });

  // Аналитика работ
  fastify.get('/works-analytics', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const user = request.user;
    const role = user?.role || 'USER';
    const userId = user?.id;

    if (!mimirData.hasFullAccess(role) && !mimirData.isPM(role)) {
      return { success: false, message: 'Нет доступа к аналитике работ' };
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
          AND work_status NOT IN ('Работы сдали', 'Отменено')
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
      return { success: false, message: 'Ошибка получения данных' };
    }
  });

  // Рекомендация по тендеру
  fastify.get('/tender-recommendation/:id', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const tenderId = request.params.id;

    try {
      const tender = await db.query('SELECT * FROM tenders WHERE id = $1', [tenderId]);
      if (tender.rows.length === 0) {
        return { success: false, message: 'Тендер не найден' };
      }

      const t = tender.rows[0];

      const history = await db.query(`
        SELECT tender_status, COUNT(*) as cnt
        FROM tenders WHERE customer_name = $1
        GROUP BY tender_status
      `, [t.customer_name]);

      const wonCount = parseInt(history.rows.find(r => r.tender_status === 'Клиент согласился')?.cnt || 0);
      const totalCount = history.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
      const winRate = totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0;

      let recommendation = '';
      let score = 0;

      if (totalCount === 0) {
        recommendation = 'Новый клиент. Требуется качественное КП.';
        score = 50;
      } else if (winRate >= 60) {
        recommendation = 'Высокие шансы! Клиент лоялен, конверсия ' + winRate + '%';
        score = 85;
      } else if (winRate >= 30) {
        recommendation = 'Средние шансы. Конверсия ' + winRate + '%. Подготовь конкурентное КП.';
        score = 60;
      } else {
        recommendation = 'Низкие шансы. Конверсия ' + winRate + '%. Оцени целесообразность участия.';
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
      return { success: false, message: 'Ошибка анализа' };
    }
  });

  // Генерация ТКП
  fastify.post('/generate-tkp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_id, work_title, customer_name, services, total_sum, deadline } = request.body;

    try {
      const prompt = `Составь профессиональное коммерческое предложение (ТКП) для заказчика.

Заказчик: ${customer_name || 'Не указан'}
Название работ: ${work_title || 'Не указано'}
Перечень услуг: ${services || 'Сервисные работы'}
Ориентировочная сумма: ${total_sum ? total_sum + ' руб.' : 'По запросу'}
Срок выполнения: ${deadline || 'По согласованию'}

О компании:
- ООО «Асгард Сервис» — российская сервисная компания нефтегазового сектора
- Опыт работы на платформе «Приразломная» в Арктике
- Квалифицированные специалисты с допусками (НАКС, газоопасные работы, высота)
- Собственное оборудование

Формат:
1. Заголовок и обращение (1-2 предложения)
2. Описание предлагаемых услуг (2-3 абзаца)
3. Наши преимущества (4-5 пунктов)
4. Условия, стоимость и сроки
5. Контактная информация

Пиши профессионально, развёрнуто, но без воды.`;

      const aiResult = await aiProvider.complete({
        system: 'Ты — профессиональный менеджер по продажам сервисной компании. Составляешь коммерческие предложения.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.7
      });

      const tkpText = aiResult.text || '';

      await logUsage(db, request.user.id, null, aiResult);

      return { success: true, tkp: tkpText };
    } catch (error) {
      fastify.log.error('TKP generation error:', error.message);
      return reply.code(500).send({ success: false, message: 'Ошибка генерации ТКП' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 4.5: ГЕНЕРАЦИЯ И СОЗДАНИЕ ТКП ЧЕРЕЗ МИМИР
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/suggest-tkp', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { tender_id, work_id, customer_name, description, mode } = request.body;
    const user = request.user;

    try {
      // 1. Собрать контекст из БД
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
          context += 'Тендер: ' + tenderData.tender_title + '\n';
          context += 'Заказчик: ' + tenderData.customer_name + ' (ИНН: ' + tenderData.customer_inn + ')\n';
          if (tenderData.tender_description) context += 'Описание: ' + tenderData.tender_description + '\n';
          if (tenderData.tender_sum) context += 'Бюджет: ' + tenderData.tender_sum + ' руб.\n';
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
          context += 'Работа: ' + work.work_title + ' (' + work.work_number + ')\n';
          context += 'Заказчик: ' + work.customer_name + '\n';
          if (work.work_description) context += 'Описание: ' + work.work_description + '\n';
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

      if (description) context += 'Дополнительно: ' + description + '\n';

      // 2. Загрузить настройки НДС
      const settingsRow = await db.query("SELECT value_json FROM settings WHERE key = 'app'");
      const vatPct = settingsRow.rows[0]
        ? (JSON.parse(settingsRow.rows[0].value_json || '{}').vat_pct || 22)
        : 22;

      // 3. Сгенерировать через AI
      const prompt = 'На основе данных создай структурированное коммерческое предложение (ТКП).\n\n' +
        'ДАННЫЕ:\n' + (context || 'Описание: ' + (description || 'Сервисные работы')) + '\n\n' +
        'ПРАВИЛА:\n' +
        '- Компания: ООО «Асгард Сервис» — промышленный сервис (химическая очистка, гидродинамическая очистка, HVAC)\n' +
        '- НДС: ' + vatPct + '%\n' +
        '- Разбей работы на 3-8 логичных позиций (не меньше 3)\n' +
        '- Цены должны быть реалистичными для промышленного сервиса (от 50 000 до 2 000 000 руб. за позицию)\n' +
        '- Единицы: усл., компл., шт., м², п.м., т., час, смена\n' +
        '- Сроки: обычно 5-15 рабочих дней\n' +
        '- Условия оплаты: обычно "Аванс 50% по договору, остаток 50% по акту выполненных работ"\n\n' +
        'ОТВЕТ СТРОГО В JSON (без markdown, без ```, только чистый JSON):\n' +
        '{\n' +
        '  "subject": "Название ТКП",\n' +
        '  "work_description": "Подробное описание работ (2-3 предложения)",\n' +
        '  "items": [\n' +
        '    {"name": "Название работы", "unit": "усл.", "qty": 1, "price": 280000, "total": 280000}\n' +
        '  ],\n' +
        '  "deadline": "10 рабочих дней с момента допуска на объект",\n' +
        '  "payment_terms": "Аванс 50% по договору, остаток 50% по акту выполненных работ",\n' +
        '  "notes": "Дополнительные условия (1-2 предложения)"\n' +
        '}';

      const aiResult = await aiProvider.complete({
        system: 'Ты — менеджер по продажам ООО «Асгард Сервис». Генерируешь коммерческие предложения. Отвечай ТОЛЬКО валидным JSON без обёрток.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        temperature: 0.5
      });

      // 4. Парсинг ответа (агрессивный)
      let tkpData;
      try {
        let text = (aiResult.text || '').trim();
        text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          text = text.substring(firstBrace, lastBrace + 1);
        }
        tkpData = JSON.parse(text);
      } catch (e) {
        return reply.code(500).send({ success: false, message: 'AI вернул невалидный JSON' });
      }

      // mode='items' — вернуть только строки работ
      if (mode === 'items') {
        return { success: true, items: tkpData.items || [], description: tkpData.work_description || '' };
      }
      if (mode === 'description') {
        return { success: true, description: tkpData.work_description || '' };
      }

      // 5. Создать черновик ТКП в БД
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
        author_name: 'Кудряшов О.С.',
        author_position: 'Генеральный директор',
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
        tkpData.subject || 'ТКП',
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
        message: 'Создано ' + tkp.tkp_number + ': "' + tkp.subject + '". ' + items.length + ' позиций, итого ' + totalWithVat.toLocaleString('ru-RU') + ' \u20BD (с НДС ' + vatPct + '%)'
      };

    } catch (error) {
      fastify.log.error('Mimir suggest-tkp error:', error.message);
      return reply.code(500).send({ success: false, message: 'Ошибка генерации ТКП: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI-ХАРАКТЕРИСТИКА СОТРУДНИКА
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/employee-summary', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { employee_id } = request.body;
    if (!employee_id) return reply.code(400).send({ success: false, message: 'employee_id обязателен' });

    try {
      // 1. Основные данные сотрудника
      const empResult = await db.query('SELECT * FROM employees WHERE id = $1', [employee_id]);
      const emp = empResult.rows[0];
      if (!emp) return reply.code(404).send({ success: false, message: 'Сотрудник не найден' });

      // 2. Анкета-характеристика (worker_profiles)
      let profile = null;
      try {
        const profResult = await db.query(
          'SELECT * FROM worker_profiles WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
          [emp.user_id || employee_id]
        );
        profile = profResult.rows[0] || null;
      } catch (_) {
        // Таблица может не существовать — не критично
      }

      // 3. Отзывы РП
      const reviews = await db.query(`
        SELECT r.rating, r.comment, r.created_at,
               w.work_title, u.name as reviewer_name
        FROM employee_reviews r
        LEFT JOIN works w ON w.id = r.work_id
        LEFT JOIN users u ON u.id = r.pm_id
        WHERE r.employee_id = $1
        ORDER BY r.created_at DESC LIMIT 10
      `, [employee_id]);

      // 4. История работ (назначения)
      const assigns = await db.query(`
        SELECT ea.date_from, ea.date_to, ea.role,
               w.work_title, w.work_number, w.customer_name, w.work_status, w.city
        FROM employee_assignments ea
        JOIN works w ON w.id = ea.work_id
        WHERE ea.employee_id = $1
        ORDER BY ea.date_from DESC LIMIT 15
      `, [employee_id]);

      // 5. Допуски и квалификация
      const permits = Array.isArray(emp.permits) ? emp.permits : [];

      // 6. Зарплатные данные (средний доход)
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

      // ─── Собрать контекст для AI ───
      let context = 'ДАННЫЕ О СОТРУДНИКЕ:\n';
      context += 'ФИО: ' + (emp.fio || emp.full_name || '—') + '\n';
      context += 'Должность: ' + (emp.position || emp.role_tag || '—') + '\n';
      context += 'Разряд: ' + (emp.grade || '—') + '\n';
      context += 'Бригада: ' + (emp.brigade || '—') + '\n';
      context += 'Квалификация: ' + (emp.qualification_name || '—') + ' ' + (emp.qualification_grade || '') + '\n';
      context += 'Город: ' + (emp.city || '—') + '\n';
      context += 'В компании с: ' + (emp.hire_date || emp.employment_date || '—') + '\n';
      context += 'Активен: ' + (emp.is_active ? 'Да' : 'Уволен') + '\n';
      context += 'Контракт: ' + (emp.contract_type || 'labor') + '\n';
      context += 'Дневная ставка: ' + (emp.day_rate || '—') + ' ₽\n';
      context += 'Рейтинг: ' + (emp.rating_avg || '—') + '/10 (' + (emp.rating_count || 0) + ' отзывов)\n';

      // Допуски
      context += '\nДОПУСКИ:\n';
      if (emp.naks) context += 'НАКС: ' + emp.naks + ' (удостоверение ' + (emp.naks_number || '—') + ', до ' + (emp.naks_expiry || '—') + ')\n';
      if (emp.imt_number) context += 'ИМТ: ' + emp.imt_number + ' (до ' + (emp.imt_expires || '—') + ')\n';
      if (emp.fsb_pass) context += 'ФСБ-допуск: ' + emp.fsb_pass + '\n';
      if (permits.length > 0) context += 'Допуски: ' + permits.join(', ') + '\n';
      if (emp.skills && emp.skills.length) context += 'Навыки: ' + emp.skills.join(', ') + '\n';

      // Анкета-характеристика
      if (profile && profile.data) {
        context += '\nАНКЕТА-ХАРАКТЕРИСТИКА (от РП):\n';
        try {
          const pData = typeof profile.data === 'string' ? JSON.parse(profile.data) : profile.data;
          for (const [key, val] of Object.entries(pData)) {
            if (val && typeof val === 'object' && val.value) {
              context += key + ': ' + val.value;
              if (val.comment) context += ' (комментарий: ' + val.comment + ')';
              context += '\n';
            } else if (val && typeof val !== 'object') {
              context += key + ': ' + val + '\n';
            }
          }
        } catch (_) {}
      }

      // Отзывы
      if (reviews.rows.length > 0) {
        context += '\nОТЗЫВЫ РП (' + reviews.rows.length + ' шт.):\n';
        reviews.rows.forEach((r, i) => {
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : '';
          context += (i + 1) + '. Оценка ' + r.rating + '/10';
          if (r.work_title) context += ' (работа: ' + r.work_title + ')';
          if (r.reviewer_name) context += ' от ' + r.reviewer_name;
          if (date) context += ' [' + date + ']';
          if (r.comment) context += ': ' + r.comment;
          context += '\n';
        });
      }

      // История работ
      if (assigns.rows.length > 0) {
        context += '\nИСТОРИЯ РАБОТ (' + assigns.rows.length + ' назначений):\n';
        assigns.rows.forEach(a => {
          const from = a.date_from ? new Date(a.date_from).toLocaleDateString('ru-RU') : '?';
          const to = a.date_to ? new Date(a.date_to).toLocaleDateString('ru-RU') : 'по н.в.';
          context += '• ' + from + '–' + to + ': ' + (a.work_title || '—') + ' (' + (a.customer_name || '—') + ', ' + (a.city || '—') + ') роль: ' + (a.role || '—') + '\n';
        });
      }

      // Зарплата
      if (avgPay) {
        context += '\nЗАРПЛАТА:\n';
        context += 'Средний доход: ~' + avgPay.avg_total.toLocaleString('ru-RU') + ' ₽/месяц\n';
        context += 'Всего отработано: ' + avgPay.total_days + ' дней\n';
      }

      // ─── Генерация через AI ───
      const aiResult = await aiProvider.complete({
        system: `Ты — HR-аналитик ООО «Асгард Сервис» (промышленный сервис: химическая очистка, гидрочистка, HVAC на НПЗ и нефтегазовых объектах).

Составь КРАТКУЮ (5-8 предложений) деловую характеристику сотрудника.

Структура:
1. Кто: ФИО, должность, стаж в компании (1 предложение)
2. Опыт: на каких объектах/заказчиках работал, основные роли (1-2 предложения)
3. Качества: на основе анкеты и отзывов РП — сильные стороны и зоны роста (2-3 предложения)
4. Рекомендация: на какие задачи/проекты рекомендуется (1 предложение)

Правила:
- Пиши по-деловому, без воды, конкретно
- Если данных мало — пиши что есть, не додумывай
- Если рейтинг низкий или есть проблемы — упомяни корректно
- Используй факты из данных, не общие фразы
- НЕ используй маркдаун, только текст`,
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
      return reply.code(500).send({ success: false, message: 'Ошибка генерации: ' + error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // БЛОК 5: АДМИН-ПАНЕЛЬ AI
  // ═══════════════════════════════════════════════════════════════════════════

  // Статистика использования AI
  fastify.get('/admin/usage', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    if (!mimirData.hasFullAccess(user?.role)) {
      return reply.code(403).send({ success: false, message: 'Нет доступа' });
    }

    try {
      // Общая статистика
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

      // По дням
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

      // Топ пользователей
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
      return { success: false, message: 'Ошибка получения статистики' };
    }
  });

  // Текущая конфигурация AI
  fastify.get('/admin/config', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;

    if (!mimirData.hasFullAccess(user?.role)) {
      return reply.code(403).send({ success: false, message: 'Нет доступа' });
    }

    const config = aiProvider.getConfig();

    // Маскируем ключи
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Извлечение содержимого файла
   */
  async function extractFileContent(buffer, filename, mimetype) {
    const ext = path.extname(filename).toLowerCase();

    try {
      // PDF → текст
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        return { type: 'text', content: data.text.substring(0, 100000), pages: data.numpages };
      }

      // DOCX → текст
      if (ext === '.docx') {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return { type: 'text', content: result.value.substring(0, 100000) };
      }

      // Excel → текст
      if (['.xlsx', '.xls'].includes(ext)) {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        let text = '';
        workbook.eachSheet((sheet, sheetId) => {
          text += `\n=== Лист: ${sheet.name} ===\n`;
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

      // Изображения → base64 для Claude Vision
      if (mimetype?.startsWith('image/')) {
        const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!supportedTypes.includes(mimetype)) {
          return { type: 'text', content: `[Неподдерживаемый формат изображения: ${mimetype}]` };
        }
        return {
          type: 'image',
          media_type: mimetype,
          data: buffer.toString('base64')
        };
      }

      // TXT и прочие текстовые
      return { type: 'text', content: buffer.toString('utf8').substring(0, 100000) };

    } catch (e) {
      fastify.log.error('File extraction error:', e.message);
      return { type: 'text', content: `[Ошибка чтения файла: ${e.message}]` };
    }
  }

  /**
   * Автогенерация заголовка диалога
   */
  async function generateTitle(db, conversationId, userMessage, assistantResponse) {
    try {
      const result = await aiProvider.complete({
        system: 'Придумай короткий заголовок (3-7 слов) для диалога на русском языке. Отвечай ТОЛЬКО заголовком, без кавычек и пояснений.',
        messages: [{
          role: 'user',
          content: `Вопрос: ${userMessage.substring(0, 200)}\nОтвет: ${assistantResponse.substring(0, 300)}`
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
   * Логирование использования AI
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

  // ═══════════════════════════════════════════════════════════════════════════
  // УНИВЕРСАЛЬНОЕ АВТОЗАПОЛНЕНИЕ ФОРМ — POST /mimir/suggest-form
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/suggest-form', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { form_type, context = {} } = request.body || {};
    if (!form_type) return reply.code(400).send({ error: 'form_type обязателен' });

    try {
      let systemPrompt = '';
      let userPrompt = '';
      let dbContext = '';

      // ── Контекст из БД по типу формы ──
      switch (form_type) {

        case 'contract': {
          // Договор: подтянуть данные контрагента и тендера
          const { counterparty_id, tender_id, existing_fields = {} } = context;
          if (counterparty_id) {
            const c = await db.query('SELECT * FROM customers WHERE inn = $1', [counterparty_id]);
            if (c.rows[0]) dbContext += 'Контрагент: ' + JSON.stringify(c.rows[0]) + '\n';
          }
          if (tender_id) {
            const t = await db.query('SELECT tender_title, tender_description, tender_sum, customer_name, deadline FROM tenders WHERE id = $1', [tender_id]);
            if (t.rows[0]) dbContext += 'Тендер: ' + JSON.stringify(t.rows[0]) + '\n';
          }
          systemPrompt = 'Ты AI-ассистент CRM-системы АСГАРД. Помоги заполнить форму договора. Верни JSON с полями: number, subject, start_date (YYYY-MM-DD), end_date, amount, responsible, comment. Только те поля, которые можешь уверенно заполнить на основе контекста. Не выдумывай данные.';
          userPrompt = 'Контекст:\n' + dbContext + '\nУже заполнено: ' + JSON.stringify(existing_fields) + '\nЗаполни оставшиеся поля формы договора.';
          break;
        }

        case 'customer': {
          // Контрагент: поиск по ИНН/названию — возвращаем только безопасные поля
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
          systemPrompt = 'Ты AI-ассистент. Помоги заполнить форму контрагента. Верни JSON с полями: name, full_name, inn, kpp, address, contact_person, phone, email. Только те что можешь уверенно определить.';
          userPrompt = 'Запрос: ' + (search_query || name || inn || '') + '\nУже заполнено: ' + JSON.stringify(existing_fields);
          break;
        }

        case 'correspondence': {
          // Корреспонденция — поля согласованы с фронтендом (subject, note, counterparty)
          const { direction, existing_fields = {} } = context;
          systemPrompt = 'Ты AI-ассистент CRM АСГАРД. Помоги заполнить форму корреспонденции (' + (direction === 'outgoing' ? 'исходящий' : 'входящий') + ' документ). Верни JSON с полями: subject (тема документа), note (примечание/содержание), counterparty (организация-отправитель/получатель), contact_person (контактное лицо). Основывайся на контексте. Только те поля что можешь уверенно заполнить.';
          userPrompt = 'Направление: ' + (direction || 'unknown') + '\nУже заполнено: ' + JSON.stringify(existing_fields) + '\nПредложи значения для оставшихся полей.';
          break;
        }

        case 'proxy': {
          // Доверенность
          const { employee_id, existing_fields = {} } = context;
          if (employee_id) {
            const e = await db.query('SELECT name, position, department FROM employees WHERE id = $1', [employee_id]);
            if (e.rows[0]) dbContext += 'Сотрудник: ' + JSON.stringify(e.rows[0]) + '\n';
          }
          systemPrompt = 'Ты AI-ассистент CRM АСГАРД. Помоги заполнить форму доверенности. Верни JSON с полями которые можешь уверенно заполнить: subject, valid_from (YYYY-MM-DD), valid_to, powers_text.';
          userPrompt = dbContext + '\nУже заполнено: ' + JSON.stringify(existing_fields);
          break;
        }

        case 'pass_request': {
          // Заявка на пропуск
          const { employee_id, work_id, existing_fields = {} } = context;
          if (employee_id) {
            const e = await db.query('SELECT name, position, phone FROM employees WHERE id = $1', [employee_id]);
            if (e.rows[0]) dbContext += 'Сотрудник: ' + JSON.stringify(e.rows[0]) + '\n';
          }
          if (work_id) {
            const w = await db.query('SELECT work_title, customer_name, city, address FROM works WHERE id = $1', [work_id]);
            if (w.rows[0]) dbContext += 'Работа: ' + JSON.stringify(w.rows[0]) + '\n';
          }
          systemPrompt = 'Ты AI-ассистент CRM АСГАРД. Помоги заполнить заявку на пропуск. Верни JSON с полями: object_name, object_address, date_from (YYYY-MM-DD), date_to, purpose.';
          userPrompt = dbContext + '\nУже заполнено: ' + JSON.stringify(existing_fields);
          break;
        }

        default:
          return reply.code(400).send({ error: 'Неизвестный form_type: ' + form_type });
      }

      // Если нет промпта — нечего делать
      if (!systemPrompt) {
        return reply.send({ fields: {}, message: 'Недостаточно контекста' });
      }

      // ── Вызов AI ──
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 1000,
        temperature: 0.3
      });

      // Парсим JSON из ответа
      let fields = {};
      try {
        const text = aiResult.text || aiResult.content || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          fields = JSON.parse(jsonMatch[0]);
        }
      } catch (_) {
        // Не удалось распарсить — вернём пустое
      }

      // Фильтруем пустые значения
      Object.keys(fields).forEach(k => {
        if (fields[k] === null || fields[k] === undefined || fields[k] === '') {
          delete fields[k];
        }
      });

      return reply.send({ fields, source: 'ai' });

    } catch (error) {
      fastify.log.error('Mimir suggest-form error:', error.message);
      return reply.code(500).send({ error: 'Ошибка AI: ' + error.message });
    }
  });
  // ═══ H1: Мимир-автоответчик для просчётов ═══

  /**
   * POST /api/mimir/auto-respond
   * Внутренний эндпоинт: Мимир анализирует комментарий директора и отвечает в чат.
   * Body: { estimate_id, chat_id, trigger_action, director_comment, director_name }
   */
  fastify.post('/auto-respond', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { estimate_id, chat_id, trigger_action, director_comment, director_name } = request.body || {};
    if (!estimate_id || !chat_id || !trigger_action || !director_comment) {
      return reply.code(400).send({ error: 'estimate_id, chat_id, trigger_action, director_comment required' });
    }

    const startTime = Date.now();

    try {
      // 1. Проверить mimir_auto_config
      const configResult = await db.query(
        "SELECT * FROM mimir_auto_config WHERE entity_type = 'estimate' AND trigger_action = $1 AND enabled = true",
        [trigger_action]
      );
      if (!configResult.rows[0]) {
        return reply.send({ skipped: true, reason: 'auto-respond disabled for this action' });
      }
      const config = configResult.rows[0];

      // 2. Получить mimir_bot user id
      const botResult = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
      const botUserId = botResult.rows[0]?.id;
      if (!botUserId) {
        return reply.code(500).send({ error: 'mimir_bot user not found' });
      }

      // 3. Получить контекст: estimate + calculation + аналоги
      const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimate_id]);
      const estimate = estResult.rows[0];
      if (!estimate) return reply.code(404).send({ error: 'Просчёт не найден' });

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
      let pmName = 'РП';
      if (estimate.pm_id) {
        const pmResult = await db.query('SELECT name FROM users WHERE id = $1', [estimate.pm_id]);
        pmName = pmResult.rows[0]?.name || 'РП';
      }

      // 4. Собрать расчёт summary
      let calcSummary = 'Расчёт пока не создан.';
      if (calcData) {
        const blocks = [];
        if (calcData.personnel_json) blocks.push(`Персонал: ${JSON.stringify(calcData.personnel_json).length > 10 ? 'есть данные' : 'пусто'}`);
        blocks.push(`Итого себестоимость: ${calcData.total_cost || '?'} ₽`);
        blocks.push(`Клиенту: ${calcData.total_with_margin || '?'} ₽`);
        blocks.push(`Маржа: ${calcData.margin_pct || '?'}%`);
        blocks.push(`Непредвиденные: ${calcData.contingency_pct || 5}%`);
        calcSummary = blocks.join('\n');
      }

      let analogsSummary = 'Аналогов нет.';
      if (analogs.length > 0) {
        analogsSummary = analogs.map(a =>
          `- ${a.title}: себес ${a.total_cost}₽, клиенту ${a.total_with_margin}₽, маржа ${a.margin_pct}%, бригада ${a.crew_count} чел, ${a.work_days} дней`
        ).join('\n');
      }

      // 5. System prompt
      const systemPrompt = `Ты Мимир — ИИ-ассистент ООО «Асгард-Сервис». Директор ${director_name || 'директор'} оставил комментарий к просчёту.

ПРОСЧЁТ: ${estimate.title || estimate.object_name || 'Без названия'}
Заказчик: ${estimate.customer || '—'}
Объект: ${estimate.object_city || '—'}, ${estimate.object_distance_km || '?'} км
Тип работ: ${estimate.work_type || '—'}
Бригада: ${estimate.crew_count || '?'} чел, ${estimate.work_days || '?'} раб. дней

РАСЧЁТ (себестоимость):
${calcSummary}

КОММЕНТАРИЙ ДИРЕКТОРА (${trigger_action}):
"${director_comment}"

АНАЛОГИЧНЫЕ ПРОЕКТЫ:
${analogsSummary}

ТВОЯ ЗАДАЧА:
1. Начни с фразы "Пока ждём ответа от ${pmName}, я посмотрел информацию и вот что могу сказать:"
2. Проанализируй комментарий директора
3. Если можешь помочь — дай конкретные цифры, сравнения с аналогами, пересчитай если нужно
4. Если не можешь — напиши: "Я хотел помочь, но не смог найти достаточно информации по этому вопросу. Ждём, что скажет ${pmName}."
5. Если видишь риск (маржа падает ниже 15%, себестоимость превышает аналоги на >30%) — предупреди

ПРАВИЛА:
- Отвечай по-русски
- Будь конкретным — цифры, проценты, суммы
- Ссылайся на аналоги если есть
- Не принимай решение за директора или РП — только рекомендуй
- Максимум 200 слов
- Используй тарифы и формулы из расчётного движка (ФОТ 55%, накладные 15%, расходные 3%, непредвиденные 5%)`;

      // 6. Вызвать AI
      const aiResult = await aiProvider.complete({
        system: systemPrompt,
        messages: [{ role: 'user', content: director_comment }],
        maxTokens: config.max_tokens || 8000,
        temperature: 0.4
      });

      const responseText = aiResult.text || '';
      const durationMs = Date.now() - startTime;

      // 7. Определить сценарий
      let scenario = 'can_help';
      if (responseText.includes('не смог найти достаточно информации') || responseText.includes('Ждём, что скажет')) {
        scenario = 'cannot_help';
      }
      if (responseText.includes('предупред') || responseText.includes('риск') || responseText.includes('ниже 15%')) {
        scenario = 'warning';
      }

      // 8. Записать сообщение в чат от mimir_bot
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
          message: { ...mimirMsg, user_name: 'Мимир', is_mimir_bot: true }
        });
      }

      // 10. Записать в mimir_auto_log
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
      fastify.log.error('[Mimir auto-respond error]:', error.message);
      return reply.code(500).send({ error: 'Ошибка автоответа Мимира: ' + error.message });
    }
  });
}

module.exports = mimirRoutes;
