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
const { getCurrentDuty } = require('./tender-registry-helpers');
const { transferOpenAnalysesToDuty } = require('./rp-review-drafts');

let _job = null;

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try { return d.toISOString().slice(0, 10); } catch (_) { return null; }
}

/** Open analyses that need a nudge (idle ≥24h or docs_deadline ≤2d). No recipient yet. */
async function findCandidates(db) {
  // ── Кого напоминать ──────────────────────────────────────────────────────
  // КОРЕНЬ (жалоба РП 09.11.2026): письмо приходило по тендеру 2121, а в
  // очереди РП его не было. Причина — крон и очередь считали РАЗНОЕ:
  //   • крон: registry_status = 'рассмотрение' (жёстко);
  //   • очередь pm-duty: тот же статус ИЛИ владелец/соавтор карточки.
  // Тендер со статусом «готовим» и назначенным владельцем виден РП в очереди,
  // но под условие крона не подходил — и наоборот, попадал в письма, если
  // статус был «рассмотрение», а владелец другой.
  //
  // Теперь условие ОДНО: напоминаем только по тем карточкам, которые реально
  // ждут действия РП — открытый анализ И владелец не финализирован, и статус
  // из рабочего набора. Плюс требование, чтобы карточка вообще была в очереди
  // (есть владелец-РП или он ещё не назначен — тогда её видит дежурный).
  const r = await db.query(`
    SELECT rev.id AS review_id, t.id AS tender_id, t.customer_name, t.tender_title,
           t.docs_deadline::date AS docs_deadline,
           t.registry_status,
           rev.analysis_owner_user_id,
           t.calculator_user_id,
           GREATEST(
             COALESCE(rev.updated_at, rev.created_at),
             COALESCE((SELECT MAX(l.created_at) FROM tender_rp_review_log l WHERE l.review_id = rev.id), rev.created_at),
             COALESCE((SELECT MAX(d.updated_at) FROM tender_rp_review_participant_drafts d WHERE d.review_id = rev.id), rev.created_at)
           ) AS last_touch
    FROM tender_rp_reviews rev
    JOIN tenders t ON t.id = rev.tender_id AND t.deleted_at IS NULL
    WHERE rev.analysis_finalized_at IS NULL
      AND (rev.is_final IS NULL OR rev.is_final = false)
      -- Тот же набор статусов, что открывает очередь pm-duty.
      AND t.registry_status IN ('рассмотрение', 'готовим')
      AND COALESCE(t.calculator_kind, '') <> 'to'
      -- Карточка должна быть «чья-то»: у неё есть владелец анализа, либо
      -- она бесхозная (её видит дежурный и берёт себе).
      AND (
        rev.analysis_owner_user_id IS NOT NULL
        OR t.calculator_user_id IS NOT NULL
        OR (rev.analysis_owner_user_id IS NULL AND t.calculator_user_id IS NULL)
      )
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
           t.participation_paid,
           t.participation_fee,
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

/** Повторное письмо по тому же review/tender+kind — не чаще раза в 48 ч. */
const NOTICE_COOLDOWN = '48 hours';

async function alreadySentReview(db, reviewId, noticeKind) {
  if (!reviewId) return false;
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE review_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - $3::interval
    LIMIT 1
  `, [reviewId, noticeKind, NOTICE_COOLDOWN]).catch(() => ({ rows: [] }));
  return !!r.rows[0];
}

async function markSentReview(db, reviewId, noticeKind) {
  if (!reviewId) return;
  // UNIQUE (review_id, notice_kind) — без UPSERT INSERT молча падает и спам идёт каждый час
  await db.query(`
    INSERT INTO pm_analysis_stale_notices (review_id, notice_kind, sent_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (review_id, notice_kind) DO UPDATE SET sent_at = NOW()
  `, [reviewId, noticeKind]);
}

async function alreadySentTender(db, tenderId, noticeKind) {
  if (!tenderId) return false;
  const r = await db.query(`
    SELECT 1 FROM pm_analysis_stale_notices
    WHERE tender_id = $1 AND notice_kind = $2
      AND sent_at > NOW() - $3::interval
    LIMIT 1
  `, [tenderId, noticeKind, NOTICE_COOLDOWN]).catch(() => ({ rows: [] }));
  return !!r.rows[0];
}

async function markSentTender(db, tenderId, reviewId, noticeKind) {
  if (!tenderId) return;
  // UNIQUE partial (tender_id, notice_kind) WHERE tender_id IS NOT NULL
  const existing = await db.query(`
    SELECT id FROM pm_analysis_stale_notices
    WHERE tender_id = $1 AND notice_kind = $2
    LIMIT 1
  `, [tenderId, noticeKind]);
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
  `, [reviewId || null, tenderId, noticeKind]);
}

// Письма по простоям и дедлайнам больше не собираются здесь: событие уходит
// в очередь дайджеста (tender_digest_outbox), а единое письмо формирует
// src/services/tender-digest.js. Это убирает десятки писем в день.

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
  let queued = 0;
  const recipient = await loadDutyRecipient(db);

  // ── Почему не письмо напрямую ────────────────────────────────────────────
  // Крон тикает каждый час. Раньше каждый «просроченный» тендер давал своё
  // письмо — за час могло уйти десяток. Теперь событие только кладётся в
  // очередь (tender_digest_outbox), а ОДНО письмо уходит в окно 09–10 или
  // 17–18 МСК. Дедупликация по event_key не даст повторить то же событие.
  const digestRunner = require('./tender-digest-runner');

  for (const row of rows) {
    try {
      if (await alreadySentTender(db, row.tender_id, 'analysis_deadline_overdue')) continue;

      // owner нужен, чтобы дайджест знал получателя; при отсутствии — дежурный.
      const ownerId = recipient ? recipient.id : null;
      const r = await digestRunner.enqueueEvent(db, {
        kind: 'analysis_overdue',
        tender_id: row.tender_id,
        title: row.customer_name || row.tender_title || null,
        deadline: row.docs_deadline || null,
        payload: {
          owner: ownerId,
          analysis_deadline: row.analysis_deadline || null,
          notice: 'analysis_deadline_overdue'
        }
      });
      if (r && r.queued) queued += 1;
      await markSentTender(db, row.tender_id, row.review_id, 'analysis_deadline_overdue');
    } catch (err) {
      log?.error?.({ err, tender_id: row.tender_id }, '[PmAnalysisStale] overdue enqueue failed');
    }
  }
  log?.info?.(`[PmAnalysisStale] overdue candidates=${rows.length} queued=${queued}`);
  return { candidates: rows.length, queued };
}

async function runOnce(db, log) {
  await handoffToCurrentDuty(db, log);

  const recipient = await loadDutyRecipient(db);
  const rows = await findCandidates(db);
  let queued = 0;

  // Событие «простой/дедлайн» кладём в очередь дайджеста. Письмо и push
  // уйдут ОДНИМ пакетом в окно 09–10 или 17–18 МСК — не по одному на тендер.
  const digestRunner = require('./tender-digest-runner');

  for (const row of rows) {
    try {
      if (await alreadySentReview(db, row.review_id, row.notice_kind)) continue;

      const r = await digestRunner.enqueueEvent(db, {
        kind: row.notice_kind === 'deadline_2d' ? 'analysis_deadline' : 'analysis_idle',
        tender_id: row.tender_id,
        title: row.customer_name || row.tender_title || null,
        deadline: row.docs_deadline || null,
        payload: {
          owner: recipient ? recipient.id : row.analysis_owner_user_id || null,
          notice: row.notice_kind,
          idle_hours: row.idle_hours,
          docs_deadline: row.docs_deadline
        }
      });
      if (r && r.queued) queued += 1;
      // Отметку ставим только когда событие реально попало в очередь:
      // иначе дедупликация крона «съест» тендер, не отправив ничего.
      await markSentReview(db, row.review_id, row.notice_kind);
    } catch (err) {
      log?.error?.({ err, review_id: row.review_id }, '[PmAnalysisStale] enqueue failed');
    }
  }
  const overdue = await runOverdueOnce(db, log);
  log?.info?.(`[PmAnalysisStale] candidates=${rows.length} queued=${queued} duty=${recipient ? recipient.id : '—'}`);
  return { candidates: rows.length, queued, overdue };
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
