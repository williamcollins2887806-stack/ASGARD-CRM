/**
 * ASGARD CRM — Создание тестового Fastify-приложения
 * Полный аналог src/index.js, но без запуска listen() и без IMAP/Telegram
 */

'use strict';

require('./env-setup');

const path = require('path');

async function createApp() {
  const fastify = require('fastify')({
    logger: false // Тихий режим для тестов
  });

  // ── Плагины ──
  fastify.register(require('@fastify/cors'), { origin: true, credentials: true });
  fastify.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: '1d' }
  });
  fastify.register(require('@fastify/cookie'));
  fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 52428800 }
  });
  fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '../../public'),
    prefix: '/'
  });
  fastify.register(require('@fastify/rate-limit'), {
    max: 1000,
    timeWindow: 60000
  });

  // ── БД ──
  const db = require('../../src/services/db');
  fastify.decorate('db', db);

  // ── Auth декоратор ──
  fastify.decorate('authenticate', async function(request, reply) {
    try {
      await request.jwtVerify();
      if (request.user.pinVerified === false) {
        const allowedPaths = ['/api/auth/verify-pin', '/api/auth/setup-credentials', '/api/auth/me'];
        if (!allowedPaths.some(p => request.url.startsWith(p))) {
          return reply.code(403).send({ error: 'Forbidden', message: 'Требуется подтверждение PIN' });
        }
      }
      if (request.user.mustChangePassword) {
        const allowedPaths = ['/api/auth/setup-credentials', '/api/auth/change-password', '/api/auth/me'];
        if (!allowedPaths.some(p => request.url.startsWith(p))) {
          return reply.code(403).send({ error: 'Forbidden', message: 'Требуется смена пароля' });
        }
      }
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Требуется авторизация' });
    }
  });

  // ── Role check ──
  fastify.decorate('requireRoles', function(roles) {
    return async function(request, reply) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      const userRole = request.user.role;
      if (userRole === 'ADMIN') return;
      if (roles.includes(userRole)) return;
      if (userRole === 'HEAD_TO' && roles.includes('TO')) return;
      if (userRole === 'HEAD_PM' && roles.includes('PM')) return;
      if (userRole === 'HR_MANAGER' && roles.includes('HR')) return;
      if (userRole === 'CHIEF_ENGINEER' && roles.includes('WAREHOUSE')) return;
      reply.code(403).send({ error: 'Forbidden', message: 'Недостаточно прав' });
    };
  });

  // ── Permission check (M1) ──
  fastify.decorate('requirePermission', function(moduleKey, operation = 'read') {
    return async function(request, reply) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      if (request.user.role === 'ADMIN') return;
      const { rows } = await db.query(
        `SELECT can_read, can_write, can_delete FROM user_permissions
         WHERE user_id = $1 AND module_key = $2`,
        [request.user.id, moduleKey]
      );
      if (rows.length === 0) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Нет доступа к модулю' });
      }
      const perm = rows[0];
      const allowed =
        (operation === 'read' && perm.can_read) ||
        (operation === 'write' && perm.can_write) ||
        (operation === 'delete' && perm.can_delete);
      if (!allowed) {
        return reply.code(403).send({ error: 'Forbidden', message: `Нет права "${operation}" на модуль "${moduleKey}"` });
      }
    };
  });

  // ── Маршруты ──
  fastify.register(require('../../src/routes/auth'), { prefix: '/api/auth' });
  fastify.register(require('../../src/routes/users'), { prefix: '/api/users' });
  fastify.register(require('../../src/routes/pre_tenders'), { prefix: '/api/pre-tenders' });
  fastify.register(require('../../src/routes/tenders'), { prefix: '/api/tenders' });
  fastify.register(require('../../src/routes/estimates'), { prefix: '/api/estimates' });
  fastify.register(require('../../src/routes/works'), { prefix: '/api/works' });
  fastify.register(require('../../src/routes/customers'), { prefix: '/api/customers' });
  fastify.register(require('../../src/routes/expenses'), { prefix: '/api/expenses' });
  fastify.register(require('../../src/routes/incomes'), { prefix: '/api/incomes' });
  fastify.register(require('../../src/routes/calendar'), { prefix: '/api/calendar' });
  fastify.register(require('../../src/routes/staff'), { prefix: '/api/staff' });
  fastify.register(require('../../src/routes/notifications'), { prefix: '/api/notifications' });
  fastify.register(require('../../src/routes/files'), { prefix: '/api/files' });
  fastify.register(require('../../src/routes/settings'), { prefix: '/api/settings' });
  fastify.register(require('../../src/routes/reports'), { prefix: '/api/reports' });
  fastify.register(require('../../src/routes/email'), { prefix: '/api/email' });
  fastify.register(require('../../src/routes/acts'), { prefix: '/api/acts' });
  fastify.register(require('../../src/routes/invoices'), { prefix: '/api/invoices' });
  fastify.register(require('../../src/routes/equipment'), { prefix: '/api/equipment' });
  fastify.register(require('../../src/routes/data'), { prefix: '/api/data' });
  fastify.register(require('../../src/routes/permissions'), { prefix: '/api/permissions' });
  fastify.register(require('../../src/routes/cash'), { prefix: '/api/cash' });
  fastify.register(require('../../src/routes/tasks'), { prefix: '/api/tasks' });
  fastify.register(require('../../src/routes/permits'), { prefix: '/api/permits' });
  fastify.register(require('../../src/routes/payroll'), { prefix: '/api/payroll' });
  fastify.register(require('../../src/routes/permit_applications'), { prefix: '/api/permit-applications' });
  fastify.register(require('../../src/routes/mailbox'), { prefix: '/api/mailbox' });
  fastify.register(require('../../src/routes/inbox_applications_ai'), { prefix: '/api/inbox-applications' });
  fastify.register(require('../../src/routes/integrations'), { prefix: '/api/integrations' });

  // Health check
  fastify.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await fastify.ready();
  return fastify;
}

module.exports = { createApp };
