'use strict';

/**
 * huginn-notify — единая доставка исходящих уведомлений Хугинна.
 *
 * Зачем (инцидент 17.10.2026): приглашения и коды входа уходили ТОЛЬКО через
 * Mango SMS, а фактически рабочий канал в компании — MAX (Green API):
 *   • твой номер доставлен через MAX (idMessage есть), а Mango «принял»
 *     отправку (result 1000), но доставку не подтверждает НИ РАЗУ за всю
 *     историю (0 записей с reason в webhook);
 *   • у Даши (89267638055) и Кости (89256222808) номера в MAX не заведены.
 *
 * Поэтому нужен КАСКАД: пробуем каналы по порядку и возвращаем честный
 * результат — что реально сработало, а что нет. Модуль НЕ бросает исключение
 * наружу: вызывающий код получает отчёт и сам решает, показывать ли ошибку.
 *
 * Порядок по умолчанию для приглашений/кодов:
 *   MAX (мгновенно, если номер заведён) → Mango SMS → email (если дан адрес).
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Доставить сообщение по каскаду.
 *
 * @param {object} db                     — пул БД
 * @param {object} opts
 * @param {string} [opts.phone]           — номер (любой формат, нормализуем сами)
 * @param {string} [opts.email]           — email для резервного канала
 * @param {string} opts.text              — текст для MAX/SMS (короткий)
 * @param {string} [opts.subject]         — тема письма (email)
 * @param {string} [opts.html]            — HTML письма (email)
 * @param {string[]} [opts.order]         — порядок каналов, по умолчанию ['max','sms','email']
 * @param {object} [opts.logger]          — fastify.log или console
 * @param {number} [opts.timeoutMs=8000]  — таймаут на канал
 * @returns {Promise<{ok:boolean, channel:string|null, attempts:Array<{channel:string, ok:boolean, detail:string}>}>}
 */
async function deliver(db, opts = {}) {
  const {
    phone = null,
    email = null,
    text = '',
    subject = 'АСГАРД Хугинн',
    html = null,
    order = ['max', 'sms', 'email'],
    logger = null,
    timeoutMs = 8000,
  } = opts;

  const log = (level, msg) => {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](msg);
    } catch (_) { /* лог не должен ломать доставку */ }
  };

  const attempts = [];
  // «Принят, но не подтверждён» канал (Mango SMS). Если ни один канал не дал
  // подтверждения, отдаём хотя бы это — не притворяемся, что не пробовали.
  let softAccepted = null;
  const withTimeout = (p, ms) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);

  for (const ch of order) {
    if (ch === 'max') {
      if (!phone) continue;
      try {
        const greenApi = require('./green-api');
        if (typeof greenApi.isMaxEnabled === 'function' && !greenApi.isMaxEnabled()) {
          attempts.push({ channel: 'max', ok: false, detail: 'disabled' });
          continue;
        }
        const r = await withTimeout(greenApi.sendMaxMessage(phone, text), timeoutMs);
        if (r && !r.error) {
          attempts.push({ channel: 'max', ok: true, detail: String(r.idMessage || 'sent') });
          return { ok: true, channel: 'max', attempts };
        }
        attempts.push({ channel: 'max', ok: false, detail: String((r && r.error) || 'no id') });
      } catch (e) {
        // «no max chatId» — обычный случай (номер не заведён в MAX), не ошибка системы.
        attempts.push({ channel: 'max', ok: false, detail: e.message || 'error' });
        log('info', `[huginn-notify] MAX miss ${phone}: ${e.message}`);
      }
      continue;
    }

    if (ch === 'sms') {
      if (!phone) continue;
      try {
        const MangoService = require('./mango');
        const client = new MangoService();
        const digits = MangoService.normalizePhone
          ? MangoService.normalizePhone(phone)
          : String(phone).replace(/\D/g, '');
        const r = await withTimeout(
          client.sendSms(MangoService.smsSenderExtension(), digits, text, process.env.MANGO_SMS_SENDER || ''),
          timeoutMs
        );
        attempts.push({ channel: 'sms', ok: true, detail: String((r && r.command_id) || 'sent') });
        // Mango отвечает «принято», но доставку НЕ подтверждает (0 reason за всю
        // историю). Поэтому не объявляем успех сразу: сначала пробуем email, если
        // он есть. Если email нет — вернём SMS как «принято» в конце каскада.
        softAccepted = { channel: 'sms', detail: String((r && r.command_id) || 'sent') };
        if (order.includes('email') && email) {
          log('info', `[huginn-notify] SMS accepted, но без подтверждения — пробую email ${email}`);
          continue;
        }
        return { ok: true, channel: 'sms', acceptedOnly: true, attempts };
      } catch (e) {
        attempts.push({ channel: 'sms', ok: false, detail: e.message || 'error' });
        log('warn', `[huginn-notify] SMS fail ${phone}: ${e.message}`);
      }
      continue;
    }

    if (ch === 'email') {
      if (!email || !EMAIL_RE.test(String(email))) continue;
      try {
        const { sendCrmEmail } = require('./crm-mailer');
        await withTimeout(sendCrmEmail(db, opts.actorUserId || null, {
          to: email,
          subject,
          text,
          html: html || `<p>${String(text).replace(/\n/g, '<br>')}</p>`,
          skipBcc: true,
        }), Math.max(timeoutMs, 15000));
        attempts.push({ channel: 'email', ok: true, detail: String(email) });
        return { ok: true, channel: 'email', attempts };
      } catch (e) {
        attempts.push({ channel: 'email', ok: false, detail: e.message || 'error' });
        log('warn', `[huginn-notify] email fail ${email}: ${e.message}`);
      }
      continue;
    }
  }

  // Ни один канал не дал подтверждения доставки.
  // Если SMS хотя бы принят Mango — сообщаем это (честно, с пометкой).
  if (softAccepted) {
    return { ok: true, channel: softAccepted.channel, acceptedOnly: true, attempts };
  }
  const firstFail = attempts.find((a) => !a.ok);
  return { ok: false, channel: null, attempts, error: firstFail ? firstFail.detail : 'no channels' };
}

module.exports = { deliver };
