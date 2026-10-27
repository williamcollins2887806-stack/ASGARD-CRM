'use strict';

/**
 * Линия оператора (multi-line, V442).
 *
 * Раньше «линия» была эксклюзивным ресурсом: partial-unique индекс
 * uniq_pbx_operators_single_on_line (V376) допускал ровно одну on_line=true,
 * а claimLine снимал линию у предыдущего владельца. Из-за этого:
 *   • на линии физически не могло быть двух человек;
 *   • вставший вторым «выбивал» первого из очереди входящих;
 *   • при разговоре первого перехват мог обрывать вызов.
 *
 * Теперь (инцидент 27.10.2026) линия — это «я готов принимать входящие».
 * Входящий звонит ВСЕМ, кто on_line, и достаётся первому ответившему.
 * Поэтому joinLine НЕ трогает on_line других операторов.
 */

const PBX_CHANNEL = 'pbx_call_event';

/**
 * Достать клиента для транзакции.
 *
 * ВАЖНО (инцидент 10.10.2026): модуль src/services/db.js экспортирует `pool`,
 * но НЕ экспортирует `connect`. Вызов db.connect() падает с
 * «db.connect is not a function». Поддерживаем оба варианта.
 */
function getPool(db) {
  if (db && typeof db.connect === 'function') return db;
  if (db && db.pool && typeof db.pool.connect === 'function') return db.pool;
  throw new Error('db.connect is not a function (нет ни connect, ни pool.connect)');
}

/**
 * Встать на линию. Других операторов НЕ снимает (multi-line).
 *
 * @param {import('pg').Pool|{pool: import('pg').Pool}} db
 * @param {number} userId
 * @param {{receiveMode?: string}} [opts]
 * @returns {Promise<{ok: boolean, previousUserId: null, previousInCall: false, previousChannel: null, onLineCount: number}>}
 */
async function joinLine(db, userId, opts = {}) {
  const receiveMode = ['browser', 'mobile', 'both'].includes(opts.receiveMode)
    ? opts.receiveMode
    : undefined;

  const client = await getPool(db).connect();
  let onLineCount = 0;
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO pbx_operators (user_id, on_line, receive_mode, on_line_since, on_line_by, last_seen_at, updated_at)
       VALUES ($1, true, COALESCE($2, 'browser'), NOW(), $1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         on_line = true,
         receive_mode = COALESCE($2, pbx_operators.receive_mode),
         on_line_since = NOW(),
         on_line_by = $1,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [userId, receiveMode || null]
    );

    // Сколько всего на линии — для UI («на линии: N») и диагностики.
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pbx_operators WHERE on_line = true`
    );
    onLineCount = rows[0]?.n || 0;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return {
    ok: true,
    previousUserId: null,
    previousInCall: false,
    previousChannel: null,
    onLineCount,
  };
}

/**
 * Совместимость: раньше «взять линию» означало перехват у прежнего владельца.
 * Оставлено как алиас к joinLine — вызывающий код (`/operator/claim-line`) не
 * меняется, но поведение теперь неотбирающее.
 *
 * @deprecated используйте joinLine (семантика теперь другая).
 */
async function claimLine(db, userId, opts = {}) {
  const r = await joinLine(db, userId, opts);
  // Уведомляем об изменении состава линии (UI обновляет счётчик), но никого
  // Никого не снимаем: линия multi-line, событие «перехвачена» не рассылаем.
  try {
    await db.query('SELECT pg_notify($1, $2)', [
      PBX_CHANNEL,
      JSON.stringify({
        event: 'call:line_join',
        user_id: userId,
        data: { on_line_count: r.onLineCount, reason: 'line_joined' },
      }),
    ]);
  } catch (_) { /* уведомление не критично */ }
  return r;
}

/**
 * Сойти с линии (не мешая другим — multi-line).
 * @param {import('pg').Pool|{pool: import('pg').Pool}} db
 * @param {number} userId
 */
async function leaveLine(db, userId) {
  const client = await getPool(db).connect();
  let onLineCount = 0;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE pbx_operators
          SET on_line = false, last_seen_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`,
      [userId]
    );
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pbx_operators WHERE on_line = true`
    );
    onLineCount = rows[0]?.n || 0;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { ok: true, onLineCount };
}

/**
 * Встать на линию (исторический вход).
 * @param {import('pg').Pool} db
 * @param {number} userId
 * @param {{receiveMode?: string}} [opts]
 */
async function goOnDuty(db, userId, opts = {}) {
  return joinLine(db, userId, opts);
}

/**
 * Кто сейчас на линии. Сортировка по calls_taken даёт «справедливую» очередь
 * (кто меньше принял — раньше), затем sort_order и user_id.
 *
 * ВНИМАНИЕ: колонка calls_taken появляется миграцией V442. На БД без неё
 * запрос упадёт, поэтому функция сама откатывается на сортировку без неё.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @returns {Promise<number[]>}
 */
async function listOnLineUserIds(db) {
  try {
    const { rows } = await db.query(
      `SELECT user_id FROM pbx_operators
        WHERE on_line = true AND can_accept = true
        ORDER BY calls_taken, sort_order, user_id`
    );
    return rows.map((r) => r.user_id);
  } catch (_) {
    // БД ещё без V442 (нет calls_taken) — деградируем без ошибки.
    const { rows } = await db.query(
      `SELECT user_id FROM pbx_operators
        WHERE on_line = true AND can_accept = true
        ORDER BY sort_order, user_id`
    );
    return rows.map((r) => r.user_id);
  }
}

module.exports = {
  claimLine,
  joinLine,
  leaveLine,
  goOnDuty,
  listOnLineUserIds,
};
