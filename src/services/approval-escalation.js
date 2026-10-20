'use strict';

/**
 * D-317: ЭСКАЛАЦИЯ ЗАЯВОК НА СОГЛАСОВАНИЕ (push + уведомление в CRM).
 * ═══════════════════════════════════════════════════════════════════════════
 * ТРЕБОВАНИЕ ЗАКАЗЧИКА (20.10.2026), дословно:
 *   «почему-то нет пуша о том, что пришёл новый счёт / выплата в кассе на
 *    согласование. Проверь, есть ли. Должно приходить сразу как пришла заявка
 *    от инициатора, далее через 12 часов если нет движения, но не позднее
 *    22:00 и не раньше 7:00. Далее через 24 часа. И далее каждые 24 часа.»
 *
 * ЧТО БЫЛО:
 *   • при отправке заявки уведомление директорам создавалось
 *     (`createNotification` шлёт и push) — но только в момент отправки;
 *   • повторных напоминаний НЕ БЫЛО ВООБЩЕ: если директор пропустил первый
 *     пуш, заявка молча умирала и через TTL (168 ч) уезжала в архив;
 *   • у всех трёх директоров в проде было 0 push-подписок, поэтому «пуша нет»
 *     даже при исправном коде (это чинится на клиенте, см. push-notifications.js).
 *
 * ЧТО ДЕЛАЕМ (ровно по ТЗ):
 *   step 1  — сразу при отправке (это делает POST /submit, здесь не дублируем);
 *   step 2  — через 12 ч без решения;
 *   step 3  — через 24 ч от первого напоминания;
 *   step 4+ — каждые 24 ч.
 *
 * ТИХИЕ ЧАСЫ: напоминание не уходит раньше 07:00 и позже 22:00 по Москве.
 *   Если срок «наступил» ночью — ждём до 07:00 и шлём на ближайшем тике.
 *   Сам срок при этом не сдвигается.
 *
 * Почему крон, а не setTimeout: процесс перезапускается (деплой/падение),
 * таймеры теряются. Расписание живёт в БД (`approval_escalation`), поэтому
 * переживает рестарт и не задваивается (атомарный claim).
 */

const cron = require('node-cron');

const TZ = process.env.APP_TZ || 'Europe/Moscow';
const QUIET_FROM = 7;    // 07:00 МСК — раньше не будим
const QUIET_TO = 22;     // 22:00 МСК — позже не будим
const FIRST_DELAY_H = 12;
const NEXT_DELAY_H = 24;

let _job = null;

/** Текущее время в Москве: { hour }. */
function mskNow(now) {
  const d = now || new Date();
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  const hour = parseInt(parts.hour, 10);
  // Intl может отдать «24» для полуночи — приводим к 0.
  return { hour: hour === 24 ? 0 : hour, ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Открыто ли «тихое окно» (можно ли будить). */
function inSendWindow(now) {
  const { hour } = mskNow(now);
  return hour >= QUIET_FROM && hour < QUIET_TO;
}

/** Сколько часов прошло с момента. */
function hoursSince(date, now) {
  if (!date) return Infinity;
  const t = (now ? now.getTime() : Date.now()) - new Date(date).getTime();
  return t / 3600000;
}

/** Следующий интервал ожидания: step 0 → 12ч, далее 24ч. */
function nextDelayHours(step) {
  return step <= 0 ? FIRST_DELAY_H : NEXT_DELAY_H;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function fmtRub(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

/** Текст напоминания с эскалацией по номеру шага. */
function reminderText(pay, step, ageH) {
  const n = Math.max(1, step);
  const age = Math.round(ageH);
  const supplier = pay.supplier_name || 'поставщик не указан';
  const sum = fmtRub(pay.amount);
  if (n <= 1) {
    return {
      title: 'Напоминание: счёт ждёт согласования',
      body: `${supplier} · ${sum}. Висит ${age} ч без решения.`,
      urgent: false
    };
  }
  if (n === 2) {
    return {
      title: 'Повторно: счёт не согласован сутки',
      body: `${supplier} · ${sum}. Ждёт ${age} ч. Инициатор не может оплатить.`,
      urgent: false
    };
  }
  const days = Math.floor(age / 24);
  return {
    title: `Не согласовано ${days} ${plural(days, 'день', 'дня', 'дней')}`,
    body: `${supplier} · ${sum}. Напоминание №${n}. Заявка всё ещё у директора.`,
    urgent: true
  };
}

/**
 * Создать запись расписания для новой заявки (идемпотентно).
 * Вызывается при отправке директору.
 */
async function scheduleForInvoice(db, paymentId, opts) {
  const o = opts || {};
  const firstAt = o.firstAt || new Date(Date.now() + nextDelayHours(0) * 3600000);
  try {
    await db.query(
      `INSERT INTO approval_escalation (payment_invoice_id, step, next_at, created_at, updated_at)
       VALUES ($1, 0, $2, NOW(), NOW())
       ON CONFLICT (payment_invoice_id) DO NOTHING`,
      [paymentId, firstAt]
    );
    return { ok: true, next_at: firstAt };
  } catch (e) {
    // Таблицы может не быть на старом стенде — не ломаем отправку.
    return { ok: false, reason: e.message };
  }
}

/** Снять расписание (директор решил / заявка ушла из awaiting_dir). */
async function clearForInvoice(db, paymentId) {
  try { await db.query('DELETE FROM approval_escalation WHERE payment_invoice_id=$1', [paymentId]); }
  catch (_) { /* не критично */ }
}

/**
 * Один проход: найти заявки, которым пора напомнить, и разослать.
 * @returns {Promise<{due:number, sent:number, skippedQuiet:number}>}
 */
async function runOnce(db, log, now) {
  const at = now || new Date();
  const quiet = !inSendWindow(at);

  const q = await db.query(
    `SELECT e.id AS schedule_id, e.step, e.next_at, e.last_sent_at,
            p.id, p.supplier_name, p.amount, p.created_by, p.created_at, p.submitted_at,
            p.status, p.batch_id, u.name AS initiator_name
       FROM approval_escalation e
       JOIN payment_invoices p ON p.id = e.payment_invoice_id
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.status = 'awaiting_dir'
        AND e.next_at <= $1
        -- D-317: не будим директора из-за мусорных карточек. Старый поток
        -- создавал заявку ДО распознавания (поставщик «Распознаётся…», сумма 0).
        AND COALESCE(p.amount, 0) > 0
        AND COALESCE(p.supplier_name, '') NOT IN ('', 'Распознаётся…')
      ORDER BY e.next_at ASC
      LIMIT 200`,
    [at]
  );

  const due = q.rows.length;
  if (!due) return { due: 0, sent: 0, skippedQuiet: 0 };
  // Тихое окно: ничего не шлём, срок не сдвигаем — уйдёт в 07:00.
  if (quiet) return { due, sent: 0, skippedQuiet: due };

  const dirs = await db.query(
    `SELECT id, name FROM users
      WHERE role IN ('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active = true`
  );
  if (!dirs.rows.length) return { due, sent: 0, skippedQuiet: 0 };

  const { createNotification } = require('./notify');
  let sent = 0;

  for (const row of q.rows) {
    // Атомарный claim: два инстанса не отправят дубль.
    const claim = await db.query(
      `UPDATE approval_escalation
          SET step = step + 1,
              last_sent_at = NOW(),
              next_at = NOW() + ($2 || ' hours')::interval,
              updated_at = NOW()
        WHERE id = $1 AND next_at <= NOW()
        RETURNING step`,
      [row.schedule_id, String(NEXT_DELAY_H)]
    );
    if (!claim.rowCount) continue;

    const step = claim.rows[0].step;
    const base = row.submitted_at || row.created_at;
    const ageH = hoursSince(base, at);
    const txt = reminderText(row, step, Number.isFinite(ageH) ? ageH : 0);
    const link = row.batch_id
      ? `#/payment-invoices?batch=${row.id}`
      : `#/payment-invoices?id=${row.id}`;

    for (const d of dirs.rows) {
      try {
        await createNotification(db, {
          user_id: d.id,
          title: `⏰ ${txt.title}`,
          message: txt.body + (row.initiator_name ? ` Инициатор: ${row.initiator_name}.` : ''),
          type: 'payment',
          link
        });
      } catch (e) {
        log?.warn?.('[ApprovalEscalation] notify: ' + (e && e.message));
      }
    }
    sent++;
  }

  return { due, sent, skippedQuiet: 0 };
}

function start(db, log) {
  if (_job) return;
  // Каждые 15 минут: точность при открытии тихого окна в 07:00.
  _job = cron.schedule('*/15 * * * *', () => {
    runOnce(db, log).then((r) => {
      if (r.sent) log?.info?.(`[ApprovalEscalation] sent=${r.sent} due=${r.due}`);
    }).catch((err) => log?.error?.({ err }, '[ApprovalEscalation] tick failed'));
  }, { timezone: TZ });
  log?.info?.(`[ApprovalEscalation] started (*/15, tz=${TZ}, quiet ${QUIET_FROM}:00–${QUIET_TO}:00)`);
}

function stop() {
  if (_job) { _job.stop(); _job = null; }
}

module.exports = {
  start, stop, runOnce, scheduleForInvoice, clearForInvoice,
  inSendWindow, nextDelayHours, reminderText, mskNow,
  FIRST_DELAY_H, NEXT_DELAY_H, QUIET_FROM, QUIET_TO
};
