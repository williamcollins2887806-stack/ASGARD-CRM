'use strict';

/**
 * ASGARD CRM — Сервис интеграции просчётов с Хугинн (H1)
 *
 * Создание чата при отправке просчёта на согласование,
 * обновление pinned-карточки при resubmit.
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

module.exports = {
  createEstimateChat,
  updateEstimateCard
};
