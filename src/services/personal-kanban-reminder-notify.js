'use strict';

/**
 * Personal Kanban Reminder Notify
 * Многоканальная доставка напоминаний: in-app/Telegram/push, WhatsApp, MAX, Email.
 */

const { createNotification } = require('./notify');

const KIND_LABELS = {
  call: 'Звонок',
  sms: 'СМС',
  meeting: 'Встреча',
  task: 'Задача',
  email: 'Письмо',
  other: 'Другое'
};

function fmtMoscow(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) {
    return String(iso);
  }
}

function resolveReminderContact(reminder, entityContact) {
  const ec = entityContact || {};
  return {
    name: (reminder.contact_name || ec.contact_person || '').trim(),
    phone: (reminder.contact_phone || ec.contact_phone || '').trim(),
    company: (reminder.contact_company || ec.customer_name || ec.source_name || '').trim()
  };
}

function entityKindShort(kind) {
  if (kind === 'pre_tender') return 'ПКП';
  if (kind === 'tender') return 'Тендер';
  if (kind === 'inbox_application') return 'Заявка';
  if (kind === 'work') return 'Работа';
  return kind || 'карта';
}

function buildReminderText(reminder, cardMeta, entityContact) {
  const kind = KIND_LABELS[reminder.reminder_kind] || reminder.reminder_kind || 'Напоминание';
  const title = reminder.title ? String(reminder.title).trim() : '';
  const msg = reminder.message ? String(reminder.message).trim() : '';
  const eventAt = fmtMoscow(reminder.event_at || reminder.remind_at);
  const contact = resolveReminderContact(reminder, entityContact);
  const isCallLike = reminder.reminder_kind === 'call' || reminder.reminder_kind === 'sms';

  const cardLabel = cardMeta
    ? `🗂 Карта #${cardMeta.card_id} · ${entityKindShort(cardMeta.entity_kind)} #${cardMeta.entity_id || '—'}${contact.company ? ' · ' + contact.company : ''}`
    : `🗂 Карта #${reminder.card_id}`;

  const lines = [`⏰ ${kind}${title && !isCallLike ? ': ' + title : ''}`];

  if (isCallLike) {
    if (contact.name || contact.phone) {
      lines.push(`👤 ${contact.name || '—'}${contact.phone ? ' · ' + contact.phone : ''}`);
    }
    if (contact.company) lines.push(`🏢 ${contact.company}`);
    if (msg) lines.push(`📋 ${msg}`);
    else if (title) lines.push(`📋 ${title}`);
  } else {
    if (title) lines.push(title);
    if (msg) lines.push('', msg);
  }

  lines.push(cardLabel, `🕐 Событие: ${eventAt} (МСК)`);
  if (contact.phone && isCallLike) {
    const digits = contact.phone.replace(/\D/g, '');
    if (digits) lines.push('', `📞 tel:${digits}`);
  }
  lines.push('', 'АСГАРД CRM · Личный канбан');
  return lines.join('\n');
}

function buildInAppTitle(reminder, contact) {
  const kind = KIND_LABELS[reminder.reminder_kind] || 'Напоминание';
  if (reminder.reminder_kind === 'call' || reminder.reminder_kind === 'sms') {
    const who = contact.name || reminder.title || kind;
    return `${kind}: ${who}`;
  }
  return reminder.title || `${kind} по карте`;
}

function buildInAppMessage(reminder, contact) {
  const parts = [];
  if (contact.phone) parts.push(contact.phone);
  if (reminder.message) parts.push(reminder.message);
  else if (reminder.title && !contact.name) parts.push(reminder.title);
  if (contact.company) parts.push(contact.company);
  return parts.join(' · ') || 'Откройте карту для деталей';
}

function buildEmailSubject(reminder, contact) {
  const kind = KIND_LABELS[reminder.reminder_kind] || 'Напоминание';
  if (reminder.reminder_kind === 'call') {
    const who = contact.name || reminder.title || 'контакт';
    const co = contact.company ? ` — ${contact.company}` : '';
    return `📞 ${kind}: ${who}${co}`;
  }
  return `⏰ ${kind}: ${reminder.title || 'напоминание по карте #' + reminder.card_id}`;
}

async function loadEntityContact(db, entityKind, entityId) {
  if (!entityKind || !entityId) return null;
  try {
    if (entityKind === 'pre_tender') {
      const r = await db.query(
        `SELECT customer_name, contact_person, contact_phone FROM pre_tender_requests WHERE id=$1`,
        [entityId]
      );
      return r.rows[0] || null;
    }
    if (entityKind === 'tender') {
      const r = await db.query(
        `SELECT customer_name, contact_person, contact_phone FROM tenders WHERE id=$1`,
        [entityId]
      );
      return r.rows[0] || null;
    }
    if (entityKind === 'work') {
      const r = await db.query(
        `SELECT customer_name, contact_person, contact_phone FROM works WHERE id=$1`,
        [entityId]
      );
      return r.rows[0] || null;
    }
    if (entityKind === 'inbox_application') {
      const r = await db.query(
        `SELECT source_name, contact_person, contact_phone FROM inbox_applications WHERE id=$1`,
        [entityId]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { customer_name: row.source_name, contact_person: row.contact_person, contact_phone: row.contact_phone };
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function resolveMaxTarget(db, user) {
  if (user.max_user_id) return String(user.max_user_id);

  try {
    const r = await db.query(
      `SELECT ea.max_user_id
         FROM employees e
         JOIN employee_assignments ea ON ea.employee_id = e.id
        WHERE e.user_id = $1
          AND ea.max_user_id IS NOT NULL
        ORDER BY ea.is_active DESC, ea.created_at DESC
        LIMIT 1`,
      [user.id]
    );
    if (r.rows[0] && r.rows[0].max_user_id) {
      return String(r.rows[0].max_user_id);
    }
  } catch (_) { /* ignore */ }

  return null;
}

async function loadUser(db, userId) {
  const r = await db.query(
    `SELECT id, name, phone, email, max_user_id FROM users WHERE id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function sendInApp(db, userId, reminder, text, cardMeta, contact) {
  const title = buildInAppTitle(reminder, contact);
  const message = buildInAppMessage(reminder, contact);
  await createNotification(db, {
    user_id: userId,
    title,
    message: message || text.split('\n').slice(0, 4).join('\n'),
    type: 'personal_kanban_reminder',
    link: `#/personal-kanban-v3?card=${reminder.card_id}`
  });
  return { ok: true };
}

async function sendWhatsapp(user, text, log) {
  const greenApi = require('./green-api');
  if (!greenApi.isEnabled()) return { ok: false, error: 'whatsapp_disabled' };
  if (!user.phone) return { ok: false, error: 'no_phone' };
  try {
    await greenApi.sendMessage(user.phone, text);
    return { ok: true };
  } catch (e) {
    if (log && log.error) log.error({ err: e }, '[pk-reminder-notify] whatsapp failed');
    return { ok: false, error: e.message };
  }
}

async function sendMax(db, user, text, log) {
  const maxMessenger = require('./max-messenger');
  if (!maxMessenger.isEnabled()) return { ok: false, error: 'max_disabled' };

  const maxId = await resolveMaxTarget(db, user);
  if (!maxId) return { ok: false, error: 'no_max_user_id' };

  try {
    await maxMessenger.sendMessage(maxId, text);
    return { ok: true, max_user_id: maxId };
  } catch (e) {
    if (log && log.error) log.error({ err: e }, '[pk-reminder-notify] max failed');
    return { ok: false, error: e.message };
  }
}

async function sendEmail(db, userId, user, reminder, text, contact, log) {
  if (!user.email) return { ok: false, error: 'no_email' };
  try {
    const { sendCrmEmail } = require('./crm-mailer');
    const subject = buildEmailSubject(reminder, contact);
    const html = text.replace(/\n/g, '<br>');
    await sendCrmEmail(db, userId, {
      to: user.email,
      subject,
      text,
      html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${html}</div>`
    });
    return { ok: true };
  } catch (e) {
    if (log && log.error) log.error({ err: e }, '[pk-reminder-notify] email failed');
    return { ok: false, error: e.message };
  }
}

/**
 * @param {object} db
 * @param {object} reminder — строка из personal_kanban_card_reminders + card meta
 * @param {object} log
 */
async function dispatch(db, reminder, log) {
  const user = await loadUser(db, reminder.user_id);
  if (!user) {
    return { ok: false, error: 'user_not_found' };
  }

  const cardMeta = {
    card_id: reminder.card_id,
    entity_kind: reminder.entity_kind,
    entity_id: reminder.entity_id,
    current_main_status: reminder.current_main_status
  };
  const entityContact = await loadEntityContact(db, reminder.entity_kind, reminder.entity_id);
  const contact = resolveReminderContact(reminder, entityContact);
  const text = buildReminderText(reminder, cardMeta, entityContact);
  const channels = Array.isArray(reminder.channels) && reminder.channels.length
    ? reminder.channels
    : ['inapp'];

  const notifyStatus = {};
  let anyOk = false;

  for (const ch of channels) {
    try {
      if (ch === 'inapp') {
        notifyStatus.inapp = await sendInApp(db, reminder.user_id, reminder, text, cardMeta, contact);
      } else if (ch === 'whatsapp') {
        notifyStatus.whatsapp = await sendWhatsapp(user, text, log);
      } else if (ch === 'max') {
        const maxRes = await sendMax(db, user, text, log);
        notifyStatus.max = maxRes;
        if (!maxRes.ok && !channels.includes('whatsapp')) {
          const fb = await sendWhatsapp(user, text, log);
          notifyStatus.max_whatsapp_fallback = fb;
          if (fb.ok) anyOk = true;
        }
      } else if (ch === 'email') {
        notifyStatus.email = await sendEmail(db, reminder.user_id, user, reminder, text, contact, log);
      } else {
        notifyStatus[ch] = { ok: false, error: 'unknown_channel' };
      }
      if (notifyStatus[ch] && notifyStatus[ch].ok) anyOk = true;
    } catch (e) {
      notifyStatus[ch] = { ok: false, error: e.message };
      if (log && log.error) log.error({ err: e, channel: ch }, '[pk-reminder-notify] channel error');
    }
  }

  try {
    await db.query(
      `UPDATE personal_kanban_card_reminders SET notify_status = $1::jsonb WHERE id = $2`,
      [JSON.stringify(notifyStatus), reminder.id]
    );
  } catch (e) {
    if (log && log.error) log.error({ err: e }, '[pk-reminder-notify] notify_status save failed');
  }

  return { ok: anyOk, notify_status: notifyStatus };
}

module.exports = {
  dispatch,
  buildReminderText,
  resolveReminderContact,
  loadEntityContact,
  resolveMaxTarget,
  KIND_LABELS
};
