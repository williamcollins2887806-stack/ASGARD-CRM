'use strict';

/**
 * Reminder Cron — раз в час сканирует и рассылает напоминания:
 *  1) tenders.deadline в ближайшие 24ч (приближается закрытие) → PM/HEAD_PM/HEAD_TO + автор.
 *  2) works.end_plan в ближайшие 3 дня (работа подходит к концу) → works.pm_id.
 *  3) invoices.due_date в ближайшие 5 дней (счёт скоро к оплате) → BUH + DIRECTOR_GEN.
 *
 * Анти-дубль: notifications.entity_type='reminder' + entity_id+kind за последние 6 часов.
 * Авто-очистка: notifications.type='reminder' старше 48 часов → DELETE.
 *
 * Источник: ledger D-44 (Phase 2 fix conveyor).
 * Схема (сверена с прод):
 *   tenders: deadline (DATE), tender_number, customer_name, created_by, pm_id, tender_status, deleted_at
 *   works: end_plan (DATE), pm_id, work_status, work_number, work_title, deleted_at
 *   invoices: due_date (DATE), status, invoice_number, customer_name, total_amount
 *   notifications: entity_type, entity_id, type, title, message, link, user_id, created_at, is_read
 */

const cron = require('node-cron');

let _job = null;

const WORK_CLOSED_STATUSES = ['Закрыт', 'Закрыта', 'Закрыто', 'Завершена', 'Отменена', 'Работы сдали'];
const INVOICE_PAID_STATUSES = ['paid', 'cancelled', 'оплачен', 'отменён', 'отменен'];

/**
 * Проверка дубля: ищем не-прочитанное reminder-уведомление по entity за последние 6ч.
 */
async function hasRecentReminder(db, userId, entityType, entityId, kind) {
  const r = await db.query(
    `SELECT 1 FROM notifications
      WHERE user_id = $1
        AND entity_type = $2
        AND entity_id = $3
        AND type = 'reminder'
        AND (kind = $4 OR ($4 IS NULL AND kind IS NULL))
        AND is_read = false
        AND created_at >= NOW() - INTERVAL '6 hours'
      LIMIT 1`,
    [userId, entityType, entityId, kind || null]
  );
  return r.rowCount > 0;
}

async function insertReminder(db, row) {
  await db.query(
    `INSERT INTO notifications (user_id, type, title, message, link, entity_type, entity_id, kind, created_at)
     VALUES ($1, 'reminder', $2, $3, $4, $5, $6, $7, NOW())`,
    [row.user_id, row.title, row.message, row.link, row.entity_type, row.entity_id, row.kind || null]
  );
}

/**
 * 1) Тендеры — закрытие в ближайшие 24 часа.
 *    tenders.deadline — DATE (без времени); считаем «истекает в ближайший день».
 */
async function processTenders(db, log) {
  // PM/HEAD_PM/HEAD_TO получатели + автор (created_by) + ответственный (pm_id).
  const tendersQ = await db.query(`
    SELECT t.id, t.tender_number, t.customer_name, t.deadline, t.created_by, t.pm_id
      FROM tenders t
     WHERE t.deleted_at IS NULL
       AND t.deadline IS NOT NULL
       AND t.deadline <= (NOW() + INTERVAL '24 hours')::date
       AND t.deadline >= NOW()::date
       AND COALESCE(t.tender_status,'') NOT IN ('Выиграли','Проиграли','Отменён','Отменен','Архив','won','lost','cancelled')
  `);

  if (!tendersQ.rows.length) {
    log?.info?.('[ReminderCron] tenders: 0 upcoming closes');
    return 0;
  }

  // Получатели по роли — общий список (один раз на тик).
  const recR = await db.query(
    `SELECT id FROM users WHERE COALESCE(is_active,true)=true AND role IN ('PM','HEAD_PM','HEAD_TO')`
  );
  const roleRecipients = recR.rows.map((r) => Number(r.id));

  let created = 0;
  for (const t of tendersQ.rows) {
    const numLabel = t.tender_number || `#${t.id}`;
    const title = `🔔 Тендер ${numLabel} истекает через 24ч`;
    const cust = t.customer_name ? ` (${t.customer_name})` : '';
    const message = `До закрытия тендера${cust} меньше суток. Не пропустите подачу.`;
    const link = `#/tenders?id=${t.id}`;

    // Объединяем получателей: роли + автор + ответственный (без дублей и без NULL).
    const recipients = new Set(roleRecipients);
    if (t.created_by) recipients.add(Number(t.created_by));
    if (t.pm_id) recipients.add(Number(t.pm_id));

    for (const uid of recipients) {
      if (!uid) continue;
      if (await hasRecentReminder(db, uid, 'tender', t.id, 'close_soon')) continue;
      await insertReminder(db, {
        user_id: uid,
        title,
        message,
        link,
        entity_type: 'tender',
        entity_id: t.id,
        kind: 'close_soon'
      });
      created++;
    }
  }
  log?.info?.(`[ReminderCron] tenders: ${tendersQ.rows.length} upcoming, ${created} notifications created`);
  return created;
}

/**
 * 2) Работы — окончание через ≤ 3 дня (без учёта закрытых/завершённых/отменённых).
 *    Только PM работы (works.pm_id).
 */
async function processWorks(db, log) {
  const placeholders = WORK_CLOSED_STATUSES.map((_, i) => `$${i + 1}`).join(',');
  const worksQ = await db.query(
    `SELECT id, work_number, work_title, end_plan, pm_id
       FROM works
      WHERE deleted_at IS NULL
        AND end_plan IS NOT NULL
        AND end_plan <= (NOW() + INTERVAL '3 days')::date
        AND end_plan >= NOW()::date
        AND COALESCE(work_status,'') NOT IN (${placeholders})
        AND pm_id IS NOT NULL`,
    WORK_CLOSED_STATUSES
  );

  if (!worksQ.rows.length) {
    log?.info?.('[ReminderCron] works: 0 ending soon');
    return 0;
  }

  let created = 0;
  for (const w of worksQ.rows) {
    const uid = Number(w.pm_id);
    if (!uid) continue;
    if (await hasRecentReminder(db, uid, 'work', w.id, 'end_soon')) continue;
    const numLabel = w.work_number || `#${w.id}`;
    const ttl = w.work_title ? ` «${w.work_title}»` : '';
    await insertReminder(db, {
      user_id: uid,
      title: `🔔 Работа ${numLabel} подходит к концу`,
      message: `До планового завершения работы${ttl} ≤ 3 дней. Готовьте акт/отчёт.`,
      link: `#/work/${w.id}`,
      entity_type: 'work',
      entity_id: w.id,
      kind: 'end_soon'
    });
    created++;
  }
  log?.info?.(`[ReminderCron] works: ${worksQ.rows.length} ending soon, ${created} notifications created`);
  return created;
}

/**
 * 3) Счета — оплата через ≤ 5 дней (исключаем уже оплаченные/отменённые).
 *    invoices.status (а не payment_status в реальной схеме).
 */
async function processInvoices(db, log) {
  const placeholders = INVOICE_PAID_STATUSES.map((_, i) => `$${i + 1}`).join(',');
  const invoicesQ = await db.query(
    `SELECT id, invoice_number, customer_name, due_date, total_amount
       FROM invoices
      WHERE due_date IS NOT NULL
        AND due_date <= (NOW() + INTERVAL '5 days')::date
        AND due_date >= NOW()::date
        AND LOWER(COALESCE(status,'')) NOT IN (${placeholders})`,
    INVOICE_PAID_STATUSES
  );

  if (!invoicesQ.rows.length) {
    log?.info?.('[ReminderCron] invoices: 0 due soon');
    return 0;
  }

  const recR = await db.query(
    `SELECT id FROM users WHERE COALESCE(is_active,true)=true AND role IN ('BUH','DIRECTOR_GEN')`
  );
  const recipients = recR.rows.map((r) => Number(r.id)).filter(Boolean);
  if (!recipients.length) {
    log?.info?.('[ReminderCron] invoices: no BUH/DIRECTOR_GEN recipients');
    return 0;
  }

  let created = 0;
  for (const inv of invoicesQ.rows) {
    const numLabel = inv.invoice_number || `#${inv.id}`;
    const cust = inv.customer_name ? ` (${inv.customer_name})` : '';
    const sumLabel = inv.total_amount ? `, ${Number(inv.total_amount).toLocaleString('ru-RU')} ₽` : '';
    const title = `🔔 Счёт ${numLabel} скоро к оплате`;
    const message = `Срок оплаты счёта${cust}${sumLabel} наступит в ближайшие 5 дней.`;
    const link = `#/invoices?id=${inv.id}`;
    for (const uid of recipients) {
      if (await hasRecentReminder(db, uid, 'invoice', inv.id, 'due_soon')) continue;
      await insertReminder(db, {
        user_id: uid,
        title,
        message,
        link,
        entity_type: 'invoice',
        entity_id: inv.id,
        kind: 'due_soon'
      });
      created++;
    }
  }
  log?.info?.(`[ReminderCron] invoices: ${invoicesQ.rows.length} due soon, ${created} notifications created`);
  return created;
}

/**
 * Авто-очистка старых reminder-уведомлений (> 48 часов).
 */
async function cleanupOld(db, log) {
  const r = await db.query(
    `DELETE FROM notifications
      WHERE type = 'reminder'
        AND created_at < NOW() - INTERVAL '48 hours'`
  );
  log?.info?.(`[ReminderCron] cleanup: deleted ${r.rowCount || 0} stale reminders`);
  return r.rowCount || 0;
}

async function runOnce(db, log) {
  const t0 = Date.now();
  let tenders = 0, works = 0, invoices = 0, cleaned = 0;
  try { tenders = await processTenders(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] tenders failed'); }
  try { works = await processWorks(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] works failed'); }
  try { invoices = await processInvoices(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] invoices failed'); }
  try { cleaned = await cleanupOld(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] cleanup failed'); }
  const ms = Date.now() - t0;
  log?.info?.(`[ReminderCron] tick: tenders=${tenders} works=${works} invoices=${invoices} cleaned=${cleaned} (${ms}ms)`);
  return { tenders, works, invoices, cleaned, ms };
}

function start(db, log) {
  if (_job) return;
  // Раз в час, в начале часа.
  _job = cron.schedule('0 * * * *', () => {
    runOnce(db, log).catch((err) => log?.error?.({ err }, '[ReminderCron] tick failed'));
  });
  log?.info?.('[ReminderCron] started (hourly)');
}

function stop() {
  if (_job) { _job.stop(); _job = null; }
}

module.exports = { start, stop, runOnce };
