/**
 * ASGARD CRM - Main Server Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const fastify = require('fastify')({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production' ? {
      target: 'pino-pretty',
      options: { colorize: true }
    } : undefined
  }
});

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
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
// ─────────────────────────────────────────────────────────────────────────────
fastify.decorate('authenticate', async function(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Требуется авторизация' });
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
// Start Server
// ─────────────────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    fastify.log.info('Database connected');
    
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
