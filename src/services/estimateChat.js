'use strict';

/**
 * ASGARD CRM — Сервис интеграции просчётов с Хугинн (H1+H2+BF2b)
 *
 * H1:  Создание чата при send, обновление карточки при resubmit.
 * H2:  Дублирование комментариев директора в чат, вызов Мимир-автоответчика
 *      на approval-action (rework/question/reject).
 * BF2b: Мимир отвечает на @упоминания в чатах просчётов, читает приложенные
 *      документы (PDF/DOCX/Excel/txt), знает полный контекст просчёта.
 */

const path = require('path');
const fs = require('fs');
const { sendToUser } = require('../routes/sse');

// Базовая директория хранения документов (та же что в src/routes/files.js)
const UPLOAD_BASE_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// Регулярка детекции упоминания Мимира в тексте сообщения
const MIMIR_MENTION_RE = /(^|[\s,!?(])(@мимир|@mimir|мимир[,:!?\s])/i;

/**
 * Проверяет, упомянут ли Мимир в тексте сообщения чата.
 * Используется в chat_groups.js для решения о вызове mimirRespondToQuestion.
 */
function detectMimirMention(text) {
  if (!text || typeof text !== 'string') return false;
  return MIMIR_MENTION_RE.test(text);
}

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

  // 6a. Fallback: если calcData нет — рассчитать из работы (если есть)
  if (!calcData || !calcData.total_cost) {
    try {
      const workRes = await db.query(
        'SELECT id, contract_value, vat_pct FROM works WHERE estimate_id = $1 LIMIT 1',
        [estimateId]
      );
      const work = workRes.rows[0];
      if (work) {
        const expRes = await db.query(
          'SELECT COALESCE(SUM(amount), 0) as total FROM work_expenses WHERE work_id = $1',
          [work.id]
        );
        const totalExpenses = parseFloat(expRes.rows[0]?.total || 0);
        const contractValue = parseFloat(work.contract_value || 0);
        const vatPct = parseFloat(work.vat_pct || 22);
        const revenueExVat = contractValue / (1 + vatPct / 100);
        const marginPct = revenueExVat > 0 ? Math.round((1 - totalExpenses / revenueExVat) * 1000) / 10 : 0;
        calcData = {
          total_cost: totalExpenses,
          total_with_margin: contractValue,
          margin_pct: marginPct,
          version_no: 1
        };
      }
    } catch (e) { /* ok */ }
  }

  // 6b. Получить tender_title и pm_name для карточки
  let tenderTitle = null;
  if (estimate.tender_id) {
    try {
      const tRes = await db.query('SELECT tender_title, customer_name FROM tenders WHERE id = $1', [estimate.tender_id]);
      tenderTitle = tRes.rows[0]?.tender_title || null;
    } catch (e) { /* ok */ }
  }
  let pmName = null;
  if (pmId) {
    try {
      const pRes = await db.query('SELECT name FROM users WHERE id = $1', [pmId]);
      pmName = pRes.rows[0]?.name || null;
    } catch (e) { /* ok */ }
  }

  // 6c. Find work_id linked to this estimate (for fin. report link)
  let workId = null;
  try {
    const wRes = await db.query('SELECT id FROM works WHERE estimate_id = $1 LIMIT 1', [estimateId]);
    workId = wRes.rows[0]?.id || null;
  } catch (_) {}

  // 7. Pinned estimate_card
  const cardMetadata = {
    estimate_id: estimateId,
    work_id: workId,
    status: 'sent',
    title: estimate.title || estimate.object_name || tenderTitle,
    tender_title: tenderTitle,
    customer: estimate.customer,
    object_city: estimate.object_city || null,
    work_type: estimate.work_type || null,
    crew_count: estimate.crew_count || null,
    work_days: estimate.work_days || null,
    pm_name: pmName,
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

  // Получить tender_title и pm_name
  let tenderTitle = null;
  if (estimate.tender_id) {
    try {
      const tRes = await db.query('SELECT tender_title FROM tenders WHERE id = $1', [estimate.tender_id]);
      tenderTitle = tRes.rows[0]?.tender_title || null;
    } catch (e) { /* ok */ }
  }
  let pmName = null;
  const pmId = estimate.pm_id || estimate.created_by;
  if (pmId) {
    try {
      const pRes = await db.query('SELECT name FROM users WHERE id = $1', [pmId]);
      pmName = pRes.rows[0]?.name || null;
    } catch (e) { /* ok */ }
  }

  const newMetadata = {
    estimate_id: estimateId,
    status: estimate.approval_status || 'sent',
    title: estimate.title || estimate.object_name || tenderTitle,
    tender_title: tenderTitle,
    customer: estimate.customer,
    object_city: estimate.object_city || null,
    work_type: estimate.work_type || null,
    crew_count: estimate.crew_count || null,
    work_days: estimate.work_days || null,
    pm_name: pmName,
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

    // 7. Вызвать AI (YandexGPT Pro для авто-ответов, fallback на основной провайдер)
    const aiResult = await aiProvider.completeAnalytics({
      system: systemPrompt,
      messages: [{ role: 'user', content: comment }],
      maxTokens: config.max_tokens || 8000,
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

// ═══════════════════════════════════════════════════════════════════════════
// BF2b: МИМИР В ЧАТАХ ПРОСЧЁТОВ — упоминания + чтение документов
// ═══════════════════════════════════════════════════════════════════════════

// Знание о тарифах/формулах — продублировано из mimir-data.buildSystemPrompt(),
// но в сжатой форме для специализированного контекста чата просчёта.
const TARIFF_KNOWLEDGE = `ТАРИФНАЯ СЕТКА ООО «Асгард Сервис» (1 балл = 500₽, утв. 01.10.2025):
- МЛСП: рабочий 14-21 балл (7 000-10 500₽), мастер 16-23 балла (8 000-11 500₽)
- Земля обычные: рабочий 11-14 (5 500-7 000₽), мастер 14-16 (7 000-8 000₽)
- Земля тяжёлые: рабочий 13-16 (6 500-8 000₽), мастер 16-18 (8 000-9 000₽)
- Склад: рабочий 10-12 (5 000-6 000₽), мастер 12-14 (6 000-7 000₽)
- ИТР: 10 000₽/смена ФИКСИРОВАННАЯ (не из сетки). Дни дороги: 3 000₽/чел/день.
- Совмещение: +1 балл к ставке.

ФОРМУЛЫ СЕБЕСТОИМОСТИ:
- Налог на ФОТ: 55%. Накладные: 15%. Расходные: 3%. Непредвиденные: 5%.
- Пропуска и инструктаж: 3 000₽/чел. Суточные/пайковые: по 1 000₽/чел/день.
- СИЗ рабочий 5 000₽, СИЗ ИТР 7 000₽. Страхование 2 000₽/чел.
- Гостиница (Москва): 3 500₽/чел/день. Билет Саратов-Москва: 12 000₽/чел.
- Маршрут: Саратов → Москва (склад) → объект.`;

// Максимум символов содержимого одного документа (защита от OOM)
const DOC_CONTENT_LIMIT = 8000;
// Максимум документов, которые парсятся за один вызов
const MAX_DOCS_TO_PARSE = 6;

/**
 * Прочитать содержимое документа: PDF / DOCX / XLSX / TXT / CSV.
 * Возвращает строку с содержимым (≤ DOC_CONTENT_LIMIT символов) или null.
 */
async function parseDocumentContent(doc) {
  if (!doc || !doc.filename) return null;

  // Безопасный resolve пути в пределах UPLOAD_BASE_DIR
  const trimmed = String(doc.filename).trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  const normalized = path.normalize(trimmed);
  const resolved = path.resolve(
    path.isAbsolute(normalized) ? normalized : path.join(UPLOAD_BASE_DIR, normalized)
  );
  const relative = path.relative(UPLOAD_BASE_DIR, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  if (!fs.existsSync(resolved)) return null;

  const ext = path.extname(doc.original_name || doc.filename || '').toLowerCase();
  // Не пытаемся парсить картинки/архивы/бинарные форматы
  const SUPPORTED = ['.pdf', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.rtf'];
  if (!SUPPORTED.includes(ext)) return null;

  const buffer = fs.readFileSync(resolved);

  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return (data.text || '').substring(0, DOC_CONTENT_LIMIT);
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return (result.value || '').substring(0, DOC_CONTENT_LIMIT);
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let text = '';
      wb.eachSheet((sheet) => {
        if (text.length >= DOC_CONTENT_LIMIT) return;
        text += `\n=== Лист: ${sheet.name} ===\n`;
        sheet.eachRow((row) => {
          if (text.length >= DOC_CONTENT_LIMIT) return;
          const vals = [];
          row.eachCell({ includeEmpty: false }, (cell) => {
            const v = cell.value;
            if (v == null) { vals.push(''); return; }
            if (typeof v === 'object' && v.text) { vals.push(String(v.text)); return; }
            if (typeof v === 'object' && v.result != null) { vals.push(String(v.result)); return; }
            vals.push(String(v));
          });
          text += vals.join(' | ') + '\n';
        });
      });
      return text.substring(0, DOC_CONTENT_LIMIT);
    }
    if (ext === '.txt' || ext === '.csv' || ext === '.rtf') {
      return buffer.toString('utf-8').substring(0, DOC_CONTENT_LIMIT);
    }
  } catch (err) {
    console.warn(`[BF2b] parseDocumentContent failed for ${doc.original_name}: ${err.message}`);
    return null;
  }

  return null;
}

/**
 * Собрать ПОЛНЫЙ контекст просчёта для Мимира:
 *   - estimate (поля карточки)
 *   - calculation (json блоки расчёта последней версии)
 *   - tender (если связан)
 *   - approval-комментарии всех участников
 *   - документы (с распарсенным содержимым) — из tender и estimate
 *
 * Возвращает объект с готовыми текстовыми блоками для подстановки в system prompt.
 */
async function buildEstimateContext(db, estimateId) {
  // Estimate
  const estResult = await db.query('SELECT * FROM estimates WHERE id = $1', [estimateId]);
  const est = estResult.rows[0];

  // Calculation (последняя версия)
  let calc = null;
  try {
    const calcResult = await db.query(
      'SELECT * FROM estimate_calculation_data WHERE estimate_id = $1 ORDER BY version_no DESC LIMIT 1',
      [estimateId]
    );
    calc = calcResult.rows[0] || null;
  } catch (e) { /* ok */ }

  // Tender
  let tender = null;
  if (est?.tender_id) {
    try {
      const tRes = await db.query('SELECT * FROM tenders WHERE id = $1', [est.tender_id]);
      tender = tRes.rows[0] || null;
    } catch (e) { /* ok */ }
  }

  // Approval comments
  let comments = [];
  try {
    const cRes = await db.query(
      `SELECT ac.action, ac.comment, ac.created_at, u.name, u.role
         FROM approval_comments ac JOIN users u ON ac.user_id = u.id
        WHERE ac.entity_type = 'estimates' AND ac.entity_id = $1
        ORDER BY ac.created_at ASC`,
      [estimateId]
    );
    comments = cRes.rows;
  } catch (e) { /* ok */ }

  // Documents (estimate + связанный tender)
  let documents = [];
  try {
    if (est?.tender_id) {
      const dRes = await db.query(
        'SELECT id, original_name, mime_type, size, filename, type, tender_id, estimate_id FROM documents WHERE tender_id = $1 OR estimate_id = $2 ORDER BY created_at DESC LIMIT $3',
        [est.tender_id, estimateId, MAX_DOCS_TO_PARSE]
      );
      documents = dRes.rows;
    } else {
      const dRes = await db.query(
        'SELECT id, original_name, mime_type, size, filename, type FROM documents WHERE estimate_id = $1 ORDER BY created_at DESC LIMIT $2',
        [estimateId, MAX_DOCS_TO_PARSE]
      );
      documents = dRes.rows;
    }
  } catch (e) { /* ok */ }

  // Парсинг документов (последовательно — сильно много не будет)
  let documentsInfo = 'Вложенные документы: нет';
  if (documents.length > 0) {
    const blocks = [`Вложенные документы (${documents.length}):`];
    for (const doc of documents) {
      const sizeKb = Math.round((doc.size || 0) / 1024);
      blocks.push(`- ${doc.original_name || doc.filename} (${doc.mime_type || '?'}, ${sizeKb}KB)`);
      const content = await parseDocumentContent(doc);
      if (content && content.trim()) {
        // Очистим многократные пустые строки
        const cleaned = content.replace(/\n{3,}/g, '\n\n').trim();
        blocks.push(`  Содержимое:\n${cleaned}`);
      }
    }
    documentsInfo = blocks.join('\n');
  }

  // Форматирование блоков
  const fmt = (v) => (v == null || v === '' ? '—' : v);
  const fmtMoney = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('ru-RU')} ₽`);

  const estimateInfo = est
    ? `ПРОСЧЁТ #${est.id}:
Название: ${fmt(est.title || est.object_name)}
Статус согласования: ${fmt(est.approval_status)}
Заказчик: ${fmt(est.customer)}
Объект: ${fmt(est.object_city)}, ${fmt(est.object_distance_km)} км
Тип работ: ${fmt(est.work_type)}
Бригада: ${fmt(est.crew_count)} чел, ${fmt(est.work_days)} раб. дней, ${fmt(est.road_days || 2)} дн. дороги
Наценка: ×${fmt(est.markup_multiplier)}
Версия: v${fmt(est.current_version_no || 1)}`
    : 'Просчёт не найден';

  const personnelStr = calc?.personnel_json
    ? JSON.stringify(calc.personnel_json).substring(0, 2500)
    : '—';
  const currentStr = calc?.current_costs_json
    ? JSON.stringify(calc.current_costs_json).substring(0, 1500)
    : '—';
  const travelStr = calc?.travel_json
    ? JSON.stringify(calc.travel_json).substring(0, 1500)
    : '—';
  const transportStr = calc?.transport_json
    ? JSON.stringify(calc.transport_json).substring(0, 800)
    : '—';
  const chemistryStr = calc?.chemistry_json
    ? JSON.stringify(calc.chemistry_json).substring(0, 1500)
    : '—';

  const calculationInfo = calc
    ? `РАСЧЁТ (v${calc.version_no}):
Себестоимость: ${fmtMoney(calc.total_cost)}
Клиенту: ${fmtMoney(calc.total_with_margin)}
Маржа: ${fmt(calc.margin_pct)}%
Непредвиденные: ${fmt(calc.contingency_pct)}%
Персонал: ${personnelStr}
Текущие: ${currentStr}
Командировочные: ${travelStr}
Транспорт: ${transportStr}
Химия/материалы: ${chemistryStr}`
    : 'Расчёт пока не создан';

  const tenderInfo = tender
    ? `ТЕНДЕР #${tender.id}:
Название: ${fmt(tender.tender_title)}
Заказчик: ${fmt(tender.customer_name)}
Объект: ${fmt(tender.object_name)}
Сумма: ${fmtMoney(tender.amount)}
Статус: ${fmt(tender.tender_status)}
Дедлайн: ${fmt(tender.deadline)}`
    : '';

  const commentsInfo = comments.length > 0
    ? `КОММЕНТАРИИ СОГЛАСОВАНИЯ (${comments.length}):\n` +
      comments.map(c => `- ${c.name} (${c.role}, ${c.action}): ${c.comment}`).join('\n')
    : '';

  return { estimate: est, calc, tender, estimateInfo, calculationInfo, tenderInfo, documentsInfo, commentsInfo };
}

/**
 * Мимир отвечает на упоминание (@Мимир) в чате просчёта.
 *
 * Pipeline:
 *   1. Найти mimir_bot user
 *   2. Послать typing-индикатор всем участникам
 *   3. Собрать полный контекст просчёта (estimate + calc + tender + комментарии + документы)
 *   4. Загрузить ВСЮ историю чата (271К контекста позволяет)
 *   5. Сформировать system prompt с тарифами и правилами
 *   6. Вызвать AI (completeAnalytics → YandexGPT Pro)
 *   7. Сохранить ответ в chat_messages с типом 'mimir_response'
 *   8. Разослать SSE chat:new_message всем участникам
 *   9. Залогировать в mimir_auto_log (scenario='chat_response')
 *
 * Вызывается fire-and-forget из POST /:id/messages.
 */
async function mimirRespondToQuestion(db, { chatId, estimateId, question, askerName, askerId }) {
  try {
    const aiProvider = require('./ai-provider');

    // 1. mimir_bot user
    const botResult = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
    const botUserId = botResult.rows[0]?.id;
    if (!botUserId) {
      console.warn('[BF2b] mimir_bot user not found');
      return null;
    }

    // 2. Список участников чата (для typing и SSE)
    const membersResult = await db.query(
      'SELECT user_id FROM chat_group_members WHERE chat_id = $1', [chatId]
    );
    const members = membersResult.rows;

    // 2a. Typing indicator от Мимира
    for (const m of members) {
      sendToUser(m.user_id, 'chat:typing', {
        chat_id: chatId,
        user_id: botUserId,
        user_name: 'Мимир'
      });
    }

    // 3. Полный контекст просчёта
    const ctx = await buildEstimateContext(db, estimateId);

    // 4. Вся история чата (исключая pinned-карточку и системные)
    const historyResult = await db.query(
      `SELECT cm.id, cm.user_id, cm.message, cm.message_type, cm.created_at,
              u.name AS user_name, u.role AS user_role
         FROM chat_messages cm
         JOIN users u ON cm.user_id = u.id
        WHERE cm.chat_id = $1
          AND cm.deleted_at IS NULL
          AND cm.message_type NOT IN ('estimate_card','estimate_update')
        ORDER BY cm.created_at ASC`,
      [chatId]
    );
    const history = historyResult.rows;
    const historyText = history.length > 0
      ? history.map(m => `${m.user_name} (${m.user_role}): ${m.message}`).join('\n')
      : '(пусто)';

    // 5. System prompt
    const systemPrompt = `Ты Мимир — ИИ-ассистент в чате обсуждения просчёта ООО «Асгард Сервис».
Тебя упомянул ${askerName}. Ответ увидят все участники чата (РП, директоры, ТО).

${ctx.estimateInfo}

${ctx.calculationInfo}

${ctx.tenderInfo}

${ctx.commentsInfo}

${ctx.documentsInfo}

${TARIFF_KNOWLEDGE}

ИСТОРИЯ ЧАТА:
${historyText}

ПРАВИЛА:
- Отвечай на вопрос ${askerName} по существу, опираясь на данные просчёта, тендера и документы выше
- Если вопрос про цифры — считай по формулам (ФОТ × 1.55, накладные 15%, расходные 3%)
- На простой вопрос — 2-4 предложения. На сложный (расчёт/анализ) — подробно с цифрами
- Если данных недостаточно — прямо скажи каких именно
- Не выдумывай данные. Если в документах нет — так и скажи
- Числа форматируй с разделителями: 1 234 567 ₽
- Markdown: **жирный** для ключевых цифр, списки (-), без ### заголовков
- НЕ пиши "Что повелеваешь?", "Что ещё могу сделать?", "Обращайтесь!" — просто ответь и остановись
- Будь профессионален — твой ответ видят директоры`;

    // 6. AI call (completeAnalytics → YandexGPT Pro, не зависит от баланса routerai.ru)
    const startTime = Date.now();
    const aiResult = await aiProvider.completeAnalytics({
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
      maxTokens: 2000,
      temperature: 0.3
    });
    const responseText = aiResult.text || 'Не удалось сформировать ответ. Попробуй позже.';
    const durationMs = Date.now() - startTime;

    // 7. Сохранить ответ
    const msgMetadata = {
      trigger: 'mention',
      asker_id: askerId,
      asker: askerName,
      question: question.substring(0, 500),
      tokens_input: aiResult.usage?.inputTokens || 0,
      tokens_output: aiResult.usage?.outputTokens || 0,
      duration_ms: durationMs
    };
    const { rows: [mimirMsg] } = await db.query(`
      INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
      VALUES ($1, $2, $3, 'mimir_response', $4, false, NOW()) RETURNING *
    `, [chatId, botUserId, responseText, JSON.stringify(msgMetadata)]);

    await db.query(
      'UPDATE chats SET message_count = COALESCE(message_count,0)+1, last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [chatId]
    );

    // 8. SSE рассылка
    for (const m of members) {
      sendToUser(m.user_id, 'chat:new_message', {
        chat_id: chatId,
        message: { ...mimirMsg, user_name: 'Мимир', is_mimir_bot: true }
      });
    }

    // 9. Лог в mimir_auto_log
    try {
      await db.query(`
        INSERT INTO mimir_auto_log (chat_id, estimate_id, trigger_action, trigger_comment, response,
                                    tokens_input, tokens_output, duration_ms, scenario)
        VALUES ($1, $2, 'mention', $3, $4, $5, $6, $7, 'chat_response')
      `, [
        chatId, estimateId, question.substring(0, 1000), responseText,
        aiResult.usage?.inputTokens || 0, aiResult.usage?.outputTokens || 0, durationMs
      ]);
    } catch (e) { /* лог не критичен */ }

    console.log(`[BF2b] Mimir responded to mention: chat_id=${chatId}, estimate_id=${estimateId}, ${durationMs}ms`);
    return { messageId: mimirMsg.id, durationMs };

  } catch (err) {
    console.error('[BF2b] mimirRespondToQuestion error:', err.message);
    console.error(err.stack);
    return null;
  }
}

module.exports = {
  createEstimateChat,
  updateEstimateCard,
  syncCommentToChat,
  triggerMimirAutoRespond,
  // BF2b
  detectMimirMention,
  parseDocumentContent,
  buildEstimateContext,
  mimirRespondToQuestion
};
