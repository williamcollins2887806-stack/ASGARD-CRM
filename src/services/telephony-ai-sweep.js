'use strict';

/**
 * Sweep недоделанных звонков после 402/сети/ошибок STT.
 * Образец идеи: ai-retry-policy (почта) — infra ждёт, content не крутится вечно.
 */

const INFRA_MAX_AGE_HOURS = parseInt(process.env.TELEPHONY_AI_INFRA_MAX_AGE_HOURS || '168', 10);
const SWEEP_LIMIT = parseInt(process.env.TELEPHONY_AI_SWEEP_LIMIT || '25', 10);
const SWEEP_MS = parseInt(process.env.TELEPHONY_AI_SWEEP_MS || String(5 * 60 * 1000), 10);

class TelephonyAiSweep {
  constructor(db, jobQueue, logger) {
    this.db = db;
    this.jobQueue = jobQueue;
    this.logger = logger || console;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this.logger.info(`[TelephonyAiSweep] started (every ${SWEEP_MS}ms)`);
    this._timer = setInterval(() => {
      this.runOnce().catch((e) => this.logger.warn('[TelephonyAiSweep] ' + e.message));
    }, SWEEP_MS);
    // первый проход чуть позже старта — не конкурировать с boot
    setTimeout(() => {
      this.runOnce().catch((e) => this.logger.warn('[TelephonyAiSweep] ' + e.message));
    }, 15000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async runOnce() {
    if (!this.jobQueue) return { transcribed: 0, analyzed: 0 };
    const ageInterval = `${INFRA_MAX_AGE_HOURS} hours`;

    // 1) STT: есть файл, транскрипт не готов / error
    const stt = await this.db.query(
      `SELECT id FROM call_history
        WHERE record_path IS NOT NULL
          AND COALESCE(call_type, '') <> 'missed'
          AND transcript_status IN ('none', 'error')
          AND created_at > NOW() - $1::interval
        ORDER BY created_at ASC
        LIMIT $2`,
      [ageInterval, SWEEP_LIMIT]
    );

    let transcribed = 0;
    for (const row of stt.rows) {
      await this.jobQueue.enqueue('transcribe', row.id);
      transcribed += 1;
    }

    // 2) Analyze: транскрипт готов, анализ не финален
    const an = await this.db.query(
      `SELECT id FROM call_history
        WHERE transcript_status = 'done'
          AND COALESCE(transcript, '') <> ''
          AND COALESCE(call_type, '') <> 'missed'
          AND created_at > NOW() - $1::interval
          AND (
            ai_analysis_status IN ('pending', 'error_retryable')
            OR (
              (ai_analysis_status IS NULL OR ai_analysis_status = '')
              AND (
                ai_summary IS NULL
                OR ai_summary LIKE 'Ошибка ИИ-анализа:%'
              )
            )
          )
          AND COALESCE(ai_analysis_status, '') NOT IN ('done', 'skipped', 'error_final')
        ORDER BY COALESCE(ai_last_error_at, created_at) ASC
        LIMIT $2`,
      [ageInterval, SWEEP_LIMIT]
    );

    let analyzed = 0;
    for (const row of an.rows) {
      await this.jobQueue.enqueue('analyze', row.id);
      analyzed += 1;
    }

    if (transcribed || analyzed) {
      this.logger.info(`[TelephonyAiSweep] enqueued transcribe=${transcribed} analyze=${analyzed}`);
    }
    return { transcribed, analyzed };
  }

  /** Счётчик застрявших >24ч — для health. */
  async stuckCount() {
    const r = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM call_history
        WHERE created_at < NOW() - INTERVAL '24 hours'
          AND created_at > NOW() - ($1 || ' hours')::interval
          AND COALESCE(call_type, '') <> 'missed'
          AND (
            transcript_status IN ('none', 'error')
            OR ai_analysis_status = 'error_retryable'
            OR (transcript_status = 'done' AND ai_summary IS NULL AND COALESCE(ai_analysis_status,'') NOT IN ('skipped','error_final','done'))
          )`,
      [String(INFRA_MAX_AGE_HOURS)]
    );
    return r.rows[0] ? r.rows[0].n : 0;
  }
}

module.exports = TelephonyAiSweep;
