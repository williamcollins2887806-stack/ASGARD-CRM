'use strict';

/**
 * ASGARD CRM — Telephony Job Queue
 * PostgreSQL-based async job processing with retry and monitoring
 */

class TelephonyJobQueue {
  constructor(db, logger) {
    this.db = db;        // fastify.db (pg pool wrapper)
    this.logger = logger || console;
    this._running = false;
    this._pollInterval = null;
    this._pollMs = 5000; // poll every 5 seconds
    this._handlers = {};
  }

  // Register a handler for a job type
  register(jobType, handler) {
    this._handlers[jobType] = handler;
  }

  // Add a job to the queue
  async enqueue(jobType, callId, payload = {}, scheduledAt = null) {
    const result = await this.db.query(
      `INSERT INTO telephony_jobs (job_type, call_id, payload, scheduled_at)
       VALUES ($1, $2, $3, COALESCE($4, NOW()))
       RETURNING id`,
      [jobType, callId, JSON.stringify(payload), scheduledAt]
    );
    this.logger.info(`[JobQueue] Enqueued ${jobType} for call ${callId}, job #${result.rows[0].id}`);
    return result.rows[0].id;
  }

  // Start the worker loop
  start() {
    if (this._running) return;
    this._running = true;
    this.logger.info('[JobQueue] Worker started');
    this._pollInterval = setInterval(() => this._processNext(), this._pollMs);
    // Process immediately on start
    this._processNext();
  }

  // Stop the worker
  stop() {
    this._running = false;
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    this.logger.info('[JobQueue] Worker stopped');
  }

  // Process next pending job
  async _processNext() {
    if (!this._running) return;
    try {
      // Claim a job atomically (SELECT FOR UPDATE SKIP LOCKED)
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

      if (!result.rows.length) return; // no jobs

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
        const shouldRetry = job.attempts < job.max_attempts;
        const newStatus = shouldRetry ? 'retry' : 'failed';
        const retryDelay = Math.pow(2, job.attempts) * 10; // exponential backoff: 10s, 20s, 40s

        await this.db.query(
          `UPDATE telephony_jobs
           SET status = $1, error = $2,
               scheduled_at = CASE WHEN $1 = 'retry' THEN NOW() + ($3 || ' seconds')::interval ELSE scheduled_at END
           WHERE id = $4`,
          [newStatus, err.message, retryDelay, job.id]
        );

        this.logger.error(`[JobQueue] Job #${job.id} (${job.job_type}) ${newStatus}: ${err.message}`);
      }

      // Try to process more jobs immediately
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

  // Get queue stats (for monitoring)
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
