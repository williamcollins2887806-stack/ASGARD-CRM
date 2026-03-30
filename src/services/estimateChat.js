'use strict';

/**
 * ASGARD CRM — Сервис интеграции просчётов с Хугинн (H1+H2)
 *
 * H1: Создание чата при send, обновление карточки при resubmit.
 * H2: Дублирование комментариев директора в чат, вызов Мимир-автоответчика.
 */

const { sendToUser } = require('../routes/sse');

/**
 * Создать чат для просчёта (вызывается при send).
 * Если чат уже существует — ничего не делает.
 */
async function createEstimateChat(db, estimateId, actor) {
  // 1. Проверить что чат ещё не существует
  const existing = await db.query(
    "SELECT id FROM chats WHERE entity_type = 'estimate' AND entity_id = $1", [estimateId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // 2. Получить estimate
  const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimateId]);
  const estimate = estResult.rows[0];
  if (!estimate) return null;

  // 3. Собрать участников: PM + ТО (из тендера) + директоры + mimir_bot
  const pmId = estimate.pm_id || estimate.created_by || actor.id;
  const participantIds = new Set([pmId]);

  if (estimate.tender_id) {
    const tenderResult = await db.query('SELECT created_by FROM tenders WHERE id = $1', [estimate.tender_id]);
    if (tenderResult.rows[0]?.created_by) participantIds.add(tenderResult.rows[0].created_by);
  }

  const directors = await db.query(
    "SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
  );
  for (const d of directors.rows) participantIds.add(d.id);

  const mimirBot = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
  const mimirBotId = mimirBot.rows[0]?.id;
  if (mimirBotId) participantIds.add(mimirBotId);

  // 4. Создать чат
  const chatName = `📊 Просчёт #${estimateId} — ${estimate.title || estimate.object_name || 'Без названия'}`;
  const { rows: [chat] } = await db.query(`
    INSERT INTO chats (name, type, is_group, entity_type, entity_id, auto_created, created_at, updated_at)
    VALUES ($1, 'group', true, 'estimate', $2, true, NOW(), NOW())
    RETURNING *
  `, [chatName, estimateId]);

  // 5. Добавить участников
  const memberArr = [...participantIds];
  for (const uid of memberArr) {
    const role = uid === pmId ? 'owner' : 'member';
    await db.query(
      'INSERT INTO chat_group_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
      [chat.id, uid, role]
    );
  }

  // 6. Получить расчёт для pinned card
  let calcData = null;
  try {
    const calcResult = await db.query(
      'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
      [estimateId]
    );
    calcData = calcResult.rows[0] || null;
  } catch (e) { /* ok */ }

  // 7. Pinned estimate_card
  const cardMetadata = {
    estimate_id: estimateId,
    status: 'sent',
    title: estimate.title || estimate.object_name,
    customer: estimate.customer,
    total_cost: calcData?.total_cost || null,
    total_with_margin: calcData?.total_with_margin || null,
    margin_pct: calcData?.margin_pct || null,
    version_no: calcData?.version_no || 1
  };
  const { rows: [cardMsg] } = await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
    VALUES ($1, $2, $3, 'estimate_card', $4, false, NOW()) RETURNING *
  `, [chat.id, pmId, `📊 Просчёт #${estimateId}`, JSON.stringify(cardMetadata)]);

  await db.query(
    'INSERT INTO pinned_messages (chat_id, message_id, pinned_by, pinned_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
    [chat.id, cardMsg.id, pmId]
  );

  // 8. Системное сообщение
  const actorName = actor.name || 'РП';
  await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at)
    VALUES ($1, $2, $3, 'system', true, NOW())
  `, [chat.id, pmId, `${actorName} отправил просчёт на согласование`]);

  await db.query('UPDATE chats SET message_count = 2, last_message_at = NOW() WHERE id = $1', [chat.id]);

  // 9. SSE
  for (const uid of memberArr) {
    if (uid !== pmId) {
      sendToUser(uid, 'chat:new_chat', { chat_id: chat.id, chat_name: chatName, entity_type: 'estimate', entity_id: estimateId });
    }
  }

  console.log(`[H1] Estimate chat created: chat_id=${chat.id}, estimate_id=${estimateId}, members=${memberArr.length}`);
  return chat;
}

/**
 * Обновить pinned-карточку просчёта в чате (вызывается при resubmit).
 */
async function updateEstimateCard(db, estimateId, actor) {
  // Найти чат
  const chatResult = await db.query(
    "SELECT id FROM chats WHERE entity_type = 'estimate' AND entity_id = $1", [estimateId]
  );
  if (!chatResult.rows[0]) return null;
  const chatId = chatResult.rows[0].id;

  // Получить estimate + calc
  const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimateId]);
  const estimate = estResult.rows[0];
  if (!estimate) return null;

  let calcData = null;
  try {
    const calcResult = await db.query(
      'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
      [estimateId]
    );
    calcData = calcResult.rows[0] || null;
  } catch (e) { /* ok */ }

  const newMetadata = {
    estimate_id: estimateId,
    status: estimate.approval_status || 'sent',
    title: estimate.title || estimate.object_name,
    customer: estimate.customer,
    total_cost: calcData?.total_cost || null,
    total_with_margin: calcData?.total_with_margin || null,
    margin_pct: calcData?.margin_pct || null,
    version_no: calcData?.version_no || 1
  };

  // Обновить pinned card
  const pinnedResult = await db.query(`
    SELECT cm.id FROM chat_messages cm
    JOIN pinned_messages pm ON pm.message_id = cm.id AND pm.chat_id = cm.chat_id
    WHERE cm.chat_id = $1 AND cm.message_type = 'estimate_card'
    ORDER BY cm.id DESC LIMIT 1
  `, [chatId]);

  if (pinnedResult.rows[0]) {
    await db.query(
      'UPDATE chat_messages SET metadata = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(newMetadata), pinnedResult.rows[0].id]
    );
  }

  // Системное сообщение
  const versionNo = calcData?.version_no || 1;
  const actorName = actor.name || 'Пользователь';
  await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
    VALUES ($1, $2, $3, 'estimate_update', $4, true, NOW())
  `, [chatId, actor.id, `${actorName} обновил расчёт (v.${versionNo}) и отправил повторно`, JSON.stringify(newMetadata)]);

  await db.query('UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [chatId]);

  // SSE
  const members = await db.query('SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chatId]);
  for (const m of members.rows) {
    if (m.user_id !== actor.id) {
      sendToUser(m.user_id, 'chat:estimate_updated', {
        chat_id: chatId, estimate_id: estimateId, metadata: newMetadata
      });
    }
  }

  console.log(`[H1] Estimate card updated: chat_id=${chatId}, estimate_id=${estimateId}`);
  return { chatId, metadata: newMetadata };
}

/**
 * H2: Дублировать комментарий директора в чат просчёта.
 * Вызывается из approvalService при approve/rework/question/reject.
 * Возвращает { chatId, messageId } или null если чата нет.
 */
async function syncCommentToChat(db, { entityId, action, comment, actor }) {
  // 1. Найти чат просчёта
  const chatResult = await db.query(
    "SELECT id FROM chats WHERE entity_type = 'estimate' AND entity_id = $1", [entityId]
  );
  if (!chatResult.rows[0]) return null;
  const chatId = chatResult.rows[0].id;

  // 2. Записать комментарий как сообщение в чат
  const metadata = {
    approval_action: action,  // 'approve', 'rework', 'question', 'reject'
  };
  const { rows: [msg] } = await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
    VALUES ($1, $2, $3, 'text', $4, false, NOW()) RETURNING id
  `, [chatId, actor.id, comment, JSON.stringify(metadata)]);

  // 3. Обратная связь: обновить approval_comments.chat_message_id
  try {
    await db.query(
      `UPDATE approval_comments SET chat_message_id = $1
       WHERE id = (
         SELECT id FROM approval_comments
         WHERE entity_type = 'estimates' AND entity_id = $2 AND user_id = $3 AND action = $4
         AND chat_message_id IS NULL ORDER BY created_at DESC LIMIT 1
       )`,
      [msg.id, entityId, actor.id, action]
    );
  } catch (e) {
    // не критично — просто для двусторонней связи
  }

  // 4. Обратная связь: chat_messages.approval_comment_id
  try {
    const acResult = await db.query(
      `SELECT id FROM approval_comments
       WHERE entity_type = 'estimates' AND entity_id = $1 AND user_id = $2 AND action = $3
       ORDER BY created_at DESC LIMIT 1`,
      [entityId, actor.id, action]
    );
    if (acResult.rows[0]) {
      await db.query(
        'UPDATE chat_messages SET approval_comment_id = $1 WHERE id = $2',
        [acResult.rows[0].id, msg.id]
      );
    }
  } catch (e) { /* ok */ }

  // 5. Update chat counters
  await db.query(
    'UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
    [chatId]
  );

  // 6. SSE уведомить участников
  const members = await db.query('SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chatId]);
  for (const m of members.rows) {
    if (m.user_id !== actor.id) {
      sendToUser(m.user_id, 'chat:new_message', {
        chat_id: chatId,
        message: { id: msg.id, chat_id: chatId, user_id: actor.id, message: comment,
                   message_type: 'text', metadata, user_name: actor.name, user_role: actor.role }
      });
    }
  }

  console.log(`[H2] Comment synced to chat: chat_id=${chatId}, action=${action}, msg_id=${msg.id}`);
  return { chatId, messageId: msg.id };
}

/**
 * H2: Fire-and-forget вызов Мимир-автоответчика.
 * Вызывается после syncCommentToChat для rework/question/reject.
 */
async function triggerMimirAutoRespond(db, { entityId, chatId, action, comment, actorName }) {
  try {
    const aiProvider = require('./ai-provider');
    const { sendToUser: sse } = require('../routes/sse');

    // 1. Проверить конфигурацию
    const configResult = await db.query(
      "SELECT * FROM mimir_auto_config WHERE entity_type = 'estimate' AND trigger_action = $1 AND enabled = true",
      [action]
    );
    if (!configResult.rows[0]) {
      console.log(`[H2] Mimir auto-respond skipped: ${action} disabled`);
      return null;
    }
    const config = configResult.rows[0];

    // 2. Задержка (чтобы не выглядело как бот)
    if (config.delay_seconds > 0) {
      await new Promise(r => setTimeout(r, config.delay_seconds * 1000));
    }

    // 3. mimir_bot user id
    const botResult = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
    const botUserId = botResult.rows[0]?.id;
    if (!botUserId) return null;

    // 4. Контекст: estimate + calculation + аналоги
    const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [entityId]);
    const estimate = estResult.rows[0];
    if (!estimate) return null;

    let calcData = null;
    try {
      const calcResult = await db.query(
        'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
        [entityId]
      );
      calcData = calcResult.rows[0] || null;
    } catch (e) { /* ok */ }

    let analogs = [];
    try {
      const analogsResult = await db.query(
        "SELECT title, total_cost, total_with_margin, margin_pct, crew_count, work_days FROM estimates WHERE id != $1 AND work_type = $2 AND approval_status = 'approved' ORDER BY created_at DESC LIMIT 3",
        [entityId, estimate.work_type]
      );
      analogs = analogsResult.rows;
    } catch (e) { /* ok */ }

    let pmName = 'РП';
    if (estimate.pm_id) {
      const pmResult = await db.query('SELECT name FROM users WHERE id = $1', [estimate.pm_id]);
      pmName = pmResult.rows[0]?.name || 'РП';
    }

    // 5. Расчёт summary
    let calcSummary = 'Расчёт пока не создан.';
    if (calcData) {
      const blocks = [];
      blocks.push(`Итого себестоимость: ${calcData.total_cost || '?'} руб.`);
      blocks.push(`Клиенту: ${calcData.total_with_margin || '?'} руб.`);
      blocks.push(`Маржа: ${calcData.margin_pct || '?'}%`);
      blocks.push(`Непредвиденные: ${calcData.contingency_pct || 5}%`);
      calcSummary = blocks.join('\n');
    }

    let analogsSummary = 'Аналогов нет.';
    if (analogs.length > 0) {
      analogsSummary = analogs.map(a =>
        `- ${a.title}: себес ${a.total_cost} руб., клиенту ${a.total_with_margin} руб., маржа ${a.margin_pct}%, бригада ${a.crew_count} чел, ${a.work_days} дней`
      ).join('\n');
    }

    // 6. System prompt
    const systemPrompt = `Ты Мимир — ИИ-ассистент ООО «Асгард-Сервис». Директор ${actorName || 'директор'} оставил комментарий к просчёту.

ПРОСЧЁТ: ${estimate.title || estimate.object_name || 'Без названия'}
Заказчик: ${estimate.customer || '—'}
Объект: ${estimate.object_city || '—'}, ${estimate.object_distance_km || '?'} км
Тип работ: ${estimate.work_type || '—'}
Бригада: ${estimate.crew_count || '?'} чел, ${estimate.work_days || '?'} раб. дней

РАСЧЁТ (себестоимость):
${calcSummary}

КОММЕНТАРИЙ ДИРЕКТОРА (${action}):
"${comment}"

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
- Максимум 200 слов`;

    const startTime = Date.now();

    // 7. Вызвать AI
    const aiResult = await aiProvider.complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: comment }],
      maxTokens: config.max_tokens || 500,
      temperature: 0.4
    });

    const responseText = aiResult.text || '';
    const durationMs = Date.now() - startTime;

    // 8. Определить сценарий
    let scenario = 'can_help';
    if (responseText.includes('не смог найти достаточно информации') || responseText.includes('Ждём, что скажет')) {
      scenario = 'cannot_help';
    }
    if (responseText.includes('предупред') || responseText.includes('риск') || responseText.includes('ниже 15%')) {
      scenario = 'warning';
    }

    // 9. Записать сообщение от mimir_bot
    const msgMetadata = {
      confidence: scenario === 'can_help' ? 'high' : scenario === 'warning' ? 'medium' : 'low',
      trigger_action: action,
      scenario,
      tokens_input: aiResult.usage?.inputTokens || 0,
      tokens_output: aiResult.usage?.outputTokens || 0
    };
    const { rows: [mimirMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
      VALUES ($1, $2, $3, 'mimir_response', $4, false, NOW()) RETURNING *
    `, [chatId, botUserId, responseText, JSON.stringify(msgMetadata)]);

    await db.query(
      'UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [chatId]
    );

    // 10. SSE notify
    const members = await db.query('SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chatId]);
    for (const m of members.rows) {
      sse(m.user_id, 'chat:new_message', {
        chat_id: chatId,
        message: { ...mimirMsg, user_name: 'Мимир', is_mimir_bot: true }
      });
    }

    // 11. Лог
    await db.query(`
      INSERT INTO mimir_auto_log (chat_id, estimate_id, trigger_action, trigger_comment, response, tokens_input, tokens_output, duration_ms, scenario)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [chatId, entityId, action, comment, responseText,
        aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, durationMs, scenario]);

    console.log(`[H2] Mimir auto-responded: chat_id=${chatId}, scenario=${scenario}, ${durationMs}ms`);
    return { messageId: mimirMsg.id, scenario, durationMs };

  } catch (err) {
    console.error('[H2] Mimir auto-respond error:', err.message);
    return null;
  }
}

module.exports = {
  createEstimateChat,
  updateEstimateCard,
  syncCommentToChat,
  triggerMimirAutoRespond
};
