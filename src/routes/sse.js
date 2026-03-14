/**
 * ASGARD CRM — Server-Sent Events (SSE)
 * Real-time обновления для модулей: pre-tenders, tenders
 *
 * GET /api/sse/stream — основной SSE endpoint (авторизация через ?token=...)
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// Хранилище подключённых клиентов
// ═══════════════════════════════════════════════════════════════
const clients = new Map(); // userId → Set<Response>

/**
 * Отправить событие конкретному пользователю
 */
function sendToUser(userId, event, data) {
  const conns = clients.get(userId);
  if (!conns || conns.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try { res.write(payload); } catch (_) { conns.delete(res); }
  }
}

/**
 * Отправить событие всем пользователям с определёнными ролями
 */
function sendToRoles(roles, event, data) {
  for (const [userId, conns] of clients) {
    if (conns.size === 0) continue;
    // Роль хранится на первом соединении
    const firstConn = conns.values().next().value;
    if (firstConn && firstConn._sseRole && roles.includes(firstConn._sseRole)) {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of conns) {
        try { res.write(payload); } catch (_) { conns.delete(res); }
      }
    }
  }
}

/**
 * Отправить событие всем подключённым клиентам
 */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, conns] of clients) {
    for (const res of conns) {
      try { res.write(payload); } catch (_) { conns.delete(res); }
    }
  }
}

/**
 * Получить статистику подключений
 */
function getStats() {
  let totalConns = 0;
  for (const conns of clients.values()) totalConns += conns.size;
  return { users: clients.size, connections: totalConns };
}

// ═══════════════════════════════════════════════════════════════
// Fastify route
// ═══════════════════════════════════════════════════════════════

async function sseRoutes(fastify) {
  // GET /api/sse/stream?token=JWT
  fastify.get('/stream', async (request, reply) => {
    // Авторизация через query-параметр (EventSource не поддерживает заголовки)
    const token = request.query.token;
    if (!token) {
      return reply.code(401).send({ error: 'Token required' });
    }

    let user;
    try {
      user = fastify.jwt.verify(token);
    } catch (err) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const userId = user.id;
    const userRole = user.role;

    // Отключаем буферизацию
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // nginx
    });

    // Начальное событие
    raw.write(`event: connected\ndata: ${JSON.stringify({ userId, ts: Date.now() })}\n\n`);

    // Сохраняем роль на объекте response
    raw._sseRole = userRole;
    raw._sseUserId = userId;

    // Добавляем в хранилище
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(raw);

    // Heartbeat каждые 30 сек (чтобы соединение не рвалось)
    const heartbeat = setInterval(() => {
      try { raw.write(`: heartbeat ${Date.now()}\n\n`); } catch (_) { clearInterval(heartbeat); }
    }, 30000);

    // Cleanup при закрытии соединения
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      const conns = clients.get(userId);
      if (conns) {
        conns.delete(raw);
        if (conns.size === 0) {
          clients.delete(userId);
          // Auto-cleanup: если у пользователя нет активных SSE-соединений,
          // сбрасываем is_call_dispatcher через 60 секунд (даёт время на reconnect)
          setTimeout(async () => {
            const stillConnected = clients.has(userId);
            if (!stillConnected) {
              try {
                const db = require('../services/db');
                const wasDispatcher = await db.query(
                  'SELECT is_call_dispatcher FROM user_call_status WHERE user_id = $1 AND is_call_dispatcher = true',
                  [userId]
                );
                if (wasDispatcher.rows.length) {
                  await db.query(
                    'UPDATE user_call_status SET is_call_dispatcher = false, updated_at = NOW() WHERE user_id = $1',
                    [userId]
                  );
                  console.log('[SSE] Auto-cleanup: dispatcher ' + userId + ' disconnected, role cleared');
                }
              } catch (e) {
                console.error('[SSE] Dispatcher cleanup error:', e.message);
              }
            }
          }, 60000); // 60 секунд на reconnect
        }
      }
    });

    // Не закрываем reply — это long-lived connection
    // Fastify не должен вызывать reply.send()
  });

  // GET /api/sse/stats — для мониторинга
  fastify.get('/stats', {
    preHandler: [fastify.authenticate]
  }, async () => {
    return getStats();
  });
}

// Экспортируем route + функции для использования из других модулей
module.exports = sseRoutes;
module.exports.sendToUser = sendToUser;
module.exports.sendToRoles = sendToRoles;
module.exports.broadcast = broadcast;
module.exports.getStats = getStats;
