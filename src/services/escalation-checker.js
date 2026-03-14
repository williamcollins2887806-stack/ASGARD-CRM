'use strict';

/**
 * ASGARD CRM — Persistent Missed Call Escalation Checker
 * Survives server restarts by using DB state
 */

class EscalationChecker {
  constructor(db, notifyService, logger) {
    this.db = db;
    this.notify = notifyService; // createNotification function from notify.js
    this.logger = logger || console;
    this._interval = null;
    this._checkMs = 60000; // check every 60 seconds
  }

  start() {
    this.logger.info('[EscalationChecker] Started');
    this._interval = setInterval(() => this._check(), this._checkMs);
    // Check immediately on startup (catches missed escalations from downtime)
    this._check();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  // Create an escalation deadline for a missed call
  async createEscalation(callId, userId, deadlineMinutes = 30) {
    try {
      await this.db.query(
        `INSERT INTO telephony_escalations (call_id, user_id, deadline_at)
         VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
        [callId, userId, deadlineMinutes]
      );
    } catch (err) {
      // Ignore duplicate inserts
      if (err.code !== '23505') throw err;
    }
  }

  // Mark escalation as acknowledged (when user calls back or acknowledges missed call)
  async acknowledge(callId) {
    await this.db.query(
      `UPDATE telephony_escalations SET acknowledged = true WHERE call_id = $1 AND acknowledged = false`,
      [callId]
    );
  }

  async _check() {
    try {
      // Find expired, unescalated, unacknowledged deadlines
      const result = await this.db.query(
        `SELECT e.*, ch.from_number, ch.to_number, ch.created_at as call_time,
                u.name as user_name, u.role as user_role
         FROM telephony_escalations e
         JOIN call_history ch ON ch.id = e.call_id
         JOIN users u ON u.id = e.user_id
         WHERE e.escalated = false
           AND e.acknowledged = false
           AND e.deadline_at <= NOW()`
      );

      for (const esc of result.rows) {
        await this._escalate(esc);
      }
    } catch (err) {
      this.logger.error('[EscalationChecker] Check error: ' + err.message);
    }
  }

  async _escalate(escalation) {
    try {
      // Find supervisor (HEAD_PM for PM, HEAD_TO for TO, DIRECTOR_COM for others)
      const supervisorRole = escalation.user_role === 'PM' ? 'HEAD_PM' :
                             escalation.user_role === 'TO' ? 'HEAD_TO' : 'DIRECTOR_COMM';

      const supervisor = await this.db.query(
        `SELECT id, name FROM users WHERE role = $1 AND is_active = true LIMIT 1`,
        [supervisorRole]
      );

      const supervisorId = supervisor.rows.length ? supervisor.rows[0].id : null;

      // Create notification for the manager
      if (this.notify && typeof this.notify === 'function') {
        await this.notify(this.db, {
          user_id: escalation.user_id,
          type: 'telephony',
          title: 'Пропущенный звонок не обработан!',
          message: `Звонок от ${escalation.from_number} (${new Date(escalation.call_time).toLocaleString('ru-RU')}) не обработан более 30 минут`,
          link: '/telephony?tab=missed'
        });
      }

      // Create notification for supervisor
      if (supervisorId && this.notify && typeof this.notify === 'function') {
        await this.notify(this.db, {
          user_id: supervisorId,
          type: 'telephony',
          title: 'Эскалация: пропущенный звонок',
          message: `${escalation.user_name} не обработал звонок от ${escalation.from_number} более 30 минут`,
          link: '/telephony?tab=missed'
        });
      }

      // Mark as escalated
      await this.db.query(
        `UPDATE telephony_escalations SET escalated = true, escalated_at = NOW() WHERE id = $1`,
        [escalation.id]
      );

      this.logger.info(`[EscalationChecker] Escalated missed call #${escalation.call_id} for user ${escalation.user_name}`);
    } catch (err) {
      this.logger.error(`[EscalationChecker] Escalation error for #${escalation.id}: ${err.message}`);
    }
  }
}

module.exports = EscalationChecker;
