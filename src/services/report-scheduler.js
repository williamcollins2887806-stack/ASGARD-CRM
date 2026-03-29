'use strict';

/**
 * ASGARD CRM — Планировщик отчётов по звонкам
 * Расписание: Пн-Сб (рабочие дни), Вс — выходной
 * Понедельник: сводный отчёт за Сб+Вс
 * Вт-Сб: отчёт за предыдущий день
 * Еженедельный: Пн в 10:00 МСК за Пн-Сб предыдущей недели
 * Ежемесячный: 1-е число в 10:00 МСК
 */

const cron = require('node-cron');
const CallReportGenerator = require('./call-report-generator');

class ReportScheduler {
  constructor(db, aiProvider, notifyFn, log) {
    this.db = db;
    this.generator = new CallReportGenerator(db, aiProvider);
    this.notify = notifyFn;
    this.log = log || console;
    this.jobs = [];
    this._locks = new Set();
  }

  async start() {
    try {
      // Ежедневный: 08:00 МСК (05:00 UTC) Пн-Сб, проверка дня внутри
      const dailyJob = cron.schedule('0 5 * * 1-6', async () => {
        await this._runDaily();
      });
      this.jobs.push(dailyJob);
      this.log.info('[ReportScheduler] Daily reports: 08:00 MSK Mon-Sat');

      // Еженедельный: 10:00 МСК (07:00 UTC) по понедельникам
      const weeklyJob = cron.schedule('0 7 * * 1', async () => {
        await this._runWeekly();
      });
      this.jobs.push(weeklyJob);
      this.log.info('[ReportScheduler] Weekly reports: 10:00 MSK Monday');

      // Ежемесячный: 10:00 МСК (07:00 UTC) 1-го числа
      const monthlyJob = cron.schedule('0 7 1 * *', async () => {
        await this._runMonthly();
      });
      this.jobs.push(monthlyJob);
      this.log.info('[ReportScheduler] Monthly reports: 10:00 MSK 1st of month');
    } catch (err) {
      this.log.error('[ReportScheduler] Start error:', err.message);
    }
  }

  stop() {
    for (const job of this.jobs) {
      try { job.stop(); } catch (_) {}
    }
    this.jobs = [];
    this._locks.clear();
  }

  async _runDaily() {
    const now = new Date();
    const mskDay = this._getMoscowDayOfWeek(now);
    const lockKey = `daily_${now.toISOString().slice(0, 10)}`;
    if (this._locks.has(lockKey)) return;
    this._locks.add(lockKey);

    try {
      let dateFrom, dateTo, label, reportSubType;

      if (mskDay === 1) {
        // Понедельник — сводный за Сб+Вс
        const sunday = this._addDays(now, -1);
        const saturday = this._addDays(now, -2);
        dateFrom = this._fmtISO(saturday);
        dateTo = this._fmtISO(sunday);
        label = `Выходные (${this._fmtRu(saturday)} — ${this._fmtRu(sunday)})`;
        reportSubType = 'weekend';
      } else {
        // Вт-Сб — отчёт за вчера
        const yesterday = this._addDays(now, -1);
        dateFrom = this._fmtISO(yesterday);
        dateTo = dateFrom;
        label = this._fmtRu(yesterday);
        reportSubType = 'daily';
      }

      this.log.info(`[ReportScheduler] Daily ${reportSubType}: ${dateFrom} — ${dateTo}`);
      const report = await this.generator.generate('daily', dateFrom, dateTo);

      await this._deliver(report, 'daily', label);
    } catch (err) {
      this.log.error('[ReportScheduler] Daily failed:', err.message);
      this._locks.delete(lockKey);
    }
  }

  async _runWeekly() {
    const lockKey = `weekly_${new Date().toISOString().slice(0, 10)}`;
    if (this._locks.has(lockKey)) return;
    this._locks.add(lockKey);

    try {
      const now = new Date();
      // Пн-Сб предыдущей недели (6 рабочих дней)
      const lastMonday = this._addDays(now, -7);
      const lastSaturday = this._addDays(now, -2);
      const dateFrom = this._fmtISO(lastMonday);
      const dateTo = this._fmtISO(lastSaturday);
      const label = `Неделя (${this._fmtRu(lastMonday)} — ${this._fmtRu(lastSaturday)})`;

      this.log.info(`[ReportScheduler] Weekly: ${dateFrom} — ${dateTo}`);
      const report = await this.generator.generate('weekly', dateFrom, dateTo);

      await this._deliver(report, 'weekly', label);
    } catch (err) {
      this.log.error('[ReportScheduler] Weekly failed:', err.message);
      this._locks.delete(lockKey);
    }
  }

  async _runMonthly() {
    const lockKey = `monthly_${new Date().toISOString().slice(0, 7)}`;
    if (this._locks.has(lockKey)) return;
    this._locks.add(lockKey);

    try {
      const now = new Date();
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      const dateFrom = this._fmtISO(firstOfLastMonth);
      const dateTo = this._fmtISO(lastOfLastMonth);
      const label = firstOfLastMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

      this.log.info(`[ReportScheduler] Monthly: ${dateFrom} — ${dateTo}`);
      const report = await this.generator.generate('monthly', dateFrom, dateTo);

      await this._deliver(report, 'monthly', label);
    } catch (err) {
      this.log.error('[ReportScheduler] Monthly failed:', err.message);
      this._locks.delete(lockKey);
    }
  }

  // ════════════════════════════════════════════
  // Доставка отчётов
  // ════════════════════════════════════════════

  async _deliver(report, reportType, label) {
    if (!report) return;

    try {
      const { rows: schedules } = await this.db.query(
        'SELECT * FROM call_report_schedule WHERE report_type = $1 AND is_active = true',
        [reportType]
      );

      const notifyRoles = schedules[0]?.notify_roles || ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM'];
      const { rows: users } = await this.db.query(
        'SELECT id, email, name FROM users WHERE role = ANY($1) AND is_active = true',
        [notifyRoles]
      );

      for (const user of users) {
        try {
          // 1. CRM-уведомление
          if (this.notify) {
            await this.notify(this.db, {
              user_id: user.id,
              title: `Отчёт по звонкам: ${label}`,
              message: report.title || label,
              type: 'call_report',
              link: `#/telephony?tab=analytics&report=${report.id}`
            });
          }

          // 2. SSE
          try {
            const { sendToUser } = require('../routes/sse');
            sendToUser(user.id, 'call_report:ready', {
              report_id: report.id,
              report_type: reportType,
              title: label
            });
          } catch (_) {}

          // 3. Мимир-дайджест в Huginn
          await this._sendMimirDigest(report, user.id, label);

        } catch (e) {
          this.log.error(`[ReportScheduler] Deliver to user ${user.id}:`, e.message);
        }
      }

      this.log.info(`[ReportScheduler] Report #${report.id} delivered to ${users.length} users`);
    } catch (err) {
      this.log.error('[ReportScheduler] Deliver error:', err.message);
    }
  }

  async _sendMimirDigest(report, directorId, label) {
    try {
      const db = this.db;

      // Бот Мимир
      let mimirRes = await db.query("SELECT id FROM users WHERE login = 'mimir_bot' LIMIT 1");
      if (!mimirRes.rows.length) {
        mimirRes = await db.query(
          "INSERT INTO users (login, name, role, is_active, created_at) VALUES ('mimir_bot', 'Мимир', 'BOT', true, NOW()) RETURNING id"
        );
      }
      const mimirId = mimirRes.rows[0].id;

      // Direct чат с директором
      let chatRes = await db.query(`
        SELECT cg.id FROM chat_groups cg
        JOIN chat_group_members cm1 ON cm1.chat_id = cg.id AND cm1.user_id = $1
        JOIN chat_group_members cm2 ON cm2.chat_id = cg.id AND cm2.user_id = $2
        WHERE cg.is_direct = true LIMIT 1
      `, [mimirId, directorId]);

      let chatId;
      if (!chatRes.rows.length) {
        const nc = await db.query(
          "INSERT INTO chat_groups (name, is_direct, created_by, created_at) VALUES ('Мимир', true, $1, NOW()) RETURNING id",
          [mimirId]
        );
        chatId = nc.rows[0].id;
        await db.query(
          "INSERT INTO chat_group_members (chat_id, user_id, joined_at) VALUES ($1, $2, NOW()), ($1, $3, NOW())",
          [chatId, mimirId, directorId]
        );
      } else {
        chatId = chatRes.rows[0].id;
      }

      // Краткий дайджест
      let stats = {};
      try { stats = typeof report.stats_json === 'string' ? JSON.parse(report.stats_json) : (report.stats_json || {}); } catch (_) {}

      let msg = `**Отчёт по звонкам — ${label}**\n\n`;
      msg += `Всего: **${stats.totalCalls || 0}**  |  Целевые: **${stats.targetCalls || 0}**  |  Пропущ.: **${stats.missedCalls || 0}**\n`;
      if (stats.avgDuration) msg += `Средн. длительность: **${Math.round(stats.avgDuration)}** сек\n`;
      msg += `\n${(report.summary_text || '').slice(0, 300)}`;
      msg += `\n\n[Открыть полный отчёт](#/telephony?tab=analytics&report=${report.id})`;

      const result = await db.query(
        "INSERT INTO chat_messages (chat_id, user_id, message, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
        [chatId, mimirId, msg]
      );

      // SSE
      try {
        const { sendToUser } = require('../routes/sse');
        sendToUser(directorId, 'chat:new_message', {
          chat_id: chatId,
          message: {
            id: result.rows[0].id,
            text: msg,
            message: msg,
            user_id: mimirId,
            user_name: 'Мимир',
            created_at: result.rows[0].created_at
          }
        });
      } catch (_) {}

    } catch (e) {
      this.log.error('[ReportScheduler] MimirDigest:', e.message);
    }
  }

  // ════════════════════════════════════════════
  // Утилиты
  // ════════════════════════════════════════════

  _getMoscowDayOfWeek(date) {
    return new Date(date.getTime() + 3 * 3600000).getUTCDay();
  }

  _addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  _fmtISO(date) {
    return date.toISOString().slice(0, 10);
  }

  _fmtRu(date) {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
}

module.exports = ReportScheduler;
