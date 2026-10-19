'use strict';

/**
 * ASGARD CRM — cron напоминаний по графику отпусков офиса (V411).
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик (17–18.10.2026): отпуск офиса согласуют ВСЕ директора. За 15 дней
 * до начала периода директорам уходит письмо с кнопками «Да / Нет». Дальше —
 * не больше 3 писем (по одному в сутки). Нет ответа на 3-е письмо и истёк
 * следующий день → период снимается АВТОМАТИЧЕСКИ:
 *   • office_vacations.status = 'cancelled';
 *   • все дни периода → office_vacation_blocked_days (блокировка ПО СОТРУДНИКУ);
 *   • сотруднику — уведомление в CRM (колокольчик через notify.js);
 *   • office_vacation_reminders.auto_cancelled_at + запись в office_vacation_audit.
 *
 * Журнал писем = office_vacation_reminders (vacation_id, seq, sent_at), unique
 * (vacation_id, seq). Факт записи в журнал — надёжный инвариант; сама отправка
 * может быть подавлена предохранителем почты (src/lib/mail-killswitch.js) вне прода.
 *
 * Паттерн модуля — как у соседних кронов: start(db, log) / stop(), node-cron,
 * _task-guard, advisory-lock, прод-гейт. Ручной прогон — processVacations(db, log, opts),
 * где opts.today ('YYYY-MM-DD') подменяет «сегодня» (для воспроизводимых тестов).
 *
 * Согласование (голоса директоров) этот модуль НЕ применяет — только шлёт письма
 * и снимает просроченные периоды. Применение решения «Да/Нет» — задача роутов.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const cron = require('node-cron');
const { RULES, fmtRange, daysBetween } = require('./vacation-rules');

let _task = null;

// Advisory-lock: один прогон за раз между инстансами Node (свободный ключ).
const LOCK_KEY = 7766010;
// Кому уходит письмо по периоду: все директора + ADMIN.
const DIRECTOR_ROLES = ['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
// Срок жизни ссылки-решения в письме.
const TOKEN_TTL_HOURS = 72;
const MAX_CANDIDATES = 200;

const AUTO_CANCEL_REASON = 'Автоснятие: директора не ответили на 3 напоминания.';

// ── Утилиты ────────────────────────────────────────────────────────────────

function pickLogger(log) {
  return (log && typeof log.info === 'function') ? log : console;
}

function todayFrom(opts) {
  const t = opts && opts.today;
  if (t instanceof Date) return t.toISOString().slice(0, 10);
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || 'https://asgard-crm.ru')
    .replace(/\/$/, '');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortName(fio) {
  const p = String(fio || '').trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return `${p[0]} ${p[1][0]}.`;
  return p[0] || 'сотрудник';
}

// ── Токен решения «Да/Нет» (stateless HMAC; проверяет роут) ────────────────

function tokenSecret() {
  return process.env.VACATION_TOKEN_SECRET || process.env.JWT_SECRET || 'asgard-vacation-dev';
}

/**
 * Токен для кнопки письма. Роут-приёмник (родительский агент) проверяет его
 * через verifyDecisionToken и применяет решение.
 * @param {number} vacationId
 * @param {number} directorUserId
 * @param {'approve'|'reject'} decision
 * @param {number} [ttlHours]
 */
function decisionToken(vacationId, directorUserId, decision, ttlHours) {
  const exp = Math.floor(Date.now() / 1000) + (Number(ttlHours) || TOKEN_TTL_HOURS) * 3600;
  const payload = `${vacationId}.${directorUserId}.${decision}.${exp}`;
  const sig = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return Buffer.from(payload, 'utf8').toString('base64url') + '.' + sig;
}

/** @returns {{ok:boolean, reason?:string, vacationId?:number, directorUserId?:number, decision?:string}} */
function verifyDecisionToken(raw) {
  const s = String(raw || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payload = Buffer.from(s.slice(0, dot), 'base64url').toString('utf8');
  const sig = s.slice(dot + 1);
  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  const [vacationId, directorUserId, decision, exp] = payload.split('.');
  if (Number(exp) * 1000 < Date.now()) return { ok: false, reason: 'expired' };
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, reason: 'bad_decision' };
  return { ok: true, vacationId: Number(vacationId), directorUserId: Number(directorUserId), decision };
}

// ── Письмо директору ───────────────────────────────────────────────────────

function directorMailHtml(v, seq, dirUserId) {
  // Переиспользуем шелл и кнопки payment-mail (не копируем разметку).
  const { wrapEmail, ctaButtonsDual } = require('./payment-mail');
  const base = publicBaseUrl();
  const yes = `${base}/vacation-decision/${encodeURIComponent(decisionToken(v.id, dirUserId, 'approve'))}`;
  const no = `${base}/vacation-decision/${encodeURIComponent(decisionToken(v.id, dirUserId, 'reject'))}`;

  const from = String(v.date_from_iso).slice(0, 10);
  const to = String(v.date_to_iso).slice(0, 10);
  const period = fmtRange(from, to);
  const fio = v.employee_name || 'Сотрудник';
  const hol = Number(v.holidays_count) || 0;

  const inner = `
    <p style="font-size:15px;line-height:1.5;margin:0 0 12px;">Здравствуйте!</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 12px;">
      ${seq === 1
        ? `Через <b>${RULES.NOTICE_DAYS} дней</b> начинается отпуск сотрудника, который требует вашего решения:`
        : `Напоминание <b>${seq} из ${RULES.REMIND_MAX}</b>. Решения по отпуску всё ещё нет:`}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:12px;">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Сотрудник</td><td style="padding:6px 0;font-weight:700;">${esc(fio)}</td></tr>
      ${v.employee_position ? `<tr><td style="padding:6px 0;color:#6b7280;">Должность</td><td style="padding:6px 0;">${esc(v.employee_position)}</td></tr>` : ''}
      ${v.employee_department ? `<tr><td style="padding:6px 0;color:#6b7280;">Отдел</td><td style="padding:6px 0;">${esc(v.employee_department)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#6b7280;">Период</td><td style="padding:6px 0;font-weight:700;">${esc(period)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Длительность</td><td style="padding:6px 0;"><b>${Number(v.days) || 0} кал. дн.</b>${hol ? ` (+${hol} празд. продлевают)` : ''}</td></tr>
    </table>
    <p style="font-size:14px;line-height:1.5;color:#374151;margin:0 0 6px;">
      Согласуем отпуск или нет? Период считается согласованным, когда «за» все директора.
    </p>
    <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
      Если «Нет» — отпуск будет снят, сотрудник получит уведомление, а система запомнит эти дни:
      повторно поставить их не даст. Без ответа после ${RULES.REMIND_MAX} писем отпуск снимается автоматически.
    </p>`;

  const buttons = ctaButtonsDual({
    primaryUrl: yes,
    secondaryUrl: no,
    primaryLabel: 'Да, согласовать',
    secondaryLabel: 'Нет, снять',
  });

  return wrapEmail(`График отпусков: ${shortName(fio)} — ${period}`, inner + buttons, {
    kicker: 'АСГАРД · ОТПУСКА',
    footer: 'Ответьте кнопкой ниже. Вход в CRM не нужен. Период согласован, когда «за» все директора.',
  });
}

async function loadDirectors(db) {
  const { rows } = await db.query(`
    SELECT id, name, email
      FROM users
     WHERE role = ANY($1::text[])
       AND COALESCE(is_active, true) = true
       AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY id
  `, [DIRECTOR_ROLES]);
  return rows;
}

async function sendDirectorLetters(db, log, v, seq) {
  let directors = [];
  try {
    directors = await loadDirectors(db);
  } catch (e) {
    log.warn(`[vacation-reminders] директора не прочитаны: ${e.message}`);
    return { delivered: 0, recipients: 0 };
  }
  if (!directors.length) {
    log.warn('[vacation-reminders] директора с email не найдены');
    return { delivered: 0, recipients: 0 };
  }

  const fio = v.employee_name || 'сотрудник';
  const period = fmtRange(String(v.date_from_iso).slice(0, 10), String(v.date_to_iso).slice(0, 10));
  const subject = `График отпусков: ${shortName(fio)} — ${period}`;
  let delivered = 0;

  for (const d of directors) {
    // Лично директору — письмо (переиспользуем crm-mailer через payment-mail-шелл).
    try {
      const { sendCrmEmail } = require('./crm-mailer');
      await sendCrmEmail(db, null, {
        to: d.email,
        subject,
        html: directorMailHtml(v, seq, d.id),
        text: `Отпуск ${fio}: ${period}. Согласовать или снять — кнопки в письме.`,
      });
      delivered++;
    } catch (e) {
      log.warn(`[vacation-reminders] письмо директору ${d.id} не ушло: ${e.message}`);
    }
    // Дубль в CRM — чтобы решение не потерялось вне почты.
    try {
      const { createNotification } = require('./notify');
      await createNotification(db, {
        user_id: d.id,
        title: `Отпуск на согласование: ${shortName(fio)}`,
        message: `${period}${seq > 1 ? ` · напоминание ${seq} из ${RULES.REMIND_MAX}` : ''}`,
        type: 'warning',
        link: '#/office-schedule',
      });
    } catch (e) {
      log.warn(`[vacation-reminders] уведомление директору ${d.id}: ${e.message}`);
    }
  }
  return { delivered, recipients: directors.length };
}

// ── Применение одного периода ──────────────────────────────────────────────

/**
 * @returns {{action:string, seq?:number}}
 *   send       — письмо seq записано в журнал (отправка best-effort);
 *   duplicate  — seq уже был (гонка/повторный прогон в тот же день);
 *   autocancel — период снят автоматически;
 *   idle       — решения нет и по правилам ждать (тот же день);
 *   gone       — период уже не pending.
 *
 * Расписание детерминировано ОТ date_from, а не от wall-clock sent_at:
 *   1-е письмо — ровно за NOTICE_DAYS дней до начала;
 *   2-е — через сутки, 3-е — ещё через сутки;
 *   автоснятие — на сутки позже 3-го письма.
 * Это делает прогон воспроизводимым при подмене «сегодня» (opts.today).
 */
async function applyVacation(db, log, v, todayIso) {
  const dFrom = String(v.date_from_iso).slice(0, 10);
  // daysBetween(...) — счёт включительно, вычитаем 1 → true «дней до начала».
  const d = daysBetween(todayIso, dFrom) - 1;
  const sent = Number(v.reminders_sent) || 0;

  if (sent < RULES.REMIND_MAX) {
    // Письмо N: порог d = NOTICE_DAYS - (N - 1). Опоздали по календарю — шлём сразу.
    const due = RULES.NOTICE_DAYS - sent; // порог для письма sent+1
    if (d > due) return { action: 'idle' };
    // Напоминания — РАЗ В СУТКИ: если письмо уже уходило сегодня, второе не шлём.
    const lastSent = v.last_reminder_date ? String(v.last_reminder_date).slice(0, 10) : null;
    if (lastSent && todayIso <= lastSent) return { action: 'idle' };
    const seq = sent + 1;
    const ins = await db.query(`
      INSERT INTO office_vacation_reminders (vacation_id, seq, sent_at)
      VALUES ($1, $2, $3::date)
      ON CONFLICT (vacation_id, seq) DO NOTHING
      RETURNING id
    `, [v.id, seq, todayIso]);
    if (!ins.rowCount) return { action: 'duplicate' };

    const r = await sendDirectorLetters(db, log, v, seq);
    log.info(`[vacation-reminders] v${v.id}: письмо ${seq}/${RULES.REMIND_MAX} → ${r.delivered}/${r.recipients} директоров`);
    return { action: 'send', seq, delivered: r.delivered };
  }

  // Все письма отправлены. Автоснятие — НЕ РАНЬШЕ, чем через сутки после
  // 3-го письма (ТЗ: «напоминания раз в сутки, всего 3; без ответа — автоснятие»).
  // Считаем по факту последнего письма, а не календарной арифметикой: так поведение
  // не зависит от того, когда именно ушло письмо, и повтор в тот же день ничего не снимает.
  const lastSent = v.last_reminder_date ? String(v.last_reminder_date).slice(0, 10) : null;
  if (!lastSent) return { action: 'idle' };              // писем нет — нечего снимать
  if (todayIso <= lastSent) return { action: 'idle' };   // сутки ещё не прошли
  const res = await autoCancel(db, log, v, todayIso);
  return res;
}

/**
 * Автоснятие — ОДНИМ атомарным SQL (без явной транзакции): либо статус
 * переведён и тогда же записаны дни/аудит/штамп, либо ничего.
 */
async function autoCancel(db, log, v, todayIso) {
  const { rows } = await db.query(`
    WITH cancelled AS (
      UPDATE office_vacations
         SET status = 'cancelled', decided_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, employee_id, date_from, date_to
    ),
    days AS (
      INSERT INTO office_vacation_blocked_days (employee_id, date, vacation_id, reason)
      SELECT c.employee_id, d::date, c.id, $2
        FROM cancelled c
        CROSS JOIN LATERAL generate_series(c.date_from, c.date_to, '1 day'::interval) AS d
      ON CONFLICT (employee_id, date) DO NOTHING
      RETURNING 1
    ),
    stamp AS (
      UPDATE office_vacation_reminders
         SET auto_cancelled_at = NOW()
       WHERE vacation_id IN (SELECT id FROM cancelled) AND auto_cancelled_at IS NULL
      RETURNING 1
    ),
    aud AS (
      INSERT INTO office_vacation_audit (vacation_id, employee_id, actor_id, action, details)
      SELECT c.id, c.employee_id, NULL, 'autocancel',
             jsonb_build_object('reason', $2, 'reminders', $3::int, 'today', $4::text)
        FROM cancelled c
      RETURNING 1
    )
    SELECT (SELECT id FROM cancelled)          AS vacation_id,
           (SELECT COUNT(*) FROM days)::int    AS blocked_days,
           (SELECT COUNT(*) FROM stamp)::int   AS stamped,
           (SELECT COUNT(*) FROM aud)::int     AS audited
  `, [v.id, AUTO_CANCEL_REASON, RULES.REMIND_MAX, todayIso]);

  const out = rows[0] || {};
  if (!out.vacation_id) return { action: 'gone' }; // уже не pending (гонка/уже снят)

  const fio = v.employee_name || 'сотрудник';
  const period = fmtRange(String(v.date_from_iso).slice(0, 10), String(v.date_to_iso).slice(0, 10));
  log.info(`[vacation-reminders] v${v.id}: автоснятие, дней заблокировано ${out.blocked_days}`);

  // Сотруднику — уведомление в CRM (колокольчик). Адресат: user_id сотрудника.
  let userId = null;
  try {
    const r = await db.query('SELECT user_id FROM staff WHERE id = $1', [v.employee_id]);
    userId = (r.rows[0] && r.rows[0].user_id) || v.user_id || null;
  } catch (_) {
    userId = v.user_id || null;
  }
  if (userId) {
    try {
      const { createNotification } = require('./notify');
      await createNotification(db, {
        user_id: userId,
        title: `Отпуск снят: ${period}`,
        message: `${fio} — директора не ответили на ${RULES.REMIND_MAX} напоминания. Прежние даты поставить нельзя, выберите другие.`,
        type: 'error',
        link: '#/office-schedule',
      });
    } catch (e) {
      log.warn(`[vacation-reminders] уведомление сотруднику не создано: ${e.message}`);
    }
  }

  return {
    action: 'autocancel',
    blocked_days: out.blocked_days,
    stamped: out.stamped,
    audited: out.audited,
  };
}

// ── advisory-lock + прогон ─────────────────────────────────────────────────

async function acquireConnection(db) {
  try {
    if (db && db.pool && typeof db.pool.connect === 'function') return await db.pool.connect();
    if (db && typeof db.connect === 'function') return await db.connect();
  } catch (_) { /* нет отдельного соединения — работаем на db.query */ }
  return null;
}

async function withLock(db, log, fn) {
  const conn = await acquireConnection(db);
  const q = conn || db;
  let held = false;
  try {
    const r = await q.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_KEY]);
    held = !!(r.rows[0] && r.rows[0].got);
  } catch (e) {
    log.warn(`[vacation-reminders] advisory-lock недоступен: ${e.message}`);
  }
  if (!held) {
    if (conn) conn.release();
    return { skipped: 'locked' };
  }
  try {
    return await fn(q);
  } finally {
    try { await q.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) { /* ignore */ }
    if (conn) conn.release();
  }
}

/**
 * Ручной/тестовый прогон. opts.today ('YYYY-MM-DD' | Date) подменяет «сегодня».
 * @returns {Promise<{candidates:number, sent:number, cancelled:number, idle:number, skipped?:string}>}
 */
async function processVacations(db, log, opts) {
  const lg = pickLogger(log);
  const todayIso = todayFrom(opts);
  return withLock(db, lg, async (q) => {
    const { rows } = await q.query(`
      SELECT v.id, v.employee_id, v.user_id, v.days, v.holidays_count, v.kind, v.year,
             to_char(v.date_from, 'YYYY-MM-DD') AS date_from_iso,
             to_char(v.date_to,   'YYYY-MM-DD') AS date_to_iso,
             s.name       AS employee_name,
             s.position   AS employee_position,
             s.department AS employee_department,
             (SELECT COUNT(*)::int FROM office_vacation_reminders r WHERE r.vacation_id = v.id) AS reminders_sent,
             (SELECT to_char(MAX(r.sent_at), 'YYYY-MM-DD') FROM office_vacation_reminders r WHERE r.vacation_id = v.id) AS last_reminder_date
        FROM office_vacations v
        LEFT JOIN staff s ON s.id = v.employee_id
       WHERE v.status = 'pending'
         AND v.date_from <= ($1::date + ($2::int))
         AND v.date_to   >=  $1::date
       ORDER BY v.date_from ASC, v.id ASC
       LIMIT ${MAX_CANDIDATES}
    `, [todayIso, RULES.NOTICE_DAYS]);

    const summary = { candidates: rows.length, sent: 0, cancelled: 0, idle: 0, duplicate: 0, gone: 0 };
    for (const v of rows) {
      try {
        const r = await applyVacation(q, lg, v, todayIso);
        if (r.action === 'send') summary.sent++;
        else if (r.action === 'autocancel') summary.cancelled++;
        else if (r.action === 'duplicate') summary.duplicate++;
        else if (r.action === 'gone') summary.gone++;
        else summary.idle++;
      } catch (e) {
        lg.error({ err: e }, `[vacation-reminders] v${v.id} не обработан`);
      }
    }
    if (rows.length) lg.info(`[vacation-reminders] ${todayIso}: ${JSON.stringify(summary)}`);
    return summary;
  });
}

// ── Cron ───────────────────────────────────────────────────────────────────

function start(db, log) {
  if (_task) return;
  const lg = pickLogger(log);

  // Прод-гейт: вне прода (тест/staging/клон) реальные письма директорам не шлём.
  const dbName = process.env.DB_NAME || '';
  if (process.env.NODE_ENV !== 'production' || dbName !== 'asgard_crm') {
    lg.info(`[vacation-reminders] Skipped — non-prod runtime (DB_NAME=${dbName}, NODE_ENV=${process.env.NODE_ENV})`);
    return;
  }

  // Раз в сутки, 09:12 MSK.
  _task = cron.schedule('12 9 * * *', () => {
    processVacations(db, lg, {}).catch((e) => lg.error({ err: e }, '[vacation-reminders] run failed'));
  }, { timezone: 'Europe/Moscow' });
  lg.info('[vacation-reminders] Started — daily 09:12 MSK');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

module.exports = {
  start,
  stop,
  processVacations,
  // Опечатка из ТЗ: экспортируем алиасом, чтобы ручной вызов из тестов не падал.
  processVaccations: processVacations,
  decisionToken,
  verifyDecisionToken,
  LOCK_KEY,
  DIRECTOR_ROLES,
};
