/**
 * ASGARD CRM - Main Server Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const fastify = require('fastify')({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  }
});

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// SECURITY: JWT_SECRET обязателен (CRIT-4)
// ─────────────────────────────────────────────────────────────────────────────
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET, // SECURITY: Без fallback (CRIT-4)
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // SECURITY: В production нельзя использовать * (CRIT-6)
  corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://asgard-crm.ru' : '*'),
  uploadDir: process.env.UPLOAD_DIR || './uploads'
};

// ─────────────────────────────────────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────────────────────────────────────

// CORS
fastify.register(require('@fastify/cors'), {
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  credentials: true
});

// JWT
fastify.register(require('@fastify/jwt'), {
  secret: config.jwtSecret,
  sign: { expiresIn: config.jwtExpiresIn }
});

// Cookies
fastify.register(require('@fastify/cookie'));

// Multipart (file uploads)
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10)
  }
});

// Static files (frontend)
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/'
});

// Rate limiting
fastify.register(require('@fastify/rate-limit'), {
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10)
});

// ─────────────────────────────────────────────────────────────────────────────
// Database Connection
// ─────────────────────────────────────────────────────────────────────────────
const db = require('./services/db');

fastify.decorate('db', db);

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Decorator
// SECURITY: Проверка pinVerified и mustChangePassword (HIGH-7, MED-4)
// ─────────────────────────────────────────────────────────────────────────────
fastify.decorate('authenticate', async function(request, reply) {
  try {
    await request.jwtVerify();

    // SECURITY: Проверка PIN-верификации (HIGH-7)
    if (request.user.pinVerified === false) {
      const allowedPaths = ['/api/auth/verify-pin', '/api/auth/setup-credentials', '/api/auth/me'];
      if (!allowedPaths.some(p => request.url.startsWith(p))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Требуется подтверждение PIN' });
      }
    }

    // SECURITY: Проверка обязательной смены пароля (MED-4)
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

// Role check decorator
fastify.decorate('requireRoles', function(roles) {
  return async function(request, reply) {
    await fastify.authenticate(request, reply);
    if (!roles.includes(request.user.role) && request.user.role !== 'ADMIN') {
      reply.code(403).send({ error: 'Forbidden', message: 'Недостаточно прав' });
    }
  };
});

// Permission check decorator (модульные роли M1)
// Использование: preHandler: [fastify.requirePermission('tenders', 'read')]
// ADMIN всегда проходит. Для остальных проверяет user_permissions.
fastify.decorate('requirePermission', function(moduleKey, operation = 'read') {
  return async function(request, reply) {
    await fastify.authenticate(request, reply);
    if (reply.sent) return; // authenticate уже отправил 401

    // ADMIN bypass
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

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
fastify.register(require('./routes/users'), { prefix: '/api/users' });
fastify.register(require('./routes/tenders'), { prefix: '/api/tenders' });
fastify.register(require('./routes/estimates'), { prefix: '/api/estimates' });
fastify.register(require('./routes/works'), { prefix: '/api/works' });
fastify.register(require('./routes/customers'), { prefix: '/api/customers' });
fastify.register(require('./routes/expenses'), { prefix: '/api/expenses' });
fastify.register(require('./routes/incomes'), { prefix: '/api/incomes' });
fastify.register(require('./routes/calendar'), { prefix: '/api/calendar' });
fastify.register(require('./routes/staff'), { prefix: '/api/staff' });
fastify.register(require('./routes/notifications'), { prefix: '/api/notifications' });
fastify.register(require('./routes/files'), { prefix: '/api/files' });
fastify.register(require('./routes/settings'), { prefix: '/api/settings' });
fastify.register(require('./routes/reports'), { prefix: '/api/reports' });
fastify.register(require('./routes/mimir'), { prefix: '/api/mimir' });
fastify.register(require('./routes/geo'), { prefix: '/api/geo' });
fastify.register(require('./routes/email'), { prefix: '/api/email' });
fastify.register(require('./routes/acts'), { prefix: '/api/acts' });
fastify.register(require('./routes/invoices'), { prefix: '/api/invoices' });
fastify.register(require('./routes/equipment'), { prefix: '/api/equipment' });
fastify.register(require('./routes/data'), { prefix: '/api/data' });
fastify.register(require('./routes/permissions'), { prefix: '/api/permissions' });

// ─────────────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────────────
fastify.get('/api/health', async (request, reply) => {
  try {
    await db.query('SELECT 1');
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: require('../package.json').version,
      database: 'connected'
    };
  } catch (err) {
    reply.code(500).send({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: err.message 
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SPA Fallback (for frontend routing)
// ─────────────────────────────────────────────────────────────────────────────
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Not Found', message: 'Endpoint не найден' });
  } else {
    // Serve index.html for SPA routing
    reply.sendFile('index.html');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handler
// ─────────────────────────────────────────────────────────────────────────────
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? 'Внутренняя ошибка сервера' : error.message;
  
  reply.code(statusCode).send({
    error: error.name || 'Error',
    message,
    statusCode
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ensure Required Tables Exist
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTables() {
  // Chat messages table
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      chat_type VARCHAR(50) DEFAULT 'general',
      entity_id INTEGER,
      entity_title VARCHAR(255),
      chat_id INTEGER,
      to_user_id INTEGER,
      user_id INTEGER,
      user_name VARCHAR(255),
      user_role VARCHAR(50),
      text TEXT,
      attachments TEXT,
      mentions TEXT,
      is_system BOOLEAN DEFAULT false,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Chats table
  await db.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      chat_type VARCHAR(50) DEFAULT 'direct',
      participants TEXT,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Staff plan table
  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_plan (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER,
      date DATE,
      status_code VARCHAR(10),
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add user_id column to staff if not exists
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='user_id') THEN
        ALTER TABLE staff ADD COLUMN user_id INTEGER;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='role_tag') THEN
        ALTER TABLE staff ADD COLUMN role_tag VARCHAR(50);
      END IF;
    END $$;
  `);

  // Add PIN hash column to users if not exists
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin_hash') THEN
        ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='must_change_password') THEN
        ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_login_at') THEN
        ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_chat_id') THEN
        ALTER TABLE users ADD COLUMN telegram_chat_id BIGINT;
      END IF;
    END $$;
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// SECURITY: Проверка обязательных переменных окружения (CRIT-4, CRIT-5)
// ─────────────────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // SECURITY: Проверка JWT_SECRET (CRIT-4)
    if (!process.env.JWT_SECRET) {
      fastify.log.error('FATAL: JWT_SECRET environment variable is required');
      process.exit(1);
    }

    // SECURITY: Предупреждение о слабом пароле БД (CRIT-5)
    const weakPasswords = ['password', 'changeme', '123456', 'postgres', 'admin'];
    if (!process.env.DB_PASSWORD || weakPasswords.includes(process.env.DB_PASSWORD)) {
      fastify.log.warn('WARNING: Using weak database password. Change DB_PASSWORD in production!');
    }

    // SECURITY: Предупреждение о CORS в production
    if (process.env.NODE_ENV === 'production' && config.corsOrigin === '*') {
      fastify.log.warn('WARNING: CORS origin is set to *. This is not recommended for production!');
    }

    // Test database connection
    await db.query('SELECT NOW()');
    fastify.log.info('Database connected');

    // Ensure required tables exist
    await ensureTables();
    fastify.log.info('Database tables verified');
    
    // Initialize Telegram bot if token provided
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const telegram = require('./services/telegram');
      await telegram.init();
      fastify.log.info('Telegram bot started');
    }
    
    // Start server
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                         ASGARD CRM SERVER                                 ║
║═══════════════════════════════════════════════════════════════════════════║
║  Status:    RUNNING                                                       ║
║  Port:      ${String(config.port).padEnd(59)}║
║  Mode:      ${String(process.env.NODE_ENV || 'development').padEnd(59)}║
║  API:       http://${config.host}:${config.port}/api                              ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  await fastify.close();
  await db.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
