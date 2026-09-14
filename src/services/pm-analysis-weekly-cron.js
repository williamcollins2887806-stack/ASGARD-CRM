'use strict';

/**
 * Director digests (утверждённые шаблоны):
 *  — еженедельный: понедельник 08:30 MSK
 *      (09:00 — MimirCron/Birthday; 09:30 — per-diem-cron)
 *  — месячный: 1-е число 10:30 MSK (10:00 — ReportScheduler monthly)
 *
 * Одно письмо сразу на 4 адреса: Андросов + Кудряшов + Сторожев + Гажилиев.
 */

const cron = require('node-cron');
const { buildWeeklyDigest, resolveWeekRange, isoDate } = require('./pm-analysis-weekly-report');
const { generatePmAnalysisWeeklyEmail } = require('./pm-analysis-weekly-email');
const { sendCrmEmail } = require('./crm-mailer');

let _weeklyJob = null;
let _monthlyJob = null;

/** Фиксированный список рассылки (прод). */
const DIGEST_RECIPIENT_IDS = [3474, 3455, 3457, 3456]; // Андросов, Кудряшов, Сторожев, Гажилиев

const MONTH_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];

async function acquireLock(db, key) {
  try {
    const r = await db.query(
      `INSERT INTO cron_locks (lock_key, acquired_at, expires_at)
       VALUES ($1, NOW(), NOW() + INTERVAL '2 hours')
       ON CONFLICT (lock_key) DO UPDATE SET
         acquired_at = NOW(),
         expires_at = NOW() + INTERVAL '2 hours'
       WHERE cron_locks.expires_at < NOW()
       RETURNING lock_key`,
      [key]
    );
    return !!r.rows[0];
  } catch (_) {
    return true;
  }
}

async function releaseLock(db, key) {
  try { await db.query(`DELETE FROM cron_locks WHERE lock_key = $1`, [key]); } catch (_) { /* ignore */ }
}

function resolvePreviousMonth(asOfDate) {
  const raw = isoDate(asOfDate) || isoDate(new Date());
  const d = new Date(`${raw}T12:00:00Z`);
  const firstThis = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const lastPrev = new Date(firstThis);
  lastPrev.setUTCDate(0);
  const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
  return {
    start: isoDate(firstPrev),
    end: isoDate(lastPrev),
    monthIndex: lastPrev.getUTCMonth(),
    year: lastPrev.getUTCFullYear()
  };
}

function fmtPeriodRu(start, end) {
  const a = String(start || '').slice(0, 10);
  const b = String(end || '').slice(0, 10);
  const f = (d) => {
    const [y, m, day] = d.split('-');
    return y ? `${day}.${m}` : d;
  };
  return `${f(a)}–${f(b)}.${a.slice(0, 4)}`;
}

async function getDigestRecipients(db) {
  const r = await db.query(
    `SELECT id, name, email, role FROM users
     WHERE id = ANY($1::int[])
       AND is_active = true
       AND email IS NOT NULL AND btrim(email) <> ''`,
    [DIGEST_RECIPIENT_IDS]
  );
  const byId = new Map(r.rows.map((x) => [x.id, x]));
  // стабильный порядок как в DIGEST_RECIPIENT_IDS; дедуп по email
  const seen = new Set();
  const out = [];
  for (const id of DIGEST_RECIPIENT_IDS) {
    const u = byId.get(id);
    if (!u || !u.email) continue;
    const key = String(u.email).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

async function sendToAll(db, log, { subject, html, text }) {
  const recipients = await getDigestRecipients(db);
  if (!recipients.length) {
    log?.error?.('[PmDigest] no recipients');
    return { ok: false, results: [], recipients: [] };
  }
  const toList = recipients.map((u) => u.email);
  try {
    const result = await sendCrmEmail(db, null, {
      to: toList,
      subject,
      html,
      text: text || subject,
      skipBcc: true,
      noBcc: true
    });
    log?.info?.(`[PmDigest] sent one mail to ${toList.join(', ')}`);
    return {
      ok: true,
      messageId: result?.messageId || null,
      recipients: toList,
      results: toList.map((email) => ({ email, ok: true }))
    };
  } catch (err) {
    log?.error?.({ err }, '[PmDigest] send failed');
    return {
      ok: false,
      recipients: toList,
      results: toList.map((email) => ({ email, ok: false, error: err.message }))
    };
  }
}

async function runWeeklyOnce(db, log, opts = {}) {
  const payload = await buildWeeklyDigest(db, {
    preview: !!opts.preview,
    kind: 'weekly',
    forceWeek: opts.forceWeek,
    asOf: opts.asOf
  });
  const html = generatePmAnalysisWeeklyEmail(payload);
  const periodRu = fmtPeriodRu(payload.weekStart, payload.weekEnd);
  const subject = opts.preview
    ? `Еженедельный дайджест · просмотр · ${periodRu}`
    : `Еженедельный дайджест · ${periodRu}`;

  if (opts.toEmail) {
    await sendCrmEmail(db, null, {
      to: opts.toEmail,
      subject,
      html,
      text: payload.verdict || subject,
      skipBcc: true,
      noBcc: true
    });
    return { payload, html, subject, results: [{ email: opts.toEmail, ok: true }] };
  }

  const send = await sendToAll(db, log, {
    subject,
    html,
    text: payload.verdict || subject
  });
  return { payload, html, subject, ...send };
}

async function runMonthlyOnce(db, log, opts = {}) {
  const month = opts.forceWeek
    ? {
      start: opts.forceWeek.start,
      end: opts.forceWeek.end,
      monthIndex: Number(String(opts.forceWeek.start).slice(5, 7)) - 1,
      year: Number(String(opts.forceWeek.start).slice(0, 4))
    }
    : resolvePreviousMonth(opts.asOf || new Date());

  const monthTitle = `${MONTH_RU[month.monthIndex] || ''} ${month.year}`.trim();
  const payload = await buildWeeklyDigest(db, {
    preview: !!opts.preview,
    kind: 'monthly',
    title: `Месячный дайджест · ${monthTitle}`,
    forceWeek: { start: month.start, end: month.end }
  });
  const html = generatePmAnalysisWeeklyEmail(payload);
  const subject = opts.preview
    ? `Месячный дайджест · просмотр · ${monthTitle}`
    : `Месячный дайджест · ${monthTitle}`;

  if (opts.toEmail) {
    await sendCrmEmail(db, null, {
      to: opts.toEmail,
      subject,
      html,
      text: payload.verdict || subject,
      skipBcc: true,
      noBcc: true
    });
    return { payload, html, subject, results: [{ email: opts.toEmail, ok: true }] };
  }

  const send = await sendToAll(db, log, {
    subject,
    html,
    text: payload.verdict || subject
  });
  return { payload, html, subject, ...send };
}

/** Совместимость со старым API preview/send. */
async function runOnce(db, log, opts = {}) {
  if (opts.kind === 'monthly') return runMonthlyOnce(db, log, opts);
  return runWeeklyOnce(db, log, opts);
}

function start(db, log) {
  if (!_weeklyJob) {
    // Пн 08:30 MSK — 09:00 MimirCron/Birthday, 09:30 per-diem
    _weeklyJob = cron.schedule('30 8 * * 1', async () => {
      const key = `pm_weekly_digest_${new Date().toISOString().slice(0, 10)}`;
      const ok = await acquireLock(db, key);
      if (!ok) {
        log?.info?.('[PmWeeklyDigest] lock held, skip');
        return;
      }
      try {
        await runWeeklyOnce(db, log, { preview: false });
      } catch (err) {
        log?.error?.({ err }, '[PmWeeklyDigest] tick failed');
      } finally {
        await releaseLock(db, key);
      }
    }, { timezone: 'Europe/Moscow' });
    log?.info?.('[PmWeeklyDigest] started (Mon 08:30 MSK)');
  }

  if (!_monthlyJob) {
    // 1-е число 10:30 MSK — 10:00 занято ReportScheduler monthly
    _monthlyJob = cron.schedule('30 10 1 * *', async () => {
      const key = `pm_monthly_digest_${new Date().toISOString().slice(0, 7)}`;
      const ok = await acquireLock(db, key);
      if (!ok) {
        log?.info?.('[PmMonthlyDigest] lock held, skip');
        return;
      }
      try {
        await runMonthlyOnce(db, log, { preview: false });
      } catch (err) {
        log?.error?.({ err }, '[PmMonthlyDigest] tick failed');
      } finally {
        await releaseLock(db, key);
      }
    }, { timezone: 'Europe/Moscow' });
    log?.info?.('[PmMonthlyDigest] started (1st 10:30 MSK)');
  }
}

function stop() {
  if (_weeklyJob) { _weeklyJob.stop(); _weeklyJob = null; }
  if (_monthlyJob) { _monthlyJob.stop(); _monthlyJob = null; }
}

module.exports = {
  start,
  stop,
  runOnce,
  runWeeklyOnce,
  runMonthlyOnce,
  getDigestRecipients,
  resolvePreviousMonth,
  DIGEST_RECIPIENT_IDS,
  buildWeeklyDigest: require('./pm-analysis-weekly-report').buildWeeklyDigest,
  resolveWeekRange
};
