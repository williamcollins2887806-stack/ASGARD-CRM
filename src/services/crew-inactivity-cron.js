'use strict';

/**
 * Crew inactivity cron (warn-only)
 * ─────────────────────────────────────────────────────────────
 * Правило (МСК, ежедневно 08:00):
 *   • last_activity = MAX(последний checkin на этой работе,
 *                         конец последнего этапа на этой работе,
 *                         date_from назначения)
 *   • idle = сегодня − last_activity
 *   • ≥25 дней без отметок → одно письмо РП со списком (warn)
 *
 * Автоснятие по простою ОТКЛЮЧЕНО (2026-11): людей без смен, но без
 * признака отъезда, с бригады не снимаем. Снятие — только по отъезду
 * (crew-travel-depart-cron: to_site + from_site, охлаждение 2 суток).
 *
 * Закрытые/отменённые работы не трогаем.
 * Работы site_category='mlsp' не трогаем (вахта — mlsp_stays).
 */

const cron = require('node-cron');
const { notClosedSql } = require('../helpers/work-status');

const WARN_DAYS = 25;
/** @deprecated автоснятие выключено; константа оставлена для совместимости логов/тестов */
const DEPART_DAYS = null;

let _task = null;

function start(db, log) {
  if (_task) return;
  _task = cron.schedule('0 8 * * *', () => {
    run(db, log).catch((e) => log.error('[crew-inactivity] ' + (e && e.message)));
  }, { timezone: 'Europe/Moscow' });
  log.info(`[crew-inactivity] Started — daily 08:00 MSK (warn-only ${WARN_DAYS}d, no auto-depart)`);
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

function fmtRuDate(d) {
  const s = d == null ? '' : String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isNaN(dt.getTime())) {
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yy = dt.getFullYear();
      return `${dd}.${mm}.${yy}`;
    }
  } catch (_) { /* ignore */ }
  return s || '—';
}

function isTestDbName() {
  const name = String(process.env.DB_NAME || process.env.PGDATABASE || '');
  return /_test$/i.test(name) || process.env.CREW_INACTIVITY_NO_EMAIL === '1';
}

async function sendEmailSafe(db, log, payload, opts = {}) {
  if (opts.noEmail || isTestDbName()) {
    log?.info?.(`[crew-inactivity] email skipped (test/noEmail): ${payload && payload.subject}`);
    return { skipped: true };
  }
  try {
    const { sendCrmEmail } = require('./crm-mailer');
    await sendCrmEmail(db, null, payload);
  } catch (e) {
    log?.warn?.({ err: e }, '[crew-inactivity] email failed');
  }
}

/** Работы МЛСП (site_category) не трогаем — вахта 45 суток отдельно (mlsp_stays). */
const NOT_MLSP = `
  AND NOT EXISTS (
    SELECT 1 FROM field_project_settings fps
    WHERE fps.work_id = ea.work_id AND fps.site_category = 'mlsp'
  )`;

async function clearStaleWarnings(db, log) {
  const { rowCount } = await db.query(`
    WITH active AS (
      SELECT ea.id, ea.employee_id, ea.work_id, ea.date_from, ea.created_at::date AS created
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id
      WHERE COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL
        AND ea.inactivity_warned_at IS NOT NULL
        AND w.deleted_at IS NULL
        AND ${notClosedSql('w.work_status')}
        ${NOT_MLSP}
    ),
    marked AS (
      SELECT a.id,
             GREATEST(
               COALESCE((SELECT MAX(fc.date)::date FROM field_checkins fc
                         WHERE fc.employee_id=a.employee_id AND fc.work_id=a.work_id AND fc.status='completed'), '1900-01-01'::date),
               COALESCE((SELECT MAX(COALESCE(fts.date_to,fts.date_from))::date FROM field_trip_stages fts
                         WHERE fts.employee_id=a.employee_id AND fts.work_id=a.work_id
                           AND COALESCE(fts.status,'active') NOT IN ('rejected','cancelled')), '1900-01-01'::date),
               COALESCE(a.date_from, a.created)
             ) AS last_activity
      FROM active a
    )
    UPDATE employee_assignments ea
       SET inactivity_warned_at = NULL, updated_at = NOW()
      FROM marked m
     WHERE ea.id = m.id
       AND (CURRENT_DATE - m.last_activity) < $1
  `, [WARN_DAYS]);
  if (rowCount) log.info(`[crew-inactivity] cleared warnings after new marks: ${rowCount}`);
}

/** Активные назначения на незакрытых работах + last_activity / idle_days */
async function loadIdleCrew(db) {
  const { rows } = await db.query(`
    WITH active AS (
      SELECT ea.id, ea.employee_id, ea.work_id, ea.date_from, ea.created_at::date AS created,
             ea.inactivity_warned_at,
             w.pm_id, w.work_title,
             u.name AS pm_name, u.email AS pm_email,
             COALESCE(e.fio, e.full_name) AS fio
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id
      JOIN employees e ON e.id = ea.employee_id
      LEFT JOIN users u ON u.id = w.pm_id
      WHERE COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL
        AND w.deleted_at IS NULL
        AND ${notClosedSql('w.work_status')}
        ${NOT_MLSP}
    ),
    marked AS (
      SELECT a.*,
             GREATEST(
               COALESCE((
                 SELECT MAX(fc.date)::date FROM field_checkins fc
                  WHERE fc.employee_id = a.employee_id AND fc.work_id = a.work_id
                    AND fc.status = 'completed'
               ), '1900-01-01'::date),
               COALESCE((
                 SELECT MAX(COALESCE(fts.date_to, fts.date_from))::date
                   FROM field_trip_stages fts
                  WHERE fts.employee_id = a.employee_id AND fts.work_id = a.work_id
                    AND COALESCE(fts.status, 'active') NOT IN ('rejected', 'cancelled')
               ), '1900-01-01'::date),
               COALESCE(a.date_from, a.created)
             ) AS last_activity
      FROM active a
    )
    SELECT *,
           (CURRENT_DATE - last_activity) AS idle_days
      FROM marked
     WHERE (CURRENT_DATE - last_activity) >= $1
     ORDER BY pm_id NULLS LAST, work_id, fio
  `, [WARN_DAYS]);
  return rows;
}

async function run(db, log, opts = {}) {
  await clearStaleWarnings(db, log);
  const rows = await loadIdleCrew(db);
  if (!rows.length) {
    log.info('[crew-inactivity] nothing to warn');
    return { warned: 0, departed: 0 };
  }

  const toWarn = rows.filter((r) => !r.inactivity_warned_at);

  const byPm = new Map();
  for (const r of toWarn) {
    const key = r.pm_id || 0;
    if (!byPm.has(key)) {
      byPm.set(key, {
        pm_id: r.pm_id,
        pm_name: r.pm_name || 'РП',
        pm_email: r.pm_email,
        items: []
      });
    }
    byPm.get(key).items.push(r);
  }

  let warned = 0;
  for (const group of byPm.values()) {
    const lines = group.items.map((r) =>
      `• ${r.fio} — «${r.work_title || ('#' + r.work_id)}»: нет отметок ${r.idle_days} дн. (последняя ${fmtRuDate(r.last_activity)})`
    );
    const subject = `[АСГАРД] Нет отметок в табеле ≥${WARN_DAYS} дн. — ${group.items.length} чел.`;
    const text =
      `${group.pm_name}, здравствуйте.\n\n` +
      `У персонала на ваших объектах нет отметок в табеле ${WARN_DAYS}+ дней:\n\n` +
      lines.join('\n') +
      `\n\nПроставьте смены/дорогу в полевом табеле или «Мой табель».\n` +
      `Система НЕ снимает людей с бригады только из‑за отсутствия смен.\n` +
      `Автоснятие — только если в табеле есть заезд и отъезд (дорога/корабль/вертолёт) и прошло 2 дня без смен.\n` +
      `Городской объект / добрался сам — снимите вручную: полевой модуль → Бригада → Отъезд.\n\n` +
      `— АСГАРД CRM`;

    if (group.pm_email) {
      await sendEmailSafe(db, log, {
        to: group.pm_email,
        subject,
        text,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`
      }, opts);
    } else {
      log.warn(`[crew-inactivity] PM ${group.pm_name} (id=${group.pm_id}) has no email — warn logged only`);
    }

    const ids = group.items.map((r) => r.id);
    await db.query(`
      UPDATE employee_assignments
         SET inactivity_warned_at = NOW(), updated_at = NOW()
       WHERE id = ANY($1::int[])
         AND inactivity_warned_at IS NULL
         AND departure_date IS NULL
         AND COALESCE(is_active, true) = true
    `, [ids]);
    warned += ids.length;

    if (group.pm_id) {
      try {
        const { createNotification } = require('./notify');
        await createNotification(db, {
          user_id: group.pm_id,
          title: `Нет отметок ≥${WARN_DAYS} дн.`,
          message: `${group.items.length} чел. без отметок. Автоснятие по простою выключено — проверьте бригаду.`,
          type: 'crew',
          link: '#/pm-works'
        });
      } catch (_) { /* ignore */ }
    }
  }

  log.info(`[crew-inactivity] done warned=${warned} departed=0 (warn-only)`);
  return { warned, departed: 0 };
}

module.exports = {
  start,
  stop,
  run,
  WARN_DAYS,
  DEPART_DAYS
};
