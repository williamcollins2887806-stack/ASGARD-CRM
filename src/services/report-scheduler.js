'use strict';

/**
 * ASGARD CRM — CRON-планировщик отчётов по звонкам
 * Читает расписание из call_report_schedule и запускает генерацию
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
  }

  async start() {
    try {
      const { rows } = await this.db.query(
        'SELECT * FROM call_report_schedule WHERE is_active = true'
      );

      for (const schedule of rows) {
        if (!cron.validate(schedule.cron_expression)) {
          this.log.warn(`[ReportScheduler] Invalid cron: ${schedule.cron_expression}`);
          continue;
        }

        const job = cron.schedule(schedule.cron_expression, async () => {
          await this._runReport(schedule);
        });

        this.jobs.push(job);
        this.log.info(`[ReportScheduler] Scheduled ${schedule.report_type}: ${schedule.cron_expression}`);
      }
    } catch (err) {
      this.log.error('[ReportScheduler] Start error:', err.message);
    }
  }

  stop() {
    for (const job of this.jobs) {
      try { job.stop(); } catch (_) {}
    }
    this.jobs = [];
  }

  async _runReport(schedule) {
    try {
      const now = new Date();
      let dateFrom, dateTo;

      switch (schedule.report_type) {
        case 'daily': {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          dateFrom = yesterday.toISOString().slice(0, 10);
          dateTo = dateFrom;
          break;
        }
        case 'weekly': {
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          dateFrom = weekAgo.toISOString().slice(0, 10);
          dateTo = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
        case 'monthly': {
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          dateFrom = monthAgo.toISOString().slice(0, 10);
          dateTo = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
          break;
        }
        default:
          return;
      }

      this.log.info(`[ReportScheduler] Generating ${schedule.report_type} report: ${dateFrom} — ${dateTo}`);
      const report = await this.generator.generate(schedule.report_type, dateFrom, dateTo);

      // Уведомляем директоров
      if (this.notify && schedule.notify_roles?.length) {
        const usersRes = await this.db.query(
          'SELECT id FROM users WHERE role = ANY($1) AND is_active = true',
          [schedule.notify_roles]
        );

        for (const user of usersRes.rows) {
          try {
            await this.notify(this.db, {
              user_id: user.id,
              title: `Отчёт: ${report.title}`,
              message: `Готов ${schedule.report_type === 'daily' ? 'ежедневный' : schedule.report_type === 'weekly' ? 'еженедельный' : 'ежемесячный'} отчёт по звонкам.`,
              type: 'call_report',
              link: `#/call-reports?id=${report.id}`
            });
          } catch (_) {}
        }
      }

      this.log.info(`[ReportScheduler] Report #${report.id} generated OK`);
    } catch (err) {
      this.log.error(`[ReportScheduler] Generation failed for ${schedule.report_type}:`, err.message);
    }
  }
}

module.exports = ReportScheduler;
