'use strict';

/**
 * ASGARD CRM — Сервис создания чата при закрытии работы (closeout).
 * Паттерн из estimateChat.js.
 */

const { sendToUser } = require('../routes/sse');

/**
 * Создать чат при закрытии работы (closeout).
 * Если чат уже существует — ничего не делает.
 */
async function createCloseoutChat(db, workId, actor) {
  // 1. Проверить что чат ещё не существует
  const existing = await db.query(
    "SELECT id FROM chats WHERE entity_type = 'work' AND entity_id = $1", [workId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // 2. Получить work
  const workResult = await db.query('SELECT * FROM works WHERE id = $1', [workId]);
  const work = workResult.rows[0];
  if (!work) return null;

  // 3. Собрать участников: PM + директоры + mimir_bot
  const pmId = work.pm_id || actor.id;
  const participantIds = new Set([pmId]);

  const directors = await db.query(
    "SELECT id FROM users WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true"
  );
  for (const d of directors.rows) participantIds.add(d.id);

  const mimirBot = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
  const mimirBotId = mimirBot.rows[0]?.id;
  if (mimirBotId) participantIds.add(mimirBotId);

  // 4. Создать чат
  const chatName = `📋 Работа #${workId} — ${work.work_title || work.customer_name || 'Без названия'}`;
  const { rows: [chat] } = await db.query(`
    INSERT INTO chats (name, type, is_group, entity_type, entity_id, auto_created, created_at, updated_at)
    VALUES ($1, 'group', true, 'work', $2, true, NOW(), NOW())
    RETURNING *
  `, [chatName, workId]);

  // 5. Добавить участников
  const memberArr = [...participantIds];
  for (const uid of memberArr) {
    const role = uid === pmId ? 'owner' : 'member';
    await db.query(
      'INSERT INTO chat_group_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
      [chat.id, uid, role]
    );
  }

  // 6. PM name for card
  let pmName = null;
  try {
    const pRes = await db.query('SELECT name FROM users WHERE id = $1', [pmId]);
    pmName = pRes.rows[0]?.name || null;
  } catch (e) { /* ok */ }

  // 7. Pinned work_card
  const profit = (parseFloat(work.contract_value) || 0) - (parseFloat(work.cost_fact) || 0);
  const margin = (parseFloat(work.contract_value) || 0) > 0
    ? Math.round(profit / (parseFloat(work.contract_value) || 1) * 1000) / 10
    : 0;

  const cardMetadata = {
    work_id: workId,
    status: 'closed',
    title: work.work_title || work.customer_name || 'Без названия',
    customer_name: work.customer_name || null,
    customer_inn: work.customer_inn || null,
    city: work.city || null,
    object_name: work.object_name || null,
    pm_name: pmName,
    contract_value: parseFloat(work.contract_value) || 0,
    cost_fact: parseFloat(work.cost_fact) || 0,
    profit: Math.round(profit),
    margin: margin
  };

  const { rows: [cardMsg] } = await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, metadata, is_system, created_at)
    VALUES ($1, $2, $3, 'work_card', $4, false, NOW()) RETURNING *
  `, [chat.id, pmId, `📋 Работа #${workId}`, JSON.stringify(cardMetadata)]);

  await db.query(
    'INSERT INTO pinned_messages (chat_id, message_id, pinned_by, pinned_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
    [chat.id, cardMsg.id, pmId]
  );

  // 8. Системное сообщение
  const actorName = actor.name || 'РП';
  await db.query(`
    INSERT INTO chat_messages (chat_id, user_id, message, message_type, is_system, created_at)
    VALUES ($1, $2, $3, 'system', true, NOW())
  `, [chat.id, pmId, `${actorName} закрыл контракт. Прибыль: ${Math.round(profit).toLocaleString('ru-RU')} ₽`]);

  await db.query('UPDATE chats SET message_count = 2, last_message_at = NOW() WHERE id = $1', [chat.id]);

  // 9. SSE
  for (const uid of memberArr) {
    if (uid !== pmId) {
      sendToUser(uid, 'chat:new_chat', { chat_id: chat.id, chat_name: chatName, entity_type: 'work', entity_id: workId });
    }
  }

  console.log(`[WorkChat] Closeout chat created: chat_id=${chat.id}, work_id=${workId}, members=${memberArr.length}`);
  return chat;
}

module.exports = { createCloseoutChat };
