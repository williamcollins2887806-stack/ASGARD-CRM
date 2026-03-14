/**
 * Telegram Bot Service v2.0
 * ═══════════════════════════════════════════════════════════════
 * Полная переработка: универсальные согласования, двухшаговые диалоги,
 * чистая кириллица, интеграция с approvalService.
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const approvalService = require('./approvalService');

let bot = null;

// Состояние диалогов (chatId → ожидаемый ввод)
const pendingInput = new Map();

// ─────────────────────────────────────────────────────────────────
// Initialize Bot
// ─────────────────────────────────────────────────────────────────
async function init() {
  let token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    try {
      const result = await db.query("SELECT value_json FROM settings WHERE key = 'telegram'");
      if (result.rows[0]?.value_json) {
        let parsed = JSON.parse(result.rows[0].value_json);
        const settings = parsed.value_json ? JSON.parse(parsed.value_json) : parsed;
        if (settings.bot_token && settings.enabled !== false) {
          token = settings.bot_token;
          console.log('[Telegram] Token loaded from DB');
        }
      }
    } catch (e) { /* no telegram settings */ }
  }

  if (!token) {
    console.warn('[Telegram] No token, bot disabled');
    return;
  }

  bot = new TelegramBot(token, { polling: false });
  bot.on('polling_error', (err) => {
    console.error('[Telegram] Polling error:', err.code, err.message);
  });

  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `
🏰 *Добро пожаловать в ASGARD CRM Bot!*

Я помогу вам:
• Получать уведомления о задачах
• Согласовывать заявки прямо из Telegram
• Быстро связаться с системой

*Команды:*
/link email@example.com — привязать аккаунт
/status — статус системы
/my — мои задачи
/help — справка
    `, { parse_mode: 'Markdown' });
  });

  // /link
  bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1].trim().toLowerCase();
    try {
      const result = await db.query(
        'SELECT id, name FROM users WHERE LOWER(email) = $1 OR LOWER(login) = $1',
        [email]
      );
      if (!result.rows.length) {
        return bot.sendMessage(chatId, '❌ Пользователь не найден.');
      }
      const user = result.rows[0];
      await db.query('UPDATE users SET telegram_chat_id = $1, updated_at = NOW() WHERE id = $2',
        [chatId.toString(), user.id]);
      await bot.sendMessage(chatId, `✅ *Аккаунт привязан!*\nПользователь: ${user.name}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[Telegram] Link error:', err);
      await bot.sendMessage(chatId, '❌ Ошибка привязки.');
    }
  });

  // /status
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const [tenders, works] = await Promise.all([
        db.query('SELECT COUNT(*) FROM tenders'),
        db.query('SELECT COUNT(*) FROM works')
      ]);
      await bot.sendMessage(chatId, `
📊 *ASGARD CRM*
🏷 Тендеров: ${tenders.rows[0].count}
📋 Работ: ${works.rows[0].count}
✅ Система работает
      `, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Ошибка');
    }
  });

  // /my
  bot.onText(/\/my/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const userResult = await db.query(
        'SELECT id, name, role FROM users WHERE telegram_chat_id = $1', [chatId.toString()]
      );
      if (!userResult.rows.length) {
        return bot.sendMessage(chatId, '❌ Аккаунт не привязан. /link email');
      }
      const user = userResult.rows[0];
      const tasks = await db.query(`
        SELECT t.id, t.customer, t.tender_status, t.deadline
        FROM tenders t WHERE t.responsible_pm_id = $1
        AND t.tender_status NOT IN ('Выиграли', 'Проиграли')
        ORDER BY t.deadline ASC NULLS LAST LIMIT 5
      `, [user.id]);
      if (!tasks.rows.length) {
        return bot.sendMessage(chatId, `👤 ${user.name}\n\n✨ Активных задач нет`);
      }
      let msg2 = `👤 *${user.name}*\n\n📋 *Активные тендеры:*\n\n`;
      tasks.rows.forEach((t, i) => {
        const dl = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : 'не указан';
        msg2 += `${i + 1}. ${t.customer || '—'}\n   📌 ${t.tender_status || 'Новый'} | ⏰ ${dl}\n\n`;
      });
      await bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown' });
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Ошибка');
    }
  });

  // /help
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, `
📚 *Команды:*
/start — начало
/link email — привязать аккаунт
/status — статус системы
/my — мои задачи
/help — справка

💡 Согласования приходят автоматически с кнопками действий.
    `, { parse_mode: 'Markdown' });
  });

  // Обработка текстовых ответов (двухшаговый диалог)
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Команды обрабатываются выше
    const chatId = msg.chat.id;
    const pending = pendingInput.get(chatId);
    if (!pending) return;

    pendingInput.delete(chatId);
    const comment = msg.text?.trim();
    if (!comment) {
      return bot.sendMessage(chatId, '❌ Комментарий не может быть пустым. Попробуйте ещё раз.');
    }

    try {
      const user = await getUserByChatId(chatId);
      if (!user) return bot.sendMessage(chatId, '❌ Аккаунт не привязан');

      const { action, entityType, entityId, messageId } = pending;

      let result;
      if (action === 'question') {
        result = await approvalService.askQuestion(db, {
          entityType, entityId, actor: user, comment
        });
      } else if (action === 'rework') {
        result = await approvalService.requestRework(db, {
          entityType, entityId, actor: user, comment
        });
      } else if (action === 'reject') {
        result = await approvalService.directorReject(db, {
          entityType, entityId, actor: user, comment
        });
      } else if (action === 'issue_cash') {
        const amount = parseFloat(comment.replace(/[^\d.,]/g, '').replace(',', '.'));
        if (!amount || amount <= 0) {
          return bot.sendMessage(chatId, '❌ Введите корректную сумму (число больше 0).');
        }
        result = await approvalService.issueCash(db, {
          entityType, entityId, actor: user, amount, comment: `Выдано ${amount} ₽ через Telegram`
        });
      }

      const actionLabel = action === 'question' ? '❓ Вопрос отправлен'
        : action === 'rework' ? '🔄 Возвращено на доработку'
        : action === 'reject' ? '❌ Отклонено'
        : action === 'issue_cash' ? `💵 Выдано ${comment} ₽ из кассы`
        : '✅ Выполнено';

      await bot.sendMessage(chatId, `${actionLabel}\n\nВаш комментарий: ${comment}`);

      // Убираем кнопки с оригинального сообщения
      if (messageId) {
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId, message_id: messageId
          });
        } catch (e) { /* message too old */ }
      }
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    }
  });

  // Callback-кнопки
  initCallbackHandler();

  await bot.startPolling({ restart: false });
  console.log('[Telegram] Bot started (v2.0 universal approvals)');
}

// ─────────────────────────────────────────────────────────────────
// Send Notification (простое текстовое сообщение)
// ─────────────────────────────────────────────────────────────────
async function sendNotification(userId, message, options = {}) {
  if (!bot) { try { await init(); } catch (e) { /* */ } }
  if (!bot) return false;
  try {
    const result = await db.query('SELECT telegram_chat_id FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]?.telegram_chat_id) return false;
    await bot.sendMessage(result.rows[0].telegram_chat_id, message, { parse_mode: 'Markdown', ...options });
    return true;
  } catch (err) {
    if (err?.response?.body?.error_code !== 400) {
      console.error('[Telegram] sendNotification error:', err.message);
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Send Approval Request (с кнопками действий)
// ─────────────────────────────────────────────────────────────────
async function sendApprovalRequest(userId, message, approvalData) {
  if (!bot) { try { await init(); } catch (e) { /* */ } }
  if (!bot) return false;

  try {
    const result = await db.query('SELECT telegram_chat_id FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]?.telegram_chat_id) return false;

    const chatId = result.rows[0].telegram_chat_id;
    const type = approvalData.type;
    const itemId = approvalData.id;
    const stage = approvalData.stage || 'director';
    const requiresPayment = Boolean(approvalData.requires_payment);

    let buttons;

    if (stage === 'accounting' || stage === 'buh') {
      // Кнопки для бухгалтерии
      buttons = [
        [
          { text: '💳 Оплатить ПП', callback_data: `ap_paybank_${type}_${itemId}` },
          { text: '💵 Выдать наличные', callback_data: `ap_cash_${type}_${itemId}` }
        ],
        [
          { text: '🔄 На доработку', callback_data: `ap_rework_${type}_${itemId}` },
          { text: '❓ Вопрос', callback_data: `ap_question_${type}_${itemId}` }
        ]
      ];
    } else if (type === 'estimate') {
      // Просчёт — без бухгалтерии
      buttons = [
        [
          { text: '✅ Согласовать', callback_data: `ap_approve_${type}_${itemId}` },
          { text: '🔄 Доработка', callback_data: `ap_rework_${type}_${itemId}` }
        ],
        [
          { text: '❓ Вопрос', callback_data: `ap_question_${type}_${itemId}` },
          { text: '❌ Отклонить', callback_data: `ap_reject_${type}_${itemId}` }
        ]
      ];
    } else {
      // Стандартные кнопки директора (с учётом requires_payment)
      const approveLabel = requiresPayment ? '✅ Согласовать → бухгалтерия' : '✅ Согласовать';
      buttons = [
        [
          { text: approveLabel, callback_data: `ap_approve_${type}_${itemId}` },
          { text: '🔄 Доработка', callback_data: `ap_rework_${type}_${itemId}` }
        ],
        [
          { text: '❓ Вопрос', callback_data: `ap_question_${type}_${itemId}` },
          { text: '❌ Отклонить', callback_data: `ap_reject_${type}_${itemId}` }
        ]
      ];
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });

    return true;
  } catch (err) {
    if (err?.response?.body?.error_code !== 400) {
      console.error('[Telegram] sendApprovalRequest error:', err.message);
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Callback Handler (кнопки в сообщениях)
// ─────────────────────────────────────────────────────────────────
function initCallbackHandler() {
  if (!bot) return;

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
      // Формат: ap_ACTION_TYPE_ID
      const parts = data.split('_');
      if (parts[0] !== 'ap' || parts.length < 4) {
        // Legacy format support: approve_TYPE_ID / reject_TYPE_ID
        return handleLegacyCallback(query);
      }

      const action = parts[1];
      const entityType = parts[2];
      const itemId = parseInt(parts[3], 10);

      if (isNaN(itemId)) {
        return bot.answerCallbackQuery(query.id, { text: 'Ошибка: некорректный ID' });
      }

      const user = await getUserByChatId(chatId);
      if (!user) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Аккаунт не привязан' });
      }

      // Маппинг entityType из Telegram callback → имя таблицы
      const tableMap = {
        'estimate': 'estimates',
        'estimates': 'estimates',
        'pre_tender': 'pre_tender_requests',
        'pretender': 'pre_tender_requests',
        'bonus': 'bonus_requests',
        'cash': 'cash_requests',
        'work_expense': 'work_expenses',
        'office_expense': 'office_expenses',
        'expense': 'expenses',
        'one_time': 'one_time_payments',
        'tmc': 'tmc_requests',
        'payroll': 'payroll_sheets',
        'trip': 'business_trips',
        'travel': 'travel_expenses',
        'training': 'training_applications',
        'staff': 'staff_requests'
      };

      const tableName = tableMap[entityType] || entityType;
      let resultText = '';

      switch (action) {
        case 'approve': {
          const result = await approvalService.directorApprove(db, {
            entityType: tableName, entityId: itemId, actor: user
          });
          resultText = result.payment_status
            ? '✅ Согласовано, передано в бухгалтерию'
            : '✅ Согласовано';
          break;
        }

        case 'rework': {
          // Двухшаговый диалог — запрашиваем комментарий
          pendingInput.set(chatId, {
            action: 'rework', entityType: tableName, entityId: itemId, messageId
          });
          await bot.answerCallbackQuery(query.id, { text: 'Напишите комментарий...' });
          await bot.sendMessage(chatId,
            '🔄 *На доработку*\n\nНапишите комментарий (что нужно исправить):',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        case 'question': {
          pendingInput.set(chatId, {
            action: 'question', entityType: tableName, entityId: itemId, messageId
          });
          await bot.answerCallbackQuery(query.id, { text: 'Напишите вопрос...' });
          await bot.sendMessage(chatId,
            '❓ *Вопрос*\n\nВведите ваш вопрос:',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        case 'reject': {
          pendingInput.set(chatId, {
            action: 'reject', entityType: tableName, entityId: itemId, messageId
          });
          await bot.answerCallbackQuery(query.id, { text: 'Укажите причину...' });
          await bot.sendMessage(chatId,
            '❌ *Отклонение*\n\nУкажите причину отклонения:',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        case 'paybank': {
          const result = await approvalService.payByBankTransfer(db, {
            entityType: tableName, entityId: itemId, actor: user, comment: 'Оплачено через Telegram'
          });
          resultText = '💳 Оплачено через ПП';
          break;
        }

        case 'cash': {
          // Показываем баланс кассы и просим ввести сумму
          const balance = await approvalService.getCashBalance(db);
          pendingInput.set(chatId, {
            action: 'issue_cash', entityType: tableName, entityId: itemId, messageId
          });
          await bot.answerCallbackQuery(query.id, { text: 'Введите сумму...' });
          await bot.sendMessage(chatId,
            `💵 *Выдача наличных*\n\n💰 Баланс кассы: *${balance.toLocaleString('ru-RU')} ₽*\n\nВведите сумму для выдачи:`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        default:
          return bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие' });
      }

      // Ответ и обновление сообщения
      await bot.answerCallbackQuery(query.id, { text: resultText });
      try {
        const updatedText = query.message.text + '\n\n' + resultText + '\n👤 ' + user.name;
        await bot.editMessageText(updatedText, {
          chat_id: chatId, message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] }
        });
      } catch (e) { /* message too old */ }

    } catch (err) {
      console.error('[Telegram] Callback error:', err.message);
      try {
        await bot.answerCallbackQuery(query.id, { text: '❌ ' + (err.message || 'Ошибка').substring(0, 100) });
      } catch (_) {}
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Legacy callback support (approve_TYPE_ID / reject_TYPE_ID)
// ─────────────────────────────────────────────────────────────────
async function handleLegacyCallback(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const parts = data.split('_');

  try {
    const user = await getUserByChatId(chatId);
    if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Аккаунт не привязан' });

    let action, type, itemId;

    // Legacy: wf_estimate_approve_to_accounting_123
    if (parts[0] === 'wf') {
      type = parts[1];
      itemId = parseInt(parts[parts.length - 1], 10);
      const rawAction = parts.slice(2, -1).join('_');
      // Map old actions to new
      if (rawAction.includes('approve') || rawAction.includes('accept')) action = 'approve';
      else if (rawAction.includes('rework')) action = 'rework';
      else if (rawAction.includes('question')) action = 'question';
      else if (rawAction.includes('reject')) action = 'reject';
      else action = rawAction;
    } else {
      // Legacy: approve_pre_tender_123
      action = parts[0];
      type = parts.slice(1, -1).join('_');
      itemId = parseInt(parts[parts.length - 1], 10);
    }

    if (isNaN(itemId)) return bot.answerCallbackQuery(query.id, { text: 'Ошибка формата' });

    const tableMap = {
      'estimate': 'estimates', 'pre_tender': 'pre_tender_requests',
      'pretender': 'pre_tender_requests', 'bonus': 'bonus_requests'
    };
    const tableName = tableMap[type] || type;

    let resultText;
    if (action === 'approve') {
      await approvalService.directorApprove(db, { entityType: tableName, entityId: itemId, actor: user });
      resultText = '✅ Согласовано';
    } else if (action === 'reject') {
      // Legacy reject без комментария
      try {
        await approvalService.directorReject(db, { entityType: tableName, entityId: itemId, actor: user, comment: 'Отклонено через Telegram' });
      } catch (e) {
        // Fallback для pre_tender (прямой UPDATE)
        await db.query(
          "UPDATE pre_tender_requests SET status = 'in_review', decision_by = $1, decision_at = NOW(), decision_comment = 'Отклонено через Telegram', updated_at = NOW() WHERE id = $2",
          [user.id, itemId]
        );
      }
      resultText = '❌ Отклонено';
    } else {
      return bot.answerCallbackQuery(query.id, { text: 'Устаревший формат кнопки' });
    }

    await bot.answerCallbackQuery(query.id, { text: resultText });
    try {
      await bot.editMessageText(query.message.text + '\n\n' + resultText + '\n👤 ' + user.name, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] }
      });
    } catch (e) { /* message too old */ }

  } catch (err) {
    console.error('[Telegram] Legacy callback error:', err.message);
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' }); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
async function getUserByChatId(chatId) {
  const result = await db.query(
    'SELECT id, name, role FROM users WHERE telegram_chat_id = $1', [chatId.toString()]
  );
  return result.rows[0] || null;
}

async function broadcast(userIds, message, options = {}) {
  const results = await Promise.all(
    userIds.map(id => sendNotification(id, message, options))
  );
  return results.filter(Boolean).length;
}

async function sendTempPassword(userId, password) {
  return sendNotification(userId, `
🔐 *Временный пароль ASGARD CRM:*

\`${password}\`

⚠️ Действителен 24 часа. Смените после входа.
  `);
}

async function sendDeadlineReminder(userId, tender) {
  const deadline = new Date(tender.deadline).toLocaleDateString('ru-RU');
  return sendNotification(userId, `
⏰ *Напоминание о дедлайне!*

📋 Тендер: ${tender.customer || '—'}
📌 Статус: ${tender.tender_status || 'Новый'}
📅 Дедлайн: ${deadline}
  `);
}

async function sendCalendarReminder(userId, event) {
  return sendNotification(userId, `
📅 *Напоминание!*

📌 ${event.title}
🕐 ${event.date} ${event.time || ''}
${event.participants ? '👥 ' + event.participants : ''}
${event.description ? '\n📝 ' + event.description : ''}
  `);
}

async function shutdown() {
  if (bot) {
    try { await bot.stopPolling(); } catch (e) {}
    bot = null;
  }
  pendingInput.clear();
}

module.exports = {
  init,
  sendNotification,
  sendApprovalRequest,
  broadcast,
  sendTempPassword,
  sendDeadlineReminder,
  sendCalendarReminder,
  getBot: () => bot,
  shutdown
};
