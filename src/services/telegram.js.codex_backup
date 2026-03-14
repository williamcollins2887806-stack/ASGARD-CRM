/**
 * Telegram Bot Service
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

let bot = null;

// ─────────────────────────────────────────────────────────────────────────────
// Initialize Bot
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  let token = process.env.TELEGRAM_BOT_TOKEN;

  // Fallback: читаем токен из таблицы settings (если пользователь сохранил через UI)
  if (!token) {
    try {
      const result = await db.query("SELECT value_json FROM settings WHERE key = 'telegram'");
      if (result.rows[0]?.value_json) {
        let parsed = JSON.parse(result.rows[0].value_json);
        // IndexedDB sync хранит данные вложенно: { key, value_json: "{...}", updated_at }
        const settings = parsed.value_json ? JSON.parse(parsed.value_json) : parsed;
        if (settings.bot_token && settings.enabled !== false) {
          token = settings.bot_token;
          console.log('[Telegram] Bot token loaded from DB settings');
        }
      }
    } catch (e) {
      // settings table may not have telegram key yet
    }
  }

  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set and no token in DB, bot disabled');
    return;
  }

  bot = new TelegramBot(token, { polling: false });
  // Handle polling errors gracefully
  bot.on("polling_error", (err) => {
    console.error("[Telegram] Polling error:", err.code, err.message, JSON.stringify(err.response ? {status: err.response.statusCode, body: err.response.body} : "no-resp"));
  });
  
  // Start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    await bot.sendMessage(chatId, `
🏰 *Добро пожаловать в ASGARD CRM Bot!*

Я помогу вам:
• Получать уведомления о задачах
• Проверять статусы тендеров
• Быстро связаться с системой

*Для привязки аккаунта:*
Введите команду /link и ваш email из CRM

*Доступные команды:*
/link email@example.com - привязать аккаунт
/status - статус системы
/my - мои задачи
/help - справка
    `, { parse_mode: 'Markdown' });
    
    // Save chat_id for future notifications
    console.log(`New Telegram user: ${username} (${chatId})`);
  });

  // Link account command
  bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1].trim().toLowerCase();
    
    try {
      // Find user by email
      const result = await db.query(
        'SELECT id, name FROM users WHERE LOWER(email) = $1 OR LOWER(login) = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        await bot.sendMessage(chatId, '❌ Пользователь с таким email не найден в системе.');
        return;
      }
      
      const user = result.rows[0];
      
      // Update user's telegram_chat_id
      await db.query(
        'UPDATE users SET telegram_chat_id = $1, updated_at = NOW() WHERE id = $2',
        [chatId.toString(), user.id]
      );
      
      await bot.sendMessage(chatId, `
✅ *Аккаунт привязан!*

Пользователь: ${user.name}
Теперь вы будете получать уведомления в Telegram.
      `, { parse_mode: 'Markdown' });
      
    } catch (err) {
      console.error('Link error:', err);
      await bot.sendMessage(chatId, '❌ Ошибка при привязке аккаунта. Попробуйте позже.');
    }
  });

  // Status command
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const [tenders, works, estimates] = await Promise.all([
        db.query('SELECT COUNT(*) FROM tenders'),
        db.query('SELECT COUNT(*) FROM works'),
        db.query('SELECT COUNT(*) FROM estimates')
      ]);
      
      await bot.sendMessage(chatId, `
📊 *Статус системы ASGARD CRM*

🏷 Тендеров: ${tenders.rows[0].count}
📋 Работ: ${works.rows[0].count}
📄 Расчётов: ${estimates.rows[0].count}

✅ Система работает нормально
      `, { parse_mode: 'Markdown' });
      
    } catch (err) {
      await bot.sendMessage(chatId, '❌ Ошибка получения статуса');
    }
  });

  // My tasks command
  bot.onText(/\/my/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      // Find user by chat_id
      const userResult = await db.query(
        'SELECT id, name, role FROM users WHERE telegram_chat_id = $1',
        [chatId.toString()]
      );
      
      if (userResult.rows.length === 0) {
        await bot.sendMessage(chatId, '❌ Аккаунт не привязан. Используйте /link email@example.com');
        return;
      }
      
      const user = userResult.rows[0];
      
      // Get active tasks based on role
      let tasks = [];
      
      if (user.role === 'PM' || user.role === 'ADMIN') {
        const result = await db.query(`
          SELECT t.id, t.customer, t.tender_status, t.deadline
          FROM tenders t
          WHERE t.responsible_pm_id = $1 AND t.tender_status NOT IN ('Выиграли', 'Проиграли')
          ORDER BY t.deadline ASC NULLS LAST
          LIMIT 5
        `, [user.id]);
        tasks = result.rows;
      }
      
      if (tasks.length === 0) {
        await bot.sendMessage(chatId, `👤 ${user.name}\n\n✨ Активных задач нет`);
        return;
      }
      
      let message = `👤 *${user.name}*\n\n📋 *Активные тендеры:*\n\n`;
      
      tasks.forEach((t, i) => {
        const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : 'не указан';
        message += `${i + 1}. ${t.customer || 'Без названия'}\n   📌 ${t.tender_status || 'Новый'} | ⏰ ${deadline}\n\n`;
      });
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (err) {
      console.error('My tasks error:', err);
      await bot.sendMessage(chatId, '❌ Ошибка получения задач');
    }
  });

  // Help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, `
📚 *Справка по командам:*

/start - Начало работы
/link email - Привязать аккаунт CRM
/status - Статус системы
/my - Мои активные задачи
/help - Эта справка

💡 После привязки аккаунта вы будете получать уведомления о:
• Новых тендерах
• Изменениях статусов
• Приближающихся дедлайнах
• Напоминаниях из календаря
    `, { parse_mode: 'Markdown' });
  });

  // Initialize inline approval button handler
  initCallbackHandler();

  await bot.startPolling({ restart: false });
  console.log('Telegram bot initialized (with inline approvals)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Notification
// ─────────────────────────────────────────────────────────────────────────────
async function sendNotification(userId, message, options = {}) {
  // Ленивая инициализация: если бот не запущен, пробуем инициализировать
  if (!bot) {
    try { await init(); } catch (e) { /* ignore */ }
  }
  if (!bot) return false;
  
  try {
    // Get user's telegram_chat_id
    const result = await db.query(
      'SELECT telegram_chat_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!result.rows[0]?.telegram_chat_id) {
      return false;
    }
    
    const chatId = result.rows[0].telegram_chat_id;
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
    return true;
    
  } catch (err) {
    // Suppress 400 errors (blocked bot, invalid chat_id) - just log as debug
      if (err?.response?.body?.error_code === 400 || err?.response?.statusCode === 400) {
        // Silent: user blocked bot or invalid chat_id
      } else {
        console.error('Send notification error:', err);
      }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send to Multiple Users
// ─────────────────────────────────────────────────────────────────────────────
async function broadcast(userIds, message, options = {}) {
  const results = await Promise.all(
    userIds.map(id => sendNotification(id, message, options))
  );
  return results.filter(Boolean).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Temporary Password
// ─────────────────────────────────────────────────────────────────────────────
async function sendTempPassword(userId, password) {
  const message = `
🔐 *Ваш временный пароль для ASGARD CRM:*

\`${password}\`

⚠️ Пароль действителен 24 часа.
После входа рекомендуем сменить пароль в настройках.
  `;
  
  return sendNotification(userId, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Deadline Reminder
// ─────────────────────────────────────────────────────────────────────────────
async function sendDeadlineReminder(userId, tender) {
  const deadline = new Date(tender.deadline).toLocaleDateString('ru-RU');
  const message = `
⏰ *Напоминание о дедлайне!*

📋 Тендер: ${tender.customer || 'Без названия'}
📌 Статус: ${tender.tender_status || 'Новый'}
📅 Дедлайн: ${deadline}

Не забудьте завершить работу вовремя!
  `;
  
  return sendNotification(userId, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Calendar Reminder
// ─────────────────────────────────────────────────────────────────────────────
async function sendCalendarReminder(userId, event) {
  const message = `
📅 *Напоминание о событии!*

📌 ${event.title}
🕐 ${event.date} ${event.time || ''}
${event.participants ? `👥 ${event.participants}` : ''}
${event.description ? `\n📝 ${event.description}` : ''}
  `;
  
  return sendNotification(userId, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Approval Buttons (callback_query)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send an approval request with inline buttons to a director's Telegram.
 * @param {number} userId - Director's user ID
 * @param {string} message - Notification message text (Markdown)
 * @param {object} approvalData - { type: 'pre_tender'|'estimate'|'bonus', id: number }
 */
async function sendApprovalRequest(userId, message, approvalData) {
  if (!bot) {
    try { await init(); } catch (e) { /* ignore */ }
  }
  if (!bot) return false;

  try {
    const result = await db.query(
      'SELECT telegram_chat_id FROM users WHERE id = $1',
      [userId]
    );

    if (!result.rows[0]?.telegram_chat_id) return false;

    const chatId = result.rows[0].telegram_chat_id;
    const type = approvalData.type;
    const itemId = approvalData.id;
    const stage = approvalData.stage || 'director';
    const requiresPayment = Boolean(approvalData.requires_payment);

    let buttons;
    if (type === 'estimate' && stage === 'accounting') {
      buttons = [
        [
          { text: '\u041f\u0440\u0438\u043d\u044f\u0442\u044c', callback_data: `wf_${type}_accept_accounting_${itemId}` },
          { text: '\u041d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443', callback_data: `wf_${type}_request_rework_${itemId}` }
        ],
        [
          { text: '\u0412\u043e\u043f\u0440\u043e\u0441', callback_data: `wf_${type}_question_${itemId}` }
        ]
      ];
    } else if (type === 'estimate') {
      buttons = [
        [
          { text: '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u0442\u044c', callback_data: `wf_${type}_approve_to_accounting_${itemId}` },
          { text: '\u041d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443', callback_data: `wf_${type}_request_rework_${itemId}` }
        ],
        [
          { text: '\u0412\u043e\u043f\u0440\u043e\u0441', callback_data: `wf_${type}_question_${itemId}` },
          { text: '\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c', callback_data: `wf_${type}_reject_${itemId}` }
        ]
      ];
    } else {
      buttons = [
        [
          { text: 'Одобрить', callback_data: `approve_${type}_${itemId}` },
          { text: 'Отклонить', callback_data: `reject_${type}_${itemId}` }
        ]
      ];
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });

    return true;
  } catch (err) {
    if (err?.response?.body?.error_code !== 400) {
      console.error('[Telegram] sendApprovalRequest error:', err.message);
    }
    return false;
  }
}

/**
 * Initialize callback_query handler for inline approval buttons.
 * Called automatically from init() after bot is created.
 */
function initCallbackHandler() {
  if (!bot) return;

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data; // format: "action_type_id"

    try {
      // Parse callback data
      const parts = data.split('_');
      let action;
      let type;
      let itemId;

      if (parts[0] === 'wf' && parts.length >= 4) {
        type = parts[1];
        itemId = parseInt(parts[parts.length - 1], 10);
        action = parts.slice(2, -1).join('_');
      } else {
        if (parts.length < 3) {
          await bot.answerCallbackQuery(query.id, { text: 'Неверный формат команды' });
          return;
        }
        action = parts[0];
        type = parts[1];
        itemId = parseInt(parts.slice(2).join('_'), 10);
      }

      if (isNaN(itemId)) {
        await bot.answerCallbackQuery(query.id, { text: 'Некорректный идентификатор' });
        return;
      }

      // Find director user by chat_id
      const userResult = await db.query(
        'SELECT id, name, role FROM users WHERE telegram_chat_id = $1',
        [chatId.toString()]
      );

      if (!userResult.rows.length) {
        await bot.answerCallbackQuery(query.id, { text: '\u274c \u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u043d\u0435 \u043f\u0440\u0438\u0432\u044f\u0437\u0430\u043d' });
        return;
      }

      const director = userResult.rows[0];
      const dirRole = director.role || '';

      const isDirectorActor = dirRole === 'ADMIN' || dirRole.startsWith('DIRECTOR');
      const isEstimateActor = isDirectorActor || dirRole === 'BUH';
      if (type === 'estimate' && !isEstimateActor) {
        await bot.answerCallbackQuery(query.id, { text: 'У вас нет прав для работы с этим согласованием' });
        return;
      }
      if (type !== 'estimate' && !isDirectorActor) {
        await bot.answerCallbackQuery(query.id, { text: 'Это действие доступно только руководителю' });
        return;
      }

      let resultText = '';

      // ═══ Process Pre-Tender Approval ═══
      if (type === 'pre' || type === 'pretender' || data.includes('pre_tender')) {
        const ptId = itemId;
        if (action === 'approve') {
          await db.query(
            `UPDATE pre_tender_requests SET status = 'accepted', decision_by = $1, decision_at = NOW(), decision_comment = '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram', updated_at = NOW() WHERE id = $2`,
            [director.id, ptId]
          );
          resultText = '\u2705 \u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430';

          // Notify requester
          const ptResult = await db.query('SELECT approval_requested_by FROM pre_tender_requests WHERE id = $1', [ptId]);
          if (ptResult.rows[0]?.approval_requested_by) {
            await sendNotification(ptResult.rows[0].approval_requested_by,
              `\u2705 *\u0417\u0430\u044f\u0432\u043a\u0430 #${ptId} \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430*\n\n\u0420\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c ${director.name} \u0441\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043b \u0437\u0430\u044f\u0432\u043a\u0443 \u0447\u0435\u0440\u0435\u0437 Telegram.`
            );
          }
        } else {
          await db.query(
            `UPDATE pre_tender_requests SET status = 'in_review', decision_by = $1, decision_at = NOW(), decision_comment = '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram', updated_at = NOW() WHERE id = $2`,
            [director.id, ptId]
          );
          resultText = '\u274c \u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430';

          const ptResult = await db.query('SELECT approval_requested_by FROM pre_tender_requests WHERE id = $1', [ptId]);
          if (ptResult.rows[0]?.approval_requested_by) {
            await sendNotification(ptResult.rows[0].approval_requested_by,
              `\u274c *\u0417\u0430\u044f\u0432\u043a\u0430 #${ptId} \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430*\n\n\u0420\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c ${director.name} \u043e\u0442\u043a\u043b\u043e\u043d\u0438\u043b \u0437\u0430\u044f\u0432\u043a\u0443 \u0447\u0435\u0440\u0435\u0437 Telegram.`
            );
          }
        }
      }

      // ═══ Process Estimate Approval ═══
      else if (type === 'estimate') {
        const estimateApprovalWorkflow = require('./estimateApprovalWorkflow');
        const estId = itemId;
        let workflowAction = action;
        let reworkKind = 'rework';
        let workflowComment = '';

        if (action === 'approve') {
          workflowAction = dirRole === 'BUH' ? 'accept_accounting' : 'approve_to_accounting';
        } else if (action === 'rework') {
          workflowAction = 'request_rework';
        } else if (action === 'question') {
          workflowAction = 'request_rework';
          reworkKind = 'question';
        }

        if (workflowAction === 'approve_to_accounting') {
          workflowComment = '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram';
          const workflowResult = await estimateApprovalWorkflow.approveToAccounting(db, {
            estimateId: estId,
            actor: director,
            comment: workflowComment,
            source: 'telegram_callback'
          });
          resultText = workflowResult.request?.current_stage === 'approved_final'
            ? '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e'
            : '\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e, \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u044d\u0442\u0430\u043f: \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u044f';
        } else if (workflowAction === 'accept_accounting' || workflowAction === 'approve_final') {
          workflowComment = '\u041f\u0440\u0438\u043d\u044f\u0442\u043e \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0435\u0439 \u0447\u0435\u0440\u0435\u0437 Telegram';
          await estimateApprovalWorkflow.acceptAccounting(db, {
            estimateId: estId,
            actor: director,
            comment: workflowComment,
            source: 'telegram_callback'
          });
          resultText = 'Принято бухгалтерией, следующий этап: оплата';
        } else if (workflowAction === 'request_rework') {
          workflowComment = reworkKind === 'question' ? '\u0412\u043e\u043f\u0440\u043e\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u0447\u0435\u0440\u0435\u0437 Telegram' : '\u0412\u043e\u0437\u0432\u0440\u0430\u0442 \u043d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443 \u0447\u0435\u0440\u0435\u0437 Telegram';
          await estimateApprovalWorkflow.requestRework(db, {
            estimateId: estId,
            actor: director,
            comment: workflowComment,
            reworkKind,
            source: 'telegram_callback'
          });
          resultText = reworkKind === 'question' ? '\u0412\u043e\u043f\u0440\u043e\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d' : '\u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0435\u043d\u043e \u043d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443';
        } else if (workflowAction === 'reject') {
          workflowComment = '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram';
          await estimateApprovalWorkflow.reject(db, {
            estimateId: estId,
            actor: director,
            comment: workflowComment,
            source: 'telegram_callback'
          });
          resultText = '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e';
        } else {
          await bot.answerCallbackQuery(query.id, { text: 'Действие не поддерживается' });
          return;
        }
      }

      // ═══ Process Bonus Approval ═══
      else if (type === 'bonus') {
        const bonusId = itemId;
        if (action === 'approve') {
          await db.query(
            `UPDATE bonus_requests SET status = 'approved', director_id = $1, decided_at = NOW(), director_comment = '\u041e\u0434\u043e\u0431\u0440\u0435\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram', updated_at = NOW() WHERE id = $2`,
            [director.id, bonusId]
          );
          resultText = '\u2705 \u041f\u0440\u0435\u043c\u0438\u044f \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430';

          // Auto-create work expenses for approved bonuses
          try {
            const bonusResult = await db.query('SELECT * FROM bonus_requests WHERE id = $1', [bonusId]);
            if (bonusResult.rows[0]) {
              const bonus = bonusResult.rows[0];
              const bonuses = typeof bonus.bonuses_json === 'string' ? JSON.parse(bonus.bonuses_json) : (bonus.bonuses_json || []);
              for (const b of bonuses) {
                if (b.amount && b.amount > 0) {
                  await db.query(
                    `INSERT INTO work_expenses (work_id, category, description, amount, date, created_by, created_at, updated_at) VALUES ($1, 'fot_bonus', $2, $3, NOW(), $4, NOW(), NOW())`,
                    [bonus.work_id, '\u041f\u0440\u0435\u043c\u0438\u044f: ' + (b.name || '\u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a'), b.amount, director.id]
                  );
                }
              }
            }
          } catch (bonusErr) {
            console.error('[Telegram] Bonus expense creation error:', bonusErr.message);
          }

          // Notify PM
          const bonusResult = await db.query('SELECT user_id FROM bonus_requests WHERE id = $1', [bonusId]);
          if (bonusResult.rows[0]?.user_id) {
            await sendNotification(bonusResult.rows[0].user_id,
              `\u2705 *\u041f\u0440\u0435\u043c\u0438\u044f \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430!*\n\n${director.name} \u043e\u0434\u043e\u0431\u0440\u0438\u043b \u0432\u0430\u0448 \u0437\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u043f\u0440\u0435\u043c\u0438\u044e \u0447\u0435\u0440\u0435\u0437 Telegram.`
            );
          }
        } else {
          await db.query(
            `UPDATE bonus_requests SET status = 'rejected', director_id = $1, decided_at = NOW(), director_comment = '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e \u0447\u0435\u0440\u0435\u0437 Telegram', updated_at = NOW() WHERE id = $2`,
            [director.id, bonusId]
          );
          resultText = '\u274c \u041f\u0440\u0435\u043c\u0438\u044f \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430';

          const bonusResult = await db.query('SELECT user_id FROM bonus_requests WHERE id = $1', [bonusId]);
          if (bonusResult.rows[0]?.user_id) {
            await sendNotification(bonusResult.rows[0].user_id,
              `\u274c *\u041f\u0440\u0435\u043c\u0438\u044f \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430*\n\n${director.name} \u043e\u0442\u043a\u043b\u043e\u043d\u0438\u043b \u0437\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u043f\u0440\u0435\u043c\u0438\u044e.`
            );
          }
        }
      }

      // Answer callback and update message
      await bot.answerCallbackQuery(query.id, { text: resultText });

      // Edit original message to show result (remove buttons)
      const updatedText = query.message.text + '\n\n' + resultText + '\n\u0420\u0435\u0448\u0435\u043d\u0438\u0435: ' + director.name;
      try {
        await bot.editMessageText(updatedText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] }
        });
      } catch (editErr) {
        // Message might be too old to edit
        console.error('[Telegram] Edit message error:', editErr.message);
      }

      // Log the action
      try {
        await db.query(
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [director.id, action, type, itemId, JSON.stringify({ via: 'telegram', director: director.name })]
        );
      } catch (logErr) {
        // audit_log might not exist
      }

    } catch (err) {
      console.error('[Telegram] Callback query error:', err.message);
      try {
        await bot.answerCallbackQuery(query.id, { text: '\u274c \u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0438' });
      } catch (_) {}
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// Graceful shutdown
async function shutdown() {
  if (bot) {
    try {
      await bot.stopPolling();
      console.log("[Telegram] Polling stopped");
    } catch (e) {
      console.error("[Telegram] Error stopping polling:", e.message);
    }
    bot = null;
  }
}

// Export
// ─────────────────────────────────────────────────────────────────────────────
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
