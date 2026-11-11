'use strict';
/**
 * ui-prefs.js — пользовательские настройки интерфейса.
 *
 * ── Зачем серверу хранить «что свёрнуто» ──────────────────────────────────
 * В ДВ 603 позиции и 43 периода. РП каждую сессию открывает свой период
 * (например, «май») и сворачивает остальные. Если состояние живёт в памяти
 * вкладки, после перезагрузки всё развёрнуто, и он снова листает 603 строки.
 * Поэтому состояние хранится за пользователем.
 *
 * ── Ключ настроек ─────────────────────────────────────────────────────────
 * Один пользователь — много ключей (`collapsed_periods`, `dv_columns`, …).
 * Значение — произвольный JSON, но с ограничением размера: это настройки,
 * а не хранилище данных.
 */

/** Максимальный размер значения — 64 КБ. Больше в настройки не кладут. */
const MAX_VALUE_BYTES = 64 * 1024;

/** Допустимые символы в ключе: латиница, цифры, подчёркивание, точка, дефис. */
const KEY_RE = /^[a-z][a-z0-9_.-]{0,63}$/i;

async function uiPrefsRoutes(fastify) {
  /** GET /api/ui-prefs — все настройки пользователя. */
  fastify.get('/', {
    preHandler: [fastify.authenticate]
  }, async (request) => {
    const userId = request.user && request.user.id;
    const r = await fastify.pg.query(
      'SELECT key, value, updated_at FROM user_ui_prefs WHERE user_id = $1',
      [userId]
    );
    const prefs = {};
    for (const row of r.rows) prefs[row.key] = row.value;
    return { ok: true, prefs };
  });

  /** GET /api/ui-prefs/:key — одна настройка (или пустой объект). */
  fastify.get('/:key', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const key = String(request.params.key || '');
    if (!KEY_RE.test(key)) {
      return reply.code(400).send({ ok: false, error: 'Недопустимый ключ настройки' });
    }
    const r = await fastify.pg.query(
      'SELECT value FROM user_ui_prefs WHERE user_id = $1 AND key = $2',
      [request.user.id, key]
    );
    return { ok: true, key, value: r.rows[0] ? r.rows[0].value : null };
  });

  /** PUT /api/ui-prefs/:key — сохранить настройку. */
  fastify.put('/:key', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const key = String(request.params.key || '');
    if (!KEY_RE.test(key)) {
      return reply.code(400).send({ ok: false, error: 'Недопустимый ключ настройки' });
    }
    const value = request.body && Object.prototype.hasOwnProperty.call(request.body, 'value')
      ? request.body.value
      : request.body;
    if (value === undefined) {
      return reply.code(400).send({ ok: false, error: 'Нет значения' });
    }
    // Размер проверяем по факту сериализации: строка «x» и объект на 1000
    // ключей весят по-разному, а ограничение — про объём.
    let serialized;
    try { serialized = JSON.stringify(value); } catch (_) {
      return reply.code(400).send({ ok: false, error: 'Значение не сериализуется' });
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
      return reply.code(413).send({ ok: false, error: 'Настройка слишком большая' });
    }

    await fastify.pg.query(
      `INSERT INTO user_ui_prefs (user_id, key, value, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [request.user.id, key, serialized]
    );
    return { ok: true, key };
  });

  /**
   * POST /api/ui-prefs/:key/merge — частичное обновление объекта.
   *
   * Нужно для свёрнутых периодов: клиент шлёт { "май": true }, и это
   * добавляется к уже сохранённому, а не заменяет его. Иначе два окна
   * затирают настройки друг друга.
   */
  fastify.post('/:key/merge', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const key = String(request.params.key || '');
    if (!KEY_RE.test(key)) {
      return reply.code(400).send({ ok: false, error: 'Недопустимый ключ настройки' });
    }
    const patch = request.body && request.body.value !== undefined
      ? request.body.value
      : request.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return reply.code(400).send({ ok: false, error: 'Ожидался объект' });
    }

    const r = await fastify.pg.query(
      `INSERT INTO user_ui_prefs (user_id, key, value, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, key)
       DO UPDATE SET value = user_ui_prefs.value || EXCLUDED.value, updated_at = NOW()
       RETURNING value`,
      [request.user.id, key, JSON.stringify(patch)]
    );
    return { ok: true, key, value: r.rows[0] ? r.rows[0].value : patch };
  });

  /** DELETE /api/ui-prefs/:key — сброс настройки. */
  fastify.delete('/:key', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const key = String(request.params.key || '');
    if (!KEY_RE.test(key)) {
      return reply.code(400).send({ ok: false, error: 'Недопустимый ключ настройки' });
    }
    await fastify.pg.query(
      'DELETE FROM user_ui_prefs WHERE user_id = $1 AND key = $2',
      [request.user.id, key]
    );
    return { ok: true, key };
  });
}

module.exports = uiPrefsRoutes;
module.exports.MAX_VALUE_BYTES = MAX_VALUE_BYTES;
module.exports.KEY_RE = KEY_RE;
