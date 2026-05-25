/**
 * ASGARD CRM — Persistent storage для просчётов Мимира.
 *
 * Раньше использовался in-memory Map _aeJobs с TTL 10 мин — при рестарте сервера
 * данные терялись, готовые результаты пропадали через 10 мин.
 *
 * Этот сервис эмулирует API Map (.get/.set/.delete/.entries) но пишет в БД
 * (таблица mimir_estimate_jobs, см. миграцию V119).
 *
 * Политика хранения:
 *   - status='running' / 'questions': хранится пока актуально (sweep stale при чтении)
 *   - status='error': 24 часа (для диагностики), потом авточистка
 *   - status='done': НАВСЕГДА (юзер может вернуться к просчёту через год)
 */

'use strict';

const db = require('./db');

// "Зависший" running больше этого считается просрочкой (но не удаляется,
// помечается как stale при чтении — иначе юзер не сможет узнать что упало)
const RUNNING_TIMEOUT_MS = 30 * 60 * 1000;  // 30 минут
const ERROR_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 часа для error

/** Парсит job_key 'w<id>'/'t<id>' → {work_id, tender_id} */
function _parseKey(key) {
  if (!key || typeof key !== 'string') return { work_id: null, tender_id: null };
  if (key.startsWith('w')) {
    const id = parseInt(key.slice(1));
    return { work_id: isNaN(id) ? null : id, tender_id: null };
  }
  if (key.startsWith('t')) {
    const id = parseInt(key.slice(1));
    return { work_id: null, tender_id: isNaN(id) ? null : id };
  }
  return { work_id: null, tender_id: null };
}

/** Преобразует строку БД в объект "как был в Map" — совместимый с предыдущим API. */
function _rowToJob(row) {
  if (!row) return null;
  return {
    status: row.status,
    startedAt: new Date(row.started_at).getTime(),
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    updatedAt: new Date(row.updated_at).getTime(),
    session_id: row.session_id || null,
    questions: row.questions || null,
    result: row.result || null,
    estimate_id: row.estimate_id || null,
    error: row.error_text || null,
    error_code: row.error_code || null,
    provider_message: row.provider_message || null,
    iterations: row.iterations || 0,
    _id: row.id,         // внутренний ID для апдейтов
    _row: row            // полная строка на всякий случай
  };
}

/**
 * Получить АКТИВНЫЙ job по ключу.
 * "Активный" = последний не-deleted, в статусе running/questions/done (свежий error).
 * Старые done/error не выдаём чтобы не путать с текущим.
 */
async function get(key) {
  const { work_id, tender_id } = _parseKey(key);
  if (!work_id && !tender_id) return null;

  // Самый свежий job. running/questions имеют приоритет, потом done, потом error в окне 24ч.
  const result = await db.query(`
    SELECT * FROM mimir_estimate_jobs
    WHERE job_key = $1
      AND (
        status IN ('running','questions')
        OR (status = 'done' AND started_at > NOW() - INTERVAL '7 days')
        OR (status = 'error' AND started_at > NOW() - INTERVAL '24 hours')
      )
    ORDER BY started_at DESC
    LIMIT 1
  `, [key]);

  return _rowToJob(result.rows[0]);
}

/**
 * Записать состояние job по ключу.
 * Логика:
 *   - running: создаём новую строку или обновляем существующую running
 *   - questions: обновляем существующую running
 *   - done: завершаем существующую и проставляем completed_at
 *   - error: завершаем существующую и проставляем error_text/error_code
 */
async function set(key, data, opts = {}) {
  const { work_id, tender_id } = _parseKey(key);
  if (!work_id && !tender_id) return null;

  const status = data.status;
  if (!status) throw new Error('mimir-jobs.set requires data.status');

  // Ищем последний АКТИВНЫЙ job на этом ключе (running/questions/недавний)
  const existing = await db.query(`
    SELECT id FROM mimir_estimate_jobs
    WHERE job_key = $1 AND status IN ('running','questions')
    ORDER BY started_at DESC LIMIT 1
  `, [key]);

  const params = {
    job_key: key,
    status,
    work_id,
    tender_id,
    user_id: opts.user_id || data.user_id || null,
    session_id: data.session_id || null,
    questions: data.questions ? JSON.stringify(data.questions) : null,
    result: data.result ? JSON.stringify(data.result) : null,
    estimate_id: data.result?.estimate_id || data.estimate_id || null,
    error_text: data.error || null,
    error_code: data.error_code || null,
    provider_message: data.provider_message || null,
    iterations: data.iterations || 0,
    total_input_tokens: data.total_input_tokens || 0,
    total_output_tokens: data.total_output_tokens || 0
  };

  if (existing.rows.length > 0 && status !== 'done') {
    // Обновляем существующий active job (running → questions/error)
    const id = existing.rows[0].id;
    const completedAt = (status === 'done' || status === 'error') ? 'NOW()' : 'NULL';
    await db.query(`
      UPDATE mimir_estimate_jobs SET
        status = $1,
        session_id = COALESCE($2, session_id),
        questions = COALESCE($3, questions),
        result = COALESCE($4, result),
        estimate_id = COALESCE($5, estimate_id),
        error_text = $6,
        error_code = $7,
        provider_message = $8,
        iterations = GREATEST(iterations, $9),
        total_input_tokens = GREATEST(total_input_tokens, $10),
        total_output_tokens = GREATEST(total_output_tokens, $11),
        updated_at = NOW(),
        completed_at = CASE WHEN $1 IN ('done','error') THEN NOW() ELSE completed_at END
      WHERE id = $12
    `, [params.status, params.session_id, params.questions, params.result,
        params.estimate_id, params.error_text, params.error_code,
        params.provider_message, params.iterations, params.total_input_tokens,
        params.total_output_tokens, id]);
    return id;
  }

  // Иначе — создаём новую строку (новый просчёт или done без предшествующего running)
  const inserted = await db.query(`
    INSERT INTO mimir_estimate_jobs (
      job_key, status, work_id, tender_id, user_id,
      session_id, questions, result, estimate_id,
      error_text, error_code, provider_message,
      iterations, total_input_tokens, total_output_tokens,
      completed_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,
      CASE WHEN $2 IN ('done','error') THEN NOW() ELSE NULL END
    ) RETURNING id
  `, [params.job_key, params.status, params.work_id, params.tender_id, params.user_id,
      params.session_id, params.questions, params.result, params.estimate_id,
      params.error_text, params.error_code, params.provider_message,
      params.iterations, params.total_input_tokens, params.total_output_tokens]);

  return inserted.rows[0].id;
}

/**
 * "Удалить" job — НЕ удаляем из БД, а просто помечаем как done/cancelled
 * чтобы не мешал. Если был running → переводим в done или error в зависимости от context.
 *
 * Если хотим именно вычистить (например юзер закрыл окно с ошибкой) — переводим
 * статус running/questions в error (cancelled). done не трогаем (он навсегда).
 */
async function del(key) {
  await db.query(`
    UPDATE mimir_estimate_jobs SET
      status = 'error',
      error_text = COALESCE(error_text, 'Отменено пользователем'),
      error_code = COALESCE(error_code, 'cancelled'),
      completed_at = NOW(),
      updated_at = NOW()
    WHERE job_key = $1 AND status IN ('running','questions')
  `, [key]);
}

/**
 * Получить все АКТИВНЫЕ jobs (для эндпоинта /auto-estimate-active).
 * Активные = running/questions + недавние done (последние 7 дней).
 */
async function listActive(opts = {}) {
  let sql = `
    SELECT * FROM mimir_estimate_jobs
    WHERE (
      status IN ('running','questions')
      OR (status = 'done' AND started_at > NOW() - INTERVAL '7 days')
    )
  `;
  const params = [];
  if (opts.user_id) {
    params.push(opts.user_id);
    sql += ` AND user_id = $${params.length}`;
  }
  sql += ' ORDER BY started_at DESC LIMIT 50';
  const res = await db.query(sql, params);
  return res.rows.map(_rowToJob).map((j, i) => ({ ...j, job_key: res.rows[i].job_key }));
}

/**
 * История просчётов конкретного work/tender (для отображения "был ли уже просчёт").
 * Все done навсегда → возвращаем последний (или всю историю если limit > 1).
 */
async function historyFor({ work_id, tender_id, limit = 10 }) {
  if (!work_id && !tender_id) return [];
  const key = work_id ? 'w' + work_id : 't' + tender_id;
  const res = await db.query(`
    SELECT * FROM mimir_estimate_jobs
    WHERE job_key = $1
    ORDER BY started_at DESC
    LIMIT $2
  `, [key, limit]);
  return res.rows.map(_rowToJob).map((j, i) => ({ ...j, job_key: res.rows[i].job_key }));
}

/**
 * Авточистка старых error (24ч+) и зависших running (30мин+).
 * Запускаем при старте приложения и периодически (1 раз в час).
 */
async function sweep() {
  try {
    // Удаляем старые error (24ч+)
    const errDel = await db.query(`
      DELETE FROM mimir_estimate_jobs
      WHERE status = 'error' AND started_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    // Помечаем зависший running как error (timeout)
    const runStale = await db.query(`
      UPDATE mimir_estimate_jobs SET
        status = 'error',
        error_text = COALESCE(error_text, 'Timeout (более 30 мин без обновлений)'),
        error_code = COALESCE(error_code, 'timeout'),
        completed_at = NOW(),
        updated_at = NOW()
      WHERE status IN ('running','questions')
        AND updated_at < NOW() - INTERVAL '30 minutes'
      RETURNING id
    `);
    if (errDel.rowCount > 0 || runStale.rowCount > 0) {
      console.log(`[mimir-jobs] sweep: удалено ${errDel.rowCount} старых error, ${runStale.rowCount} зависших running помечено как timeout`);
    }
  } catch (e) {
    console.warn('[mimir-jobs] sweep error:', e.message);
  }
}

/**
 * При старте сервера: все running/questions, обновлённые более 5 минут назад,
 * помечаем как error (timeout). Это критично потому что после рестарта
 * процесса все идущие просчёты на самом деле УМЕРЛИ, но в БД они помечены
 * как running. Без этой очистки следующий клик "Просчёт" даст 409.
 */
async function markOrphanedAsError() {
  try {
    const res = await db.query(`
      UPDATE mimir_estimate_jobs SET
        status = 'error',
        error_text = 'Сервер был перезагружен во время просчёта',
        error_code = 'server_restart',
        completed_at = NOW(),
        updated_at = NOW()
      WHERE status IN ('running','questions')
        AND updated_at < NOW() - INTERVAL '5 minutes'
      RETURNING id, job_key
    `);
    if (res.rowCount > 0) {
      console.log(`[mimir-jobs] startup: ${res.rowCount} осиротевших running помечены как error (server_restart)`);
    }
  } catch (e) {
    console.warn('[mimir-jobs] markOrphanedAsError error:', e.message);
  }
}

// Автозапуск sweep раз в час
let _sweepInterval = null;
function startSweep() {
  if (_sweepInterval) return;
  // При запуске сервера: помечаем висящие running от ПРЕДЫДУЩЕГО процесса как error
  markOrphanedAsError().catch(()=>{});
  _sweepInterval = setInterval(sweep, 60 * 60 * 1000); // 1 час
  sweep().catch(()=>{}); // первый запуск сразу
}

/**
 * Просто отметить что job ещё жив (обновить updated_at).
 * Используется heartbeat-функцией auto-estimate чтобы stale-детектор
 * не путал работающий долгий просчёт с зомби.
 */
async function touch(key) {
  if (!key) return;
  try {
    await db.query(`
      UPDATE mimir_estimate_jobs SET updated_at = NOW()
      WHERE job_key = $1 AND status IN ('running','questions')
    `, [key]);
  } catch (e) { /* not critical */ }
}

module.exports = {
  get,
  set,
  delete: del,           // совместимое имя с Map
  del,
  touch,
  listActive,
  historyFor,
  sweep,
  markOrphanedAsError,
  startSweep,
  _parseKey               // для тестов
};
