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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not set, bot disabled');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  
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

  console.log('Telegram bot initialized');
}

// ─────────────────────────────────────────────────────────────────────────────
// Send Notification
// ─────────────────────────────────────────────────────────────────────────────
async function sendNotification(userId, message, options = {}) {
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
    console.error('Send notification error:', err);
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
// Export
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  init,
  sendNotification,
  broadcast,
  sendTempPassword,
  sendDeadlineReminder,
  sendCalendarReminder,
  getBot: () => bot
};
