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
    const tz = { timezone: 'Europe/Moscow' };

    try {
      // Ежедневный: 08:00 МСК Пн-Сб
      const dailyJob = cron.schedule('0 8 * * 1-6', async () => {
        await this._runDaily();
      }, tz);
      this.jobs.push(dailyJob);
      this.log.info('[ReportScheduler] Daily reports: 08:00 MSK Mon-Sat');

      // Еженедельный: 10:00 МСК по понедельникам
      const weeklyJob = cron.schedule('0 10 * * 1', async () => {
        await this._runWeekly();
      }, tz);
      this.jobs.push(weeklyJob);
      this.log.info('[ReportScheduler] Weekly reports: 10:00 MSK Monday');

      // Ежемесячный: 10:00 МСК 1-го числа
      const monthlyJob = cron.schedule('0 10 1 * *', async () => {
        await this._runMonthly();
      }, tz);
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
      // Получаем пользователей с их персональными настройками
      const { rows: users } = await this.db.query(`
        SELECT u.id, u.email, u.name, u.role,
          COALESCE(p.is_enabled, true) as pref_enabled,
          COALESCE(p.via_crm, true)    as pref_crm,
          COALESCE(p.via_huginn, true) as pref_huginn,
          COALESCE(p.via_email, true)  as pref_email
        FROM users u
        LEFT JOIN call_report_user_prefs p ON p.user_id = u.id AND p.report_type = $1
        WHERE u.role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV')
          AND u.is_active = true
          AND COALESCE(p.is_enabled, true) = true
      `, [reportType]);

      for (const user of users) {
        try {
          // 1. CRM-уведомление
          if (user.pref_crm && this.notify) {
            await this.notify(this.db, {
              user_id: user.id,
              title: `📊 Отчёт: ${label}`,
              message: report.title || label,
              type: 'call_report',
              link: `#/telephony?tab=analytics&report=${report.id}`
            });
          }

          // 2. SSE (всегда)
          try {
            const { sendToUser } = require('../routes/sse');
            sendToUser(user.id, 'call_report:ready', {
              report_id: report.id,
              report_type: reportType,
              title: label
            });
          } catch (_) {}

          // 3. Мимир-дайджест в Huginn
          if (user.pref_huginn) {
            await this._sendMimirDigest(report, user.id, label);
          }

          // 4. Email-рассылка (красивый HTML-отчёт)
          if (user.pref_email && user.email) {
            try {
              const { generateReportEmail } = require('./call-report-email');
              const crmMailer = require('./crm-mailer');
              const _typeNames = { daily: 'ежедневный', weekly: 'еженедельный', monthly: 'ежемесячный' };
              await crmMailer.sendCrmEmail(this.db, null, {
                to: user.email,
                subject: `📊 Ваш ${_typeNames[reportType] || 'ежедневный'} отчёт по звонкам`,
                html: generateReportEmail(report),
                text: (report.summary_text || '').slice(0, 500)
              });
              this.log.info(`[ReportScheduler] Email sent to ${user.email}`);
            } catch (emailErr) {
              this.log.error(`[ReportScheduler] Email to ${user.email}: ${emailErr.message}\n${emailErr.stack || ''}`);
            }
          }

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

      // Direct чат с директором (таблица chats, not chat_groups)
      let chatRes = await db.query(`
        SELECT c.id FROM chats c
        JOIN chat_group_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
        JOIN chat_group_members m2 ON m2.chat_id = c.id AND m2.user_id = $2
        WHERE c.is_group = false AND c.type = 'direct'
        LIMIT 1
      `, [mimirId, directorId]);

      let chatId;
      if (!chatRes.rows.length) {
        const dirUser = await db.query('SELECT name FROM users WHERE id = $1', [directorId]);
        const chatName = `Мимир — ${dirUser.rows[0]?.name || 'Директор'}`;
        const nc = await db.query(
          "INSERT INTO chats (name, type, is_group, created_at, last_message_at) VALUES ($1, 'direct', false, NOW(), NOW()) RETURNING id",
          [chatName]
        );
        chatId = nc.rows[0].id;
        await db.query(
          "INSERT INTO chat_group_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', NOW()), ($1, $3, 'member', NOW())",
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

      // chat_messages.text (колонка text, не message)
      const result = await db.query(
        "INSERT INTO chat_messages (chat_id, user_id, user_name, text, created_at) VALUES ($1, $2, 'Мимир', $3, NOW()) RETURNING *",
        [chatId, mimirId, msg]
      );

      // Обновим last_message_at в чате
      await db.query(
        "UPDATE chats SET last_message_at = NOW() WHERE id = $1",
        [chatId]
      ).catch(() => {});

      // SSE
      try {
        const { sendToUser } = require('../routes/sse');
        sendToUser(directorId, 'chat:new_message', {
          chat_id: chatId,
          message: {
            id: result.rows[0].id,
            text: msg,
            user_id: mimirId,
            user_name: 'Мимир',
            created_at: result.rows[0].created_at
          }
        });
      } catch (_) {}

    } catch (e) {
      this.log.error(`[ReportScheduler] MimirDigest for user ${directorId}: ${e.message}\n${e.stack}`);
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
