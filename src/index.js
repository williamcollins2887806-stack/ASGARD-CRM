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
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// Server-side UA detection: mobile/desktop get different script bundles
// Кэшируем 2 версии index.html при старте (как Сбер/Яндекс)
// ─────────────────────────────────────────────────────────────────────────────
const indexHtmlPath = path.join(__dirname, '../public/index.html');
const reactMobileHtmlPath = path.join(__dirname, '../public/m/index.html');
let indexDesktop = '';
let indexMobile = '';
let reactMobileHtml = '';

function buildIndexVersions() {
  const raw = fs.readFileSync(indexHtmlPath, 'utf8');
  // Десктопная: убираем мобильные скрипты
  indexDesktop = raw
    .replace(/<!-- ASGARD_MOBILE_START -->[\s\S]*?<!-- ASGARD_MOBILE_END -->/g, '<!-- mobile scripts excluded by server -->');
  // Мобильная: убираем десктопные скрипты
  indexMobile = raw
    .replace(/<!-- ASGARD_DESKTOP_START -->[\s\S]*?<!-- ASGARD_DESKTOP_END -->/g, '<!-- desktop scripts excluded by server -->');
  // React mobile app (если собран)
  try {
    reactMobileHtml = fs.readFileSync(reactMobileHtmlPath, 'utf8');
  } catch (_) {
    reactMobileHtml = '';
  }
}

buildIndexVersions();

// Dev mode: перезагрузка при изменении файла
if (process.env.NODE_ENV !== 'production') {
  fs.watchFile(indexHtmlPath, { interval: 2000 }, () => {
    try { buildIndexVersions(); console.log('[Server] index.html reloaded'); }
    catch (e) { console.error('[Server] Failed to reload index.html:', e.message); }
  });
}

function isMobileUA(userAgent) {
  if (!userAgent) return false;
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);
}

function sendIndexHtml(request, reply) {
  const ua = request.headers['user-agent'] || '';
  const html = isMobileUA(ua) ? indexMobile : indexDesktop;
  reply.type('text/html').header('Cache-Control', 'no-cache').send(html);
}

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

// Security headers (SECURITY: helmet)
fastify.register(require('@fastify/helmet'), {
  contentSecurityPolicy: false,         // CSP отключён — инлайн-скрипты/стили в SPA
  crossOriginEmbedderPolicy: false,     // не ломать загрузку внешних ресурсов
  crossOriginResourcePolicy: { policy: 'same-site' }
});

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

// SECURITY: Block path traversal and sensitive paths for static files
fastify.addHook('onRequest', async (request, reply) => {
  // API routes have their own auth and input validation — skip
  if (request.url.startsWith('/api/')) return;

  const rawUrl = request.raw.url || request.url;
  const url = decodeURIComponent(rawUrl).replace(/\\/g, '/');

  // Allow known static asset paths
  if (/^\/(assets|css|js|img|images|fonts|icons|manifest)\//i.test(url) ||
      url === '/favicon.ico' || url === '/sw.js' || url === '/manifest.json') {
    return;
  }

  // Allow React mobile app paths (/m/ and its assets)
  if (url === '/m' || url === '/m/' || url.startsWith('/m/')) {
    return;
  }

  // Block /mobile-app/ source directory from web access
  if (url === '/mobile-app' || url.startsWith('/mobile-app/')) {
    reply.code(403).send({ error: 'Forbidden', message: 'Доступ запрещён' });
    return;
  }

  // Block path traversal and sensitive paths
  if (url.includes('..') ||
      /\/\.env/i.test(url) ||
      /\/node_modules/i.test(url) ||
      /\/package[\w.-]*\.json/i.test(url) ||
      /\/etc\/(passwd|shadow|hosts)/i.test(url) ||
      /\/proc\//i.test(url) ||
      /\/var\/log/i.test(url) ||
      /^\/(server|app|index)\.(js|ts)$/i.test(url) ||
      /\/docker-compose/i.test(url) ||
      /\/Dockerfile/i.test(url) ||
      /\/(db|config|migrations|tests|scripts|src)\/?$/i.test(url) ||
      /\/(db|config|migrations|tests|scripts|src)\//i.test(url)) {
    reply.code(403).send({ error: 'Forbidden', message: 'Доступ запрещён' });
  }
});

// Gzip/Brotli compression — DISABLED (nginx handles gzip at proxy level)
// @fastify/compress v7 produces empty response bodies for some routes.
// nginx gzip on + gzip_types already covers compression for all responses.
// fastify.register(require('@fastify/compress'), {
//   global: true,
//   encodings: ['gzip', 'deflate'],
//   threshold: 1024
// });

// Перехватываем / и /index.html ДО @fastify/static
// + React mobile app SPA routing для /m/*
fastify.addHook('onRequest', (request, reply, done) => {
  const url = request.url.split('?')[0];

  // React mobile app: /m → /m/ redirect
  if (url === '/m') {
    reply.redirect(301, '/m/');
    return;
  }

  // React mobile app: SPA fallback для всех /m/* путей
  if (url === '/m/' || (url.startsWith('/m/') && !url.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|json|map)$/i))) {
    if (reactMobileHtml) {
      reply.type('text/html').header('Cache-Control', 'no-cache').send(reactMobileHtml);
      return;
    }
  }

  // Root: мобильный UA → redirect на React app
  if (url === '/' || url === '/index.html') {
    const ua = request.headers['user-agent'] || '';
    if (isMobileUA(ua) && reactMobileHtml) {
      reply.redirect(302, '/m/');
      return;
    }
    sendIndexHtml(request, reply);
    return;
  }
  done();
});

// Static files (frontend) with cache-busting headers
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/',
  setHeaders(res, filePath) {
    // HTML files: always revalidate (browser checks freshness each time)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // SW: must not be cached aggressively
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // JS, CSS, images, fonts: cache 30 days (?v= in URL guarantees freshness)
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      return;
    }
    // manifest.json
    if (filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
});

// Rate limiting
// SECURITY B8: Per-user rate limit (not just per-IP)
fastify.register(require('@fastify/rate-limit'), {
    hook: 'preHandler',  // Run after authenticate so request.user is available for keyGenerator
  max: parseInt(process.env.RATE_LIMIT_MAX || '10000', 10),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
  keyGenerator: (request) => request.user?.id ? `user_${request.user.id}` : request.ip,
  allowList: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
  addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true }
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

// Role check decorator — поддержка групп ролей (M15)
fastify.decorate('requireRoles', function(roles) {
  return async function(request, reply) {
    await fastify.authenticate(request, reply);
    if (reply.sent) return; // authenticate уже отправил ошибку

    const userRole = request.user.role;
    if (userRole === 'ADMIN') return; // ADMIN всегда проходит
    if (roles.includes(userRole)) return;
    // HEAD_TO наследует доступы TO
    if (userRole === 'HEAD_TO' && roles.includes('TO')) return;
    // HEAD_PM наследует доступы PM
    if (userRole === 'HEAD_PM' && roles.includes('PM')) return;
    // HR_MANAGER наследует доступы HR
    if (userRole === 'HR_MANAGER' && roles.includes('HR')) return;
    // CHIEF_ENGINEER наследует доступы WAREHOUSE
    if (userRole === 'CHIEF_ENGINEER' && roles.includes('WAREHOUSE')) return;

    reply.code(403).send({ error: 'Forbidden', message: 'Недостаточно прав' });
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

    // Check user_permissions first, fallback to role_presets
    let { rows } = await db.query(
      `SELECT can_read, can_write, can_delete FROM user_permissions
       WHERE user_id = $1 AND module_key = $2`,
      [request.user.id, moduleKey]
    );

    if (rows.length === 0) {
      // Role inheritance map (child inherits parent permissions)
      const ROLE_INHERIT = {
        'HEAD_PM': 'PM', 'HEAD_TO': 'TO',
        'HR_MANAGER': 'HR', 'CHIEF_ENGINEER': 'WAREHOUSE'
      };
      const rolesToCheck = [request.user.role];
      if (ROLE_INHERIT[request.user.role]) rolesToCheck.push(ROLE_INHERIT[request.user.role]);

      // Fallback to role_presets for the user's role (with inheritance)
      const preset = await db.query(
        `SELECT can_read, can_write, can_delete FROM role_presets
         WHERE role = ANY($1) AND module_key = $2
         ORDER BY can_write DESC, can_read DESC LIMIT 1`,
        [rolesToCheck, moduleKey]
      );
      rows = preset.rows;
    }

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
fastify.register(require('./routes/pre_tenders'), { prefix: '/api/pre-tenders' });
fastify.register(require('./routes/tenders'), { prefix: '/api/tenders' });
fastify.register(require('./routes/estimates'), { prefix: '/api/estimates' });
fastify.register(require('./routes/works'), { prefix: '/api/works' });
fastify.register(require('./routes/customers'), { prefix: '/api/customers' });
fastify.register(require('./routes/expenses'), { prefix: '/api/expenses' });
fastify.register(require('./routes/incomes'), { prefix: '/api/incomes' });
fastify.register(require('./routes/calendar'), { prefix: '/api/calendar' });
fastify.register(require('./routes/staff'), { prefix: '/api/staff' });
fastify.register(require("./routes/employee_collections"), { prefix: "/api/employee-collections" });
fastify.register(require('./routes/notifications'), { prefix: '/api/notifications' });
fastify.register(require('./routes/files'), { prefix: '/api/files' });
fastify.register(require('./routes/settings'), { prefix: '/api/settings' });
fastify.register(require('./routes/reports'), { prefix: '/api/reports' });
fastify.register(require('./routes/mimir'), { prefix: '/api/mimir' });
fastify.register(require('./routes/hints'), { prefix: '/api' });
fastify.register(require('./routes/geo'), { prefix: '/api/geo' });
fastify.register(require('./routes/email'), { prefix: '/api/email' });
fastify.register(require('./routes/acts'), { prefix: '/api/acts' });
fastify.register(require('./routes/invoices'), { prefix: '/api/invoices' });
fastify.register(require('./routes/correspondence'), { prefix: '/api/correspondence' });
fastify.register(require('./routes/equipment'), { prefix: '/api/equipment' });
fastify.register(require('./routes/data'), { prefix: '/api/data' });
fastify.register(require('./routes/permissions'), { prefix: '/api/permissions' });
fastify.register(require('./routes/cash'), { prefix: '/api/cash' });
fastify.register(require('./routes/tasks'), { prefix: '/api/tasks' });
fastify.register(require('./routes/permits'), { prefix: '/api/permits' });
fastify.register(require('./routes/chat_groups'), { prefix: '/api/chat-groups' });
fastify.register(require('./routes/meetings'), { prefix: '/api/meetings' });
fastify.register(require('./routes/payroll'), { prefix: '/api/payroll' });
fastify.register(require('./routes/permit_applications'), { prefix: '/api/permit-applications' });
fastify.register(require('./routes/mailbox'), { prefix: '/api/mailbox' });
fastify.register(require("./routes/my-mail"), { prefix: "/api/my-mail" });
fastify.register(require('./routes/inbox_applications_ai'), { prefix: '/api/inbox-applications' });
fastify.register(require('./routes/integrations'), { prefix: '/api/integrations' });
fastify.register(require('./routes/sites'), { prefix: '/api/sites' });
fastify.register(require('./routes/tkp'), { prefix: '/api/tkp' });
fastify.register(require('./routes/pass_requests'), { prefix: '/api/pass-requests' });
fastify.register(require('./routes/procurement'), { prefix: '/api/procurement' });
fastify.register(require('./routes/assembly'), { prefix: '/api/assembly' });
fastify.register(require('./routes/tmc_requests'), { prefix: '/api/tmc-requests' });
fastify.register(require('./routes/sse'), { prefix: '/api/sse' });
fastify.register(require('./routes/push'), { prefix: '/api/push' });
fastify.register(require('./routes/webauthn'), { prefix: '/api/webauthn' });
fastify.register(require("./routes/training_applications"), { prefix: "/api/training-applications" });
fastify.register(require('./routes/travel'), { prefix: '/api/travel' });
fastify.register(require("./routes/site_inspections"), { prefix: "/api/site-inspections" });
fastify.register(require("./routes/telephony"), { prefix: "/api/telephony" });
fastify.register(require("./routes/approval"), { prefix: "/api/approval" });
fastify.register(require('./routes/stories'), { prefix: '/api/stories' });
fastify.register(require('./routes/worker_profiles'), { prefix: '/api/worker-profiles' });
fastify.register(require('./routes/call-reports'), { prefix: '/api/call-reports' });

// ── Telephony Job Queue & Escalation ──
try {
  const TelephonyJobQueue = require('./services/job-queue');
  const EscalationChecker = require('./services/escalation-checker');
  const CallPipeline = require('./services/call-pipeline');
  const createNotification = require('./services/notify');

  const jobQueue = new TelephonyJobQueue(db, fastify.log);
  const escalationChecker = new EscalationChecker(db, createNotification, fastify.log);

  // Initialize pipeline and register handlers with queue
  let pipeline;
  try {
    const aiProvider = require('./services/ai-provider');
    pipeline = new CallPipeline(db, aiProvider, createNotification);
  } catch (e) {
    pipeline = new CallPipeline(db, null, createNotification);
  }
  pipeline.registerHandlers(jobQueue);
  pipeline.setEscalationChecker(escalationChecker);

  // Recording Fetcher — забирает recording_id через Mango Stats API
  const RecordingFetcher = require('./services/recording-fetcher');
  const recordingFetcher = new RecordingFetcher(db, fastify.log);
  recordingFetcher.setJobQueue(jobQueue);

  // Make queue and escalation available to routes
  fastify.decorate('telephonyQueue', jobQueue);
  fastify.decorate('escalationChecker', escalationChecker);

  // Start workers after server is ready
  fastify.addHook('onReady', async () => {
    jobQueue.start();
    escalationChecker.start();
    recordingFetcher.start();
    fastify.log.info('[Telephony] Job queue, escalation checker and recording fetcher started');
  });

  fastify.addHook('onClose', async () => {
    jobQueue.stop();
    escalationChecker.stop();
    recordingFetcher.stop();
  });
} catch (telErr) {
  fastify.log.warn('[Telephony] Job queue/escalation init skipped: ' + telErr.message);
}

// ── Mimir Cron: Daily Digests ──
try {
  const mimirCron = require('./services/mimir-cron');
  fastify.addHook('onReady', async () => {
    mimirCron.start();
    fastify.log.info('[MimirCron] Daily digest cron started');
  });
  fastify.addHook('onClose', async () => {
    mimirCron.stop();
  });
} catch (cronErr) {
  fastify.log.warn('[MimirCron] Init skipped: ' + cronErr.message);
}

// ── Call Report Scheduler ──
try {
  const ReportScheduler = require('./services/report-scheduler');
  const createNotification = require('./services/notify');
  let aiProv = null;
  try { aiProv = require('./services/ai-provider'); } catch (_) {}
  const reportScheduler = new ReportScheduler(db, aiProv, createNotification, fastify.log);
  fastify.addHook('onReady', async () => {
    await reportScheduler.start();
    fastify.log.info('[ReportScheduler] Call report scheduler started');
  });
  fastify.addHook('onClose', async () => {
    reportScheduler.stop();
  });
} catch (schedErr) {
  fastify.log.warn('[ReportScheduler] Init skipped: ' + schedErr.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional API aliases for missing dedicated endpoints
// ─────────────────────────────────────────────────────────────────────────────
fastify.get('/api/employees', { preHandler: [fastify.authenticate] }, async (request) => {
  const { rows } = await db.query('SELECT * FROM employees ORDER BY id DESC LIMIT 100');
  return { employees: rows };
});
fastify.get('/api/chats', { preHandler: [fastify.authenticate] }, async (request) => {
  const userId = request.user.id;
  const { rows } = await db.query(`
    SELECT c.*, cm.last_read_at FROM chats c
    LEFT JOIN chat_group_members cm ON cm.chat_id = c.id AND cm.user_id = $1
    ORDER BY c.updated_at DESC NULLS LAST LIMIT 50
  `, [userId]);
  return { chats: rows };
});
fastify.get('/api/correspondence', { preHandler: [fastify.authenticate] }, async (request) => {
  const { rows } = await db.query('SELECT * FROM correspondence ORDER BY id DESC LIMIT 100');
  return { correspondence: rows };
});

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
    return;
  }

  // SECURITY: Block path traversal and sensitive file access
  const decodedUrl = decodeURIComponent(request.url).replace(/\\/g, '/');
  if (decodedUrl.includes('..') ||
      decodedUrl.includes('/node_modules') ||
      /\/\.env/i.test(decodedUrl) ||
      /\/\.[a-z]/i.test(decodedUrl) ||
      /\/package\.json/i.test(decodedUrl) ||
      /\/src\//i.test(decodedUrl) ||
      /\/migrations\//i.test(decodedUrl) ||
      /\/tests\//i.test(decodedUrl)) {
    reply.code(403).send({ error: 'Forbidden', message: 'Доступ запрещён' });
    return;
  }

  // React mobile app SPA fallback (/m/* routes)
  const cleanUrl = request.url.split('?')[0];
  if (cleanUrl.startsWith('/m/') && reactMobileHtml) {
    reply.type('text/html').header('Cache-Control', 'no-cache').send(reactMobileHtml);
    return;
  }

  // Serve index.html for SPA routing (UA-aware)
  sendIndexHtml(request, reply);
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

  // Add group-chat columns to chats table if missing
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='is_group') THEN
        ALTER TABLE chats ADD COLUMN is_group BOOLEAN DEFAULT false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='description') THEN
        ALTER TABLE chats ADD COLUMN description TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='type') THEN
        ALTER TABLE chats ADD COLUMN type VARCHAR(50) DEFAULT 'direct';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='archived_at') THEN
        ALTER TABLE chats ADD COLUMN archived_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='last_message_at') THEN
        ALTER TABLE chats ADD COLUMN last_message_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='is_readonly') THEN
        ALTER TABLE chats ADD COLUMN is_readonly BOOLEAN DEFAULT false;
      END IF;
    END $$;
  `);

  // Add group-chat columns to chat_messages table if missing
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='message') THEN
        ALTER TABLE chat_messages ADD COLUMN message TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='reply_to') THEN
        ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='reactions') THEN
        ALTER TABLE chat_messages ADD COLUMN reactions JSONB DEFAULT '{}';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='edited_at') THEN
        ALTER TABLE chat_messages ADD COLUMN edited_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_messages' AND column_name='deleted_at') THEN
        ALTER TABLE chat_messages ADD COLUMN deleted_at TIMESTAMP;
      END IF;
    END $$;
  `);

  // Chat group members table
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_group_members (
      id SERIAL PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role VARCHAR(20) DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT NOW(),
      last_read_at TIMESTAMP,
      muted_until TIMESTAMP,
      UNIQUE(chat_id, user_id)
    )
  `);

  // Chat attachments table
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL,
      file_name VARCHAR(255),
      file_path VARCHAR(500),
      file_size INTEGER,
      mime_type VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Cash (Касса) tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS cash_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      work_id INTEGER,
      type VARCHAR(20) DEFAULT 'advance',
      amount NUMERIC(12,2) NOT NULL,
      purpose TEXT,
      cover_letter TEXT,
      status VARCHAR(30) DEFAULT 'requested',
      director_id INTEGER,
      director_comment TEXT,
      received_at TIMESTAMP,
      closed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cash_expenses (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES cash_requests(id),
      amount NUMERIC(12,2) NOT NULL,
      description TEXT,
      category VARCHAR(50) DEFAULT 'other',
      receipt_file VARCHAR(500),
      receipt_original_name VARCHAR(255),
      expense_date DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add category column if missing (migration for existing installs)
  await db.query(`ALTER TABLE cash_expenses ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'other'`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cash_returns (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES cash_requests(id),
      amount NUMERIC(12,2) NOT NULL,
      note TEXT,
      confirmed_at TIMESTAMP,
      confirmed_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Staff plan table
  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_plan (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER,
      date DATE,
      status_code VARCHAR(20),
      created_by INTEGER,
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

  // Push Subscriptions table (Phase 2)
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_info VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_push_sub_user_id ON push_subscriptions(user_id)`);

  // Add url/body columns to notifications if missing (Phase 2)
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='url') THEN
        ALTER TABLE notifications ADD COLUMN url VARCHAR(500);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='body') THEN
        ALTER TABLE notifications ADD COLUMN body TEXT;
      END IF;
    END $$;
  `);

  // WebAuthn Credentials table (Phase 3)
  await db.query(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      device_name VARCHAR(255) DEFAULT 'Устройство',
      transports TEXT[],
      created_at TIMESTAMP DEFAULT NOW(),
      last_used_at TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON webauthn_credentials(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id)`);

  // WebAuthn Challenges table (temporary, TTL 5 min)
  await db.query(`
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      challenge TEXT NOT NULL,
      type VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
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

    // SECURITY: CORS production check — запрет wildcard; предупреждение о HTTP
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
        fastify.log.error('FATAL: CORS_ORIGIN must be set to specific origin(s) in production (not "*")');
        process.exit(1);
      }
      const origins = process.env.CORS_ORIGIN.split(',');
      const httpOrigin = origins.find(o => o.trim().startsWith('http://'));
      if (httpOrigin) {
        fastify.log.warn('WARNING: CORS_ORIGIN contains HTTP origin: ' + httpOrigin.trim() + '. Use HTTPS in production for full security.');
      }
    }

    // Test database connection
    await db.query('SELECT NOW()');
    fastify.log.info('Database connected');

    // Ensure required tables exist
    await ensureTables();
    fastify.log.info('Database tables verified');

    // ── Cron: автоудаление завершённых напоминаний ─────────────────────
    async function cleanupCompletedReminders() {
      try {
        // Получаем настройку (по умолчанию 48 часов)
        let hours = 48;
        try {
          const res = await db.query(
            `SELECT value_json FROM settings WHERE key = 'app' LIMIT 1`
          );
          if (res.rows[0]?.value_json) {
            const cfg = JSON.parse(res.rows[0].value_json);
            if (cfg.reminder_auto_delete_hours != null) {
              hours = Math.max(1, Number(cfg.reminder_auto_delete_hours) || 48);
            }
          }
        } catch (_) {}

        const result = await db.query(
          `DELETE FROM reminders
           WHERE (completed = true OR dismissed = true)
             AND due_date < NOW() - INTERVAL '1 hour' * $1
           RETURNING id`,
          [hours]
        );
        if (result.rowCount > 0) {
          fastify.log.info(`[Cron] Удалено ${result.rowCount} завершённых напоминаний (порог: ${hours}ч)`);
        }
      } catch (err) {
        fastify.log.error('[Cron] Ошибка очистки напоминаний: ' + err.message);
      }
    }

    // Запуск каждый час
    setInterval(cleanupCompletedReminders, 60 * 60 * 1000);
    // Первый запуск через 10 секунд после старта
    setTimeout(cleanupCompletedReminders, 10_000);
    fastify.log.info('[Cron] Автоочистка напоминаний запланирована');

    // Initialize Telegram bot (from env var or DB settings)
    try {
      const telegram = require('./services/telegram');
      await telegram.init();
      if (telegram.getBot()) {
        fastify.log.info('Telegram bot started');
      }
    } catch (e) {
      fastify.log.warn('Telegram bot init failed:', e.message);
    }

    // Initialize IMAP mail collection service
    try {
      const imapService = require('./services/imap');
      await imapService.init();
      fastify.log.info('IMAP mail service started');
      try { const imapSvc = require("./services/imap"); imapSvc.startPersonalPolling(); fastify.log.info("Personal IMAP polling started"); } catch(pe) { fastify.log.warn("Personal IMAP init skipped: " + pe.message); }
      try { const folderSorter = require("./services/email-folder-sorter"); folderSorter.initCrmFolders(); setInterval(() => folderSorter.processNewCrmEmails().catch(e => console.error("[FolderSorter]", e.message)), 300000); fastify.log.info("Email folder sorter initialized"); } catch(fse) { fastify.log.warn("Folder sorter init skipped: " + fse.message); }
    } catch (imapErr) {
      fastify.log.warn('IMAP mail service init skipped: ' + imapErr.message);
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

    // Auto-archive tasks completed >48h ago (runs every hour)
    setInterval(async () => {
      try {
        const result = await db.query(`
          UPDATE tasks SET archived_at = NOW()
          WHERE status IN ('done', 'completed') AND archived_at IS NULL
          AND updated_at < NOW() - INTERVAL '48 hours'
        `);
        if (result.rowCount > 0) {
          console.log(`[Auto-archive] Archived ${result.rowCount} tasks`);
        }
      } catch (archiveErr) {
        console.error('[Auto-archive] Error:', archiveErr.message);
      }
    }, 3600000); // every hour
    // ─── Cash receipt deadline checker (every 30 min) ───
    setInterval(async () => {
      try {
        // Найти заявки с просроченным дедлайном (не старше 24ч, ещё не уведомлены)
        const overdue = await db.query(`
          SELECT cr.id, cr.amount, cr.user_id, cr.receipt_deadline,
                 u.name as user_name
          FROM cash_requests cr
          JOIN users u ON u.id = cr.user_id
          WHERE cr.status = 'money_issued'
            AND cr.receipt_deadline < NOW()
            AND cr.receipt_deadline > NOW() - INTERVAL '24 hours'
            AND (cr.overdue_notified IS NULL OR cr.overdue_notified = false)
        `);

        if (overdue.rows.length > 0) {
          const { createNotification } = require('./services/notify');

          for (const req of overdue.rows) {
            // Уведомление директорам
            const directors = await db.query(
              `SELECT id FROM users WHERE role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV') AND is_active = true`
            );
            for (const dir of directors.rows) {
              createNotification(db, {
                user_id: dir.id,
                title: '⚠️ Просрочка подтверждения кассы',
                message: `${req.user_name} не подтвердил получение ${req.amount} ₽ (заявка #${req.id})`,
                type: 'cash',
                link: `#/cash-admin?id=${req.id}`
              });
            }

            // Уведомление РП
            createNotification(db, {
              user_id: req.user_id,
              title: '⚠️ Подтвердите получение денег!',
              message: `Просрочен дедлайн подтверждения получения ${req.amount} ₽. Пожалуйста, подтвердите.`,
              type: 'cash',
              link: `#/cash?id=${req.id}`
            });

            // Пометить как уведомлённый
            await db.query(
              'UPDATE cash_requests SET overdue_notified = true WHERE id = $1',
              [req.id]
            );
          }

          console.log(`[Cash-Deadline] Sent overdue notifications for ${overdue.rows.length} requests`);
        }
      } catch (err) {
        console.error('[Cash-Deadline] Error:', err.message);
      }
    }, 30 * 60 * 1000); // каждые 30 мин
    console.log('[Cron] Cash receipt deadline checker scheduled (every 30 min)');

    // ─── Procurement overdue monitor (every hour) ───
    setInterval(async()=>{
      try{
        const {createNotification}=require('./services/notify');
        const lock=await db.query('SELECT pg_try_advisory_lock(42001)');
        if(!lock.rows[0].pg_try_advisory_lock)return;
        try{
          const ov=await db.query(`SELECT pr.id,pr.pm_id,pr.proc_id,pr.delivery_deadline,w.work_title,
            CURRENT_DATE-pr.delivery_deadline as days_overdue FROM procurement_requests pr LEFT JOIN works w ON pr.work_id=w.id
            WHERE pr.status IN('paid','partially_delivered') AND pr.delivery_deadline IS NOT NULL
            AND pr.delivery_deadline<CURRENT_DATE AND pr.delivered_at IS NULL`);
          for(const pr of ov.rows){
            const dl=new Date(pr.delivery_deadline).toLocaleDateString('ru-RU');
            const msg=`#${pr.id} «${pr.work_title||''}» — дедлайн ${dl} просрочен на ${pr.days_overdue} дн.`;
            const ex=await db.query(`SELECT id FROM notifications WHERE user_id=$1 AND type='procurement_overdue' AND link=$2 AND created_at>CURRENT_DATE LIMIT 1`,
              [pr.pm_id,`#/procurement?id=${pr.id}`]);
            if(!ex.rows.length){
              if(pr.pm_id) createNotification(db,{user_id:pr.pm_id,title:'⚠️ Просрочка',message:msg,type:'procurement_overdue',link:`#/procurement?id=${pr.id}`});
              if(pr.proc_id) createNotification(db,{user_id:pr.proc_id,title:'⚠️ Просрочка',message:msg,type:'procurement_overdue',link:`#/procurement?id=${pr.id}`});
            }
          }
        }finally{await db.query('SELECT pg_advisory_unlock(42001)');}
      }catch(e){console.error('[overdue]',e.message);}
    },3600000);
    console.log('[Cron] Procurement overdue monitor scheduled (every hour)');

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  try { const imap = require('./services/imap'); await imap.shutdown(); } catch (_) {}
  await fastify.close();
  await db.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
