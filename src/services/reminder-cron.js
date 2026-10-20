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

// ── Хелперы для письма-дайджеста (D-300) ─────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** 2026-10-15 → 15.10.2026 (в письме читается лучше ISO). */
function fmtDateRu(d) {
  const s = String(d || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
/** Русское склонение: 1 задача / 2 задачи / 5 задач. */
function plural(n, one, few, many) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

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
 * 4) Doc Hub — сроки оплаты / СФ / неполнота карточек.
 *    entity_type='doc_registry', link #/doc-hub?id=
 */
async function processDocRegistry(db, log) {
  let created = 0;
  let digest = 0;
  const roleRec = await db.query(
    `SELECT id, role FROM users WHERE COALESCE(is_active,true)=true AND role IN ('BUH','PROC')`
  );
  const buhIds = roleRec.rows.filter((r) => r.role === 'BUH').map((r) => Number(r.id));
  const procIds = roleRec.rows.filter((r) => r.role === 'PROC').map((r) => Number(r.id));

  async function notifyDoc(doc, kind, title, message) {
    const recipients = new Set([...buhIds, ...procIds]);
    if (doc.doc_owner_id) recipients.add(Number(doc.doc_owner_id));
    if (doc.pm_id) recipients.add(Number(doc.pm_id));
    const link = `#/doc-hub?id=${doc.id}`;
    for (const uid of recipients) {
      if (!uid) continue;
      if (await hasRecentReminder(db, uid, 'doc_registry', doc.id, kind)) continue;
      await insertReminder(db, {
        user_id: uid,
        title,
        message,
        link,
        entity_type: 'doc_registry',
        entity_id: doc.id,
        kind
      });
      created++;
    }
    return link;
  }

  // pay soon ≤ 3 days
  const soonQ = await db.query(`
    SELECT id, invoice_number, counterparty_name, payment_due_at, amount_gross, doc_owner_id, pm_id
      FROM doc_registry
     WHERE deleted_at IS NULL
       AND payment_due_at IS NOT NULL
       AND payment_due_at::date >= NOW()::date
       AND payment_due_at::date <= (NOW() + INTERVAL '3 days')::date
       AND COALESCE(pay_status,'none') NOT IN ('paid','n_a')
  `);
  for (const d of soonQ.rows) {
    const numLabel = d.invoice_number || `#${d.id}`;
    await notifyDoc(
      d,
      'doc_pay_soon',
      `🔔 Счёт ${numLabel} скоро к оплате`,
      `Оплата Doc Hub «${d.counterparty_name || ''}» до ${String(d.payment_due_at).slice(0, 10)}.`
    );
  }

  const overduePayQ = await db.query(`
    SELECT id, invoice_number, counterparty_name, payment_due_at, amount_gross, doc_owner_id, pm_id
      FROM doc_registry
     WHERE deleted_at IS NULL
       AND payment_due_at IS NOT NULL
       AND payment_due_at::date < NOW()::date
       AND COALESCE(pay_status,'none') NOT IN ('paid','n_a')
  `);
  for (const d of overduePayQ.rows) {
    const numLabel = d.invoice_number || `#${d.id}`;
    await notifyDoc(
      d,
      'doc_pay_overdue',
      `⚠️ Просрочена оплата ${numLabel}`,
      `Срок оплаты Doc Hub «${d.counterparty_name || ''}» истёк (${String(d.payment_due_at).slice(0, 10)}).`
    );
  }

  const overdueSfQ = await db.query(`
    SELECT id, invoice_number, counterparty_name, sf_due_at, doc_owner_id, pm_id
      FROM doc_registry
     WHERE deleted_at IS NULL
       AND sf_due_at IS NOT NULL
       AND sf_due_at::date < NOW()::date
       AND ops_status IN ('wait_sf','wait_closing')
  `);
  for (const d of overdueSfQ.rows) {
    const numLabel = d.invoice_number || `#${d.id}`;
    await notifyDoc(
      d,
      'doc_sf_overdue',
      `⚠️ Просрочена СФ ${numLabel}`,
      `Ожидаем закрывающие по Doc Hub «${d.counterparty_name || ''}» (срок ${String(d.sf_due_at).slice(0, 10)}).`
    );
  }

  const incompleteQ = await db.query(`
    SELECT id, invoice_number, counterparty_name, doc_owner_id, pm_id, incomplete_reasons
      FROM doc_registry
     WHERE deleted_at IS NULL AND is_incomplete = true
     LIMIT 200
  `);
  for (const d of incompleteQ.rows) {
    const numLabel = d.invoice_number || `#${d.id}`;
    await notifyDoc(
      d,
      'doc_incomplete',
      `📋 Неполная карточка ${numLabel}`,
      `Doc Hub «${d.counterparty_name || ''}» требует дозаполнения.`
    );
  }

  // ── V394: корректировки (запрошены — владельцу) ─────────────────────────
  const corrQ = await db.query(`
    SELECT id, invoice_number, counterparty_name, correction_kind, correction_comment, doc_owner_id, pm_id
      FROM doc_registry
     WHERE deleted_at IS NULL AND correction_state = 'requested'
     LIMIT 200
  `);
  for (const d of corrQ.rows) {
    const numLabel = d.invoice_number || `#${d.id}`;
    const kind = d.correction_kind === 'both' ? 'СФ и акт' : d.correction_kind === 'act' ? 'Акт' : 'СФ';
    await notifyDoc(
      d,
      'doc_correction',
      `🚩 ${kind} НЕ КОРРЕКТЕН: ${numLabel}`,
      `${d.correction_comment || 'Бухгалтерия запросила исправление.'}`
    );
  }

  // ── V394: акты сверки — дедлайн близко / не запрошен ────────────────────
  let reconDocs = [];
  try {
    const cfgRaw = await db.query(
      `SELECT key, value_json FROM settings WHERE key IN ('doc_recon_quarter_deadline_day','doc_recon_year_deadline')`);
    const cfg = {};
    for (const r of cfgRaw.rows) { let v = r.value_json; try { v = JSON.parse(v); } catch (_) {} cfg[r.key] = v; }
    const reconSvc = require('./doc-reconciliation');
    const now = new Date();
    const y = now.getUTCFullYear();
    const q = Math.floor(now.getUTCMonth() / 3) + 1;
    const due = reconSvc.periodDeadline(y, q, {
      quarterDay: parseInt(cfg.doc_recon_quarter_deadline_day, 10) || 10,
      yearDeadline: typeof cfg.doc_recon_year_deadline === 'string' ? cfg.doc_recon_year_deadline : '01-15'
    });
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    if (due <= soon) {
      const { rows } = await db.query(
        `SELECT counterparty_inn, counterparty_name, status FROM doc_reconciliation_acts
          WHERE period_year=$1 AND period_quarter=$2 AND status <> 'received'`, [y, q]);
      reconDocs = rows;
    }
  } catch (e) { log?.warn?.({ err: e }, '[ReminderCron] recon digest failed'); }

  // Best-effort email только на DOC_HUB_MAIL_TO / PAYMENT_MAIL_TO (Андросов), без директоров.
  const mailTo = String(process.env.DOC_HUB_MAIL_TO || process.env.PAYMENT_MAIL_TO || '').trim();
  const mailOk = mailTo && (process.env.NODE_ENV !== 'production' || process.env.DOC_HUB_MAIL_FORCE === '1');
  const totalDocs = soonQ.rows.length + overduePayQ.rows.length + overdueSfQ.rows.length
    + incompleteQ.rows.length + corrQ.rows.length + reconDocs.length;
  if (mailOk && totalDocs > 0) {
    try {
      const { sendCrmEmail } = require('./crm-mailer');
      const subject = `[Doc Hub] Напоминания: soon=${soonQ.rows.length} overdue_pay=${overduePayQ.rows.length} sf=${overdueSfQ.rows.length} incomplete=${incompleteQ.rows.length} corr=${corrQ.rows.length} acts=${reconDocs.length}`;
      const text = [
        'Doc Hub reminder tick',
        `pay_soon: ${soonQ.rows.length}`,
        `pay_overdue: ${overduePayQ.rows.length}`,
        `sf_overdue: ${overdueSfQ.rows.length}`,
        `incomplete: ${incompleteQ.rows.length}`,
        `corrections: ${corrQ.rows.length}`,
        `recon_due: ${reconDocs.length}`,
        `in-app notifications created: ${created}`
      ].join('\n');
      await sendCrmEmail(db, null, { to: mailTo, subject, text, skipBcc: true });
    } catch (e) {
      log?.warn?.({ err: e }, '[ReminderCron] doc_registry mail failed');
    }
  }

  // ── V394: ОДИН digest-email на человека (антидубль doc_reminder_log) ─────
  try {
    digest = await sendDailyDigests(db, log);
  } catch (e) { log?.warn?.({ err: e }, '[ReminderCron] digest failed'); }

  log?.info?.(
    `[ReminderCron] doc_registry: soon=${soonQ.rows.length} overdue_pay=${overduePayQ.rows.length} sf=${overdueSfQ.rows.length} incomplete=${incompleteQ.rows.length} corr=${corrQ.rows.length} acts=${reconDocs.length} notify=${created} digest=${digest}`
  );
  return created;
}

/**
 * V394: крон-дайджест — ОДИН прогон = ОДНО письмо на человека.
 * Собирает все задачи дня (срок оплаты за 1 рабочий день, СФ, корректировки,
 * акты сверки) и объединяет их в одно письмо. Антидубль — doc_reminder_log
 * (UNIQUE doc_id,user_id,kind,due_date): повтор в том же окне не отправляется.
 * @returns {Promise<number>} число отправленных писем
 */
async function sendDailyDigests(db, log) {
  if (String(process.env.DOC_DIGEST_DISABLED || '') === '1') return 0;
  const cfg = await db.query(`SELECT value_json FROM settings WHERE key='doc_digest_enabled' LIMIT 1`);
  if (cfg.rows[0]) {
    let v = cfg.rows[0].value_json;
    try { v = JSON.parse(v); } catch (_) {}
    if (v === false || v === 'false') return 0;
  }
  // Задачи по видимым получателям: владелец/РП строки.
  const { rows: tasks } = await db.query(`
    SELECT d.id AS doc_id,
           COALESCE(d.doc_owner_id, d.pm_id) AS user_id,
           (CASE
              WHEN d.correction_state='requested' THEN 'correction'
              WHEN d.payment_due_at IS NOT NULL AND d.payment_due_at::date <= (NOW() + INTERVAL '1 day')::date
                   AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a') THEN 'pay_due'
              WHEN d.sf_due_at IS NOT NULL AND d.sf_due_at::date <= (NOW() + INTERVAL '5 days')::date
                   AND d.sf_received_at IS NULL THEN 'sf_due'
              ELSE NULL END) AS kind,
           COALESCE(d.payment_due_at, d.sf_due_at)::date AS due_date,
           d.invoice_number, d.counterparty_name
      FROM doc_registry d
     WHERE d.deleted_at IS NULL
       AND COALESCE(d.doc_owner_id, d.pm_id) IS NOT NULL
       AND (d.correction_state = 'requested'
            OR (d.payment_due_at IS NOT NULL AND d.payment_due_at::date <= (NOW() + INTERVAL '1 day')::date
                AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a'))
            OR (d.sf_due_at IS NOT NULL AND d.sf_due_at::date <= (NOW() + INTERVAL '5 days')::date
                AND d.sf_received_at IS NULL))
     LIMIT 1000`);
  if (!tasks.length) return 0;

  const byUser = new Map();
  for (const t of tasks) {
    if (!t.kind) continue;
    if (!byUser.has(t.user_id)) byUser.set(t.user_id, []);
    byUser.get(t.user_id).push(t);
  }
  const { sendCrmEmail } = require('./crm-mailer');
  let sent = 0;
  for (const [userId, items] of byUser) {
    // антидубль: какие из задач уже слали сегодня
    const fresh = [];
    for (const it of items) {
      // V405: у корректировок нет срока → due_date NULL, а NULL-ы в UNIQUE-индексе
      // Postgres считаются РАЗНЫМИ, из-за чего ON CONFLICT не ловил дубль и задача
      // уходила в дайджест повторно. Приводим NULL к сентинелу 9999-12-31 — тот же,
      // что в уникальном индексе uq_doc_reminder_log_task (миграция V405).
      const dueForLog = it.due_date || '9999-12-31';
      const key = [it.doc_id, userId, it.kind, dueForLog];
      const ins = await db.query(
        `INSERT INTO doc_reminder_log (doc_id, user_id, kind, due_date, sent_at, attempts)
         VALUES ($1,$2,$3,$4,NOW(),0) ON CONFLICT (doc_id,user_id,kind,due_date) DO NOTHING RETURNING id`, key);
      if (ins.rowCount) fresh.push({ ...it, log_id: ins.rows[0].id });
    }
    if (!fresh.length) continue;
    const u = (await db.query(`SELECT id, name, email FROM users WHERE id=$1`, [userId])).rows[0];
    if (!u || !u.email) {
      // нет почты — снимаем лог, чтобы не «съесть» задачу навсегда
      await db.query(`DELETE FROM doc_reminder_log WHERE id = ANY($1::int[])`, [fresh.map((f) => f.log_id)]);
      continue;
    }
    const lines = fresh.map((f) => {
      const label = f.invoice_number ? `Счёт ${f.invoice_number}` : `Документ #${f.doc_id}`;
      const dueTxt = f.due_date ? `до ${fmtDateRu(f.due_date)}` : '';
      const overdue = f.due_date && String(f.due_date).slice(0, 10) < todayIso();
      // D-302 (заказчик 20.10.2026): «в письме по каждому нужно указывать,
      // что и где нужно сделать — а то непонятно, что нужно сделать
      // пользователю». Раньше был только тип («💳 срок оплаты») — это
      // констатация, а не инструкция. Теперь для каждой задачи есть:
      //   • action — ЧТО сделать (глагол в повелительном наклонении);
      //   • where  — ГДЕ это сделать в CRM (какой раздел/кнопка).
      // Тексты разные по роли: оплату ставит бухгалтерия, СФ отмечает
      // владелец/склад, корректировку снимает автор.
      let action, where, kindTxt;
      if (f.kind === 'correction') {
        kindTxt = 'корректировка';
        action = 'Заменить СФ/акт и снять флаг';
        where = 'Карточка документа → «Закрывающие» → загрузить новый файл, затем «Снять» в красном баннере';
      } else if (f.kind === 'pay_due') {
        kindTxt = 'срок оплаты';
        // Просрочка и предстоящая оплата — разные действия.
        if (overdue) {
          action = 'Оплатить сегодня и отметить оплату';
          where = 'Карточка документа → «В очередь оплаты» → после платежа «Отметить оплачено» (или через очередь бухгалтерии)';
        } else {
          action = 'Подготовить оплату и отметить оплату';
          where = 'Карточка документа → «В очередь оплаты» → после платежа «Отметить оплачено»';
        }
      } else {
        kindTxt = 'закрывающие';
        action = 'Запросить СФ или акт у поставщика';
        where = 'Карточка документа → «Закрывающие» → добавить номер и дату, либо «СФ получена»';
      }
      return { label, kindTxt, dueTxt, overdue, cp: f.counterparty_name || '', kind: f.kind, doc_id: f.doc_id, action, where };
    });

    // D-300 (заказчик 20.10.2026): письмо было ПЛОСКИМ ТЕКСТОМ и со ссылкой
    // «#/doc-hub» — якорь без домена. В почте такая ссылка не работает вовсе,
    // а «сырой» вид вызывал вопрос «это не баг?».
    // Теперь: премиальный HTML по общему шаблону (wrapEmail — тот же, что у
    // писем-согласований), абсолютная ссылка через publicBaseUrl(), кнопка CTA,
    // цветовая маркировка просрочки, и текстовая версия для клиентов без HTML.
    const { wrapEmail, publicBaseUrl } = require('./payment-mail');
    const base = publicBaseUrl();
    const link = `${base}/?_v=${Date.now()}#/doc-hub`;
    const overdueCount = lines.filter((l) => l.overdue).length;

    const rowHtml = lines.map((l) => {
      const accent = l.overdue ? '#b91c1c' : (l.kind === 'correction' ? '#b45309' : '#1b2a4a');
      const badgeBg = l.overdue ? '#fef2f2' : (l.kind === 'correction' ? '#fff8e6' : '#eef2ff');
      const badgeTxt = l.overdue ? 'просрочено' : (l.kind === 'correction' ? 'корректировка' : l.kindTxt);
      const whereShort = escHtml(l.where.replace('Карточка документа → ', ''));
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #eef1f6;vertical-align:top;">
          <div style="font-size:14px;font-weight:700;color:${accent};">${escHtml(l.label)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escHtml(l.cp)}${l.dueTxt ? ' · ' + escHtml(l.dueTxt) : ''}</div>
          <div style="margin-top:7px;padding:8px 10px;border-left:3px solid ${accent};background:#f8fafc;border-radius:0 6px 6px 0;">
            <div style="font-size:13px;font-weight:700;color:${accent};">${escHtml(l.action)}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:3px;line-height:1.4;">${whereShort}</div>
          </div>
        </td>
        <td style="padding:12px 0 12px 10px;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap;vertical-align:top;">
          <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${badgeBg};color:${accent};">${escHtml(badgeTxt)}</span>
        </td>
      </tr>`;
    }).join('');

    const html = wrapEmail(
      `Задачи по документам: ${fresh.length}`,
      `<div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Здравствуйте, ${escHtml(u.name || '')}!</div>
       <div style="font-size:15px;color:#1b2a4a;margin-bottom:6px;">
         ${fresh.length} ${plural(fresh.length, 'задача', 'задачи', 'задач')} по реестру документов${overdueCount ? `, из них <b style="color:#b91c1c;">${overdueCount} ${plural(overdueCount, 'просрочена', 'просрочены', 'просрочено')}</b>` : ''}.
       </div>
       <div style="font-size:12.5px;color:#6b7280;margin-bottom:14px;">
         По каждой задаче указано, что сделать и в каком месте карточки.
       </div>
       <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">${rowHtml}</table>
       <a href="${escHtml(link)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:18px 0 8px;">Открыть реестр документов</a>
       <p style="font-size:12px;color:#6b7280;margin:10px 0 0;line-height:1.45;">
         Ссылка ведёт в CRM. Если кнопка не открывается — скопируйте адрес:<br>
         <span style="color:#1b2a4a;word-break:break-all;">${escHtml(link)}</span>
       </p>`,
      {
        kicker: 'АСГАРД · ДОКУМЕНТЫ',
        footer: 'Сводка формируется автоматически один раз в день. Задача исчезает из неё, когда действие выполнено: оплата отмечена, СФ/акт получены, корректировка снята.'
      });

    const text =
      `Здравствуйте, ${u.name || ''}!\n\n`
      + `Задачи по реестру документов — ${fresh.length}:\n\n`
      + lines.map((l) => `• ${l.label} · ${l.cp}${l.dueTxt ? ' (' + l.dueTxt + ')' : ''}\n`
          + `  ЧТО СДЕЛАТЬ: ${l.action}\n`
          + `  ГДЕ: ${l.where}`).join('\n\n')
      + `\n\nОткрыть реестр: ${link}\n`;

    try {
      await sendCrmEmail(db, null, {
        to: u.email,
        subject: `[Doc Hub] Задачи по документам: ${fresh.length}`,
        html,
        text,
        skipBcc: true
      });
      sent++;
    } catch (e) {
      await db.query(
        `UPDATE doc_reminder_log SET error=$1, attempts=attempts+1 WHERE id = ANY($2::int[])`,
        [String(e.message || e).slice(0, 500), fresh.map((f) => f.log_id)]);
      log?.warn?.({ err: e, userId }, '[ReminderCron] digest send failed');
    }
  }
  log?.info?.(`[ReminderCron] digest: users=${byUser.size} sent=${sent}`);
  return sent;
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
  let tenders = 0, works = 0, invoices = 0, docs = 0, cleaned = 0, ttlArchived = 0;
  try { tenders = await processTenders(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] tenders failed'); }
  try { works = await processWorks(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] works failed'); }
  try { invoices = await processInvoices(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] invoices failed'); }
  try { docs = await processDocRegistry(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] doc_registry failed'); }
  // V398 (Часть II): TTL согласования директора (72ч) → архив.
  try {
    const ttl = require('./doc-approval-ttl');
    const res = await ttl.archiveExpired(db, log);
    ttlArchived = res.archived;
  } catch (e) { log?.error?.({ err: e }, '[ReminderCron] approval TTL failed'); }
  try { cleaned = await cleanupOld(db, log); } catch (e) { log?.error?.({ err: e }, '[ReminderCron] cleanup failed'); }
  const ms = Date.now() - t0;
  log?.info?.(`[ReminderCron] tick: tenders=${tenders} works=${works} invoices=${invoices} docs=${docs} ttl_archived=${ttlArchived} cleaned=${cleaned} (${ms}ms)`);
  return { tenders, works, invoices, docs, ttlArchived, cleaned, ms };
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

module.exports = { start, stop, runOnce, processDocRegistry, sendDailyDigests };
