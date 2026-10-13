'use strict';

/**
 * Payout notify — уведомления рабочему о выплате и коды подтверждения.
 * ═══════════════════════════════════════════════════════════════════════════
 * Каналы (по ТЗ): сначала MAX (если у рабочего есть), иначе SMS через Mango.
 * Плюс in-app (notifications) — баннер в мобильном PWA.
 *
 * Код подтверждения хранится хешем (bcrypt), TTL и лимит попыток — из settings.
 * Переиспользуется как паттерн из src/routes/field-auth.js (field_auth_codes).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const CODE_LENGTH = 5;          // 5 цифр — достаточно для одноразового кода
const DEFAULT_TTL_HOURS = 72;
const DEFAULT_COOLDOWN_SEC = 60;
const DEFAULT_MAX_ATTEMPTS = 5;

function generateCode() {
  // crypto-safe RNG, диапазон [10^(N-1), 10^N)
  const min = Math.pow(10, CODE_LENGTH - 1);
  const max = Math.pow(10, CODE_LENGTH);
  return String(crypto.randomInt(min, max));
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
  if (!digits.startsWith('7')) digits = '7' + digits;
  return '+' + digits;
}

async function getSettingNum(db, key, fallback) {
  try {
    const { rows } = await db.query('SELECT value_json FROM settings WHERE key = $1 LIMIT 1', [key]);
    if (!rows[0]) return fallback;
    const v = parseFloat(String(rows[0].value_json).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(v) ? v : fallback;
  } catch (_) { return fallback; }
}

/** Телефон/MAX-адресат рабочего. */
async function resolveEmployeeContacts(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.id, e.fio, e.phone, e.phone2, e.max_phone, e.user_id,
            u.telegram_chat_id, u.max_user_id,
            (SELECT ea.max_user_id FROM employee_assignments ea
              WHERE ea.employee_id = e.id AND ea.max_user_id IS NOT NULL
              ORDER BY ea.id DESC LIMIT 1) AS assign_max_user_id
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = $1`, [employeeId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    employee_id: r.id,
    fio: r.fio,
    user_id: r.user_id,
    phone: normalizePhone(r.max_phone || r.phone || r.phone2),
    max_user_id: r.max_user_id || r.assign_max_user_id || null,
  };
}

/**
 * Отправить код подтверждения выплаты.
 * Возвращает { ok, channel, code_sent } — сам код НЕ возвращается.
 * @param {object} opts { paymentId, employeeId, amount }
 */
async function sendPayoutCode(fastify, db, { paymentId, employeeId, amount }) {
  const contacts = await resolveEmployeeContacts(db, employeeId);
  if (!contacts) return { ok: false, error: 'employee_not_found' };

  // Rate limit: не чаще 1 кода / cooldown
  const cooldown = await getSettingNum(db, 'payout_code_cooldown_sec', DEFAULT_COOLDOWN_SEC);
  try {
    const { rows: recent } = await db.query(
      `SELECT id FROM payout_confirmation_codes
        WHERE payment_id = $1 AND created_at > NOW() - ($2 || ' seconds')::interval
        LIMIT 1`, [paymentId, String(cooldown)]);
    if (recent.length) return { ok: false, error: 'cooldown', retry_after: cooldown };
  } catch (_) {}

  const code = generateCode();
  const hash = await bcrypt.hash(code, 10);
  const ttl = await getSettingNum(db, 'payout_confirm_ttl_hours', DEFAULT_TTL_HOURS);

  // Гасим все прежние живые коды этой выплаты: активным остаётся только новый.
  // Иначе при resend/повторе остаются валидными старые коды.
  await db.query(
    `UPDATE payout_confirmation_codes SET used = true
      WHERE payment_id = $1 AND used = false`, [paymentId]);

  await db.query(
    `INSERT INTO payout_confirmation_codes
       (payment_id, employee_id, phone, channel, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)`,
    [paymentId, employeeId, contacts.phone || null, 'sms', hash, String(ttl)]
  );

  // Текст для рабочего
  const text = `Вам произведена выплата ${Math.round(amount)} ₽. Зайдите в приложение ASGARD CRM и подтвердите получение. Код: ${code}`;
  let channel = 'none';

  // 1) MAX (если есть адресат/аккаунт) — приоритет по ТЗ
  let sent = false;
  try {
    const greenApi = require('../services/green-api');
    if (greenApi && typeof greenApi.isMaxEnabled === 'function' && greenApi.isMaxEnabled() && contacts.phone) {
      const r = await greenApi.sendMaxMessage(contacts.phone, text);
      if (r && !r.error) { sent = true; channel = 'max'; }
    }
  } catch (e) {
    fastify.log.warn(`[payout-notify] MAX fail: ${e.message}`);
  }

  // 2) SMS через Mango (fallback, если MAX не ушёл)
  if (!sent && contacts.phone) {
    try {
      const MangoService = require('../services/mango');
      const mango = new MangoService();
      const from = process.env.MANGO_SMS_EXTENSION || '101';
      await mango.sendSms(from, contacts.phone, text);
      sent = true; channel = 'sms';
    } catch (e) {
      fastify.log.warn(`[payout-notify] SMS fail: ${e.message}`);
    }
  }

  // Фиксируем фактический канал доставки (для отчётности/повторов).
  // Если ничего не ушло — 'none' (не врём 'sms').
  try {
    const ch = channel === 'max' ? 'max' : (channel === 'sms' ? 'sms' : 'none');
    await db.query(
      `UPDATE payout_confirmation_codes SET channel = $2
        WHERE payment_id = $1 AND used = false`, [paymentId, ch]);
  } catch (_) {}

  // 3) in-app (баннер в PWA)
  try {
    if (contacts.user_id) {
      const notify = require('./notify');
      await notify.createNotification(db, {
        user_id: contacts.user_id,
        title: `💰 Выплата ${Math.round(amount)} ₽`,
        message: 'Зайдите в приложение и подтвердите получение.',
        type: 'payment_received',
        link: '/field/earnings',
      });
    }
  } catch (_) {}

  return { ok: sent, channel, phone: contacts.phone, max: !!contacts.max_user_id };
}

/**
 * Проверить код подтверждения выплаты.
 * @returns { ok, error }
 */
async function verifyPayoutCode(db, { paymentId, employeeId, code }) {
  const maxAttempts = await getSettingNum(db, 'payout_code_max_attempts', DEFAULT_MAX_ATTEMPTS);
  const { rows } = await db.query(
    `SELECT id, code_hash, attempts, expires_at, used
       FROM payout_confirmation_codes
      WHERE payment_id = $1 AND employee_id = $2 AND used = false
      ORDER BY created_at DESC LIMIT 1`, [paymentId, employeeId]);
  const row = rows[0];
  if (!row) return { ok: false, error: 'no_code' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: 'expired' };
  if (row.attempts >= maxAttempts) return { ok: false, error: 'too_many_attempts' };

  const match = await bcrypt.compare(String(code), row.code_hash);
  if (!match) {
    await db.query(`UPDATE payout_confirmation_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return { ok: false, error: 'invalid_code', attempts_left: Math.max(0, maxAttempts - row.attempts - 1) };
  }
  await db.query(`UPDATE payout_confirmation_codes SET used = true WHERE id = $1`, [row.id]);
  return { ok: true };
}

module.exports = {
  sendPayoutCode,
  verifyPayoutCode,
  resolveEmployeeContacts,
  generateCode,
  normalizePhone,
  CODE_LENGTH,
};
