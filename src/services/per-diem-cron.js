'use strict';

/**
 * Per-Diem Cron — ежедневно 09:30 MSK (пн–сб).
 *
 * 1) РП — только долг по сменам на объекте (per_diem_on_checkins=true).
 *    Пуш: «Не выданы суточные».
 * 2) Хосе (HEAD_TO) — долг по этапам (дорога/МО/обучение/склад/корабль/вертолёт).
 *    Email + пуш: список людей и дат; подсказка через Моя касса.
 *
 * Долг только если реально недоплатили (сумма < дней×ставка), не при нуле запаса.
 */

const cron = require('node-cron');
const { createNotification } = require('./notify');
const { STAGE_TYPES, loadDefaultPerDiem } = require('../lib/worker-per-diem-days');

/** Хосе Вильяр — рук. ТО, суточные за дорогу/МО/обучение */
const JOSE_USER_ID = 3460;
const JOSE_EMAIL = 'hv@asgard-service.com';
const JOSE_LOOKBACK_DAYS = 45;

const STAGE_LABEL = {
  warehouse: 'Склад',
  medical: 'МО',
  travel: 'Дорога',
  ship: 'Корабль',
  training: 'Обучение',
  helicopter: 'Вертолёт',
  waiting: 'Ожидание',
};

let _task = null;

function shortFio(fio) {
  const p = String(fio || '').trim().split(/\s+/).filter(Boolean);
  if (p.length >= 3) return `${p[0]} ${p[1][0]}.${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1][0]}.`;
  return p[0] || '';
}

function shortWorkTitle(title) {
  const t = String(title || '').trim();
  if (t.length <= 52) return t;
  return t.slice(0, 49) + '…';
}

function ymd(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtDate(d) {
  const s = ymd(d);
  if (!s) return '';
  const [Y, M, D] = s.split('-');
  return `${D}.${M}.${Y}`;
}

function start(db, log) {
  if (_task) return;

  _task = cron.schedule('30 9 * * 1-6', () => checkPerDiem(db, log), {
    timezone: 'Europe/Moscow',
  });

  log.info('[per-diem-cron] Started — daily 09:30 MSK (Mon-Sat), PM checkins + Jose stages');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

/**
 * Долг РП: только смены на объекте с per_diem_on_checkins.
 * Сравниваем суммы (не FLOOR дней) — хвост < ставки не даёт ложный −1 день.
 */
async function findPmCheckinDebts(db) {
  const defaultRate = await loadDefaultPerDiem(db);

  const { rows } = await db.query(`
    WITH active_works AS (
      SELECT DISTINCT w.id AS work_id, w.work_title, w.pm_id
      FROM works w
      WHERE w.work_status NOT IN ('Завершена', 'Закрыт')
        AND w.pm_id IS NOT NULL
    ),
    checkin_days AS (
      SELECT
        fc.work_id,
        fc.employee_id,
        COUNT(DISTINCT fc.date)::int AS worked_days,
        COALESCE(
          NULLIF((
            SELECT ea2.per_diem FROM employee_assignments ea2
            WHERE ea2.work_id = fc.work_id
              AND ea2.employee_id = fc.employee_id
              AND COALESCE(ea2.is_active, true) = true
            ORDER BY ea2.id DESC
            LIMIT 1
          ), 0),
          NULLIF((
            SELECT fps2.per_diem FROM field_project_settings fps2
            WHERE fps2.work_id = fc.work_id
            LIMIT 1
          ), 0),
          $1::numeric
        ) AS rate
      FROM field_checkins fc
      JOIN active_works aw ON aw.work_id = fc.work_id
      LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
      LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
      WHERE fc.status = 'completed'
        AND COALESCE(fps.per_diem_on_checkins, true) = true
        AND COALESCE(NULLIF(ea.per_diem, 0), NULLIF(fps.per_diem, 0), 0) > 0
      GROUP BY fc.work_id, fc.employee_id
    ),
    paid AS (
      SELECT
        wp.work_id,
        wp.employee_id,
        COALESCE(SUM(wp.amount), 0)::numeric AS paid_sum
      FROM worker_payments wp
      JOIN active_works aw ON aw.work_id = wp.work_id
      WHERE wp.type = 'per_diem' AND wp.status IN ('paid', 'confirmed')
      GROUP BY wp.work_id, wp.employee_id
    )
    SELECT
      c.work_id,
      aw.work_title,
      aw.pm_id,
      e.fio,
      c.worked_days,
      c.rate,
      COALESCE(p.paid_sum, 0)::numeric AS paid_sum,
      FLOOR(COALESCE(p.paid_sum, 0) / GREATEST(c.rate, 1))::int AS paid_days,
      (c.worked_days * c.rate - COALESCE(p.paid_sum, 0))::numeric AS unpaid_amount,
      CEIL(
        GREATEST(0, c.worked_days * c.rate - COALESCE(p.paid_sum, 0))
        / GREATEST(c.rate, 1)
      )::int AS unpaid_days
    FROM checkin_days c
    JOIN active_works aw ON aw.work_id = c.work_id
    JOIN employees e ON e.id = c.employee_id
    LEFT JOIN paid p ON p.work_id = c.work_id AND p.employee_id = c.employee_id
    WHERE (c.worked_days * c.rate - COALESCE(p.paid_sum, 0)) > 0.009
    ORDER BY unpaid_amount DESC, e.fio
  `, [defaultRate]);

  return rows.map((r) => ({
    ...r,
    days_left: -Number(r.unpaid_days || 0),
    paid_days: Number(r.paid_days || 0),
    worked_days: Number(r.worked_days || 0),
  }));
}

/** @deprecated alias for tests / admin */
async function findLowPerDiem(db) {
  return findPmCheckinDebts(db);
}

/**
 * Долг Хосе: этапы за lookback.
 * Выплаты сначала закрывают смены РП (checkin), остаток — этапы.
 */
async function findJoseStageDebts(db, { lookbackDays = JOSE_LOOKBACK_DAYS } = {}) {
  const rate = await loadDefaultPerDiem(db);
  const stageSql = STAGE_TYPES.map((t) => `'${t}'`).join(',');

  const { rows: stages } = await db.query(`
    SELECT fts.employee_id, e.fio, fts.work_id,
           COALESCE(w.work_title, 'Без объекта') AS work_title,
           fts.stage_type, d.day::date AS day
    FROM field_trip_stages fts
    JOIN employees e ON e.id = fts.employee_id AND COALESCE(e.is_active, true)
    LEFT JOIN works w ON w.id = fts.work_id
    CROSS JOIN LATERAL generate_series(
      fts.date_from::date, COALESCE(fts.date_to, fts.date_from)::date, '1 day'::interval
    ) AS d(day)
    WHERE COALESCE(fts.status, 'active') NOT IN ('cancelled', 'rejected')
      AND fts.stage_type IN (${stageSql})
      AND d.day >= CURRENT_DATE - ($1 || ' days')::interval
      AND d.day <= CURRENT_DATE
      AND (fts.work_id IS NULL OR w.work_status IS NULL
           OR w.work_status NOT IN ('Завершена', 'Закрыт'))
    ORDER BY e.fio, d.day
  `, [String(lookbackDays)]);

  const { rows: checkins } = await db.query(`
    SELECT fc.employee_id, COUNT(DISTINCT fc.date)::int AS days
    FROM field_checkins fc
    JOIN works w ON w.id = fc.work_id
    LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
    LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
    WHERE fc.status = 'completed'
      AND w.work_status NOT IN ('Завершена', 'Закрыт')
      AND COALESCE(fps.per_diem_on_checkins, true) = true
      AND COALESCE(NULLIF(ea.per_diem, 0), NULLIF(fps.per_diem, 0), 0) > 0
      AND fc.date >= CURRENT_DATE - ($1 || ' days')::interval
      AND fc.date <= CURRENT_DATE
    GROUP BY fc.employee_id
  `, [String(lookbackDays)]);
  const checkMap = new Map(checkins.map((r) => [Number(r.employee_id), Number(r.days) || 0]));

  const { rows: paidByEmp } = await db.query(`
    SELECT wp.employee_id,
           COALESCE(SUM(wp.amount), 0)::numeric AS paid_sum
    FROM worker_payments wp
    WHERE wp.type = 'per_diem' AND wp.status IN ('paid', 'confirmed')
      AND wp.paid_at >= CURRENT_DATE - INTERVAL '180 days'
    GROUP BY wp.employee_id
  `);
  const paidMap = new Map(paidByEmp.map((r) => [
    Number(r.employee_id),
    Number(r.paid_sum) || 0,
  ]));

  const byEmp = new Map();
  for (const r of stages) {
    const eid = Number(r.employee_id);
    if (!byEmp.has(eid)) byEmp.set(eid, { fio: r.fio, days: new Map() });
    const day = ymd(r.day);
    const cur = byEmp.get(eid).days.get(day) || { day, types: new Set(), works: new Set() };
    cur.types.add(r.stage_type);
    cur.works.add(r.work_id == null ? 'Без объекта' : `${r.work_title} (#${r.work_id})`);
    byEmp.get(eid).days.set(day, cur);
  }

  const people = [];
  for (const [eid, g] of [...byEmp.entries()].sort((a, b) => a[1].fio.localeCompare(b[1].fio, 'ru'))) {
    const stageList = [...g.days.values()].sort((a, b) => a.day.localeCompare(b.day));
    const stageN = stageList.length;
    const checkN = checkMap.get(eid) || 0;
    let paidDays = Math.floor((paidMap.get(eid) || 0) / Math.max(rate, 1));

    const coverCheck = Math.min(paidDays, checkN);
    paidDays -= coverCheck;
    const coverStages = Math.min(paidDays, stageN);
    const unpaidN = stageN - coverStages;
    if (unpaidN <= 0) continue;

    const unpaid = stageList.slice(coverStages);
    people.push({
      employee_id: eid,
      fio: g.fio,
      unpaid_days: unpaidN,
      amount: unpaidN * rate,
      unpaid,
    });
  }

  return { rate, people };
}

function buildJoseEmailText(people, rate) {
  const lines = [
    'Хосе, добрый день.',
    '',
    'Нужно выдать суточные следующим людям за указанные даты',
    '(дорога, МО, обучение, склад, корабль/вертолёт).',
    'Смены на объекте сюда не входят — их платит РП.',
    '',
  ];

  let totalDays = 0;
  let totalAmt = 0;
  for (const p of people) {
    totalDays += p.unpaid_days;
    totalAmt += p.amount;
    const dates = p.unpaid.map((x) => {
      const types = [...x.types].map((t) => STAGE_LABEL[t] || t).join('/');
      return `${fmtDate(x.day)} (${types})`;
    }).join(', ');
    lines.push(`• ${p.fio}`);
    lines.push(`  Не выдано: ${p.unpaid_days} дн. × ${rate} ₽ = ${p.amount.toLocaleString('ru-RU')} ₽`);
    lines.push(`  Даты: ${dates}`);
    lines.push('');
  }

  lines.push(`Итого: ${totalDays} дн. / ${totalAmt.toLocaleString('ru-RU')} ₽`);
  lines.push('');
  lines.push('Если уже выдали наличными — отметьте в CRM (иначе будет напоминание):');
  lines.push('1) asgard-crm.ru → «Касса» (Моя касса)');
  lines.push('2) «+ Добавить расход»');
  lines.push('3) тип «Суточные рабочему» → рабочий → сумма → «Сохранить»');
  lines.push('   (можно ткнуть подсказку из табеля дороги)');

  return { text: lines.join('\n'), totalDays, totalAmt };
}

function buildJosePushBody(people, totalDays) {
  if (people.length === 1) {
    const p = people[0];
    const dates = p.unpaid.slice(0, 3).map((x) => fmtDate(x.day)).join(', ');
    return `${shortFio(p.fio)}: ${p.unpaid_days} дн. (${dates}${p.unpaid.length > 3 ? '…' : ''})`;
  }
  const names = people.slice(0, 3).map((p) => shortFio(p.fio).split(' ')[0]).join(', ');
  return `${people.length} чел., ${totalDays} дн. — ${names}${people.length > 3 ? '…' : ''}`;
}

async function notifyJose(db, log, { dryRun = false } = {}) {
  const { rate, people } = await findJoseStageDebts(db);
  if (!people.length) {
    log.info('[per-diem-cron] Jose: no stage per-diem debts');
    return { jose_people: 0, jose_notified: false };
  }

  const { text, totalDays, totalAmt } = buildJoseEmailText(people, rate);
  const title = 'Нужно выдать суточные';
  const pushBody = buildJosePushBody(people, totalDays);
  const link = '#/cash?quickExpense=1';

  if (dryRun) {
    log.info(`[per-diem-cron] dry-run Jose: ${people.length} чел., ${totalDays} дн., ${totalAmt} ₽`);
    return { jose_people: people.length, jose_notified: false, dryRun: true, text, pushBody };
  }

  const { rows: existing } = await db.query(`
    SELECT id FROM notifications
    WHERE user_id = $1 AND title = $2 AND created_at >= CURRENT_DATE
    LIMIT 1
  `, [JOSE_USER_ID, title]);

  if (!existing.length) {
    await createNotification(db, {
      user_id: JOSE_USER_ID,
      title,
      message: pushBody,
      type: 'warning',
      link,
    });
  }

  try {
    const { sendCrmEmail } = require('./crm-mailer');
    await sendCrmEmail(db, null, {
      to: JOSE_EMAIL,
      subject: 'Нужно выдать суточные (дорога / МО / обучение)',
      text,
    });
    log.info(`[per-diem-cron] Jose email sent: ${people.length} чел., ${totalDays} дн.`);
  } catch (e) {
    log.warn({ err: e }, '[per-diem-cron] Jose email failed');
  }

  return { jose_people: people.length, jose_notified: true, totalDays, totalAmt };
}

async function notifyPms(db, log, rows, { dryRun = false } = {}) {
  if (!rows.length) return { warned: 0, notified: 0 };

  const byWork = {};
  for (const r of rows) {
    const key = r.work_id + ':' + r.pm_id;
    if (!byWork[key]) {
      byWork[key] = {
        work_id: r.work_id,
        work_title: r.work_title,
        pm_id: r.pm_id,
        people: [],
      };
    }
    byWork[key].people.push({
      fio: r.fio,
      days_left: parseInt(r.days_left, 10),
      worked: parseInt(r.worked_days, 10),
      paid: parseInt(r.paid_days, 10),
    });
  }

  let notified = 0;
  for (const row of Object.values(byWork)) {
    if (!row.pm_id) continue;

    const shown = row.people.slice(0, 3);
    const extra = row.people.length > shown.length
      ? ` и ещё ${row.people.length - shown.length}`
      : '';
    const names = shown
      .map((p) => `${shortFio(p.fio)} (${p.days_left} дн.)`)
      .join(', ');

    const workLabel = shortWorkTitle(row.work_title);
    const title = 'Не выданы суточные';
    const message = `${workLabel}: ${names}${extra}`;
    const link = `#/pm-works?highlight=${row.work_id}`;

    if (dryRun) {
      log.info(`[per-diem-cron] dry-run PM ${row.pm_id}: ${title} — ${message}`);
      notified++;
      continue;
    }

    const { rows: existing } = await db.query(`
      SELECT id FROM notifications
      WHERE user_id = $1
        AND title = $2
        AND created_at >= CURRENT_DATE
      LIMIT 1
    `, [row.pm_id, title]);

    if (existing.length > 0) continue;

    await createNotification(db, {
      user_id: row.pm_id,
      title,
      message,
      type: 'warning',
      link,
    });
    notified++;
    log.info(`[per-diem-cron] Notified PM ${row.pm_id}: ${row.work_title} — ${row.people.length} workers`);
  }

  return { warned: rows.length, notified };
}

async function checkPerDiem(db, log, { dryRun = false } = {}) {
  try {
    log.info('[per-diem-cron] Checking unpaid per-diem (PM checkins + Jose stages)...');

    const pmRows = await findPmCheckinDebts(db);
    const pm = await notifyPms(db, log, pmRows, { dryRun });
    const jose = await notifyJose(db, log, { dryRun });

    if (!pmRows.length && !jose.jose_people) {
      log.info('[per-diem-cron] No unpaid per-diem');
    }

    return {
      warned: pm.warned || 0,
      notified: pm.notified || 0,
      rows: pmRows,
      jose,
    };
  } catch (err) {
    log.error({ err }, '[per-diem-cron] Error');
    throw err;
  }
}

module.exports = {
  start,
  stop,
  checkPerDiem,
  findLowPerDiem,
  findPmCheckinDebts,
  findJoseStageDebts,
  JOSE_USER_ID,
  JOSE_EMAIL,
};
