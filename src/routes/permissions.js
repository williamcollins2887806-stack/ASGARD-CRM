'use strict';

/**
 * Permissions Routes — Модульные роли (M1)
 *
 * Эндпоинты для управления правами доступа пользователей к модулям CRM.
 * Обратная совместимость: старые роли работают как пресеты.
 */

module.exports = async function(fastify) {
  const db = fastify.db;

  // ─────────────────────────────────────────────────────────────────
  // GET /api/permissions/modules — Справочник всех модулей
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/modules', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { rows } = await db.query(
      'SELECT * FROM modules WHERE is_active = true ORDER BY sort_order'
    );
    return rows;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/permissions/presets — Все пресеты ролей
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/presets', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { rows } = await db.query(
      'SELECT * FROM role_presets ORDER BY role, module_key'
    );
    // Группировка: { PM: { tenders: {read:true, write:true, delete:false}, ... }, ... }
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.role]) grouped[row.role] = {};
      grouped[row.role][row.module_key] = {
        read: row.can_read,
        write: row.can_write,
        delete: row.can_delete
      };
    }
    return grouped;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/permissions/user/:userId — Пермишены конкретного пользователя
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/user/:userId', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const userId = parseInt(request.params.userId);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Invalid userId' });

    const { rows } = await db.query(
      'SELECT module_key, can_read, can_write, can_delete FROM user_permissions WHERE user_id = $1',
      [userId]
    );

    const perms = {};
    for (const row of rows) {
      perms[row.module_key] = {
        read: row.can_read,
        write: row.can_write,
        delete: row.can_delete
      };
    }
    return perms;
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /api/permissions/my — Мои пермишены (для фронтенда после логина)
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/my', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user.id;

    // ADMIN получает всё
    if (request.user.role === 'ADMIN') {
      const { rows: modules } = await db.query('SELECT key FROM modules WHERE is_active = true');
      const perms = {};
      for (const m of modules) {
        perms[m.key] = { read: true, write: true, delete: true };
      }
      return perms;
    }

    const { rows } = await db.query(
      'SELECT module_key, can_read, can_write, can_delete FROM user_permissions WHERE user_id = $1',
      [userId]
    );

    const perms = {};
    for (const row of rows) {
      perms[row.module_key] = {
        read: row.can_read,
        write: row.can_write,
        delete: row.can_delete
      };
    }
    return perms;
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /api/permissions/user/:userId — Обновить пермишены пользователя
  // Тело: { permissions: { "tenders": { read:true, write:true, delete:false }, ... } }
  // ─────────────────────────────────────────────────────────────────
  fastify.put('/user/:userId', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const userId = parseInt(request.params.userId);
    if (isNaN(userId)) return reply.code(400).send({ error: 'Invalid userId' });

    const { permissions } = request.body;
    if (!permissions || typeof permissions !== 'object') {
      return reply.code(400).send({ error: 'permissions object required' });
    }

    const grantedBy = request.user.id;

    // Транзакция: удалить старые, вставить новые
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем все текущие пермишены
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

      // Вставляем новые
      for (const [moduleKey, ops] of Object.entries(permissions)) {
        if (ops.read || ops.write || ops.delete) {
          await client.query(
            `INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, moduleKey, !!ops.read, !!ops.write, !!ops.delete, grantedBy]
          );
        }
      }

      await client.query('COMMIT');
      return { success: true, message: 'Права обновлены' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /api/permissions/apply-preset — Применить пресет роли к пользователю
  // Тело: { userId: 5, role: 'PM' }
  // ─────────────────────────────────────────────────────────────────
  fastify.post('/apply-preset', {
    preHandler: [fastify.requireRoles(['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'])]
  }, async (request, reply) => {
    const { userId, role } = request.body;
    if (!userId || !role) return reply.code(400).send({ error: 'userId and role required' });

    const grantedBy = request.user.id;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем старые пермишены
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

      // Копируем из пресета
      await client.query(`
        INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
        SELECT $1, module_key, can_read, can_write, can_delete, $2
        FROM role_presets WHERE role = $3
      `, [userId, grantedBy, role]);

      await client.query('COMMIT');
      return { success: true, message: `Применён пресет роли ${role}` };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET/PUT /api/permissions/menu — Настройки меню пользователя
  // ─────────────────────────────────────────────────────────────────
  fastify.get('/menu', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { rows } = await db.query(
      'SELECT hidden_routes, route_order FROM user_menu_settings WHERE user_id = $1',
      [request.user.id]
    );
    return rows[0] || { hidden_routes: [], route_order: [] };
  });

  fastify.put('/menu', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const { hidden_routes = [], route_order = [] } = request.body;
    await db.query(`
      INSERT INTO user_menu_settings (user_id, hidden_routes, route_order, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id) DO UPDATE SET hidden_routes = $2, route_order = $3, updated_at = NOW()
    `, [request.user.id, JSON.stringify(hidden_routes), JSON.stringify(route_order)]);
    return { success: true };
  });
};
