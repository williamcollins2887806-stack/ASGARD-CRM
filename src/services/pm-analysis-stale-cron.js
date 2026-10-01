'use strict';

/**
 * Hourly reminders for OPEN analysis queue:
 * - idle ≥24h OR docs_deadline ≤2 days
 * - analysis_deadline overdue
 *
 * Канон: письма и in-app — ТОЛЬКО текущему дежурному РП.
 * Owner / бывший дежурный / HEAD_PM CC — не получатели.
 * Нет дежурного → не слать (warning в лог).
 */

const cron = require('node-cron');
const { sendCrmEmail } = require('./crm-mailer');
const { createNotification } = require('./notify');
const { getCurrentDuty } = require('./tender-registry-helpers');
const { transferOpenAnalysesToDuty } = require('./rp-review-drafts');

let _job = null;

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try { return d.toISOString().slice(0, 10); } catch (_) { return null; }
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMoneyRu(n) {
  if (n == null || n === '') return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

/** Open analyses that need a nudge (idle ≥24h or docs_deadline ≤2d). No recipient yet. */
async function findCandidates(db) {
  const r = await db.query(`
    SELECT rev.id AS review_id, t.id AS tender_id, t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           GREATEST(
             COALESCE(rev.updated_at, rev.created_at),
             COALESCE((SELECT MAX(l.created_at) FROM tender_rp_review_log l WHERE l.review_id = rev.id), rev.created_at),
             COALESCE((SELECT MAX(d.updated_at) FROM tender_rp_review_participant_drafts d WHERE d.review_id = rev.id), rev.created_at)
           ) AS last_touch
    FROM tender_rp_reviews rev
    JOIN tenders t ON t.id = rev.tender_id AND t.deleted_at IS NULL
    WHERE rev.analysis_finalized_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND COALESCE(t.calculator_kind, '') <> 'to'
      AND NOT (
        COALESCE(btrim(t.customer_name), '') = ''
        AND COALESCE(btrim(t.tender_title), '') ILIKE 'Новый тендер%'
      )
  `);
  const today = isoDate(new Date());
  const out = [];
  for (const row of r.rows) {
    const idleMs = Date.now() - new Date(row.last_touch).getTime();
    const idle24 = idleMs >= 24 * 3600 * 1000;
    const ddl = isoDate(row.docs_deadline);
    let deadlineHot = false;
    if (ddl && today) {
      const d0 = new Date(today + 'T12:00:00Z').getTime();
      const d1 = new Date(ddl + 'T12:00:00Z').getTime();
      const days = Math.round((d1 - d0) / 86400000);
      deadlineHot = days <= 2;
    }
    if (!idle24 && !deadlineHot) continue;
    out.push({
      ...row,
      notice_kind: deadlineHot ? 'deadline_2d' : 'idle_24h',
      idle_hours: Math.round(idleMs / 3600000),
      docs_deadline: ddl
    });
  }
  return out;
}

/** Overdue internal analysis_deadline; still extendable (≥2 calendar days before docs_deadline). */
async function findAnalysisDeadlineOverdue(db) {
  const r = await db.query(`
    SELECT t.id AS tender_id, t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           t.analysis_deadline::date AS analysis_deadline,
           rev.id AS review_id
    FROM tenders t
    LEFT JOIN LATERAL (
      SELECT r.id, r.analysis_finalized_at
      FROM tender_rp_reviews r
      WHERE r.tender_id = t.id
      ORDER BY r.created_at DESC
      LIMIT 1
    ) rev ON true
    WHERE t.deleted_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND COALESCE(t.calculator_kind, '') <> 'to'
      AND t.analysis_deadline IS NOT NULL
      AND t.analysis_deadline::date < CURRENT_DATE
      AND t.docs_deadline IS NOT NULL
      AND t.docs_deadline::date >= (CURRENT_DATE + INTERVAL '2 days')
      AND (rev.id IS NULL OR rev.analysis_finalized_at IS NULL)
      AND NOT (
        COALESCE(btrim(t.customer_name), '') = ''
        AND COALESCE(btrim(t.tender_title), '') ILIKE 'Новый тендер%'
      )
  `);
  return r.rows.map((row) => ({
    ...row,
    notice_kind: 'analysis_deadline_overdue',
    docs_deadline: isoDate(row.docs_deadline),
    analysis_deadline: isoDate(row.analysis_deadline)
  }));
}

async function alreadySentReview(db, reviewId, noticeKind) {
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE review_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `, [reviewId, noticeKind]).catch(() => ({ rows: [] }));
  return !!r.rows[0];
}

async function markSentReview(db, reviewId, noticeKind) {
  await db.query(`
    INSERT INTO pm_analysis_stale_notices (review_id, notice_kind, sent_at)
    VALUES ($1, $2, NOW())
  `, [reviewId, noticeKind]).catch(() => {});
}

async function alreadySentTender(db, tenderId, noticeKind) {
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE tender_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `, [tenderId, noticeKind]).catch(() => ({ rows: [] }));
  return !!r.rows[0];
}

async function markSentTender(db, tenderId, reviewId, noticeKind) {
  await db.query(`
    INSERT INTO pm_analysis_stale_notices (tender_id, review_id, notice_kind, sent_at)
    VALUES ($1, $2, $3, NOW())
  `, [tenderId, reviewId || null, noticeKind]).catch(() => {});
}

function buildEmail(row) {
  const why = row.notice_kind === 'deadline_2d'
    ? `До дедлайна подачи документов осталось 2 дня или меньше (${row.docs_deadline || '—'}).`
    : `По анализу нет движения больше суток (последнее касание ~${row.idle_hours || '?'} ч назад).`;
  const subject = row.notice_kind === 'deadline_2d'
    ? `Срок подачи близко: ${row.customer_name || ('тендер #' + row.tender_id)}`
    : `Анализ без движения: ${row.customer_name || ('тендер #' + row.tender_id)}`;
  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#111;">
      <p>Здравствуйте.</p>
      <p>${escHtml(why)}</p>
      <p><strong>${escHtml(row.customer_name || '')}</strong><br>
         ${escHtml(row.tender_title || '')}<br>
         Дедлайн документов: <strong>${escHtml(row.docs_deadline || '—')}</strong></p>
      <p><a href="https://asgard-crm.ru/#/pm-calculations">Открыть очередь анализа</a></p>
    </div>`;
  return { subject, html };
}

function buildOverdueEmail(row, dutyName) {
  const subject = `Просрочен analysis_deadline: ${row.customer_name || ('тендер #' + row.tender_id)}`;
  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#111;">
      <p>Здравствуйте${dutyName ? ', ' + escHtml(dutyName) : ''}.</p>
      <p>Внутренний срок анализа просрочен
         (<strong>${escHtml(row.analysis_deadline || '—')}</strong>).</p>
      <p><strong>${escHtml(row.customer_name || '')}</strong><br>
         ${escHtml(row.tender_title || '')}<br>
         Срок подачи документов: <strong>${escHtml(row.docs_deadline || '—')}</strong></p>
      <p><a href="https://asgard-crm.ru/#/tenders?id=${row.tender_id}">Открыть тендер</a></p>
    </div>`;
  return { subject, html };
}

async function loadDutyRecipient(db) {
  const duty = await getCurrentDuty(db).catch(() => null);
  if (!duty || !duty.pm_user_id) return null;
  const r = await db.query(`
    SELECT id, name, email, role
    FROM users
    WHERE id = $1
      AND is_active
      AND role IS DISTINCT FROM 'ADMIN'
      AND name NOT ILIKE 'Администратор%'
      AND login NOT LIKE 'test_%'
    LIMIT 1
  `, [duty.pm_user_id]).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

/** Если есть текущий дежурный — перекинуть открытые рассмотрение на него (owner не залипает). */
async function handoffToCurrentDuty(db, log) {
  const duty = await getCurrentDuty(db).catch(() => null);
  if (!duty || !duty.pm_user_id) return { transferred: 0, skipped: true };
  try {
    const r = await transferOpenAnalysesToDuty(db, Number(duty.pm_user_id));
    if (r.transferred > 0) {
      log?.info?.(`[PmAnalysisStale] handoff transferred=${r.transferred} → duty=${duty.pm_user_id}`);
    }
    return r;
  } catch (err) {
    log?.warn?.({ err }, '[PmAnalysisStale] handoff failed');
    return { transferred: 0, error: true };
  }
}

async function runOverdueOnce(db, log) {
  const rows = await findAnalysisDeadlineOverdue(db);
  let sent = 0;
  const recipient = await loadDutyRecipient(db);
  if (!recipient) {
    log?.warn?.(`[PmAnalysisStale] overdue: no duty PM — skip ${rows.length} candidates`);
    return { candidates: rows.length, sent: 0, skipped_no_duty: true };
  }

  for (const row of rows) {
    try {
      if (await alreadySentTender(db, row.tender_id, 'analysis_deadline_overdue')) continue;

      const { subject, html } = buildOverdueEmail(row, recipient.name);
      if (recipient.email) {
        await sendCrmEmail(db, null, { to: recipient.email, subject, html, text: subject });
      }
      if (createNotification) {
        await createNotification(db, {
          user_id: recipient.id,
          type: 'pm_analysis_deadline_overdue',
          title: subject,
          message: row.customer_name || (`Тендер #${row.tender_id}`),
          link: `#/tenders?id=${row.tender_id}`
        }).catch(() => {});
      }

      await markSentTender(db, row.tender_id, row.review_id, 'analysis_deadline_overdue');
      sent += 1;
    } catch (err) {
      log?.error?.({ err, tender_id: row.tender_id }, '[PmAnalysisStale] overdue send failed');
    }
  }
  log?.info?.(`[PmAnalysisStale] overdue candidates=${rows.length} sent=${sent} duty=${recipient.id}`);
  return { candidates: rows.length, sent };
}

async function runOnce(db, log) {
  await handoffToCurrentDuty(db, log);

  const recipient = await loadDutyRecipient(db);
  const rows = await findCandidates(db);
  let sent = 0;

  if (!recipient) {
    log?.warn?.(`[PmAnalysisStale] no duty PM — skip ${rows.length} idle/deadline candidates`);
    const overdue = await runOverdueOnce(db, log);
    return { candidates: rows.length, sent: 0, skipped_no_duty: true, overdue };
  }

  for (const row of rows) {
    try {
      if (await alreadySentReview(db, row.review_id, row.notice_kind)) continue;
      const { subject, html } = buildEmail(row);
      if (recipient.email) {
        await sendCrmEmail(db, null, { to: recipient.email, subject, html, text: subject });
      }
      if (createNotification) {
        await createNotification(db, {
          user_id: recipient.id,
          type: 'pm_analysis_stale',
          title: subject,
          message: row.customer_name || (`Тендер #${row.tender_id}`),
          link: '#/pm-calculations'
        }).catch(() => {});
      }
      // CC HEAD_PM убран: уведомления только дежурному.
      await markSentReview(db, row.review_id, row.notice_kind);
      sent += 1;
    } catch (err) {
      log?.error?.({ err, review_id: row.review_id }, '[PmAnalysisStale] send failed');
    }
  }
  const overdue = await runOverdueOnce(db, log);
  log?.info?.(`[PmAnalysisStale] candidates=${rows.length} sent=${sent} duty=${recipient.id}`);
  return { candidates: rows.length, sent, overdue };
}

function start(db, log) {
  if (_job) return;
  _job = cron.schedule('0 * * * *', () => {
    runOnce(db, log).catch((err) => log?.error?.({ err }, '[PmAnalysisStale] tick failed'));
  }, { timezone: 'Europe/Moscow' });
  log?.info?.('[PmAnalysisStale] started (hourly MSK)');
}

function stop() {
  if (_job) { _job.stop(); _job = null; }
}

module.exports = {
  start,
  stop,
  runOnce,
  findCandidates,
  findAnalysisDeadlineOverdue,
  runOverdueOnce,
  handoffToCurrentDuty,
  loadDutyRecipient
};
