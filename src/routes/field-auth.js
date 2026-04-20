/**
 * ASGARD Field — SMS Authentication
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /request-code  — send SMS code
 * POST /verify-code   — verify code, issue JWT
 * POST /refresh       — refresh session
 * POST /logout        — delete session
 * GET  /me            — current employee (token check)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const MangoService = require('../services/mango');

const FIELD_JWT_SECRET = process.env.FIELD_JWT_SECRET || process.env.JWT_SECRET;
const FIELD_JWT_EXPIRES = '90d';
const SMS_CODE_LENGTH = 4;
const SMS_CODE_TTL_MIN = 5;
const SMS_MAX_ATTEMPTS = 3;
const SMS_COOLDOWN_SEC = 60;
const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) {
    digits = '7' + digits.slice(1);
  }
  if (!digits.startsWith('7')) {
    digits = '7' + digits;
  }
  return '+' + digits;
}

async function routes(fastify, options) {
  const db = fastify.db;
  const mango = new MangoService();

  // ─────────────────────────────────────────────────────────────────────
  // POST /request-code — send SMS auth code
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/request-code', async (req, reply) => {
    try {
      const { phone } = req.body || {};
      if (!phone) {
        return reply.code(400).send({ error: 'Укажите номер телефона' });
      }

      const normalized = normalizePhone(phone);
      if (normalized.length < 12) {
        return reply.code(400).send({ error: 'Некорректный номер телефона' });
      }

      // Find employee by phone
      const { rows: employees } = await db.query(
        `SELECT id, fio, phone FROM employees WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1 AND is_active = true LIMIT 1`,
        ['%' + normalized.replace('+', '').slice(-10)]
      );

      if (employees.length === 0) {
        return reply.code(404).send({ error: 'Сотрудник с таким номером не найден' });
      }

      const employee = employees[0];

      // Rate limit: 1 code per 60 sec per phone
      const { rows: recent } = await db.query(
        `SELECT id FROM field_auth_codes
         WHERE phone = $1 AND created_at > NOW() - INTERVAL '${SMS_COOLDOWN_SEC} seconds'
         LIMIT 1`,
        [normalized]
      );

      if (recent.length > 0) {
        return reply.code(429).send({ error: 'Подождите минуту перед повторной отправкой' });
      }

      // Generate code
      const code = generateCode();

      // Save to DB
      await db.query(
        `INSERT INTO field_auth_codes (phone, code, employee_id, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '${SMS_CODE_TTL_MIN} minutes')`,
        [normalized, code, employee.id]
      );

      // Send SMS via Mango
      const smsText = `ASGARD: ваш код ${code}. Действует ${SMS_CODE_TTL_MIN} мин.`;
      let smsStatus = 'sent';
      let smsResponse = null;
      try {
        smsResponse = await mango.sendSms(MANGO_SMS_FROM, normalized, smsText);
        fastify.log.info(`[field-auth] SMS sent to ${normalized}, response: ${JSON.stringify(smsResponse)}`);
      } catch (smsErr) {
        smsStatus = 'failed';
        smsResponse = { error: smsErr.message };
        fastify.log.error(`[field-auth] SMS send error to ${normalized}: ${smsErr.message}`);
      }

      // Log SMS (always — success or failure)
      try {
        await db.query(
          `INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, mango_response)
           VALUES ($1, $2, 'auth_code', $3, $4, $5)`,
          [employee.id, normalized, smsText, smsStatus, JSON.stringify(smsResponse)]
        );
      } catch (logErr) {
        fastify.log.error('[field-auth] SMS log error:', logErr.message);
      }

      return { ok: true, expires_in: SMS_CODE_TTL_MIN * 60 };
    } catch (err) {
      fastify.log.error('[field-auth] request-code error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /verify-code — verify SMS code, issue JWT
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/verify-code', async (req, reply) => {
    try {
      const { phone, code } = req.body || {};
      if (!phone || !code) {
        return reply.code(400).send({ error: 'Укажите номер и код' });
      }

      const normalized = normalizePhone(phone);

      // Find valid code
      const { rows: codes } = await db.query(
        `SELECT id, code, employee_id, attempts FROM field_auth_codes
         WHERE phone = $1 AND used = false AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [normalized]
      );

      if (codes.length === 0) {
        return reply.code(401).send({ error: 'Код не найден или истёк' });
      }

      const authCode = codes[0];

      // Check attempts
      if (authCode.attempts >= SMS_MAX_ATTEMPTS) {
        return reply.code(429).send({ error: 'Код заблокирован. Запросите новый' });
      }

      // Verify code
      if (authCode.code !== code.trim()) {
        await db.query(
          `UPDATE field_auth_codes SET attempts = attempts + 1 WHERE id = $1`,
          [authCode.id]
        );
        const remaining = SMS_MAX_ATTEMPTS - authCode.attempts - 1;
        return reply.code(401).send({ error: `Неверный код. Осталось попыток: ${remaining}` });
      }

      // Mark code as used
      await db.query(
        `UPDATE field_auth_codes SET used = true WHERE id = $1`,
        [authCode.id]
      );

      // Load employee
      const { rows: employees } = await db.query(
        `SELECT id, fio, phone, city, position, role_tag, is_active FROM employees WHERE id = $1`,
        [authCode.employee_id]
      );

      if (employees.length === 0 || !employees[0].is_active) {
        return reply.code(403).send({ error: 'Сотрудник не активен' });
      }

      const employee = employees[0];

      // ── Auto-create user record if not exists (for push + gamification) ──
      let userId = null;
      const { rows: empUser } = await db.query(
        `SELECT user_id FROM employees WHERE id = $1`, [employee.id]
      );
      userId = empUser[0]?.user_id;

      if (!userId) {
        // Create user with role FIELD_WORKER
        const login = normalized.replace('+', '');
        const { rows: newUser } = await db.query(
          `INSERT INTO users (login, role, is_active, name, created_at, updated_at)
           VALUES ($1, 'FIELD_WORKER', true, $2, NOW(), NOW())
           ON CONFLICT (login) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [login, employee.fio || 'Рабочий']
        );
        userId = newUser[0].id;
        await db.query(
          `UPDATE employees SET user_id = $1 WHERE id = $2`,
          [userId, employee.id]
        );
      }

      // Check PIN status
      const { rows: userRow } = await db.query(
        `SELECT pin_hash FROM users WHERE id = $1`, [userId]
      );
      const hasPinSet = !!(userRow[0]?.pin_hash);

      // Generate JWT
      const token = jwt.sign(
        { employee_id: employee.id, user_id: userId, type: 'field' },
        FIELD_JWT_SECRET,
        { expiresIn: FIELD_JWT_EXPIRES }
      );

      // Save session
      const tokenHash = hashToken(token);
      const deviceInfo = req.headers['user-agent'] || '';
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

      await db.query(
        `INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [employee.id, tokenHash, deviceInfo, expiresAt]
      );

      // Update employee last login
      await db.query(
        `UPDATE employees SET field_last_login = NOW(), phone_verified = true WHERE id = $1`,
        [employee.id]
      );

      return {
        token,
        status: hasPinSet ? 'need_pin' : 'need_pin_setup',
        employee: {
          id: employee.id,
          fio: employee.fio,
          phone: employee.phone,
          city: employee.city,
          position: employee.position,
          user_id: userId
        }
      };
    } catch (err) {
      fastify.log.error('[field-auth] verify-code error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /refresh — extend session
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/refresh', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    try {
      const employee = req.fieldEmployee;

      // Generate new token
      const newToken = jwt.sign(
        { employee_id: employee.id, type: 'field' },
        FIELD_JWT_SECRET,
        { expiresIn: FIELD_JWT_EXPIRES }
      );

      const newTokenHash = hashToken(newToken);
      const newExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      // Delete old session
      const oldToken = req.headers.authorization?.replace('Bearer ', '');
      if (oldToken) {
        await db.query(
          `DELETE FROM field_sessions WHERE token_hash = $1`,
          [hashToken(oldToken)]
        );
      }

      // Create new session
      await db.query(
        `INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [employee.id, newTokenHash, req.headers['user-agent'] || '', newExpires]
      );

      return { token: newToken };
    } catch (err) {
      fastify.log.error('[field-auth] refresh error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /logout — delete session
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/logout', async (req, reply) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        await db.query(
          `DELETE FROM field_sessions WHERE token_hash = $1`,
          [hashToken(token)]
        );
      }
      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-auth] logout error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /me — current employee (token check)
  // ─────────────────────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: [fastify.fieldAuthenticate] }, async (req, reply) => {
    try {
      const emp = req.fieldEmployee;
      return {
        id: emp.id,
        fio: emp.fio,
        phone: emp.phone,
        city: emp.city,
        position: emp.position,
        role_tag: emp.role_tag,
        is_self_employed: emp.is_self_employed,
        naks: emp.naks,
        naks_expiry: emp.naks_expiry,
        imt_number: emp.imt_number,
        imt_expires: emp.imt_expires,
        permits: emp.permits,
        clothing_size: emp.clothing_size,
        shoe_size: emp.shoe_size,
        phone_verified: emp.phone_verified,
        field_last_login: emp.field_last_login
      };
    } catch (err) {
      fastify.log.error('[field-auth] me error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /setup-pin — set PIN for the first time (after SMS verification)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/setup-pin', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['pin'],
        properties: {
          pin: { type: 'string', pattern: '^\\d{4}$' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const employee = req.fieldEmployee;

      const { rows: empRows } = await db.query(
        'SELECT user_id FROM employees WHERE id = $1', [employee.id]
      );
      const userId = empRows[0]?.user_id;
      if (!userId) {
        return reply.code(400).send({ error: 'Пользователь не привязан' });
      }

      // Check PIN not already set
      const { rows: userRows } = await db.query(
        'SELECT pin_hash FROM users WHERE id = $1', [userId]
      );
      if (userRows[0]?.pin_hash) {
        return reply.code(409).send({ error: 'PIN уже установлен. Используйте сброс' });
      }

      const pinHash = await bcrypt.hash(req.body.pin, 10);
      await db.query(
        'UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2',
        [pinHash, userId]
      );

      return { ok: true, message: 'PIN установлен' };
    } catch (err) {
      fastify.log.error('[field-auth] setup-pin error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /verify-pin — verify PIN (after SMS verify or on session restore)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/verify-pin', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['pin'],
        properties: {
          pin: { type: 'string', pattern: '^\\d{4}$' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const employee = req.fieldEmployee;

      const { rows: empRows } = await db.query(
        'SELECT user_id FROM employees WHERE id = $1', [employee.id]
      );
      const userId = empRows[0]?.user_id;
      if (!userId) {
        return reply.code(400).send({ error: 'Пользователь не привязан' });
      }

      const { rows: userRows } = await db.query(
        'SELECT pin_hash FROM users WHERE id = $1', [userId]
      );
      if (!userRows[0]?.pin_hash) {
        return reply.code(400).send({ error: 'PIN не установлен' });
      }

      const valid = await bcrypt.compare(req.body.pin, userRows[0].pin_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Неверный PIN' });
      }

      return { ok: true, verified: true };
    } catch (err) {
      fastify.log.error('[field-auth] verify-pin error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /pin-login — login with PIN only (JWT expired, employee_id known)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/pin-login', {
    schema: {
      body: {
        type: 'object',
        required: ['employee_id', 'pin'],
        properties: {
          employee_id: { type: 'integer' },
          pin: { type: 'string', pattern: '^\\d{4}$' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const { employee_id, pin } = req.body;

      const { rows: employees } = await db.query(
        `SELECT e.id, e.fio, e.phone, e.city, e.position, e.user_id, e.is_active
         FROM employees e WHERE e.id = $1`, [employee_id]
      );

      if (!employees.length || !employees[0].is_active) {
        return reply.code(404).send({ error: 'Сотрудник не найден' });
      }

      const employee = employees[0];
      if (!employee.user_id) {
        return reply.code(400).send({ error: 'Необходима SMS-авторизация' });
      }

      const { rows: userRows } = await db.query(
        'SELECT pin_hash FROM users WHERE id = $1', [employee.user_id]
      );
      if (!userRows[0]?.pin_hash) {
        return reply.code(400).send({ error: 'PIN не установлен. Войдите через SMS' });
      }

      const valid = await bcrypt.compare(pin, userRows[0].pin_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Неверный PIN' });
      }

      const token = jwt.sign(
        { employee_id: employee.id, user_id: employee.user_id, type: 'field' },
        FIELD_JWT_SECRET,
        { expiresIn: FIELD_JWT_EXPIRES }
      );

      const tokenHash = hashToken(token);
      const deviceInfo = req.headers['user-agent'] || '';
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO field_sessions (employee_id, token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [employee.id, tokenHash, deviceInfo, expiresAt]
      );

      await db.query(
        `UPDATE employees SET field_last_login = NOW() WHERE id = $1`, [employee.id]
      );

      return {
        token,
        status: 'ok',
        employee: {
          id: employee.id,
          fio: employee.fio,
          phone: employee.phone,
          city: employee.city,
          position: employee.position,
          user_id: employee.user_id
        }
      };
    } catch (err) {
      fastify.log.error('[field-auth] pin-login error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /reset-pin — reset PIN (requires valid session from SMS re-verify)
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/reset-pin', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['new_pin'],
        properties: {
          new_pin: { type: 'string', pattern: '^\\d{4}$' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const employee = req.fieldEmployee;
      const { rows: empRows } = await db.query(
        'SELECT user_id FROM employees WHERE id = $1', [employee.id]
      );
      const userId = empRows[0]?.user_id;
      if (!userId) {
        return reply.code(400).send({ error: 'Пользователь не привязан' });
      }

      const pinHash = await bcrypt.hash(req.body.new_pin, 10);
      await db.query(
        'UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2',
        [pinHash, userId]
      );

      return { ok: true, message: 'PIN сброшен' };
    } catch (err) {
      fastify.log.error('[field-auth] reset-pin error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /push-subscribe — save push subscription for field worker
  // ─────────────────────────────────────────────────────────────────────
  fastify.post('/push-subscribe', {
    preHandler: [fastify.fieldAuthenticate],
    schema: {
      body: {
        type: 'object',
        required: ['endpoint', 'keys'],
        properties: {
          endpoint: { type: 'string' },
          keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            properties: {
              p256dh: { type: 'string' },
              auth: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const employee = req.fieldEmployee;
      const { rows: empRows } = await db.query(
        'SELECT user_id FROM employees WHERE id = $1', [employee.id]
      );
      const userId = empRows[0]?.user_id;
      if (!userId) {
        return reply.code(400).send({ error: 'Пользователь не привязан' });
      }

      const { endpoint, keys } = req.body;
      const deviceInfo = req.headers['user-agent'] || '';

      await db.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_info)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET
           p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_id = EXCLUDED.user_id, device_info = EXCLUDED.device_info`,
        [userId, endpoint, keys.p256dh, keys.auth, deviceInfo]
      );

      return { ok: true };
    } catch (err) {
      fastify.log.error('[field-auth] push-subscribe error:', err);
      return reply.code(500).send({ error: 'Ошибка сервера' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /send-invite — отправить SMS-приглашение рабочему
  // Только для PM/ADMIN (через CRM авторизацию)
  // ═══════════════════════════════════════════════════════════════════
  fastify.post('/send-invite', {
    preHandler: [fastify.authenticate, fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN'])]
  }, async (req, reply) => {
    try {
      const { employee_id, text } = req.body || {};
      if (!employee_id) return reply.code(400).send({ error: 'employee_id обязателен' });

      const { rows } = await db.query('SELECT id, fio, phone FROM employees WHERE id = $1', [employee_id]);
      if (!rows.length) return reply.code(404).send({ error: 'Сотрудник не найден' });
      const emp = rows[0];

      if (!emp.phone) return reply.code(400).send({ error: 'У сотрудника нет телефона' });

      const normalized = emp.phone.replace(/[\s\-\(\)\+]/g, '').replace(/^8/, '7');
      if (normalized.length < 11) return reply.code(400).send({ error: 'Некорректный номер' });

      const smsText = text || 'АСГАРД-СЕРВИС: Для вас создан личный кабинет. Зайдите: asgard-crm.ru/field и введите этот номер. Инструкция: asgard-crm.ru/field-help.html';

      const mango = new MangoService();
      const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

      let smsResponse = null;
      try {
        smsResponse = await mango.sendSms(MANGO_SMS_FROM, normalized, smsText);
      } catch (smsErr) {
        fastify.log.error('[field-auth] invite SMS error:', smsErr.message);
        return reply.code(500).send({ error: 'SMS не отправлено: ' + smsErr.message });
      }

      // Логируем
      await db.query(`
        INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, mango_response, sent_by, created_at)
        VALUES ($1, $2, 'invite', $3, 'sent', $4, $5, NOW())
      `, [emp.id, normalized, smsText, JSON.stringify(smsResponse), req.user.id]).catch(() => {});

      return { ok: true, employee: emp.fio, phone: normalized, response: smsResponse };
    } catch (err) {
      fastify.log.error('[field-auth] send-invite error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /send-invite-bulk — массовая рассылка SMS бригаде
  fastify.post('/send-invite-bulk', {
    preHandler: [fastify.authenticate, fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN'])]
  }, async (req, reply) => {
    const { work_id, text } = req.body || {};
    if (!work_id) return reply.code(400).send({ error: 'work_id обязателен' });

    const { rows: employees } = await db.query(`
      SELECT DISTINCT e.id, e.fio, e.phone
      FROM employee_assignments ea
      JOIN employees e ON e.id = ea.employee_id
      WHERE ea.work_id = $1 AND ea.is_active = TRUE
        AND e.phone IS NOT NULL AND TRIM(e.phone) != ''
      ORDER BY e.fio
    `, [work_id]);

    const smsText = text || 'АСГАРД-СЕРВИС: Для вас создан личный кабинет. Зайдите: asgard-crm.ru/field и введите этот номер. Инструкция: asgard-crm.ru/field-help.html';
    const mango = new MangoService();
    const MANGO_SMS_FROM = process.env.MANGO_SMS_EXTENSION || '101';

    const results = [];
    for (const emp of employees) {
      const normalized = emp.phone.replace(/[\s\-\(\)\+]/g, '').replace(/^8/, '7');
      try {
        const resp = await mango.sendSms(MANGO_SMS_FROM, normalized, smsText);
        results.push({ id: emp.id, fio: emp.fio, status: 'sent', response: resp });
        await db.query(`
          INSERT INTO field_sms_log (employee_id, phone, message_type, message_text, status, mango_response, sent_by, created_at)
          VALUES ($1, $2, 'invite', $3, 'sent', $4, $5, NOW())
        `, [emp.id, normalized, smsText, JSON.stringify(resp), req.user.id]).catch(() => {});
      } catch (e) {
        results.push({ id: emp.id, fio: emp.fio, status: 'failed', error: e.message });
      }
    }

    return { ok: true, total: employees.length, sent: results.filter(r => r.status === 'sent').length, results };
  });
}

module.exports = routes;
