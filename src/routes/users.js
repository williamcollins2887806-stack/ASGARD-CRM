/**
 * Users Routes - CRUD for users management
 * ═══════════════════════════════════════════════════════════════════════════
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function routes(fastify, options) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/users - List all users
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { role, is_active, search, limit = 100, offset = 0 } = request.query;

    let sql = `
      SELECT u.id, u.login, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login_at,
        u.birth_date, u.employment_date, u.phone, u.telegram_chat_id, u.is_blocked, u.block_reason, u.must_change_password,
        ea.id as email_account_id, ea.email_address as mail_address, ea.is_active as mail_active,
        ea.last_sync_at as mail_last_sync, ea.last_sync_error as mail_sync_error
      FROM users u
      LEFT JOIN user_email_accounts ea ON ea.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (role) {
      sql += ` AND role = $${idx}`;
      params.push(role);
      idx++;
    }

    if (is_active !== undefined) {
      sql += ` AND is_active = $${idx}`;
      params.push(is_active === 'true');
      idx++;
    }

    if (search) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR LOWER(login) LIKE $${idx} OR LOWER(email) LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }

    sql += ` ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await db.query(sql, params);
    const countResult = await db.query('SELECT COUNT(*) FROM users');

    return {
      users: result.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/users/:id - Get single user
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return reply.code(400).send({ error: 'Invalid user id' });
    }

    const result = await db.query(
      'SELECT id, login, name, patronymic, email, role, is_active, created_at, last_login_at, birth_date, employment_date, phone, telegram_chat_id, is_blocked, block_reason, must_change_password FROM users WHERE id = $1',
      [numericId]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    return { user: result.rows[0] };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/users - Create user (Admin and Directors)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])],
    schema: {
      body: {
        type: 'object',
        required: ['login', 'name', 'role'],
        properties: {
          login: { type: 'string', minLength: 3 },
          password: { type: 'string' },
          name: { type: 'string', minLength: 2 },
          email: { type: 'string' },
          phone: { type: 'string' },
          role: { type: 'string' },
          birth_date: { type: 'string' },
          employment_date: { type: 'string' },
          telegram_chat_id: { type: 'string' },
          is_active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password, name, email, phone, role, birth_date, employment_date, telegram_chat_id, is_active = true } = request.body;

    // Check if login exists
    const existing = await db.query(
      'SELECT id FROM users WHERE LOWER(login) = LOWER($1)',
      [login]
    );

    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'Пользователь с таким логином уже существует' });
    }

    // Generate temp password if not provided
    const tempPassword = password || generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Create user
    const result = await db.query(`
      INSERT INTO users (login, password_hash, name, email, phone, role, birth_date, employment_date, telegram_chat_id, is_active, must_change_password, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW())
      RETURNING id, login, name, patronymic, email, role, is_active, birth_date, employment_date, phone, telegram_chat_id, created_at
    `, [login, passwordHash, name, email || null, phone || null, role, birth_date || null, employment_date || null, telegram_chat_id || null, is_active]);

    const user = result.rows[0];

    // Send password via Telegram if chat_id provided
    if (telegram_chat_id) {
      try {
        const telegram = require('../services/telegram');
        // Используем sendNotification с user.id - он найдёт chat_id из базы
        await telegram.sendNotification(user.id,
          `🔐 *Добро пожаловать в АСГАРД CRM!*\n\n` +
          `Логин: \`${login}\`\n` +
          `Временный пароль: \`${tempPassword}\`\n\n` +
          `При первом входе вам нужно сменить пароль и установить PIN.`
        );
      } catch(e) {
        fastify.log.error('Failed to send Telegram:', e);
      }
    }

    return { 
      user, 
      tempPassword,
      telegramSent: !!telegram_chat_id
    };
  });

  // Helper function - криптографически безопасная генерация пароля
  function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const randomBytes = crypto.randomBytes(8);
    let pass = '';
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(randomBytes[i] % chars.length);
    }
    return pass;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/users/:id/send-credentials - Send login/password via email
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/send-credentials', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const senderId = request.user.id;
    const senderRole = request.user.role;
    if (!['ADMIN', 'HR', 'HR_MANAGER'].includes(senderRole)) {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }

    const userId = parseInt(request.params.id);
    const res = await db.query(
      'SELECT id, login, name, patronymic, email, role FROM users WHERE id = $1',
      [userId]
    );
    if (!res.rows.length) return reply.code(404).send({ error: 'Пользователь не найден' });
    const user = res.rows[0];

    if (!user.email) {
      return reply.code(400).send({ error: 'У пользователя не указан email' });
    }

    // Generate new temp password
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2',
      [passwordHash, userId]
    );

    // Viking motivational quotes
    const vikingQuotes = [
      'Корабль в гавани безопасен, но не для этого строят корабли. — Не бойся новых вызовов!',
      'Лучше быть волком на день, чем овцой всю жизнь. — Покажи свою силу!',
      'Тот, кто не рискует, не пьёт мёд из рога победы. — Дерзай!',
      'Сильнейший не тот, кто побеждает других, а тот, кто побеждает себя. — Стань лучше!',
      'Даже самый длинный путь начинается с первого шага по мосту Биврёст. — Вперёд!',
      'Один решительный воин стоит тысячи нерешительных. — Действуй без сомнений!',
      'Слава приходит к тому, кто не отступает перед бурей. — Будь несгибаем!',
      'Викинг не ждёт попутного ветра — он гребёт. — Создавай свой путь!',
      'В Вальгаллу попадают те, кто сражался с полной отдачей. — Работай на все 100%!',
      'Руны выбиты в камне, но судьбу ты пишешь сам. — Творец своей судьбы!'
    ];
    const quote = vikingQuotes[Math.floor(Math.random() * vikingQuotes.length)];

    const parts = (user.name || '').split(' ');
    const firstName = parts[1] || parts[0] || user.login;
    const patronymic = user.patronymic || parts[2] || '';
    const greeting = patronymic ? `${firstName} ${patronymic}` : firstName;

    const domain = process.env.DOMAIN || 'asgard-crm.ru';

    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f14;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f14;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1a24 0%,#12121a 100%);border-radius:16px;border:1px solid rgba(207,181,59,0.3);overflow:hidden;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px;text-align:center;border-bottom:2px solid rgba(207,181,59,0.4);">
  <div style="font-size:32px;margin-bottom:8px;">⚔️</div>
  <h1 style="color:#cfb53b;margin:0;font-size:24px;letter-spacing:2px;">АСГАРД CRM</h1>
  <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:14px;">Система управления проектами</p>
</td></tr>

<!-- Welcome -->
<tr><td style="padding:32px;">
  <h2 style="color:#e0e0e0;margin:0 0 16px;font-size:20px;">Приветствуем, ${greeting}!</h2>
  <p style="color:rgba(255,255,255,0.7);line-height:1.6;margin:0 0 24px;">
    Для вас создана учётная запись в системе <strong style="color:#cfb53b;">АСГАРД CRM</strong>.
    Ниже ваши данные для входа.
  </p>

  <!-- Credentials Card -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(207,181,59,0.08);border:1px solid rgba(207,181,59,0.25);border-radius:12px;margin:0 0 24px;">
  <tr><td style="padding:24px;">
    <p style="color:rgba(255,255,255,0.5);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Учётные данные</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:8px 0;color:rgba(255,255,255,0.5);width:100px;">Логин:</td>
        <td style="padding:8px 0;color:#cfb53b;font-family:'Courier New',monospace;font-size:16px;font-weight:bold;">${user.login}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:rgba(255,255,255,0.5);width:100px;">Пароль:</td>
        <td style="padding:8px 0;color:#cfb53b;font-family:'Courier New',monospace;font-size:16px;font-weight:bold;">${tempPassword}</td>
      </tr>
    </table>
  </td></tr>
  </table>

  <!-- Instructions -->
  <div style="margin:0 0 24px;">
    <h3 style="color:#e0e0e0;margin:0 0 12px;font-size:16px;">📋 Краткая инструкция</h3>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">
        <span style="color:#cfb53b;font-weight:bold;">1.</span> Перейдите на <a href="https://${domain}" style="color:#cfb53b;text-decoration:none;">https://${domain}</a>
      </td></tr>
      <tr><td style="padding:6px 0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">
        <span style="color:#cfb53b;font-weight:bold;">2.</span> Введите логин и пароль из письма
      </td></tr>
      <tr><td style="padding:6px 0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">
        <span style="color:#cfb53b;font-weight:bold;">3.</span> Система попросит сменить пароль — придумайте надёжный (от 8 символов)
      </td></tr>
      <tr><td style="padding:6px 0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">
        <span style="color:#cfb53b;font-weight:bold;">4.</span> Установите PIN-код (4 цифры) — для быстрого входа
      </td></tr>
      <tr><td style="padding:6px 0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.5;">
        <span style="color:#cfb53b;font-weight:bold;">5.</span> Готово! Вы в системе. Изучите дашборд и меню слева
      </td></tr>
    </table>
  </div>

  <!-- Button -->
  <table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:8px 0 24px;">
    <a href="https://${domain}" style="display:inline-block;background:linear-gradient(135deg,#cfb53b,#b8960f);color:#1a1a24;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;letter-spacing:0.5px;">
      Войти в АСГАРД
    </a>
  </td></tr>
  </table>

  <!-- Viking Quote -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.03);border-left:3px solid #cfb53b;border-radius:0 8px 8px 0;margin:0 0 8px;">
  <tr><td style="padding:16px 20px;">
    <p style="color:rgba(255,255,255,0.5);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">⚡ Мудрость викингов</p>
    <p style="color:rgba(255,255,255,0.7);font-style:italic;margin:0;line-height:1.5;font-size:14px;">${quote}</p>
  </td></tr>
  </table>
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
  <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0;">
    ⚔️ АСГАРД CRM &copy; ${new Date().getFullYear()} | Это письмо отправлено автоматически
  </p>
  <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:8px 0 0;">
    Если вы получили это письмо по ошибке, проигнорируйте его.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    // Try sending via CRM email infrastructure
    try {
      const emailRoute = require('./email');
      // Use the getTransporter approach directly
    } catch(e) {}

    // Direct send via nodemailer using same config
    let transport;
    try {
      const smtpRes = await db.query("SELECT value_json FROM settings WHERE key = 'smtp_config'");
      if (smtpRes.rows.length > 0) {
        const config = JSON.parse(smtpRes.rows[0].value_json);
        const nodemailer = require('nodemailer');
        transport = nodemailer.createTransport({
          ...config,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000
        });
      }
    } catch(e) {}

    if (!transport) {
      if (process.env.SMTP_HOST) {
        const nodemailer = require('nodemailer');
        transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000
        });
      }
    }

    if (!transport) {
      // Log to console as fallback
      console.log('EMAIL CREDENTIALS (no SMTP configured):', { to: user.email, login: user.login, tempPassword });
      return {
        success: true,
        warning: 'SMTP не настроен. Пароль сброшен, но письмо не отправлено. Сообщите пароль лично.',
        tempPassword
      };
    }

    try {
      const fromRes = await db.query("SELECT value_json FROM settings WHERE key = 'smtp_from'");
      const fromAddr = fromRes.rows.length ? JSON.parse(fromRes.rows[0].value_json) : (process.env.SMTP_FROM || '"АСГАРД CRM" <crm@asgard-service.com>');

      await transport.sendMail({
        from: fromAddr,
        to: user.email,
        subject: '⚔️ Ваши учётные данные — АСГАРД CRM',
        html: htmlBody
      });

      // Log
      try {
        await db.query(
          `INSERT INTO email_log (user_id, to_email, subject, status, created_at)
           VALUES ($1, $2, $3, 'sent', NOW())`,
          [senderId, user.email, 'Учётные данные — АСГАРД CRM']
        );
      } catch(e) {}

      return { success: true, message: 'Письмо с учётными данными отправлено на ' + user.email };
    } catch(emailErr) {
      console.error('Send credentials email error:', emailErr);
      return reply.code(500).send({
        error: 'Ошибка отправки email. Пароль сброшен.',
        tempPassword,
        detail: 'Сообщите пароль пользователю лично'
      });
    }
  });

    // ─────────────────────────────────────────────────────────────────────────────
  // PUT /api/users/:id - Update user
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const userId = parseInt(id, 10);

    // Users can update themselves, admins can update anyone
    if (request.user.id !== userId && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }

    const { name, email, role, is_active, birth_date, employment_date, phone, telegram_chat_id, patronymic, avatar_url } = request.body;

    // Only admin can change role and is_active
    if ((role !== undefined || is_active !== undefined) && request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только администратор может менять роль и статус' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx}`);
      values.push(name);
      idx++;
    }
    if (email !== undefined) {
      updates.push(`email = $${idx}`);
      values.push(email);
      idx++;
    }
    if (role !== undefined && request.user.role === 'ADMIN') {
      updates.push(`role = $${idx}`);
      values.push(role);
      idx++;
    }
    if (is_active !== undefined && request.user.role === 'ADMIN') {
      updates.push(`is_active = $${idx}`);
      values.push(is_active);
      idx++;
    }

    if (birth_date !== undefined) { updates.push("birth_date = $" + idx); values.push(birth_date || null); idx++; }
    if (employment_date !== undefined) { updates.push("employment_date = $" + idx); values.push(employment_date || null); idx++; }
    if (phone !== undefined) { updates.push("phone = $" + idx); values.push(phone || null); idx++; }
    if (telegram_chat_id !== undefined) { updates.push("telegram_chat_id = $" + idx); values.push(telegram_chat_id || null); idx++; }
if (patronymic !== undefined) { updates.push("patronymic = $" + idx); values.push(patronymic || null); idx++; }
    if (avatar_url !== undefined) { updates.push("avatar_url = $" + idx); values.push(avatar_url || null); idx++; }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных для обновления' });
    }

    updates.push('updated_at = NOW()');
    values.push(userId);

    const sql = `
      UPDATE users SET ${updates.join(', ')}
      WHERE id = $${idx}
      RETURNING id, login, name, patronymic, email, role, is_active, avatar_url
    `;

    const result = await db.query(sql, values);

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    return { user: result.rows[0] };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/users/:id - Delete user (Admin only)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { id } = request.params;

    // Cannot delete yourself
    if (request.user.id === parseInt(id, 10)) {
      return reply.code(400).send({ error: 'Нельзя удалить свой аккаунт' });
    }

    const result = await db.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    return { message: 'Пользователь удалён' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/users/:id/block - Block user (Admin only)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/block', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const userId = parseInt(request.params.id, 10);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Invalid user id' });
    if (request.user.id === userId) return reply.code(400).send({ error: 'Нельзя заблокировать свой аккаунт' });

    const result = await db.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, login, name, role, is_active',
      [userId]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Пользователь не найден' });
    return { user: result.rows[0], message: 'Пользователь заблокирован' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/users/:id/unblock - Unblock user (Admin only)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/:id/unblock', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const userId = parseInt(request.params.id, 10);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Invalid user id' });

    const result = await db.query(
      'UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING id, login, name, role, is_active',
      [userId]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: 'Пользователь не найден' });
    return { user: result.rows[0], message: 'Пользователь разблокирован' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/users/roles - Get available roles
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/roles/list', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    return {
      roles: [
        { code: 'ADMIN', label: 'Администратор' },
        { code: 'DIRECTOR_GEN', label: 'Генеральный директор' },
        { code: 'DIRECTOR_COMM', label: 'Коммерческий директор' },
        { code: 'DIRECTOR_DEV', label: 'Директор по развитию' },
        { code: 'TO', label: 'Тендерный отдел' },
        { code: 'PM', label: 'Руководитель проекта' },
        { code: 'BUH', label: 'Бухгалтерия' },
        { code: 'HR', label: 'Кадры' },
        { code: 'OFFICE_MANAGER', label: 'Офис-менеджер' },
        { code: 'PROC', label: 'Закупки' }
      ]
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL ACCOUNT MANAGEMENT (для привязки почтовых ящиков к сотрудникам)
  // ═══════════════════════════════════════════════════════════════════════════
  const imapService = require('../services/imap');
  const yandex360 = require('../services/yandex360');

  // GET /api/users/:id/email-account — получить почтовый аккаунт пользователя
  fastify.get('/:id/email-account', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    // Пользователь может смотреть свой аккаунт, админы — любой
    if (user.id !== parseInt(id) && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const result = await db.query(
      'SELECT id, user_id, email_address, imap_host, imap_port, smtp_host, smtp_port, display_name, signature_html, is_active, last_sync_at, last_sync_error, created_at FROM user_email_accounts WHERE user_id = $1',
      [id]
    );

    return { account: result.rows[0] || null };
  });

  // POST /api/users/:id/email-account — привязать почтовый ящик вручную
  fastify.post('/:id/email-account', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const {
      email_address, imap_password, smtp_password,
      display_name, signature_html,
      imap_host, imap_port, smtp_host, smtp_port
    } = request.body;

    if (!email_address) {
      return reply.code(400).send({ error: 'Укажите email-адрес' });
    }

    // Проверяем что пользователь существует
    const userRes = await db.query('SELECT id, name FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    // Проверяем что аккаунт ещё не привязан
    const existing = await db.query('SELECT id FROM user_email_accounts WHERE user_id = $1', [id]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'У пользователя уже есть почтовый аккаунт. Удалите старый перед добавлением нового.' });
    }

    const imapUser = email_address;
    const smtpUser = email_address;
    const imapPassEnc = imapService.encrypt(imap_password || '');
    const smtpPassEnc = imapService.encrypt(smtp_password || imap_password || '');

    const result = await db.query(`
      INSERT INTO user_email_accounts (
        user_id, email_address,
        imap_host, imap_port, imap_user, imap_pass_encrypted, imap_tls,
        smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_tls,
        display_name, signature_html
      ) VALUES (
        $1, $2,
        $3, $4, $5, $6, true,
        $7, $8, $9, $10, true,
        $11, $12
      ) RETURNING id, email_address
    `, [
      id, email_address,
      imap_host || 'imap.yandex.ru', imap_port || 993, imapUser, imapPassEnc,
      smtp_host || 'smtp.yandex.ru', smtp_port || 465, smtpUser, smtpPassEnc,
      display_name || userRes.rows[0].name, signature_html || ''
    ]);

    // Обновляем email в users если пустой
    await db.query(
      "UPDATE users SET email = COALESCE(NULLIF(email, ''), $1), updated_at = NOW() WHERE id = $2",
      [email_address, id]
    );

    return { success: true, account: result.rows[0] };
  });

  // DELETE /api/users/:id/email-account — отвязать почтовый ящик
  fastify.delete('/:id/email-account', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await db.query(
      'DELETE FROM user_email_accounts WHERE user_id = $1 RETURNING id, email_address',
      [id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Почтовый аккаунт не найден' });
    }

    return { success: true, deleted: result.rows[0] };
  });

  // POST /api/users/:id/email-account/create-yandex — автоматически создать ящик через Яндекс 360
  fastify.post('/:id/email-account/create-yandex', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { nickname, password } = request.body;

    if (!nickname || !password) {
      return reply.code(400).send({ error: 'Укажите nickname (логин) и password' });
    }

    // Проверяем пользователя
    const userRes = await db.query('SELECT id, name, patronymic FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }
    const usr = userRes.rows[0];

    // Разбиваем имя на части
    const nameParts = (usr.name || '').split(' ');
    const lastName = nameParts[0] || 'User';
    const firstName = nameParts[1] || '';
    const middleName = usr.patronymic || nameParts[2] || '';

    try {
      // Создаём пользователя в Яндекс 360
      const y360user = await yandex360.createUser({
        nickname,
        password,
        firstName: firstName || lastName,
        lastName: lastName,
        middleName
      });

      const config = await yandex360.getConfig();
      const domain = config.domain || 'asgard-service.com';
      const email = nickname + '@' + domain;

      // Привязываем ящик к пользователю CRM
      const existing = await db.query('SELECT id FROM user_email_accounts WHERE user_id = $1', [id]);
      if (existing.rows.length > 0) {
        await db.query('DELETE FROM user_email_accounts WHERE user_id = $1', [id]);
      }

      const imapPassEnc = imapService.encrypt(password);
      const smtpPassEnc = imapService.encrypt(password);

      await db.query(`
        INSERT INTO user_email_accounts (
          user_id, email_address,
          imap_host, imap_port, imap_user, imap_pass_encrypted, imap_tls,
          smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_tls,
          display_name
        ) VALUES (
          $1, $2,
          'imap.yandex.ru', 993, $2, $3, true,
          'smtp.yandex.ru', 465, $2, $4, true,
          $5
        )
      `, [id, email, imapPassEnc, smtpPassEnc, usr.name]);

      // Обновляем email в users
      await db.query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [email, id]);

      return { success: true, email, yandex_user_id: y360user.id };
    } catch (error) {
      return reply.code(500).send({ error: 'Ошибка создания ящика в Яндекс 360: ' + error.message });
    }
  });



  // POST /api/users/:id/email-account/bind-yandex — привязать корп. ящик через Яндекс 360 Admin API
  // Находит пользователя в Яндекс 360, сбрасывает пароль, привязывает ящик
  fastify.post('/:id/email-account/bind-yandex', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const { email } = request.body || {};

    if (!email) return reply.code(400).send({ error: 'Укажите email корпоративного ящика' });

    // Проверяем пользователя CRM
    const userRes = await db.query('SELECT id, name FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    // Проверяем нет ли уже привязанного аккаунта
    const existing = await db.query('SELECT id FROM user_email_accounts WHERE user_id = $1', [id]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'У пользователя уже есть почтовый аккаунт' });
    }

    try {
      // Ищем пользователя в Яндекс 360
      const y360user = await yandex360.findUserByEmail(email);
      if (!y360user) {
        return reply.code(404).send({ error: 'Пользователь не найден в Яндекс 360: ' + email });
      }

      // Генерируем надёжный пароль
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
      const crypto = require("crypto");
      const bytes = crypto.randomBytes(16);
      const newPassword = Array.from(bytes).map(b => chars[b % chars.length]).join('');

      // Сбрасываем пароль в Яндекс 360
      await yandex360.changePassword(y360user.id, newPassword);

      // Шифруем и сохраняем
      const passEnc = imapService.encrypt(newPassword);
      const displayName = userRes.rows[0].name || email;

      await db.query(`
        INSERT INTO user_email_accounts (
          user_id, email_address,
          imap_host, imap_port, imap_user, imap_pass_encrypted, imap_tls,
          smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_tls,
          display_name
        ) VALUES (
          $1, $2,
          'imap.yandex.ru', 993, $2, $3, true,
          'smtp.yandex.ru', 465, $2, $3, true,
          $4
        )
      `, [id, email, passEnc, displayName]);

      // Обновляем email в users если пустой
      const curEmail = await db.query("SELECT email FROM users WHERE id = $1", [id]);
      if (!curEmail.rows[0]?.email) {
        await db.query("UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2", [email, id]);
      }

      return { success: true, email, message: 'Ящик привязан, пароль сброшен' };
    } catch (error) {
      return reply.code(500).send({ error: 'Ошибка привязки через Яндекс 360: ' + error.message });
    }
  });

  // PUT /api/users/:id/email-account — обновить настройки почтового аккаунта
  fastify.put('/:id/email-account', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await db.query('SELECT id FROM user_email_accounts WHERE user_id = $1', [id]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Почтовый аккаунт не найден' });
    }

    const {
      display_name, signature_html,
      imap_host, imap_port, imap_password,
      smtp_host, smtp_port, smtp_password
    } = request.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (display_name !== undefined) { updates.push('display_name = $' + idx); params.push(display_name); idx++; }
    if (signature_html !== undefined) { updates.push('signature_html = $' + idx); params.push(signature_html); idx++; }
    if (imap_host !== undefined) { updates.push('imap_host = $' + idx); params.push(imap_host); idx++; }
    if (imap_port !== undefined) { updates.push('imap_port = $' + idx); params.push(imap_port); idx++; }
    if (smtp_host !== undefined) { updates.push('smtp_host = $' + idx); params.push(smtp_host); idx++; }
    if (smtp_port !== undefined) { updates.push('smtp_port = $' + idx); params.push(smtp_port); idx++; }

    if (imap_password) {
      updates.push('imap_pass_encrypted = $' + idx);
      params.push(imapService.encrypt(imap_password));
      idx++;
    }
    if (smtp_password) {
      updates.push('smtp_pass_encrypted = $' + idx);
      params.push(imapService.encrypt(smtp_password));
      idx++;
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет полей для обновления' });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await db.query(
      'UPDATE user_email_accounts SET ' + updates.join(', ') + ' WHERE user_id = $' + idx,
      params
    );

    const updated = await db.query(
      'SELECT id, email_address, imap_host, imap_port, smtp_host, smtp_port, display_name, signature_html, is_active, last_sync_at, last_sync_error FROM user_email_accounts WHERE user_id = $1',
      [id]
    );

    return { success: true, account: updated.rows[0] };
  });

  // PUT /api/users/:id/email-account/signature — обновить подпись (legacy)
  fastify.put('/:id/email-account/signature', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    if (user.id !== parseInt(id) && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Нет доступа' });
    }

    const { signature_html, display_name } = request.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (signature_html !== undefined) { updates.push('signature_html = $' + idx); params.push(signature_html); idx++; }
    if (display_name !== undefined) { updates.push('display_name = $' + idx); params.push(display_name); idx++; }
    updates.push('updated_at = NOW()');
    params.push(id);

    if (updates.length <= 1) return reply.code(400).send({ error: 'Нет полей для обновления' });

    await db.query(
      'UPDATE user_email_accounts SET ' + updates.join(', ') + ' WHERE user_id = $' + idx,
      params
    );

    return { success: true };
  });


  // POST /api/users/:id/email-account/test — тестовое подключение IMAP/SMTP
  // Режим 1: без body — тестирует сохранённый аккаунт
  // Режим 2: с body (email_address, password) — тестирует до привязки
  fastify.post('/:id/email-account/test', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN'])]
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    let imapConfig, smtpConfig;

    if (body.email_address && body.password) {
      // Режим 2: тестируем новые учётки
      imapConfig = {
        imap_host: body.imap_host || 'imap.yandex.ru',
        imap_port: body.imap_port || 993,
        imap_user: body.email_address,
        imap_pass: body.password,
        imap_tls: true
      };
      smtpConfig = {
        smtp_host: body.smtp_host || 'smtp.yandex.ru',
        smtp_port: body.smtp_port || 465,
        smtp_user: body.email_address,
        smtp_pass: body.password
      };
    } else {
      // Режим 1: тестируем сохранённый аккаунт
      const accRes = await db.query('SELECT * FROM user_email_accounts WHERE user_id = $1', [id]);
      if (accRes.rows.length === 0) {
        return reply.code(404).send({ error: 'Почтовый аккаунт не найден' });
      }
      const acc = accRes.rows[0];
      imapConfig = {
        imap_host: acc.imap_host,
        imap_port: acc.imap_port,
        imap_user: acc.imap_user,
        imap_pass_encrypted: acc.imap_pass_encrypted,
        imap_tls: acc.imap_tls
      };
      smtpConfig = null;
    }

    const results = { imap: { ok: false, error: null }, smtp: { ok: false, error: null } };

    // Test IMAP
    try {
      const imapResult = await imapService.testConnection(imapConfig);
      results.imap = { ok: true, ...imapResult };
    } catch (error) {
      results.imap = { ok: false, error: error.message };
    }

    // Test SMTP (only for new credentials)
    if (smtpConfig) {
      try {
        const nodemailer = require('nodemailer');
        const transport = nodemailer.createTransport({
          host: smtpConfig.smtp_host,
          port: smtpConfig.smtp_port,
          secure: smtpConfig.smtp_port === 465,
          auth: { user: smtpConfig.smtp_user, pass: smtpConfig.smtp_pass },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000
        });
        await transport.verify();
        transport.close();
        results.smtp = { ok: true };
      } catch (error) {
        results.smtp = { ok: false, error: error.message };
      }
    } else {
      results.smtp = { ok: true, note: 'Используются сохранённые настройки' };
    }

    const allOk = results.imap.ok && results.smtp.ok;
    return reply.code(allOk ? 200 : 422).send({
      success: allOk,
      ...results
    });
  });
}

module.exports = routes;
