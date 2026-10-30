'use strict';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Normalize public Huginn contact numbers to E.164. Local 10-digit numbers and
 * Russian 8XXXXXXXXXX numbers are treated as Russian; explicitly international
 * numbers are preserved. Invalid or ambiguous input returns an empty string.
 */
function normalizePhone(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (value.startsWith('00') && !value.startsWith('+')) digits = digits.replace(/^00/, '');
  if (!value.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (digits.length === 10) digits = '7' + digits;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return '';
  return '+' + digits;
}

function safeLog(logger, level, message) {
  try {
    if (logger && typeof logger[level] === 'function') logger[level](message);
  } catch (_) { /* Diagnostic logging must not break delivery. */ }
}

function timeout(promise, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('provider_timeout');
      error.code = 'provider_timeout';
      reject(error);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), expired]).finally(() => clearTimeout(timer));
}

/**
 * Send a message to a Huginn contact.
 *
 * "accepted" means that a provider accepted the request. It never means
 * "delivered"; only the provider's signed delivery callback can set that state.
 * opts.adapters is intended for deterministic tests; production defaults remain
 * the existing Green API, Mango Office and CRM mail integrations.
 */
async function deliver(db, opts = {}) {
  const {
    phone: rawPhone = null,
    email = null,
    text = '',
    subject = 'АСГАРД Хугинн',
    html = null,
    order = ['max', 'sms', 'email'],
    logger = null,
    timeoutMs = 8000,
    adapters = {},
  } = opts;

  const phone = rawPhone ? normalizePhone(rawPhone) : '';
  const attempts = [];
  const validEmail = email && EMAIL_RE.test(String(email).trim());
  if (rawPhone && !phone) {
    attempts.push({ channel: 'phone', ok: false, status: 'failed', detail: 'invalid_phone' });
    safeLog(logger, 'warn', '[huginn-notify] phone rejected: invalid_phone');
    if (!validEmail || !order.includes('email')) {
      return { ok: false, status: 'failed', deliveryConfirmed: false, channel: null, attempts, error: 'invalid_phone' };
    }
  }

  let greenApi = null;
  let MangoService = null;
  let emailAccepted = false;

  for (const channel of order) {
    if (channel === 'max') {
      if (!phone) continue;
      try {
        greenApi = greenApi || require('./green-api');
        const enabled = adapters.isMaxEnabled ? await adapters.isMaxEnabled() : greenApi.isMaxEnabled();
        if (!enabled) {
          attempts.push({ channel: 'max', ok: false, status: 'unavailable', detail: 'disabled' });
          continue;
        }
        const send = adapters.sendMaxMessage
          ? adapters.sendMaxMessage
          : (to, message) => greenApi.sendMaxMessage(to, message);
        const result = await timeout(send(phone, text), timeoutMs);
        const id = result && result.idMessage != null ? String(result.idMessage).trim() : '';
        if (result && !result.error && id) {
          attempts.push({ channel: 'max', ok: true, status: 'accepted', detail: id });
          return {
            ok: true,
            status: 'accepted',
            deliveryConfirmed: false,
            channel: 'max',
            providerMessageId: id,
            attempts,
          };
        }
        attempts.push({ channel: 'max', ok: false, status: 'failed', detail: 'missing_message_id' });
      } catch (error) {
        const reason = String(error && (error.code || error.message) || 'provider_error');
        const ambiguous = /timeout|timed out|ECONNRESET|ECONNABORTED|fetch failed/i.test(reason);
        attempts.push({
          channel: 'max',
          ok: false,
          status: ambiguous ? 'unknown' : 'failed',
          detail: ambiguous ? 'provider_result_unknown' : 'provider_rejected',
        });
        safeLog(logger, ambiguous ? 'warn' : 'info', '[huginn-notify] MAX attempt: ' + (ambiguous ? 'provider_result_unknown' : 'provider_rejected'));
        // A timeout can mean MAX accepted the message but its response was lost.
        // Do not send a duplicate code through SMS while that result is unknown.
        if (ambiguous) {
          return { ok: false, status: 'unknown', deliveryConfirmed: false, channel: 'max', attempts, error: 'provider_result_unknown' };
        }
      }
      continue;
    }

    if (channel === 'sms') {
      if (!phone) continue;
      try {
        MangoService = MangoService || require('./mango');
        const client = adapters.mangoClient || new MangoService();
        const sender = adapters.smsSender || MangoService.smsSenderExtension();
        const send = adapters.sendSms
          ? () => adapters.sendSms({ phone, text, sender })
          : () => client.sendSms(sender, phone, text, process.env.MANGO_SMS_SENDER || '');
        const result = await timeout(send(), timeoutMs);
        const commandId = result && result.command_id != null ? String(result.command_id).trim() : '';
        if (!result || result.error || !commandId) {
          attempts.push({ channel: 'sms', ok: false, status: 'failed', detail: 'provider_rejected' });
          continue;
        }
        attempts.push({ channel: 'sms', ok: true, status: 'accepted', detail: commandId });
        // Invitations may still use the configured email fallback. OTP callers pass
        // ['max','sms'] and stop here with an honest "accepted, not confirmed" state.
        if (order.includes('email') && validEmail) continue;
        return {
          ok: true,
          status: 'accepted',
          deliveryConfirmed: false,
          channel: 'sms',
          providerMessageId: commandId,
          attempts,
        };
      } catch (error) {
        const reason = String(error && (error.code || error.message) || 'provider_error');
        const ambiguous = /timeout|timed out|ECONNRESET|ECONNABORTED|fetch failed/i.test(reason);
        attempts.push({
          channel: 'sms',
          ok: false,
          status: ambiguous ? 'unknown' : 'failed',
          detail: ambiguous ? 'provider_result_unknown' : 'provider_rejected',
        });
        safeLog(logger, 'warn', '[huginn-notify] SMS attempt: ' + (ambiguous ? 'provider_result_unknown' : 'provider_rejected'));
        if (ambiguous) {
          return { ok: false, status: 'unknown', deliveryConfirmed: false, channel: 'sms', attempts, error: 'provider_result_unknown' };
        }
      }
      continue;
    }

    if (channel === 'email') {
      if (!validEmail) continue;
      try {
        const sendEmail = adapters.sendEmail || (async () => {
          const { sendCrmEmail } = require('./crm-mailer');
          return sendCrmEmail(db, opts.actorUserId || null, {
            to: String(email).trim().toLowerCase(),
            subject,
            text,
            html: html || `<p>${String(text).replace(/\n/g, '<br>')}</p>`,
            skipBcc: true,
          });
        });
        await timeout(sendEmail({ to: String(email).trim().toLowerCase(), subject, text, html }), Math.max(timeoutMs, 15000));
        attempts.push({ channel: 'email', ok: true, status: 'accepted', detail: 'provider_accepted' });
        emailAccepted = true;
        return {
          ok: true,
          status: 'accepted',
          deliveryConfirmed: false,
          channel: 'email',
          providerMessageId: null,
          attempts,
        };
      } catch (_) {
        attempts.push({ channel: 'email', ok: false, status: 'failed', detail: 'provider_rejected' });
        safeLog(logger, 'warn', '[huginn-notify] email attempt: provider_rejected');
      }
    }
  }

  return {
    ok: emailAccepted,
    status: emailAccepted ? 'accepted' : 'failed',
    deliveryConfirmed: false,
    channel: null,
    attempts,
    error: attempts.some((attempt) => attempt.status === 'unknown')
      ? 'provider_result_unknown'
      : (attempts.length ? 'delivery_failed' : 'no_channels'),
  };
}

module.exports = { deliver, normalizePhone };
