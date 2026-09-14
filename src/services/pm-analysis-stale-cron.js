'use strict';

/**
 * Hourly reminders:
 * - open analysis idle ≥24h OR docs_deadline ≤2 days
 * - analysis_deadline overdue (duty PM + analysis owner)
 */

const cron = require('node-cron');
const { sendCrmEmail } = require('./crm-mailer');
const { createNotification } = require('./notify');
const { getCurrentDuty } = require('./tender-registry-helpers');

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

async function findCandidates(db) {
  const r = await db.query(`
    SELECT rev.id AS review_id, t.id AS tender_id, t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           u.id AS pm_user_id, u.name AS pm_name, u.email AS pm_email, u.role AS pm_role,
           GREATEST(
             COALESCE(rev.updated_at, rev.created_at),
             COALESCE((SELECT MAX(l.created_at) FROM tender_rp_review_log l WHERE l.review_id = rev.id), rev.created_at),
             COALESCE((SELECT MAX(d.updated_at) FROM tender_rp_review_participant_drafts d WHERE d.review_id = rev.id), rev.created_at)
           ) AS last_touch
    FROM tender_rp_reviews rev
    JOIN tenders t ON t.id = rev.tender_id AND t.deleted_at IS NULL
    JOIN users u ON u.id = COALESCE(rev.analysis_owner_user_id, rev.started_by_user_id)
    WHERE rev.analysis_finalized_at IS NULL
      AND t.registry_status = 'рассмотрение'
      AND COALESCE(t.calculator_kind, '') <> 'to'
      AND u.role IS DISTINCT FROM 'ADMIN'
      AND u.name NOT ILIKE 'Администратор%'
      AND u.login NOT LIKE 'test_%'
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
    SELECT t.id AS tender_id,
           t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           t.analysis_deadline::date AS analysis_deadline,
           t.participation_paid,
           t.participation_fee,
           rev.id AS review_id,
           COALESCE(rev.analysis_owner_user_id, rev.started_by_user_id) AS owner_user_id
    FROM tenders t
    LEFT JOIN LATERAL (
      SELECT r.id, r.analysis_owner_user_id, r.started_by_user_id, r.analysis_finalized_at
      FROM tender_rp_reviews r
      WHERE r.tender_id = t.id
      ORDER BY r.id DESC
      LIMIT 1
    ) rev ON true
    WHERE t.deleted_at IS NULL
      AND t.registry_status = 'рассмотрение'
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

async function alreadySentReview(db, reviewId, kind) {
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE review_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `, [reviewId, kind]);
  return !!r.rows[0];
}

async function alreadySentTender(db, tenderId, kind) {
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE tender_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `, [tenderId, kind]);
  return !!r.rows[0];
}

async function markSentReview(db, reviewId, kind) {
  await db.query(`
    INSERT INTO pm_analysis_stale_notices (review_id, notice_kind, sent_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (review_id, notice_kind) DO UPDATE SET sent_at = NOW()
  `, [reviewId, kind]);
}

async function markSentTender(db, tenderId, reviewId, kind) {
  // Prefer unique (tender_id, notice_kind) partial index
  const existing = await db.query(`
    SELECT id FROM pm_analysis_stale_notices
    WHERE tender_id = $1 AND notice_kind = $2
    LIMIT 1
  `, [tenderId, kind]);
  if (existing.rows[0]) {
    await db.query(`
      UPDATE pm_analysis_stale_notices
      SET sent_at = NOW(), review_id = COALESCE($2, review_id)
      WHERE id = $1
    `, [existing.rows[0].id, reviewId || null]);
    return;
  }
  await db.query(`
    INSERT INTO pm_analysis_stale_notices (review_id, tender_id, notice_kind, sent_at)
    VALUES ($1, $2, $3, NOW())
  `, [reviewId || null, tenderId, kind]);
}

function buildEmail(row) {
  const why = row.notice_kind === 'deadline_2d'
    ? `До дедлайна подачи документов осталось 2 дня или меньше (${row.docs_deadline || '—'}).`
    : `По анализу нет движения уже около ${row.idle_hours} ч.`;
  const subject = row.notice_kind === 'deadline_2d'
    ? `Срочно: анализ тендера №${row.tender_id} — дедлайн близко`
    : `Напоминание: анализ тендера №${row.tender_id} без движения`;
  const client = (row.customer_name && String(row.customer_name).trim())
    || (row.tender_title && String(row.tender_title).trim())
    || 'не указан';
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:16px;">
  <table width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;">
    <tr><td style="padding:20px;background:#1a2332;color:#fff;">
      <strong>ASGARD CRM</strong> · незакрытый анализ тендера
    </td></tr>
    <tr><td style="padding:16px;font-size:14px;color:#334155;line-height:1.5;">
      <p>Здравствуйте, ${escHtml(row.pm_name) || ''}!</p>
      <p><strong>${escHtml(why)}</strong></p>
      <p>Клиент: <strong>${escHtml(client)}</strong><br>
         Тендер №${row.tender_id}<br>
         ${row.tender_title ? escHtml(row.tender_title) : ''}</p>
      <p>Закройте анализ («подаём» или «не подаём» с причиной) — черновик портит очередь и рейтинг.</p>
      <p style="text-align:center;margin-top:20px;">
        <a href="https://asgard-crm.ru/#/pm-calculations"
           style="background:#3b82f6;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Открыть очередь анализа
        </a>
      </p>
    </td></tr>
  </table></body></html>`;
  return { subject, html };
}

function buildOverdueEmail(row, recipientName) {
  const paidLabel = row.participation_paid
    ? (`платное · ${formatMoneyRu(row.participation_fee) || 'сумма не указана'}`)
    : 'бесплатное';
  const subject = `Просрочен внутренний срок анализа · тендер №${row.tender_id}`;
  const client = (row.customer_name && String(row.customer_name).trim())
    || (row.tender_title && String(row.tender_title).trim())
    || 'не указан';
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:16px;">
  <table width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;">
    <tr><td style="padding:20px;background:#7f1d1d;color:#fff;">
      <strong>ASGARD CRM</strong> · просрочен внутренний срок анализа
    </td></tr>
    <tr><td style="padding:16px;font-size:14px;color:#334155;line-height:1.5;">
      <p>Здравствуйте${recipientName ? ', ' + escHtml(recipientName) : ''}!</p>
      <p>Внутренний срок анализа тендера <strong>№${row.tender_id}</strong> истёк
         (<strong>${escHtml(row.analysis_deadline || '—')}</strong>).</p>
      <p>Клиент: <strong>${escHtml(client)}</strong><br>
         ${row.tender_title ? escHtml(row.tender_title) + '<br>' : ''}
         Участие: ${escHtml(paidLabel)}<br>
         Срок подачи документов: <strong>${escHtml(row.docs_deadline || '—')}</strong></p>
      <p>Продление внутреннего срока возможно <strong>не позднее чем за 2 календарных дня</strong>
         до срока подачи документов (сейчас ещё можно успеть закрыть или сдвинуть срок подачи).</p>
      <p style="text-align:center;margin-top:20px;">
        <a href="https://asgard-crm.ru/#/tenders?id=${row.tender_id}"
           style="background:#3b82f6;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Открыть тендер в CRM
        </a>
      </p>
    </td></tr>
  </table></body></html>`;
  return { subject, html };
}

async function getHeadPmEmails(db) {
  const r = await db.query(`
    SELECT email FROM users
    WHERE is_active AND role = 'HEAD_PM' AND email IS NOT NULL AND btrim(email) <> ''
  `);
  return r.rows.map((x) => x.email);
}

async function loadUsersByIds(db, ids) {
  const uniq = [...new Set(ids.filter(Boolean).map((x) => Number(x)).filter((n) => Number.isFinite(n)))];
  if (!uniq.length) return [];
  const r = await db.query(`
    SELECT id, name, email, role, login
    FROM users
    WHERE id = ANY($1::int[])
      AND is_active
      AND role IS DISTINCT FROM 'ADMIN'
      AND name NOT ILIKE 'Администратор%'
      AND login NOT LIKE 'test_%'
  `, [uniq]);
  return r.rows;
}

async function runOverdueOnce(db, log) {
  const rows = await findAnalysisDeadlineOverdue(db);
  let sent = 0;
  const duty = await getCurrentDuty(db).catch(() => null);
  const dutyPmId = duty?.pm_user_id || null;

  for (const row of rows) {
    try {
      if (await alreadySentTender(db, row.tender_id, 'analysis_deadline_overdue')) continue;

      const recipients = await loadUsersByIds(db, [dutyPmId, row.owner_user_id]);
      if (!recipients.length) {
        log?.warn?.({ tender_id: row.tender_id }, '[PmAnalysisStale] overdue: no recipients');
        await markSentTender(db, row.tender_id, row.review_id, 'analysis_deadline_overdue');
        continue;
      }

      for (const u of recipients) {
        const { subject, html } = buildOverdueEmail(row, u.name);
        if (u.email) {
          await sendCrmEmail(db, null, { to: u.email, subject, html, text: subject });
        }
        if (createNotification) {
          await createNotification(db, {
            user_id: u.id,
            type: 'pm_analysis_deadline_overdue',
            title: subject,
            message: row.customer_name || (`Тендер #${row.tender_id}`),
            link: `#/tenders?id=${row.tender_id}`
          }).catch(() => {});
        }
      }

      await markSentTender(db, row.tender_id, row.review_id, 'analysis_deadline_overdue');
      sent += 1;
    } catch (err) {
      log?.error?.({ err, tender_id: row.tender_id }, '[PmAnalysisStale] overdue send failed');
    }
  }
  log?.info?.(`[PmAnalysisStale] overdue candidates=${rows.length} sent=${sent}`);
  return { candidates: rows.length, sent };
}

async function runOnce(db, log) {
  const rows = await findCandidates(db);
  let sent = 0;
  for (const row of rows) {
    try {
      if (await alreadySentReview(db, row.review_id, row.notice_kind)) continue;
      const { subject, html } = buildEmail(row);
      if (row.pm_email) {
        await sendCrmEmail(db, null, { to: row.pm_email, subject, html, text: subject });
      }
      if (row.pm_user_id && createNotification) {
        await createNotification(db, {
          user_id: row.pm_user_id,
          type: 'pm_analysis_stale',
          title: subject,
          message: row.customer_name || (`Тендер #${row.tender_id}`),
          link: '#/pm-calculations'
        }).catch(() => {});
      }
      if (row.notice_kind === 'deadline_2d') {
        const heads = await getHeadPmEmails(db);
        for (const em of heads) {
          if (em === row.pm_email) continue;
          await sendCrmEmail(db, null, {
            to: em,
            subject: `[копия] ${subject}`,
            html,
            text: subject
          }).catch(() => {});
        }
      }
      await markSentReview(db, row.review_id, row.notice_kind);
      sent += 1;
    } catch (err) {
      log?.error?.({ err, review_id: row.review_id }, '[PmAnalysisStale] send failed');
    }
  }
  const overdue = await runOverdueOnce(db, log);
  log?.info?.(`[PmAnalysisStale] candidates=${rows.length} sent=${sent}`);
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
  runOverdueOnce
};
