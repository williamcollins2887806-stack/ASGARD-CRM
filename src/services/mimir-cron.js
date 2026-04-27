/**
 * Mimir Cron — Автоматические сводки 3 раза в день
 * 09:00 — утренняя: задачи, дедлайны, заявки
 * 13:30 — дневная: не сделано, просрочено, акты
 * 17:30 — вечерняя: итог дня, что осталось, мотивация
 */

'use strict';

const cron = require('node-cron');
const db = require('./db');

let aiProvider;
try {
  aiProvider = require('./ai-provider');
} catch (e) {
  console.warn('[MimirCron] AI provider not available:', e.message);
}

// Bot user_id for Mimir messages
const MIMIR_BOT_USER_ID = 0;

// ═══════════════════════════════════════════════════════════════════════════
// DATA COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

async function getUserData(userId, timeSlot) {
  const data = {};

  try {
    // Tasks assigned to user
    const tasks = await db.query(
      `SELECT id, title, deadline, priority, status FROM tasks
       WHERE assignee_id = $1 AND status NOT IN ('done', 'cancelled')
       ORDER BY CASE WHEN deadline IS NOT NULL THEN 0 ELSE 1 END, deadline ASC
       LIMIT 10`,
      [userId]
    );
    data.tasks = tasks.rows;
    data.tasksOverdue = tasks.rows.filter(t =>
      t.deadline && new Date(t.deadline) < new Date()
    ).length;

    // Active tenders with deadlines
    const tenders = await db.query(
      `SELECT id, tender_title AS title, tender_status, deadline FROM tenders
       WHERE (pm_id = $1 OR responsible_pm_id = $1)
         AND tender_status IN ('active', 'preparation', 'in_progress')
       ORDER BY deadline ASC NULLS LAST
       LIMIT 5`,
      [userId]
    );
    data.tenders = tenders.rows;

    // Acts pending signature
    const acts = await db.query(
      `SELECT id, act_number, status, amount FROM acts
       WHERE (created_by = $1)
         AND status IN ('draft', 'pending')
       LIMIT 5`,
      [userId]
    );
    data.acts = acts.rows;

    // Pass requests (for office managers)
    const passReqs = await db.query(
      `SELECT id, status FROM pass_requests
       WHERE status = 'new'
       LIMIT 5`
    );
    data.newPassRequests = passReqs.rows.length;

    // Completed today (for evening summary)
    if (timeSlot === 'evening') {
      const completed = await db.query(
        `SELECT COUNT(*) as cnt FROM tasks
         WHERE assignee_id = $1 AND status = 'done'
           AND completed_at >= CURRENT_DATE`,
        [userId]
      );
      data.completedToday = parseInt(completed.rows[0]?.cnt || 0);
    }
  } catch (e) {
    console.error('[MimirCron] getUserData error for user', userId, ':', e.message);
  }

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI SUMMARY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function buildPrompt(userName, timeSlot, data) {
  const slotDescriptions = {
    morning: 'утренняя сводка на начало рабочего дня',
    afternoon: 'дневное напоминание о ходе дня',
    evening: 'вечерний итог рабочего дня'
  };

  let dataSection = '';

  if (data.tasks && data.tasks.length > 0) {
    dataSection += '\nЗадачи (' + data.tasks.length + '):\n';
    data.tasks.slice(0, 3).forEach(t => {
      const dl = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : 'без срока';
      dataSection += '- ' + t.title + ' [' + t.status + ', ' + dl + ']\n';
    });
    if (data.tasksOverdue > 0) {
      dataSection += 'Просрочено задач: ' + data.tasksOverdue + '\n';
    }
  } else {
    dataSection += '\nЗадачи: нет активных\n';
  }

  if (data.tenders && data.tenders.length > 0) {
    dataSection += '\nТендеры (' + data.tenders.length + '):\n';
    data.tenders.slice(0, 2).forEach(t => {
      const dl = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : 'без дедлайна';
      dataSection += '- ' + (t.title || 'Тендер #' + t.id) + ' [' + dl + ']\n';
    });
  }

  if (data.acts && data.acts.length > 0) {
    dataSection += '\nАкты на подписи: ' + data.acts.length + '\n';
  }

  if (data.newPassRequests > 0) {
    dataSection += '\nНовых заявок на пропуск: ' + data.newPassRequests + '\n';
  }

  if (timeSlot === 'evening' && data.completedToday !== undefined) {
    dataSection += '\nЗакрыто сегодня задач: ' + data.completedToday + '\n';
  }

  return {
    system: 'Ты — Мимир, AI-помощник CRM «АСГАРД». Сделай краткую сводку (3-5 предложений) для сотрудника.\n' +
      'Это ' + slotDescriptions[timeSlot] + '.\n' +
      'Стиль: нордический, мотивирующий. Обращайся "Воин" или по имени (' + userName + '). Используй ⚔️🛡️⚡💪🔥.\n' +
      'Примеры тональности:\n' +
      '- "Воин, доброе утро! Один видит твои усилия."\n' +
      '- "' + userName + ', время — деньги! Поторопись с..."\n' +
      '- "Если нужна помощь — я всегда здесь. Skál!"\n' +
      '- "Вальхалла ждёт тех, кто не ленится."\n' +
      'НЕ перечисляй все задачи — только самые важные (2-3).\n' +
      'Если всё сделано — похвали.',
    messages: [
      { role: 'user', content: 'Данные сотрудника:\n' + dataSection + '\nСделай сводку.' }
    ]
  };
}

async function generateSummary(userName, timeSlot, data) {
  if (!aiProvider) {
    // Fallback without AI
    const fallbacks = {
      morning: '⚡ Доброе утро, ' + userName + '! Новый день — новые победы. У тебя ' + (data.tasks?.length || 0) + ' активных задач. Вперёд, воин! Skál! 🛡️',
      afternoon: '⚔️ ' + userName + ', полдень! ' + (data.tasksOverdue > 0 ? 'Есть ' + data.tasksOverdue + ' просроченных задач — время действовать!' : 'Дела идут по плану.') + ' 💪',
      evening: '🔥 ' + userName + ', день подходит к концу. ' + (data.completedToday > 0 ? 'Закрыто ' + data.completedToday + ' задач — отличная работа!' : 'Завтра будет продуктивнее!') + ' Один гордится тобой. Skál! ⚡'
    };
    return fallbacks[timeSlot];
  }

  try {
    const prompt = buildPrompt(userName, timeSlot, data);
    const result = await aiProvider.complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 300,
      temperature: 0.7
    });
    return result.text || result;
  } catch (e) {
    console.error('[MimirCron] AI generation error:', e.message);
    return '⚡ ' + userName + ', Мимир временно в раздумьях, но помни — ты воин АСГАРД! Задач: ' + (data.tasks?.length || 0) + '. Вперёд! 🛡️';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND DIGEST TO MIMIR CHAT
// ═══════════════════════════════════════════════════════════════════════════

async function sendDigestToUser(userId, text) {
  try {
    // Find or create Mimir chat for this user
    let chatResult = await db.query(
      `SELECT c.id FROM chats c
       JOIN chat_group_members m ON m.chat_id = c.id AND m.user_id = $1
       WHERE c.is_mimir = true
       LIMIT 1`,
      [userId]
    );

    let chatId;

    if (chatResult.rows.length === 0) {
      // Create Mimir chat for user
      const newChat = await db.query(
        `INSERT INTO chats (type, name, is_mimir, is_group, created_at, updated_at)
         VALUES ('direct', 'Мимир', true, false, NOW(), NOW())
         RETURNING id`,
      );
      chatId = newChat.rows[0].id;

      // Add user as member
      await db.query(
        `INSERT INTO chat_group_members (chat_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT DO NOTHING`,
        [chatId, userId]
      );
    } else {
      chatId = chatResult.rows[0].id;
    }

    // Insert message from Mimir bot
    await db.query(
      `INSERT INTO chat_messages (chat_id, user_id, message, message_type, created_at)
       VALUES ($1, $2, $3, 'text', NOW())`,
      [chatId, MIMIR_BOT_USER_ID, text]
    );

    // Update chat last_message_at and message_count
    await db.query(
      `UPDATE chats SET last_message_at = NOW(), message_count = COALESCE(message_count, 0) + 1, updated_at = NOW()
       WHERE id = $1`,
      [chatId]
    );

    return true;
  } catch (e) {
    console.error('[MimirCron] sendDigestToUser error for user', userId, ':', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON JOB RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runDigest(timeSlot) {
  console.log('[MimirCron] Starting', timeSlot, 'digest at', new Date().toISOString());

  try {
    // Get all active users
    const users = await db.query(
      `SELECT id, name, login, role FROM users WHERE is_active = true`
    );

    let sent = 0;
    let errors = 0;

    for (const user of users.rows) {
      try {
        const userName = user.name || user.login || 'Воин';
        const data = await getUserData(user.id, timeSlot);
        const summary = await generateSummary(userName, timeSlot, data);

        const ok = await sendDigestToUser(user.id, summary);
        if (ok) sent++;
        else errors++;

        // Small delay to avoid overwhelming AI API
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error('[MimirCron] Error for user', user.id, ':', e.message);
        errors++;
      }
    }

    console.log('[MimirCron]', timeSlot, 'digest complete: sent=' + sent + ', errors=' + errors);
  } catch (e) {
    console.error('[MimirCron] runDigest error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// START / STOP
// ═══════════════════════════════════════════════════════════════════════════

let _tasks = [];

function start() {
  // 09:00 Moscow time (UTC+3) — утренняя сводка
  _tasks.push(cron.schedule('0 9 * * 1-5', () => runDigest('morning'), {
    timezone: 'Europe/Moscow'
  }));

  // 13:30 — дневное напоминание
  _tasks.push(cron.schedule('30 13 * * 1-5', () => runDigest('afternoon'), {
    timezone: 'Europe/Moscow'
  }));

  // 17:30 — вечерний итог
  _tasks.push(cron.schedule('30 17 * * 1-5', () => runDigest('evening'), {
    timezone: 'Europe/Moscow'
  }));

  console.log('[MimirCron] Started — 3 daily digests (09:00, 13:30, 17:30 MSK, Mon-Fri)');
}

function stop() {
  _tasks.forEach(t => t.stop());
  _tasks = [];
  console.log('[MimirCron] Stopped');
}

module.exports = { start, stop, runDigest };
