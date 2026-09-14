'use strict';

/**
 * Crew inactivity cron
 * ─────────────────────────────────────────────────────────────
 * Правило (МСК, ежедневно 08:00):
 *   • last_activity = MAX(последний checkin на этой работе,
 *                         конец последнего этапа на этой работе,
 *                         date_from назначения)
 *   • idle = сегодня − last_activity
 *   • ≥25 дней без отметок → одно письмо РП со списком (warn)
 *   • ≥30 дней И уже было предупреждение ≥5 дня назад
 *       → departure_date = last_activity, is_active=false
 *
 * Безопасность первого запуска:
 *   даже если idle=100 дней, сначала ТОЛЬКО письмо; убытие — не раньше
 *   чем через (30−25)=5 дней после warned_at. Массового сноса в день деплоя нет.
 *
 * Закрытые/отменённые работы не трогаем.
 * Работы site_category='mlsp' не трогаем (вахта 45 суток — mlsp_stays).
 */

const cron = require('node-cron');
const { notClosedSql } = require('../helpers/work-status');

const WARN_DAYS = 25;
const DEPART_DAYS = 30;
const WARN_TO_DEPART_GAP = DEPART_DAYS - WARN_DAYS; // 5

let _task = null;

function start(db, log) {
  if (_task) return;
  _task = cron.schedule('0 8 * * *', () => {
    run(db, log).catch((e) => log.error('[crew-inactivity] ' + (e && e.message)));
  }, { timezone: 'Europe/Moscow' });
  log.info(`[crew-inactivity] Started — daily 08:00 MSK (warn ${WARN_DAYS}d / depart ${DEPART_DAYS}d)`);
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function sendEmailSafe(db, log, payload) {
  try {
    const { sendCrmEmail } = require('./crm-mailer');
    await sendCrmEmail(db, null, payload);
  } catch (e) {
    log?.warn?.({ err: e }, '[crew-inactivity] email failed');
  }
}

/** Сбросить предупреждение, если снова появились отметки (idle < WARN). */
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

async function run(db, log) {
  await clearStaleWarnings(db, log);
  const rows = await loadIdleCrew(db);
  if (!rows.length) {
    log.info('[crew-inactivity] nothing to warn/depart');
    return { warned: 0, departed: 0 };
  }

  const toWarn = rows.filter((r) => !r.inactivity_warned_at);

  // ── WARN: группируем по РП ──
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
      `• ${r.fio} — «${r.work_title || ('#' + r.work_id)}»: нет отметок ${r.idle_days} дн. (последняя ${r.last_activity})`
    );
    const subject = `[АСГАРД] Нет отметок в табеле ≥${WARN_DAYS} дн. — ${group.items.length} чел.`;
    const text =
      `${group.pm_name}, здравствуйте.\n\n` +
      `У персонала на ваших объектах нет отметок в табеле ${WARN_DAYS}+ дней:\n\n` +
      lines.join('\n') +
      `\n\nПроставьте смены/дорогу в полевом табеле или «Мой табель».\n` +
      `Если за ${DEPART_DAYS} дней с последней отметки отметок не будет — ` +
      `система снимет их с бригады (дата убытия = дата последней отметки).\n\n` +
      `— АСГАРД CRM`;

    if (group.pm_email) {
      await sendEmailSafe(db, log, {
        to: group.pm_email,
        subject,
        text,
        html: `<p>${text.replace(/\n/g, '<br>')}</p>`
      });
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

    // in-app notification
    if (group.pm_id) {
      try {
        const { createNotification } = require('./notify');
        await createNotification(db, {
          user_id: group.pm_id,
          title: `Нет отметок ≥${WARN_DAYS} дн.`,
          message: `${group.items.length} чел. без отметок. Через ${WARN_TO_DEPART_GAP} дн. после письма — авто-убытие.`,
          type: 'crew',
          link: '#/pm-works'
        });
      } catch (_) { /* ignore */ }
    }
  }

  // ── DEPART: только после warn + gap, idle≥DEPART_DAYS ──
  const { rows: departedRows } = await db.query(`
    WITH active AS (
      SELECT ea.id, ea.employee_id, ea.work_id, ea.date_from, ea.created_at::date AS created,
             ea.inactivity_warned_at,
             COALESCE(e.fio, e.full_name) AS fio,
             w.work_title
      FROM employee_assignments ea
      JOIN works w ON w.id = ea.work_id
      JOIN employees e ON e.id = ea.employee_id
      WHERE COALESCE(ea.is_active, true) = true
        AND ea.departure_date IS NULL
        AND ea.inactivity_warned_at IS NOT NULL
        AND ea.inactivity_warned_at::date <= (CURRENT_DATE - $1::int)
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
    UPDATE employee_assignments ea
       SET departure_date = m.last_activity,
           departure_reason = COALESCE(ea.departure_reason,
             'Авто: нет отметок ≥' || $2::text || ' дн. (последняя отметка ' || m.last_activity::text || ')'),
           is_active = false,
           inactivity_auto_departed_at = NOW(),
           updated_at = NOW()
      FROM marked m
     WHERE ea.id = m.id
       AND (CURRENT_DATE - m.last_activity) >= $2
    RETURNING ea.id, ea.employee_id, ea.work_id, ea.departure_date, m.fio, m.work_title
  `, [WARN_TO_DEPART_GAP, DEPART_DAYS]);

  for (const d of departedRows) {
    log.info(`[crew-inactivity] auto-depart ${d.fio} work#${d.work_id} dep=${d.departure_date}`);
    try {
      await db.query(`
        UPDATE employees
           SET readiness_status = 'unknown', readiness_updated_at = NOW()
         WHERE id = $1 AND COALESCE(readiness_status,'') IN ('on_site','')
      `, [d.employee_id]);
    } catch (_) { /* ignore */ }
  }

  log.info(`[crew-inactivity] done warned=${warned} departed=${departedRows.length}`);
  return { warned, departed: departedRows.length };
}

module.exports = {
  start,
  stop,
  run,
  WARN_DAYS,
  DEPART_DAYS
};
