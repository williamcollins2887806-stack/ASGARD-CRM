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
      SELECT id, login, name, email, role, is_active, created_at, last_login_at
      FROM users
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

    const result = await db.query(
      'SELECT id, login, name, email, role, is_active, created_at, last_login_at FROM users WHERE id = $1',
      [id]
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
      RETURNING id, login, name, email, role, is_active, created_at
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

    const { name, email, role, is_active } = request.body;

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

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Нет данных для обновления' });
    }

    updates.push('updated_at = NOW()');
    values.push(userId);

    const sql = `
      UPDATE users SET ${updates.join(', ')}
      WHERE id = $${idx}
      RETURNING id, login, name, email, role, is_active
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
}

module.exports = routes;
