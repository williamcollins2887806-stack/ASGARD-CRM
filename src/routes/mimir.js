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

    if (!message || message.length < 1) {
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

      // Загружаем историю (последние 20 сообщений)
      const history = await db.query(`
        SELECT role, content FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [convId]);

      const historyMessages = history.rows.reverse();

      // Обработка запроса — поиск данных
      const { additionalData, results } = await mimirData.processQuery(db, message, user);

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
        maxTokens: 4096,
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
        conversation_id: convId,
        userRole: user?.role,
        tokens: aiResult.usage
      };

    } catch (error) {
      fastify.log.error('Mimir error: ' + error.message);

      // Логируем ошибку
      try {
        await db.query(`
          INSERT INTO mimir_usage_log (user_id, provider, model, success, error_message)
          VALUES ($1, $2, $3, FALSE, $4)
        `, [user.id, aiProvider.getProvider(), aiProvider.getConfig().model, error.message]);
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

    if (!message || message.length < 1) {
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

      // Загружаем историю
      const history = await db.query(`
        SELECT role, content FROM mimir_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [convId]);

      const historyMessages = history.rows.reverse();

      // Обработка запроса
      const { additionalData, results } = await mimirData.processQuery(db, message, user);

      if (results) {
        sendEvent({ type: 'results', data: results });
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
        maxTokens: 4096,
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
      fastify.log.error('Stream error:', error.message);
      sendEvent({ type: 'error', message: 'Ошибка стриминга' });
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
      status: config.hasAnthropicKey || config.hasOpenAIKey ? 'ok' : 'not_configured',
      service: 'Mimir AI v3',
      provider: config.provider,
      model: config.model,
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
        SELECT id, work_number, work_title, customer_name, work_end_plan
        FROM works
        ${whereClause || 'WHERE 1=1'}
          AND work_end_plan IS NOT NULL
          AND work_status NOT IN ('Работы сдали', 'Отменено')
        ORDER BY work_end_plan ASC
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
      await db.query(`
        INSERT INTO mimir_usage_log (user_id, conversation_id, provider, model, tokens_input, tokens_output, duration_ms, success)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      `, [
        userId,
        conversationId,
        aiResult.provider || aiProvider.getProvider(),
        aiResult.model || aiProvider.getConfig().model,
        aiResult.usage?.inputTokens || 0,
        aiResult.usage?.outputTokens || 0,
        aiResult.durationMs || 0
      ]);
    } catch (e) {
      // Ignore logging errors
    }
  }
}

module.exports = mimirRoutes;
