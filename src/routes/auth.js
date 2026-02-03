/**
 * Auth Routes - Login, Register, Password Reset
 * ═══════════════════════════════════════════════════════════════════════════
 */

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function routes(fastify, options) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/login
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password } = request.body;

    // Find user
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(login) = LOWER($1) OR LOWER(email) = LOWER($1)',
      [login]
    );

    const user = result.rows[0];

    if (!user) {
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    if (!user.is_active) {
      return reply.code(403).send({ error: 'Аккаунт деактивирован' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }

    // Update last login
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate JWT
    const token = fastify.jwt.sign({
      id: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
      email: user.email
    });

    return {
      token,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
        email: user.email,
        must_change_password: user.must_change_password || false
      }
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/register
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password', 'name', 'email'],
        properties: {
          login: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 6 },
          name: { type: 'string', minLength: 2 },
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    const { login, password, name, email } = request.body;

    // Check if login exists
    const existing = await db.query(
      'SELECT id FROM users WHERE LOWER(login) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [login, email]
    );

    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'Пользователь с таким логином или email уже существует' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user (pending approval)
    const result = await db.query(`
      INSERT INTO users (login, password_hash, name, email, role, is_active, created_at)
      VALUES ($1, $2, $3, $4, 'PENDING', false, NOW())
      RETURNING id, login, name, email, role
    `, [login, passwordHash, name, email]);

    // Create registration request
    await db.query(`
      INSERT INTO user_requests (user_id, status, created_at)
      VALUES ($1, 'pending', NOW())
    `, [result.rows[0].id]);

    return {
      message: 'Заявка на регистрацию отправлена. Ожидайте одобрения.',
      user: result.rows[0]
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/auth/me
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/me', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const result = await db.query(
      'SELECT id, login, name, email, role, created_at, last_login_at FROM users WHERE id = $1',
      [request.user.id]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    return { user: result.rows[0] };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/change-password
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/change-password', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;

    // Get current password hash
    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [request.user.id]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return reply.code(401).send({ error: 'Неверный текущий пароль' });
    }

    // Update password
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, request.user.id]
    );

    return { message: 'Пароль успешно изменён' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/reset-password-request
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/reset-password-request', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    const { email } = request.body;

    // Find user
    const result = await db.query(
      'SELECT id, name, telegram_chat_id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (!result.rows[0]) {
      // Don't reveal if email exists
      return { message: 'Если email существует, вы получите инструкции по сбросу пароля' };
    }

    const user = result.rows[0];

    // Generate temp password
    const tempPassword = uuidv4().slice(0, 8).toUpperCase();
    const tempHash = await bcrypt.hash(tempPassword, 10);

    // Store temp password with expiry
    await db.query(`
      UPDATE users 
      SET temp_password_hash = $1, temp_password_expires = NOW() + INTERVAL '24 hours', updated_at = NOW()
      WHERE id = $2
    `, [tempHash, user.id]);

    // Send via Telegram if connected
    if (user.telegram_chat_id) {
      const telegram = require('../services/telegram');
      await telegram.sendTempPassword(user.id, tempPassword);
    }

    // TODO: Send via email

    return { message: 'Если email существует, вы получите инструкции по сбросу пароля' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/reset-password
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'tempPassword', 'newPassword'],
        properties: {
          email: { type: 'string', format: 'email' },
          tempPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (request, reply) => {
    const { email, tempPassword, newPassword } = request.body;

    // Find user
    const result = await db.query(
      'SELECT id, temp_password_hash, temp_password_expires FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (!result.rows[0]) {
      return reply.code(401).send({ error: 'Неверные данные для сброса пароля' });
    }

    const user = result.rows[0];

    // Check if temp password exists and not expired
    if (!user.temp_password_hash || new Date(user.temp_password_expires) < new Date()) {
      return reply.code(401).send({ error: 'Временный пароль истёк или не существует' });
    }

    // Verify temp password
    const valid = await bcrypt.compare(tempPassword, user.temp_password_hash);
    if (!valid) {
      return reply.code(401).send({ error: 'Неверный временный пароль' });
    }

    // Update password
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(`
      UPDATE users 
      SET password_hash = $1, temp_password_hash = NULL, temp_password_expires = NULL, updated_at = NOW()
      WHERE id = $2
    `, [newHash, user.id]);

    return { message: 'Пароль успешно изменён' };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/send-telegram-password
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/send-telegram-password', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const { userId } = request.body;
    
    if (request.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только администратор может отправлять пароли' });
    }

    const result = await db.query(
      'SELECT id, login, name, telegram_chat_id FROM users WHERE id = $1',
      [userId]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    if (!user.telegram_chat_id) {
      return reply.code(400).send({ error: 'У пользователя не привязан Telegram' });
    }

    // Generate temp password
    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    const tempHash = await bcrypt.hash(tempPassword, 10);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(`
      UPDATE users 
      SET temp_password_hash = $1, temp_password_expires = $2, updated_at = NOW()
      WHERE id = $3
    `, [tempHash, expires, userId]);

    // Send via Telegram
    const telegram = require('../services/telegram');
    const sent = await telegram.sendTempPassword(userId, tempPassword);

    if (sent) {
      return { success: true, message: `Пароль отправлен пользователю ${user.name}` };
    } else {
      return reply.code(500).send({ error: 'Не удалось отправить сообщение в Telegram' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/setup-credentials (первый вход - смена пароля и PIN)
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/setup-credentials', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { userId, newPassword, pin } = request.body;
    
    if (!newPassword || newPassword.length < 6) {
      return reply.code(400).send({ error: 'Пароль минимум 6 символов' });
    }
    if (!pin || !/^\d{4}$/.test(pin)) {
      return reply.code(400).send({ error: 'PIN должен быть 4 цифры' });
    }
    
    const newHash = await bcrypt.hash(newPassword, 10);
    const pinHash = await bcrypt.hash(pin, 10);
    
    await db.query(`
      UPDATE users 
      SET password_hash = $1, pin_hash = $2, must_change_password = false, updated_at = NOW()
      WHERE id = $3
    `, [newHash, pinHash, userId]);
    
    // Получаем обновленного пользователя
    const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    
    // Генерируем новый токен
    const token = fastify.jwt.sign({
      id: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
      email: user.email
    });
    
    return {
      success: true,
      token,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
        email: user.email,
        must_change_password: false
      }
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/auth/verify-pin
  // ─────────────────────────────────────────────────────────────────────────────
  fastify.post('/verify-pin', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { userId, pin } = request.body;
    
    const result = await db.query('SELECT pin_hash FROM users WHERE id = $1', [userId]);
    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Пользователь не найден' });
    }
    
    const validPin = await bcrypt.compare(pin, result.rows[0].pin_hash);
    if (!validPin) {
      return reply.code(401).send({ error: 'Неверный PIN' });
    }
    
    return { success: true };
  });
}

module.exports = routes;
