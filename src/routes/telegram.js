/**
 * Telegram Integration Routes (React v2 migration)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Заменяет vanilla `public/assets/js/telegram.js`. Все настройки и операции
 * с Telegram Bot API проксируются через backend — bot_token никогда не уходит
 * в браузер (показывается только маскированная версия `...wxyz`).
 *
 * Endpoints (ADMIN only):
 *   GET    /api/telegram/settings           — настройки бота (token замаскирован)
 *   PUT    /api/telegram/settings           — сохранить настройки + рестарт polling
 *   GET    /api/telegram/check-bot          — getMe от Telegram API
 *   GET    /api/telegram/users              — список юзеров CRM с chat_id
 *   PUT    /api/telegram/users/:id/chat-id  — обновить telegram_chat_id юзера
 *   POST   /api/telegram/test-message       — отправить тест-сообщение юзеру
 *   POST   /api/telegram/send               — отправить сообщение (ADMIN/PM/HEAD_PM)
 *
 * Bot token хранится в таблице `settings` (key='telegram', value_json=JSON).
 * Структура value_json: { bot_token, bot_username, webhook_url, enabled }.
 */

const SETTINGS_KEY = 'telegram';

// Маскирует bot_token, оставляя только последние 4 символа.
function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length <= 4) return '****';
  return '...' + token.slice(-4);
}

// Достаёт сохранённые настройки Telegram из settings.
async function loadSettings(db) {
  try {
    const r = await db.query(
      "SELECT value_json FROM settings WHERE key = $1",
      [SETTINGS_KEY]
    );
    if (!r.rows[0]?.value_json) return {};
    let parsed = JSON.parse(r.rows[0].value_json);
    // На случай legacy-формата (vanilla сохранял { value_json: '{...}' })
    if (parsed && typeof parsed === 'object' && typeof parsed.value_json === 'string') {
      try { parsed = JSON.parse(parsed.value_json); } catch (_) {}
    }
    return parsed || {};
  } catch (e) {
    return {};
  }
}

// Сохраняет настройки в settings.
async function saveSettings(db, settings) {
  await db.query(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(settings)]
  );
}

// Прямой вызов Telegram Bot API через fetch.
// Возвращает { ok, result | error_code, description }.
async function callTelegramApi(token, method, body) {
  if (!token) return { ok: false, description: 'Bot token not configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: e.message || 'Network error' };
  }
}

async function routes(fastify, options) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/telegram/settings — настройки бота (token замаскирован)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/settings', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async () => {
    const s = await loadSettings(db);
    return {
      bot_token_mask: maskToken(s.bot_token),
      has_token: Boolean(s.bot_token),
      bot_username: s.bot_username || '',
      webhook_url: s.webhook_url || '',
      enabled: s.enabled !== false,
      updated_at: s.updated_at || null
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /api/telegram/settings — сохранить настройки бота
  // body: { bot_token?, bot_username?, webhook_url?, enabled? }
  // Если bot_token не передан или пустой — старый сохраняется (для смены
  // только username/webhook/enabled без раскрытия токена клиенту).
  // ─────────────────────────────────────────────────────────────────────────
  fastify.put('/settings', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { bot_token, bot_username, webhook_url, enabled } = request.body || {};
    const current = await loadSettings(db);

    const next = {
      bot_token: (typeof bot_token === 'string' && bot_token.trim())
        ? bot_token.trim()
        : (current.bot_token || ''),
      bot_username: typeof bot_username === 'string' ? bot_username.trim() : (current.bot_username || ''),
      webhook_url: typeof webhook_url === 'string' ? webhook_url.trim() : (current.webhook_url || ''),
      enabled: typeof enabled === 'boolean' ? enabled : (current.enabled !== false),
      updated_at: new Date().toISOString()
    };

    await saveSettings(db, next);

    // Попытка рестарта polling сервиса, чтобы изменения применились без рестарта Node.
    let restarted = false;
    try {
      const telegram = require('../services/telegram');
      // Если token поменялся или был добавлен — нужен полноценный re-init.
      // shutdown + init дают чистую инициализацию с новым токеном.
      try { await telegram.shutdown(); } catch (_) {}
      try { await telegram.init(); restarted = true; } catch (_) {}
    } catch (e) {
      fastify.log.warn?.('[telegram-route] Restart failed: ' + (e.message || e));
    }

    return {
      ok: true,
      bot_token_mask: maskToken(next.bot_token),
      has_token: Boolean(next.bot_token),
      bot_username: next.bot_username,
      webhook_url: next.webhook_url,
      enabled: next.enabled,
      updated_at: next.updated_at,
      restarted
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/telegram/check-bot — getMe от Telegram API
  // Проверяет валидность токена + возвращает username бота.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/check-bot', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const s = await loadSettings(db);
    if (!s.bot_token) {
      return reply.code(400).send({ ok: false, error: 'Токен бота не настроен' });
    }
    const result = await callTelegramApi(s.bot_token, 'getMe', {});
    if (!result.ok) {
      return reply.code(400).send({
        ok: false,
        error: result.description || 'Ошибка проверки бота',
        error_code: result.error_code || null
      });
    }
    const info = result.result || {};
    // Авто-сохраняем username, чтобы UI всегда показывал актуальный.
    if (info.username && info.username !== s.bot_username) {
      await saveSettings(db, { ...s, bot_username: info.username, updated_at: new Date().toISOString() });
    }
    return {
      ok: true,
      id: info.id,
      username: info.username,
      first_name: info.first_name,
      can_join_groups: info.can_join_groups,
      can_read_all_group_messages: info.can_read_all_group_messages,
      supports_inline_queries: info.supports_inline_queries
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/telegram/users — список юзеров CRM с telegram_chat_id
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/users', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request) => {
    const { search } = request.query || {};
    let sql = `
      SELECT id, login, name, email, role, telegram_chat_id, is_active
      FROM users
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (search && String(search).trim()) {
      sql += ` AND (LOWER(name) LIKE $${idx} OR LOWER(login) LIKE $${idx} OR LOWER(COALESCE(email,'')) LIKE $${idx})`;
      params.push('%' + String(search).toLowerCase() + '%');
      idx++;
    }
    sql += ` ORDER BY name ASC NULLS LAST`;
    const r = await db.query(sql, params);
    return { users: r.rows };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /api/telegram/users/:id/chat-id — обновить telegram_chat_id юзера
  // body: { chat_id: string|null }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.put('/users/:id/chat-id', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const userId = parseInt(request.params.id, 10);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Некорректный ID пользователя' });

    const raw = (request.body || {}).chat_id;
    const chatId = (raw === null || raw === '' || raw === undefined)
      ? null
      : String(raw).trim();

    // Лёгкая валидация: chat_id — целое число (положительное для приватных
    // чатов, отрицательное для групп). Telegram chat IDs могут быть до ±10^14.
    if (chatId !== null && !/^-?\d+$/.test(chatId)) {
      return reply.code(400).send({ error: 'Chat ID должен быть числом (например 123456789)' });
    }

    const r = await db.query(
      `UPDATE users SET telegram_chat_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, login, telegram_chat_id`,
      [chatId, userId]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'Пользователь не найден' });
    return { ok: true, user: r.rows[0] };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/telegram/test-message — отправить тест-сообщение юзеру
  // body: { user_id, text? }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/test-message', {
    preHandler: [fastify.requireRoles(['ADMIN'])]
  }, async (request, reply) => {
    const { user_id, text } = request.body || {};
    const userId = parseInt(user_id, 10);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Не указан user_id' });

    const userRes = await db.query(
      'SELECT id, name, telegram_chat_id FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rows[0]) return reply.code(404).send({ error: 'Пользователь не найден' });
    const user = userRes.rows[0];
    if (!user.telegram_chat_id) {
      return reply.code(400).send({ error: 'У пользователя не привязан Telegram (нет chat_id)' });
    }

    const s = await loadSettings(db);
    if (!s.bot_token) {
      return reply.code(400).send({ error: 'Токен бота не настроен' });
    }

    const message = (typeof text === 'string' && text.trim())
      ? text.trim()
      : `✅ *Тест ASGARD CRM*\n\nТестовое сообщение отправлено администратором *${request.user.name || request.user.login}*.\n\nЕсли вы видите это — связь с ботом работает.`;

    const result = await callTelegramApi(s.bot_token, 'sendMessage', {
      chat_id: user.telegram_chat_id,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });

    if (!result.ok) {
      return reply.code(400).send({
        ok: false,
        error: result.description || 'Ошибка отправки',
        error_code: result.error_code || null
      });
    }
    return { ok: true, message_id: result.result?.message_id, user: { id: user.id, name: user.name } };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/telegram/send — отправить сообщение конкретному юзеру
  // body: { to_user_id, text, parse_mode? }
  // Доступно ADMIN/PM/HEAD_PM (например, чтобы РП написать прорабу).
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/send', {
    preHandler: [fastify.requireRoles(['ADMIN', 'PM', 'HEAD_PM'])]
  }, async (request, reply) => {
    const { to_user_id, text, parse_mode } = request.body || {};
    const userId = parseInt(to_user_id, 10);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Не указан to_user_id' });
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'Пустой текст сообщения' });
    }

    const userRes = await db.query(
      'SELECT id, name, telegram_chat_id FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rows[0]) return reply.code(404).send({ error: 'Получатель не найден' });
    const recipient = userRes.rows[0];
    if (!recipient.telegram_chat_id) {
      return reply.code(400).send({ error: 'У получателя не привязан Telegram' });
    }

    const s = await loadSettings(db);
    if (!s.bot_token) {
      return reply.code(400).send({ error: 'Токен бота не настроен' });
    }
    if (s.enabled === false) {
      return reply.code(400).send({ error: 'Telegram-уведомления отключены в настройках' });
    }

    const result = await callTelegramApi(s.bot_token, 'sendMessage', {
      chat_id: recipient.telegram_chat_id,
      text: text.trim(),
      parse_mode: parse_mode || 'Markdown',
      disable_web_page_preview: true
    });

    if (!result.ok) {
      return reply.code(400).send({
        ok: false,
        error: result.description || 'Ошибка отправки',
        error_code: result.error_code || null
      });
    }
    return { ok: true, message_id: result.result?.message_id };
  });
}

module.exports = routes;
