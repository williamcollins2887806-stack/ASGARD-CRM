'use strict';

/**
 * V398 (Часть II): TTL согласования директора — 72 часа.
 * ═══════════════════════════════════════════════════════════════════════════
 * Блокер B2 плана: заявка `awaiting_dir`, не подтверждённая директором за
 * `doc_approval_ttl_hours` (по умолчанию 168ч = 7 дней), уходит в архив.
 *
 * Правила:
 *   • при создании заявки ставим `approval_expires_at = NOW() + TTL`;
 *   • крон переводит просроченные `awaiting_dir` → `archived` (архивируем, а не
 *     удаляем: история нужна);
 *   • арбитраж «ответ после TTL»: `applyDecision` на `expired/archived` НЕ
 *     воскрешает заявку молча — возвращает признак, вызывающий код решает
 *     (ручная привязка). См. src/services/payment-mail.js.
 */

const TTL_SETTING = 'doc_approval_ttl_hours';
// D-293 (заказчик 20.10.2026): «увеличь срок согласования до 7 дней, а не 72 часа».
// Было 72 ч (3 дня) — за выходные заявка протухала и молча уезжала в архив, так
// и не показавшись директору. Теперь 168 ч. Значение живёт в настройке
// doc_approval_ttl_hours; здесь — только fallback, если настройки нет.
const DEFAULT_TTL_HOURS = 168;

/** TTL в часах из настроек (fallback 168 = 7 дней). */
async function ttlHours(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key=$1 LIMIT 1`, [TTL_SETTING]);
    if (r.rows[0]) {
      let v = r.rows[0].value_json;
      try { v = JSON.parse(v); } catch (_) { /* строка как есть */ }
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch (_) { /* настройки может не быть */ }
  return DEFAULT_TTL_HOURS;
}

/** Проставить срок истечения новой заявке. */
async function stampExpiry(db, invoiceId, hoursOverride) {
  const h = hoursOverride || await ttlHours(db);
  await db.query(
    `UPDATE payment_invoices
        SET approval_expires_at = NOW() + ($2 || ' hours')::interval
      WHERE id=$1 AND approval_expires_at IS NULL`,
    [invoiceId, String(h)]
  );
  return h;
}

/**
 * Крон: просроченные awaiting_dir → archived.
 * @returns {Promise<{archived:number, ttl:number}>}
 */
async function archiveExpired(db, log) {
  const ttl = await ttlHours(db);
  const { rows } = await db.query(
    `UPDATE payment_invoices
        SET status='archived', archived_at=NOW(), updated_at=NOW()
      WHERE status='awaiting_dir'
        AND COALESCE(approval_expires_at, created_at + ($1 || ' hours')::interval) < NOW()
      RETURNING id`, [String(ttl)]);
  if (rows.length) {
    log?.info?.(`[DocApprovalTTL] arched ${rows.length} awaiting_dir (ttl=${ttl}h)`);
    for (const r of rows) {
      try {
        const { createNotification } = require('./notify');
        const inv = (await db.query(`SELECT created_by, supplier_name FROM payment_invoices WHERE id=$1`, [r.id])).rows[0];
        if (inv && inv.created_by) {
          await createNotification(db, {
            user_id: inv.created_by,
            title: `🗄 Согласование счёта истекло (${ttl}ч)`,
            message: `Заявка «${inv.supplier_name || ''}» ушла в архив: директор не подтвердил вовремя. Отправьте заново или привяжите вручную.`,
            type: 'approval', link: `#/approval-payment?id=${r.id}`
          });
        }
      } catch (_) { /* уведомление не критично */ }
    }
  }
  return { archived: rows.length, ttl };
}

/**
 * Арбитраж ответа: можно ли применять решение к заявке в этом статусе.
 * @returns {{ok:boolean, reason?:string, needsManual?:boolean}}
 */
function canDecide(status) {
  if (status === 'awaiting_dir') return { ok: true };
  if (status === 'expired' || status === 'archived') {
    return { ok: false, reason: 'approval_expired', needsManual: true };
  }
  if (status === 'paid') return { ok: false, reason: 'already_paid' };
  if (status === 'pending_payment') return { ok: false, reason: 'already_approved' };
  if (status === 'rejected') return { ok: false, reason: 'already_rejected' };
  return { ok: false, reason: 'unknown_status' };
}

module.exports = { ttlHours, stampExpiry, archiveExpired, canDecide, DEFAULT_TTL_HOURS };
