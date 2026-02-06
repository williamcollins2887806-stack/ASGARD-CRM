/**
 * Settings Routes
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: Скрытие чувствительных настроек от не-админов (HIGH-11)
// ═══════════════════════════════════════════════════════════════════════════
const SENSITIVE_KEYS = ['smtp_config', 'smtp_from', 'smtp_password', 'api_keys', 'telegram_bot_token'];

async function routes(fastify, options) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query('SELECT * FROM settings');
    const settings = {};
    const isAdmin = request.user.role === 'ADMIN';

    for (const row of result.rows) {
      // SECURITY: Скрываем чувствительные настройки от не-админов (HIGH-11)
      if (!isAdmin && SENSITIVE_KEYS.includes(row.key)) {
        continue;
      }

      try {
        settings[row.key] = JSON.parse(row.value_json);
      } catch (e) {
        settings[row.key] = row.value_json;
      }
    }
    return { settings };
  });

  // ВАЖНО: Специфичные маршруты ДОЛЖНЫ быть ДО параметризованных
  // References (tender_statuses, reject_reasons, etc.)
  fastify.get('/refs/all', { preHandler: [fastify.authenticate] }, async (request) => {
    const result = await db.query("SELECT * FROM settings WHERE key = 'refs'");
    if (!result.rows[0]) {
      return {
        refs: {
          tender_statuses: ['Новый', 'В просчёте', 'КП отправлено', 'Переговоры', 'Выиграли', 'Проиграли'],
          reject_reasons: ['Цена', 'Сроки', 'Выбрали другого', 'Отмена тендера'],
          expense_categories: ['ФОТ', 'Логистика', 'Проживание', 'Материалы', 'Субподряд', 'Прочее']
        }
      };
    }
    return { refs: JSON.parse(result.rows[0].value_json) };
  });

  fastify.get('/:key', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { key } = request.params;
    const isAdmin = request.user.role === 'ADMIN';

    // SECURITY: Блокируем доступ к чувствительным настройкам для не-админов (HIGH-11)
    if (!isAdmin && SENSITIVE_KEYS.includes(key)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Доступ к этой настройке запрещён' });
    }

    const result = await db.query('SELECT * FROM settings WHERE key = $1', [key]);
    if (!result.rows[0]) return { key, value: null };
    try {
      return { key: result.rows[0].key, value: JSON.parse(result.rows[0].value_json) };
    } catch (e) {
      return { key: result.rows[0].key, value: result.rows[0].value_json };
    }
  });

  fastify.put('/:key', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { key } = request.params;
    const { value } = request.body;
    const valueJson = JSON.stringify(value);
    const userId = request.user.id;
    const userRole = request.user.role;

    // Разрешаем пользователям сохранять только свои dash_layout настройки
    // Остальные настройки могут менять только админы
    const isUserOwnDashLayout = key.startsWith('dash_layout_') && key === `dash_layout_${userId}`;
    const isAdmin = userRole === 'ADMIN';

    if (!isUserOwnDashLayout && !isAdmin) {
      return reply.code(403).send({ error: 'Доступ запрещён' });
    }

    await db.query(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, [key, valueJson]);

    return { key, value };
  });

  fastify.delete('/:key', { preHandler: [fastify.requireRoles(['ADMIN'])] }, async (request, reply) => {
    const result = await db.query('DELETE FROM settings WHERE key = $1 RETURNING key', [request.params.key]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    return { message: 'Удалено' };
  });
}

module.exports = routes;
