'use strict';

/**
 * ASGARD CRM — Telephony Job Queue
 * PostgreSQL-based async job processing with retry and monitoring
 */

class TelephonyJobQueue {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
    this._running = false;
    this._pollInterval = null;
    this._pollMs = 5000;
    this._handlers = {};
  }

  register(jobType, handler) {
    this._handlers[jobType] = handler;
  }

  async enqueue(jobType, callId, payload = {}, scheduledAt = null) {
    try {
      // Не плодим второй активный job того же типа на звонок (uq_telephony_jobs_active_per_call_type).
      if (callId != null) {
        const existing = await this.db.query(
          `SELECT id FROM telephony_jobs
            WHERE call_id = $1 AND job_type = $2
              AND status IN ('pending', 'processing', 'retry')
            LIMIT 1`,
          [callId, jobType]
        );
        if (existing.rows.length) {
          this.logger.info(`[JobQueue] Skip enqueue ${jobType} for call ${callId}: already active #${existing.rows[0].id}`);
          return existing.rows[0].id;
        }
      }

      const result = await this.db.query(
        `INSERT INTO telephony_jobs (job_type, call_id, payload, scheduled_at)
         VALUES ($1, $2, $3, COALESCE($4, NOW()))
         RETURNING id`,
        [jobType, callId, JSON.stringify(payload), scheduledAt]
      );
      this.logger.info(`[JobQueue] Enqueued ${jobType} for call ${callId}, job #${result.rows[0].id}`);
      return result.rows[0].id;
    } catch (err) {
      // unique violation — другой воркер успел вставить
      if (err && (err.code === '23505' || /unique/i.test(err.message || ''))) {
        this.logger.info(`[JobQueue] Enqueue race for ${jobType} call ${callId}: ${err.message}`);
        return null;
      }
      throw err;
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.logger.info('[JobQueue] Worker started');
    this._pollInterval = setInterval(() => this._processNext(), this._pollMs);
    this._processNext();
  }

  stop() {
    this._running = false;
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    this.logger.info('[JobQueue] Worker stopped');
  }

  _retryDelaySeconds(job, err) {
    const code = String((err && err.code) || '').toLowerCase();
    const msg = String((err && err.message) || '');
    if (code === 'insufficient_funds' || /недостаточно средств|insufficient.*(funds|balance|credit)/i.test(msg)) {
      // Деньги кончились — не жечь attempts каждые 10с; ждём 15–60 мин
      const n = Math.min(Number(job.attempts) || 1, 4);
      return [900, 1800, 2700, 3600][n - 1] || 3600;
    }
    if (code === 'rate_limit' || /rate.?limit/i.test(msg)) {
      return Math.min(Math.pow(2, job.attempts) * 30, 600);
    }
    // default exponential: 10s, 20s, 40s…
    return Math.pow(2, job.attempts) * 10;
  }

  _shouldCountAttempt(err) {
    // Infra (нет денег / сеть) — не сжигать max_attempts как content
    const code = String((err && err.code) || '').toLowerCase();
    if (['insufficient_funds', 'rate_limit', 'timeout', 'network', 'provider_error', 'upstream_error', 'empty_response'].includes(code)) {
      return false;
    }
    const msg = String((err && err.message) || '');
    if (/недостаточно средств|insufficient|rate.?limit|timeout|ECONN|ETIMEDOUT|socket hang up/i.test(msg)) {
      return false;
    }
    return true;
  }

  async _processNext() {
    if (!this._running) return;
    try {
      const result = await this.db.query(
        `UPDATE telephony_jobs
         SET status = 'processing', started_at = NOW(), attempts = attempts + 1
         WHERE id = (
           SELECT id FROM telephony_jobs
           WHERE status IN ('pending', 'retry')
             AND scheduled_at <= NOW()
             AND attempts < max_attempts
           ORDER BY scheduled_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`
      );

      if (!result.rows.length) return;

      const job = result.rows[0];
      const handler = this._handlers[job.job_type];

      if (!handler) {
        await this._failJob(job.id, `No handler registered for job type: ${job.job_type}`);
        return;
      }

      try {
        await handler(job);
        await this.db.query(
          `UPDATE telephony_jobs SET status = 'done', completed_at = NOW() WHERE id = $1`,
          [job.id]
        );
        this.logger.info(`[JobQueue] Job #${job.id} (${job.job_type}) completed`);
      } catch (err) {
        const countAttempt = this._shouldCountAttempt(err);
        if (!countAttempt) {
          // откатить счётчик попыток за infra — ждём деньги/сеть
          await this.db.query(
            `UPDATE telephony_jobs SET attempts = GREATEST(attempts - 1, 0) WHERE id = $1`,
            [job.id]
          );
          job.attempts = Math.max((job.attempts || 1) - 1, 0);
        }

        const effectiveAttempts = countAttempt ? job.attempts : job.attempts;
        const shouldRetry = (countAttempt ? effectiveAttempts < job.max_attempts : true)
          && err.retryable !== false;
        // Потолок ожидания infra: 7 суток от создания job
        let infraExpired = false;
        if (!countAttempt && job.created_at) {
          const ageH = (Date.now() - new Date(job.created_at).getTime()) / 3600000;
          if (ageH > 168) infraExpired = true;
        }
        const newStatus = (!shouldRetry || infraExpired) ? 'failed' : 'retry';
        const retryDelay = this._retryDelaySeconds(job, err);

        await this.db.query(
          `UPDATE telephony_jobs
           SET status = $1::varchar, error = $2,
               scheduled_at = CASE WHEN $1::text = 'retry' THEN NOW() + ($3 || ' seconds')::interval ELSE scheduled_at END,
               completed_at = CASE WHEN $1::text = 'failed' THEN NOW() ELSE completed_at END
           WHERE id = $4`,
          [newStatus, err.message, String(retryDelay), job.id]
        );

        this.logger.error(`[JobQueue] Job #${job.id} (${job.job_type}) ${newStatus}: ${err.message}`);
      }

      if (this._running) setImmediate(() => this._processNext());
    } catch (err) {
      this.logger.error('[JobQueue] Worker error: ' + err.message);
    }
  }

  async _failJob(jobId, error) {
    await this.db.query(
      `UPDATE telephony_jobs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [error, jobId]
    );
  }

  async getStats() {
    const result = await this.db.query(
      `SELECT status, COUNT(*) as count FROM telephony_jobs GROUP BY status`
    );
    const stats = {};
    result.rows.forEach(r => { stats[r.status] = parseInt(r.count); });
    return stats;
  }
}

module.exports = TelephonyJobQueue;
